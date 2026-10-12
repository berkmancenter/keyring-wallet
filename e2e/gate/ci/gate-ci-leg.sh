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
mkdir -p "$GATE_HOME" "$RUN_DIR" "$LEG_DIR"
# The agents pnm may reach: the configuration's runners and its community agent, nothing else (pnm-ci.sh).
CI_ALLOWED_SLUGS=$(grep -E '^(RUNNER_MAIN|RUNNER_A|RUNNER_B|COMMUNITY_AGENT)_SLUG=' "$GATE_ENV" | cut -d= -f2- | tr -d '"' | tr '\n' ' ')
[ -n "${CI_ALLOWED_SLUGS// /}" ] || { echo "ENV the CI configuration names no runner slugs" | tee "$LEG_DIR/leg.log"; exit 2; }
export CI_ALLOWED_SLUGS
serial=$(adb devices | awk '$1 ~ /^emulator-/ {print $1; exit}')
[ -n "$serial" ] || { echo "ENV no emulator on adb" | tee "$LEG_DIR/leg.log"; exit 2; }
"$HERE/android-settle.sh" "$serial" "${ANDROID_SETTLE_MAX:-90}"
rc=0
bash "$HERE/../legs/$leg.sh" > "$LEG_DIR/leg.log" 2>&1 || rc=$?
cat "$LEG_DIR/leg.log"
echo "leg $leg rc=$rc"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  case $rc in 0) v="**pass**" ;; 2) v="**env** — not a verdict on the app" ;; 3) v="**app**: a row failed" ;; *) v="**broken** (exit $rc): setup, not a verdict on the app" ;; esac
  { echo "### Gate leg $leg (CI): $v"; echo; echo "| Status | Row | Detail |"; echo "|---|---|---|"
    grep '^ROW ' "$LEG_DIR/leg.log" | sed 's/|/\\|/g' | sed -E 's/^ROW ([^ ]+) ([A-Z]+) — (.*)$/| \2 | \1 | \3 |/' | cut -c1-400
    echo; grep -m1 -E '^LEG ' "$LEG_DIR/leg.log" | sed 's/^/`/; s/$/`/'; } >> "$GITHUB_STEP_SUMMARY"
fi
exit $rc
