# Shared by the own-agent twin scripts. Sourced, never run.
#
# The twin is ONE dedicated lab VTA (default name `carol`, port 8113), beside
# the lab's alice / community / bob, on the lab's mediator. Nothing here reads,
# restarts or writes alice, bob or community: every script refuses those names.

STACK_DIR="${STACK_DIR:-$HOME/vti-stack}"
TWIN="${TWIN_NAME:-carol}"
TWIN_PORT="${TWIN_PORT:-8113}"
TWIN_HOST="${TWIN_HOST:-keyring-vti-$TWIN.ngrok.app}"
TWIN_DIR="$STACK_DIR/$TWIN"
TWIN_ENV="$TWIN_DIR/twin.env"
TWIN_PIDFILE="$TWIN_DIR/vta.pid"
TWIN_LOG="$STACK_DIR/logs/$TWIN.log"
# The VTA's log is capped: past this many bytes it stops being written (the VTA
# keeps running; Rust ignores SIGPIPE and the logger drops the write).
TWIN_LOG_MAX="${TWIN_LOG_MAX:-52428800}"
NGROK_API="${NGROK_API:-http://127.0.0.1:4040/api}"

VTI_SRC="${VTI_SRC:-$HOME/Documents/vti-main}"
VTA_BIN="${VTA_BIN:-$VTI_SRC/target/debug/vta}"
PNM_BIN="${PNM_BIN:-$VTI_SRC/target/debug/pnm}"
HERE_TWIN="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PNM_LOCKED="$HERE_TWIN/../pnm-locked"
export RUST_MIN_STACK="${RUST_MIN_STACK:-33554432}"

case "$TWIN" in
  alice | bob | community | vtc | dids | mediator | farm* | "")
    echo "refusing: \"$TWIN\" is a shared lab or Farm name, not the twin" >&2
    exit 2 ;;
esac
case "$TWIN_PORT" in
  7037 | 8110 | 8111 | 8112 | 8200 | 8534)
    echo "refusing: port $TWIN_PORT belongs to a shared lab service" >&2
    exit 2 ;;
esac

strip_ansi() { sed -e 's/\x1b\[[0-9;]*m//g'; }

# The PID listening on the twin's port, if any.
twin_listener() { lsof -nP -iTCP:"$TWIN_PORT" -sTCP:LISTEN -t 2>/dev/null | head -1 || true; }

# True when PID is this twin's VTA (its command line names this twin's config).
# Kill by PID only, and only a PID proven to be ours.
is_twin_pid() {
  local pid=$1
  [ -n "$pid" ] || return 1
  ps -o command= -p "$pid" 2>/dev/null | grep -qF -- "--config $TWIN_DIR/config.toml"
}

twin_stop() {
  local pid
  pid=$(twin_listener)
  [ -z "$pid" ] && [ -f "$TWIN_PIDFILE" ] && pid=$(cat "$TWIN_PIDFILE")
  if [ -z "$pid" ] || ! kill -0 "$pid" 2>/dev/null; then
    rm -f "$TWIN_PIDFILE"
    return 0
  fi
  if ! is_twin_pid "$pid"; then
    echo "refusing to stop pid $pid: it is not $TWIN's VTA ($(ps -o command= -p "$pid" | cut -c1-120))" >&2
    return 1
  fi
  kill "$pid"
  # Wait for it to let go of its store: the next act is usually a CLI write.
  for _ in $(seq 1 30); do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
  if kill -0 "$pid" 2>/dev/null; then
    echo "  $TWIN (pid $pid) ignored SIGTERM for 30s — SIGKILL" >&2
    kill -9 "$pid" 2>/dev/null || true
    sleep 2
  fi
  rm -f "$TWIN_PIDFILE"
  echo "  stopped $TWIN (pid $pid)"
}

twin_start() {
  local pid
  pid=$(twin_listener)
  if [ -n "$pid" ]; then
    is_twin_pid "$pid" || { echo "port $TWIN_PORT is held by something else (pid $pid)" >&2; return 1; }
    echo "$pid" > "$TWIN_PIDFILE"
    echo "  $TWIN already running (pid $pid)"
    return 0
  fi
  mkdir -p "$(dirname "$TWIN_LOG")"
  # The previous start's log is kept once, as evidence for the start before.
  [ -f "$TWIN_LOG" ] && mv -f "$TWIN_LOG" "$TWIN_LOG.prev"
  # A new log per start, capped at TWIN_LOG_MAX bytes by `head`. The wrapper's
  # own stdio is /dev/null, so a caller piping this script's output is never
  # held open by the daemon. The PID recorded is the one listening on the port
  # (the VTA itself, which the wrapper execs), read back once it is up.
  ( cd "$STACK_DIR" && exec nohup bash -c 'exec "$0" --config "$1" 2>&1 | head -c "$2" > "$3"' \
      "$VTA_BIN" "$TWIN_DIR/config.toml" "$TWIN_LOG_MAX" "$TWIN_LOG" ) </dev/null >/dev/null 2>&1 &
  local up
  for _ in $(seq 1 40); do
    up=$(twin_listener)
    if [ -n "$up" ]; then
      echo "$up" > "$TWIN_PIDFILE"
      echo "  started $TWIN (pid $up, :$TWIN_PORT, log $TWIN_LOG)"
      return 0
    fi
    sleep 1
  done
  echo "  $TWIN did not come up on :$TWIN_PORT — see $TWIN_LOG" >&2
  return 1
}

# pnm on the twin, through the machine-wide per-slug lock.
twin_pnm() { PNM_BIN="$PNM_BIN" "$PNM_LOCKED" --vta "$TWIN" "$@"; }

# The ACL as JSON (full DIDs), online, through the twin's harness profile.
twin_acl_json() {
  local out="" attempt
  # Up to three tries: right after a restart the agent can still be joining
  # its mediator, and the lab's tunnels drop a request now and then.
  for attempt in 1 2 3; do
    out=$(twin_pnm acl list --json 2>/dev/null) && break
    out=""
    [ "$attempt" -lt 3 ] && sleep 5
  done
  [ -n "$out" ] || return 1
  printf '%s' "$out" | python3 -c 'import sys,json; t=sys.stdin.read(); print(json.dumps(json.loads(t[t.index("["):]), indent=1))'
}
