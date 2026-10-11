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
rc=0
(cd e2e && PLATFORM=android UDID="$serial" E2E_RELEASE=1 OTA_CTL="$HERE/ota-ctl.sh" node run-ota.mjs) > "$LEG_DIR/leg.log" 2>&1 || rc=$?
cat "$LEG_DIR/leg.log"
echo "leg rc=$rc"
exit $rc
