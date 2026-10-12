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
exit $rc
