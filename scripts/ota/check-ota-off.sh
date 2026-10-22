#!/bin/bash
# An OTA-off store build carries none of the loader's settings, for staging.yaml when OTA_UPDATE_URL is unset.
#
#   check-ota-off.sh ios|android
#
# A phone keeps a downloaded update under a key made of the fingerprint, the version and build, and the channel
# (KeyringOtaIsolationKey / otaIsolationKey). An OTA-off build has no fingerprint, so its key differs from the
# OTA-on build it replaces, and it ignores the stored update. If it carried the loader's settings (native-config.mjs
# ran but the URL was not set), it could match that key and run an update its own testers were never meant to get.
# So this fails when any of them is in the checkout: the URL in app/.env, or the HOT_UPDATER_* keys in Info.plist,
# or the com.hotupdater.* metadata or hot_updater_* resources on Android.
set -euo pipefail

platform=${1:?ios or android}
cd "$(dirname "$0")/../.."

found=()
grep -q '^OTA_UPDATE_URL=' app/.env 2>/dev/null && found+=("app/.env: OTA_UPDATE_URL")
case "$platform" in
  ios)
    for f in app/ios/AriesBifold/Info.plist; do
      grep -q 'HOT_UPDATER_' "$f" && found+=("$f: $(grep -o 'HOT_UPDATER_[A-Z_]*' "$f" | sort -u | tr '\n' ' ')")
    done ;;
  android)
    f=app/android/app/src/main/AndroidManifest.xml
    grep -q 'com\.hotupdater\.' "$f" && found+=("$f: $(grep -o 'com\.hotupdater\.[A-Z_]*' "$f" | sort -u | tr '\n' ' ')")
    while IFS= read -r r; do found+=("$r: hot_updater_*"); done < <(grep -rl 'name="hot_updater_' app/android/app/src/main/res 2>/dev/null || true) ;;
  *) echo "unknown platform: $platform"; exit 64 ;;
esac

if [ "${#found[@]}" -gt 0 ]; then
  echo "::error::an OTA-off $platform build carries the loader's settings:"
  printf '  %s\n' "${found[@]}"
  exit 1
fi
echo "ota off ($platform): no loader settings in the checkout"
