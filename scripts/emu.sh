#!/usr/bin/env bash
# One Android emulator per machine, started and stopped here and nowhere else.
#
#   scripts/emu.sh start <avd> [--port 5554] [--memory 2048] [-- <extra emulator args>]
#   scripts/emu.sh stop
#   scripts/emu.sh status        # exit 0: zero or one emulator, all accounted for
#
# Why: on 2026-10-01 an Appium-launched emulator was SIGKILLed with Appium's
# process tree and the Mac then refused to boot any emulator (HVF error
# HV_NO_RESOURCES, even a 1 GB guest) until a restart. So:
#   - start refuses when any emulator is already running, or memory is short;
#   - stop asks the emulator to quit (`adb emu kill`), waits, then SIGTERM —
#     never SIGKILL — and stops adb's server only if no device is left;
#   - the e2e harness never launches one (e2e/lib/emulator.js pins sessions to
#     a running emulator's udid), and stopAppium() leaves emulators alone.
# Run `scripts/emu.sh status` at the start of every gate script.
#
# Thresholds (env): EMU_MIN_FREE_GB (3), EMU_MIN_PRESSURE_FREE (25 %),
# EMU_MAX_SWAP_GB (8). State: $EMU_STATE_DIR (~/.cache/keyring-e2e/emu).
set -u

STATE_DIR=${EMU_STATE_DIR:-$HOME/.cache/keyring-e2e/emu}
PID_FILE=$STATE_DIR/emulator.pid
EMULATOR=${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}/emulator/emulator
MIN_FREE_GB=${EMU_MIN_FREE_GB:-3}
MIN_PRESSURE_FREE=${EMU_MIN_PRESSURE_FREE:-25}
MAX_SWAP_GB=${EMU_MAX_SWAP_GB:-8}

die() { echo "emu.sh: $*" >&2; exit 1; }
alive() { [ -n "${1:-}" ] && kill -0 "$1" 2>/dev/null; }

# `adb devices` serials of running emulators, one per line.
adb_emulators() { adb devices 2>/dev/null | awk '$1 ~ /^emulator-[0-9]+$/ {print $1}'; }

# PIDs of emulator/qemu processes, whoever started them. Listing only.
emulator_pids() { pgrep -x emulator 2>/dev/null; pgrep -f '/qemu-system-' 2>/dev/null; }

# pid file: "<pid> <serial> <avd> <started-utc>"
read_state() { [ -f "$PID_FILE" ] && read -r S_PID S_SERIAL S_AVD S_AT < "$PID_FILE"; }

memory_report() {
  local page free inactive pressure swap
  page=$(sysctl -n hw.pagesize)
  free=$(vm_stat | awk '/Pages free/ {gsub("\\.","",$3); print $3}')
  inactive=$(vm_stat | awk '/Pages inactive/ {gsub("\\.","",$3); print $3}')
  FREE_GB=$(( (free + inactive) * page / 1073741824 ))
  pressure=$(memory_pressure 2>/dev/null | awk '/free percentage/ {gsub("%","",$NF); print $NF}')
  PRESSURE_FREE=${pressure:-0}
  swap=$(sysctl -n vm.swapusage | awk '{for (i=1;i<=NF;i++) if ($i=="used") print $(i+2)}')
  # "1234.50M" → whole GB
  SWAP_GB=$(awk -v s="$swap" 'BEGIN { n=s+0; if (s ~ /G$/) print int(n); else print int(n/1024) }')
  echo "memory: free+inactive ${FREE_GB} GB, pressure-free ${PRESSURE_FREE}%, swap used ${SWAP_GB} GB"
}

cmd_status() {
  local rc=0 serials pids
  serials=$(adb_emulators | xargs)
  pids=$(emulator_pids | sort -u | xargs)
  if read_state; then
    if alive "$S_PID"; then echo "ours: $S_AVD as $S_SERIAL, pid $S_PID, since $S_AT"
    else echo "stale pid file (pid $S_PID gone): $PID_FILE"; fi
  fi
  echo "adb emulators: ${serials:-none}"
  echo "emulator/qemu pids: ${pids:-none}"
  memory_report
  if [ "$(echo "$serials" | wc -w)" -gt 1 ]; then echo "NOT OK: more than one emulator"; rc=3; fi
  for p in $pids; do
    if ! { read_state && [ "$p" = "$S_PID" ]; } && [ -z "$serials" ]; then
      echo "NOT OK: emulator/qemu pid $p is not attached to adb (orphan?)"; rc=3
    fi
  done
  return $rc
}

