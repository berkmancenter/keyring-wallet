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
# later), prints the hash, and sets the step output `hash`.
#
# Exit status (staging.yaml runs this without continue-on-error):
#   0  recorded; or the fingerprint could not be computed, which is said as a
#      warning and sets no `hash` (a later publish for this build is refused,
#      and the release goes on)
#   3  a file it touched could not be put back: the build would ship the OTA
#      key, channel and fingerprint with OTA off, so the build job fails
#      ("nothing baked into the shipped app") It changes nothing in
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
# Puts every file back, attempting each one even if another fails, then checks
# each against its snapshot. A store build continues past this step
# (continue-on-error), so a partial restore must not pass quietly: it would ship
# the public key, channel and fingerprint in a build with OTA off.
restore() {
  local rc=$? bad=0 f s
  for f in "${files[@]}"; do
    s="$snap/$(echo "$f" | tr / _)"
    if [ -e "$s" ]; then cp -p "$s" "$f" || bad=1; else rm -f "$f" || bad=1; fi
  done
  for f in "${files[@]}"; do
    s="$snap/$(echo "$f" | tr / _)"
    if [ -e "$s" ]; then
      cmp -s "$s" "$f" || { echo "::error::record-fingerprint: $f was not restored" >&2; bad=1; }
    elif [ -e "$f" ]; then
      echo "::error::record-fingerprint: $f was left behind" >&2
      bad=1
    fi
  done
  [ "$bad" = 0 ] && rm -rf "$snap"
  if [ "$bad" != 0 ]; then exit 3; fi
  exit "$rc"
}
trap restore EXIT

# Not computable: a warning, no `hash`, exit 0 (the restore still runs and can
# still turn this into exit 3).
not_recorded() {
  echo "::warning::record-fingerprint: no $platform fingerprint recorded ($1); an OTA publish for this build will be refused"
  exit 0
}
(cd app && npx hot-updater fingerprint create >/dev/null) || not_recorded "fingerprint create failed"
cp app/fingerprint.json "$out/fingerprint.json" || not_recorded "no app/fingerprint.json"
hash=$(node -e 'const f = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); console.log(f[process.argv[2]].hash)' \
  "$out/fingerprint.json" "$platform" 2>/dev/null) || hash=
[[ "$hash" =~ ^[0-9a-f]{40}$ ]] || not_recorded "no $platform hash in fingerprint.json"
echo "record-fingerprint: $platform native fingerprint $hash"
if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "hash=$hash" >> "$GITHUB_OUTPUT"; fi
