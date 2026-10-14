#!/bin/bash
# One gate leg on a CI runner (gate-ci.yml), inside reactivecircus/android-emulator-runner's `script:` (one line there).
#   gate-ci-leg.sh <leg>
# Expects: GATE_ENV (the CI configuration file, mode 600), CI_PNM_HOME (the CI identity's sessions, mode 700), PNM_REAL
# (the CI pnm), APK_OFF, CAND_WALLET, CAND_BIFOLD, LEG_DIR, and the emulator on the leg's own port.
# Exit: the leg's (0 pass, 3 a row failed, 1 broken); 2 the environment (ENV line in the log).
set -u
leg=${1:?leg}
HERE=$(cd "$(dirname "$0")" && pwd)
export GATE_TARGET=ci GATE_HOME=$RUNNER_TEMP/gate PNM_BIN=$HERE/pnm-ci.sh
export E2E_RUN_DIR=$LEG_DIR RUN_DIR=$RUNNER_TEMP/gate/run E2E_ONLY_ROWS=${E2E_ONLY_ROWS:-}
# The Mac's builds also bring the iOS simulator app and the push-on APK; a CI leg job downloads only the push-off APK.
# Empty, not unset: legs run under `set -u` and copy them (smoke-android: APP=$CAND_APP) even when they don't use them.
export CAND_APP=${CAND_APP:-} APK_ON=${APK_ON:-}
mkdir -p "$GATE_HOME" "$RUN_DIR" "$LEG_DIR"
# The agents pnm may reach: the configuration's three runners, nothing else (pnm-ci.sh). Not the community agent: that
# widens the identity beyond a runner admin, and no CI leg needs it yet.
CI_ALLOWED_SLUGS=$(grep -E '^(RUNNER_MAIN|RUNNER_A|RUNNER_B)_SLUG=' "$GATE_ENV" | cut -d= -f2- | tr -d '"' | tr '\n' ' ')
[ -n "${CI_ALLOWED_SLUGS// /}" ] || { echo "ENV the CI configuration names no runner slugs" | tee "$LEG_DIR/leg.log"; exit 2; }
export CI_ALLOWED_SLUGS
# Phone grants on CI must expire (pnm-ci.sh refuses one without --expires; the CI identity expires, and the VTA refuses
# an entry that would outlive its granter). enrol-manager.sh reads EXPIRES; the enrolment page already uses 1h.
export EXPIRES=${EXPIRES:-6h}
# One pnm call before the leg (read-only, its JSON discarded): an identity, store or network fault is ENV with pnm's own
# words, not a driver failure four steps later (run 38496808904: the drivers logged only "Command failed: … acl list").
main=$(grep -m1 '^RUNNER_MAIN_SLUG=' "$GATE_ENV" | cut -d= -f2- | tr -d '"')
perr=$("$PNM_BIN" --vta "$main" acl list --json 2>&1 >/dev/null); prc=$?
if [ $prc != 0 ]; then
  echo "ENV pnm preflight failed (exit $prc): $(printf '%s' "$perr" | tail -3 | tr '\n' ' ' | cut -c1-300)" | tee "$LEG_DIR/leg.log"
  exit 2
fi
echo "pnm preflight ok (acl list on the main runner)"
serial=$(adb devices | awk '$1 ~ /^emulator-/ {print $1; exit}')
[ -n "$serial" ] || { echo "ENV no emulator on adb" | tee "$LEG_DIR/leg.log"; exit 2; }
settle=$("$HERE/android-settle.sh" "$serial" "${ANDROID_SETTLE_MAX:-90}"); echo "$settle"
# An ANR dialog that would not go away covers whatever the leg launches: the environment, not a verdict on the app.
if printf '%s' "$settle" | grep -q 'ANR still up'; then
  echo "ENV the emulator kept an ANR dialog up through settling: $(printf '%s' "$settle" | tail -1 | cut -c1-200)" | tee "$LEG_DIR/leg.log"
  exit 2
fi
# The legs pass $AVD to the drivers (ANDROID_AVD), which attach only to an emulator of that AVD name
# (lib/emulator.js pinToRunningEmulator). gate_env's default is the Mac's; here it is whatever the workflow booted,
# read the way the driver reads it (gate-ci run 38496808904: "AVD Pixel_6_API_33 is not running").
avd=$(adb -s "$serial" shell getprop ro.boot.qemu.avd_name 2>/dev/null | tr -d '\r')
[ -n "$avd" ] || avd=$(adb -s "$serial" emu avd name 2>/dev/null | head -1 | tr -d '\r')
[ -n "$avd" ] || { echo "ENV cannot read the emulator's AVD name" | tee "$LEG_DIR/leg.log"; exit 2; }
export AVD=$avd
# The mediator-block legs need root (iptables): a google_apis image gives it; a playstore image would not, silently.
adb -s "$serial" root >/dev/null 2>&1; sleep 3; adb -s "$serial" wait-for-device
uid=$(adb -s "$serial" shell id -u 2>/dev/null | tr -d '\r')
[ "$uid" = 0 ] || { echo "ENV adb root gave uid ${uid:-?}, not 0 (the emulator image must be google_apis)" | tee "$LEG_DIR/leg.log"; exit 2; }
rc=0
bash "$HERE/../legs/$leg.sh" > "$LEG_DIR/leg.log" 2>&1 || rc=$?
cat "$LEG_DIR/leg.log"
echo "leg $leg rc=$rc"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  # The summary is built from leg.log before the scrub step runs, and is not an artifact: every configuration value is
  # replaced here, whatever Actions' masking does or does not cover in a job summary.
  sum=$(mktemp)
  case $rc in 0) v="**pass**" ;; 2) v="**env** — not a verdict on the app" ;; 3) v="**app**: a row failed" ;; *) v="**broken** (exit $rc): setup, not a verdict on the app" ;; esac
  { echo "### Gate leg $leg (CI): $v"; echo; echo "| Status | Row | Detail |"; echo "|---|---|---|"
    grep '^ROW ' "$LEG_DIR/leg.log" | sed 's/|/\\|/g' | sed -E 's/^ROW ([^ ]+) ([A-Z]+) — (.*)$/| \2 | \1 | \3 |/' | cut -c1-400
    echo; grep -m1 -E '^LEG ' "$LEG_DIR/leg.log" | sed 's/^/`/; s/$/`/'; } > "$sum"
  while IFS= read -r l; do
    case "$l" in ''|'#'*) continue ;; esac
    k=${l%%=*}; v=${l#*=}; v=${v#\"}; v=${v%\"}
    [ ${#v} -ge 4 ] && V="$v" K="$k" perl -pi -e 's/\Q$ENV{V}\E/[redacted:$ENV{K}]/g' "$sum"
  done < "$GATE_ENV"
  cat "$sum" >> "$GITHUB_STEP_SUMMARY"; rm -f "$sum"
fi
exit $rc
