#!/bin/bash
# The Android half of the CI smoke, run inside reactivecircus/android-emulator-runner's `script:` (which runs
# each line of its script in a shell of its own, so this is one line there). Expects the APK at
# $RUNNER_TEMP/build/keyring-release-test.apk, LEG_DIR and CI_MARKS set, and one emulator up on adb.
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
"$HERE/mark.sh" emulator-ready
serial=$(adb devices | awk '$1 ~ /^emulator-/ {print $1; exit}')
[ -n "$serial" ] || { echo "no emulator on adb"; adb devices; exit 1; }
rel=$(adb -s "$serial" shell getprop ro.build.version.release | tr -d '\r'); sdk=$(adb -s "$serial" shell getprop ro.build.version.sdk | tr -d '\r')
abi=$(adb -s "$serial" shell getprop ro.product.cpu.abi | tr -d '\r'); model=$(adb -s "$serial" shell getprop ro.product.model | tr -d '\r')
echo "emulator $serial: $model, Android $rel (API $sdk), $abi; $(adb -s "$serial" shell cat /proc/meminfo | head -1 | tr -d '\r')"
# Boot complete is not settled: System UI can be hung with its ANR dialog over everything (run 38045665103).
"$HERE/mark.sh" settle-emulator
"$HERE/android-settle.sh" "$serial" "${ANDROID_SETTLE_MAX:-90}"
"$HERE/mark.sh" leg
rc=0
bash "$HERE/../legs/smoke-ci.sh" android "$RUNNER_TEMP/build/keyring-release-test.apk" "$serial" "$model $abi API $sdk" "$rel" > "$LEG_DIR/leg.log" 2>&1 || rc=$?
cat "$LEG_DIR/leg.log"
echo "leg rc=$rc"
"$HERE/mark.sh" machine-snapshot
free -m; nproc; df -h / | tail -1
