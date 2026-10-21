#!/bin/bash
# Records the native fingerprint a store build was made for, whether or not the
# build has over-the-air updates on (staging.yaml, after pod install on iOS).
# ota-publish.yml later refuses to publish a bundle whose fingerprint differs
# from the one its target build recorded, instead of publishing one no phone is
# offered.
#
#   scripts/ota/record-fingerprint.sh <ios|android> <out-dir>
#
# Writes <out-dir>/fingerprint.json (every source, for naming a difference
# later), prints the hash, and sets the step output `hash`. It changes nothing in
# the build: `hot-updater fingerprint create` also writes the hash into
# Info.plist and the Android manifest, so those files (and any fingerprint.json)
# are put back exactly as they were. A build with OTA off ships unchanged; one
# with OTA on gets its fingerprint from the OTA step, as before.
set -euo pipefail

platform=${1:?ios or android}
out=${2:?out-dir}
case "$platform" in ios | android) ;; *) echo "record-fingerprint: platform must be ios or android" >&2; exit 2 ;; esac
cd "$(dirname "$0")/../.."
mkdir -p "$out"

files=(app/ios/AriesBifold/Info.plist app/ios/AriesBifoldTests/Info.plist
  app/android/app/src/main/AndroidManifest.xml app/fingerprint.json)
snap=$(mktemp -d)
for f in "${files[@]}"; do
  if [ -e "$f" ]; then cp -p "$f" "$snap/$(echo "$f" | tr / _)"; fi
done
restore() {
  for f in "${files[@]}"; do
    s="$snap/$(echo "$f" | tr / _)"
    if [ -e "$s" ]; then cp -p "$s" "$f"; else rm -f "$f"; fi
  done
  rm -rf "$snap"
}
trap restore EXIT

(cd app && npx hot-updater fingerprint create >/dev/null)
cp app/fingerprint.json "$out/fingerprint.json"
hash=$(node -e 'const f = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); console.log(f[process.argv[2]].hash)' \
  "$out/fingerprint.json" "$platform")
[[ "$hash" =~ ^[0-9a-f]{40}$ ]] || { echo "record-fingerprint: no $platform hash in fingerprint.json" >&2; exit 1; }
echo "record-fingerprint: $platform native fingerprint $hash"
if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "hash=$hash" >> "$GITHUB_OUTPUT"; fi