cmd_start() {
  local avd=${1:-} port=5554 memory=2048 extra=()
  [ -n "$avd" ] || die "usage: start <avd> [--port N] [--memory MB] [-- args]"
  shift
  while [ $# -gt 0 ]; do
    case $1 in
      --port) port=$2; shift 2 ;;
      --memory) memory=$2; shift 2 ;;
      --) shift; extra=("$@"); break ;;
      *) die "unknown option $1" ;;
    esac
  done
  [ -x "$EMULATOR" ] || die "no emulator binary at $EMULATOR"
  local running pids
  running=$(adb_emulators | xargs); pids=$(emulator_pids | sort -u | xargs)
  [ -z "$running" ] && [ -z "$pids" ] || die "an emulator is already running (adb: ${running:-none}; pids: ${pids:-none}) — one at a time"
  memory_report
  [ "$FREE_GB" -ge "$MIN_FREE_GB" ] || die "free+inactive ${FREE_GB} GB < ${MIN_FREE_GB} GB"
  [ "$PRESSURE_FREE" -ge "$MIN_PRESSURE_FREE" ] || die "pressure-free ${PRESSURE_FREE}% < ${MIN_PRESSURE_FREE}%"
  [ "$SWAP_GB" -le "$MAX_SWAP_GB" ] || die "swap used ${SWAP_GB} GB > ${MAX_SWAP_GB} GB"

  mkdir -p "$STATE_DIR"
  local serial=emulator-$port log=$STATE_DIR/emulator-$port.log
  # In its own session, so a stop sent to the gate's process group (gate.sh's stop_forward) never reaches qemu
  # directly: only "emu.sh stop" ends it, the path that avoids the 10-01 HV_NO_RESOURCES leak. The pid is the
  # emulator's (perl execs into it).
  nohup perl -e 'use POSIX qw(setsid); setsid(); exec @ARGV' "$EMULATOR" -avd "$avd" -port "$port" -no-snapshot -memory "$memory" ${extra[@]+"${extra[@]}"} > "$log" 2>&1 &
  local pid=$!
  echo "$pid $serial $avd $(date -u +%FT%TZ)" > "$PID_FILE"
  echo "started $avd as $serial, pid $pid (log $log)"

  local i booted=
  for i in $(seq 1 180); do
    alive "$pid" || { tail -5 "$log" >&2; rm -f "$PID_FILE"; die "emulator exited during boot"; }
    [ "$(adb -s "$serial" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ] && { booted=1; break; }
    sleep 2
  done
  [ -n "$booted" ] || { echo "not booted after 360 s; stopping it" >&2; cmd_stop; exit 1; }
  echo "booted: $serial"
}

cmd_stop() {
  read_state || {
    local running; running=$(adb_emulators | xargs)
    [ -z "$running" ] && { echo "nothing to stop"; return 0; }
    die "no pid file, but adb lists ${running}: not started by emu.sh, so not stopped here (adb -s <serial> emu kill)"
  }
  if alive "$S_PID"; then
    adb -s "$S_SERIAL" emu kill > /dev/null 2>&1 || true
    local i
    for i in $(seq 1 60); do alive "$S_PID" || break; sleep 1; done
    if alive "$S_PID"; then
      echo "still running after 60 s; SIGTERM to pid $S_PID"
      kill -TERM "$S_PID" 2>/dev/null
      for i in $(seq 1 30); do alive "$S_PID" || break; sleep 1; done
    fi
    # Never SIGKILL: report and leave it for a person to look at.
    alive "$S_PID" && die "pid $S_PID did not exit after emu kill + SIGTERM; NOT sending SIGKILL — look at it by hand"
  fi
  rm -f "$PID_FILE"
  echo "stopped $S_AVD ($S_SERIAL)"
  # Stop adb's server only when it serves nothing: no emulator, and no USB phone
  # another run may be using.
  if [ -z "$(adb devices 2>/dev/null | awk 'NR > 1 && NF {print $1}')" ]; then
    adb kill-server > /dev/null 2>&1 && echo "adb server stopped (no device left)"
  fi
}

case ${1:-} in
  start) shift; cmd_start "$@" ;;
  stop) cmd_stop ;;
  status) cmd_status ;;
  *) die "usage: emu.sh start <avd> [--port N] [--memory MB] [-- args] | stop | status" ;;
esac
