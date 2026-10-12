#!/bin/bash
# The OTA leg on a CI emulator, inside reactivecircus/android-emulator-runner's `script:` (one line there). Expects
# the OTA-enabled Release APK at $RUNNER_TEMP/build/keyring-ota.apk, LEG_DIR set, the update server up, and the
# OTA_* settings ota-ctl.sh needs in the environment.
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
serial=$(adb devices | awk '$1 ~ /^emulator-/ {print $1; exit}')
[ -n "$serial" ] || { echo "no emulator on adb"; adb devices; exit 1; }
"$HERE/android-settle.sh" "$serial" "${ANDROID_SETTLE_MAX:-90}"
adb -s "$serial" install -r "$RUNNER_TEMP/build/keyring-ota.apk" || { echo "install failed"; exit 1; }
# The loader's own account of downloads, crashes and rollbacks, for the leg's artifact (the OTA lane asks for these
# lines when a rollback does not happen).
# Only the loader's and the runtime's crash lines are kept: the app's own JS log (ReactNativeJS) can print the
# mediator URL, and uploaded artifacts are not masked.
adb -s "$serial" logcat -c || true
adb -s "$serial" logcat -v time > "$LEG_DIR/logcat-all.txt" 2>&1 &
logcat_pid=$!
rc=0
(cd e2e && PLATFORM=android UDID="$serial" E2E_RELEASE=1 OTA_CTL="$HERE/ota-ctl.sh" node run-ota.mjs) > "$LEG_DIR/leg.log" 2>&1 || rc=$?
kill "$logcat_pid" 2>/dev/null || true
grep -E 'HotUpdater|BundleStorage|AndroidRuntime' "$LEG_DIR/logcat-all.txt" > "$LEG_DIR/logcat-ota.txt" || true
rm -f "$LEG_DIR/logcat-all.txt"
cat "$LEG_DIR/leg.log"
echo "leg rc=$rc"
# The job summary leads with whose result it is: rc 2 (the leg's ENV line) is the environment, a dead tunnel, never a
# verdict on the app; rc 3 is an app check that failed; rc 1 is the leg breaking.
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  case $rc in
    0) verdict="**pass**: every row passed" ;;
    2) verdict="**env**: $(grep -m1 '^ENV ' "$LEG_DIR/leg.log" | sed 's/^ENV //') — not a verdict on the app; rerun" ;;
    3) verdict="**app**: a row failed (below)" ;;
    *) verdict="**broken**: the leg stopped before its rows finished (exit $rc)" ;;
  esac
  {
    echo "### OTA leg (Android): $verdict"; echo
    echo "| Status | Row | Detail |"; echo "|---|---|---|"
    grep '^ROW ' "$LEG_DIR/leg.log" | sed -E 's/^ROW ([^ ]+) ([A-Z]+) — (.*)$/| \2 | \1 | \3 |/' | cut -c1-400
    echo; grep -m1 '^LEG ota' "$LEG_DIR/leg.log" | sed 's/^/`/; s/$/`/'
  } >> "$GITHUB_STEP_SUMMARY"
fi
exit $rc
