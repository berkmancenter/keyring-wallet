#!/bin/bash
# The emulator after "boot complete", left to settle before the leg installs and launches the app:
#   android-settle.sh <serial> [max seconds, default 90]
# Done when sys.boot_completed is 1, no "Application Not Responding" window is up (one that is gets dismissed,
# android-anr.sh), the launcher has the focus, and the guest's one-minute load is at or under its core count;
# or when the time is up. Prints one "settle:" line with what it saw (the ci step mark around it gives the time).
# Why: on run 38045665103 System UI hung during a 195 s boot on a cold runner, and its ANR dialog covered the
# app from before the plain launch to the welcome driver (both welcome rows FAIL); local runs never show it.
set -u
S=${1:?emulator serial} MAX=${2:-90}
HERE=$(cd "$(dirname "$0")" && pwd)
adb_() { adb -s "$S" "$@"; }
t0=$(date +%s); dismissed=0; last=""
cores=$(adb_ shell nproc 2>/dev/null | tr -d '\r'); case $cores in ''|*[!0-9]*) cores=2;; esac
adb_ shell wm dismiss-keyguard >/dev/null 2>&1
while :; do
  boot=$(adb_ shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')
  focus=$(adb_ shell dumpsys window windows 2>/dev/null | tr -d '\r' | grep -E 'mCurrentFocus|mFocusedApp' | tr -s ' ' | tr '\n' ' ')
  load=$(adb_ shell cat /proc/loadavg 2>/dev/null | tr -d '\r' | cut -d' ' -f1-3)
  last="boot_completed=${boot:-?} load=[${load:-?}] cores=$cores focus=[${focus:-?}]"
  if echo "$focus" | grep -q 'Not Responding'; then
    "$HERE/android-anr.sh" "$S" | sed 's/^/  anr: /'; case ${PIPESTATUS[0]} in 2) dismissed=$((dismissed + 1));; esac
    sleep 3; continue
  fi
  under=$(echo "${load:-99}" | awk -v c="$cores" '{print ($1 <= c) ? 1 : 0}')
  if [ "$boot" = 1 ] && echo "$focus" | grep -qi 'launcher' && [ "$under" = 1 ]; then
    echo "settle: ready after $(( $(date +%s) - t0 )) s, ANR dialogs dismissed $dismissed; $last"; exit 0
  fi
  if [ $(( $(date +%s) - t0 )) -ge "$MAX" ]; then
    echo "settle: time up after $MAX s (going on), ANR dialogs dismissed $dismissed; $last"; exit 0
  fi
  sleep 5
done
