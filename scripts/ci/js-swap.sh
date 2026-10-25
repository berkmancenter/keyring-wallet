#!/bin/bash
# Put this checkout's JS into an existing Release build: the simulator .app and
# the APK, for iteration and smoke runs only. A release candidate always gets a
# full build. Run scripts/ci/js-only.mjs first; this script does not decide
# whether a swap is valid, it only refuses one whose output is not what the
# base build would have made.
#
# The bundle is made exactly as each platform's build makes it (measured
# byte-identical to the 225 build at its own heads):
#   Android (RN gradle plugin): bundle --sourcemap-output index.android.bundle.packager.map;
#            hermesc -O -output-source-map. Metro's trailing sourceMappingURL
#            comment names the map file, and Hermes hashes the source, so the
#            name must match.
#   iOS (react-native-xcode.sh, no SOURCEMAP_FILE): bundle without a map;
#            hermesc -O. The bytecode then carries full debug info, including
#            the input file's absolute path: set IOS_JS_PATH to the path the
#            base build compiled (…/Build/Products/Release-iphonesimulator/main.jsbundle)
#            to reproduce it byte for byte.
#
# Usage: REPO=<wallet checkout at head> BASE_APK=… BASE_APP=… OUT=<dir> [IOS_JS_PATH=…] js-swap.sh
set -euo pipefail
: "${REPO:?}" "${BASE_APK:?}" "${BASE_APP:?}" "${OUT:?}"
BT=${BUILD_TOOLS:-$HOME/Library/Android/sdk/build-tools/36.0.0}
HERMESC=$REPO/node_modules/react-native/sdks/hermesc/osx-bin/hermesc
KS=${KEYSTORE:-$REPO/app/android/app/debug.keystore}
NODE=${NODE_BINARY:-node}
mkdir -p "$OUT"/{android/js,android/assets,ios/assets,base,repack}
rm -rf "$OUT"/android/assets/* "$OUT"/ios/assets/* "$OUT"/android/js/*
t0=$(date +%s); lap() { echo "  $1: $(( $(date +%s) - t0 ))s"; t0=$(date +%s); }
sha() { shasum -a 256 "$1" | cut -c1-12; }
hbcver() { xxd -s 8 -l 4 -p "$1"; }
echo "heads wallet=$(git -C "$REPO" rev-parse --short HEAD) bifold=$(git -C "$REPO/bifold" rev-parse --short HEAD)"

# The bifold packages the app bundles from lib/ (a stale lib/ is shipped silently).
( cd "$REPO/bifold/packages/trust-tasks" && yarn build ) > "$OUT/libs.log" 2>&1
( cd "$REPO/bifold/packages/core" && rm -rf lib && npx bob build ) >> "$OUT/libs.log" 2>&1
lap "libs"

cd "$REPO/app"
"$NODE" "$REPO/node_modules/react-native/cli.js" bundle --entry-file index.js --platform android --dev false --reset-cache \
  --bundle-output "$OUT/android/js/index.android.bundle" --assets-dest "$OUT/android/assets" --minify false \
  --sourcemap-output "$OUT/android/js/index.android.bundle.packager.map" > "$OUT/android/bundle.log" 2>&1
"$HERMESC" -emit-binary -max-diagnostic-width=80 -O -output-source-map -out "$OUT/android/index.android.bundle" "$OUT/android/js/index.android.bundle" > "$OUT/android/hermesc.log" 2>&1
lap "android bundle"
IOS_JS=${IOS_JS_PATH:-$OUT/ios/main.jsbundle.js}
mkdir -p "$(dirname "$IOS_JS")"
"$NODE" "$REPO/node_modules/react-native/cli.js" bundle --entry-file index.js --platform ios --dev false --reset-cache \
  --bundle-output "$IOS_JS" --assets-dest "$OUT/ios/assets" --minify false > "$OUT/ios/bundle.log" 2>&1
"$REPO/app/ios/Pods/hermes-engine/destroot/bin/hermesc" -emit-binary -max-diagnostic-width=80 -O -out "$OUT/ios/main.jsbundle" "$IOS_JS" > "$OUT/ios/hermesc.log" 2>&1
lap "ios bundle"

# Refuse a swap the base could not run or whose resources it lacks.
unzip -p "$BASE_APK" assets/index.android.bundle > "$OUT/base/index.android.bundle"
[ "$(hbcver "$OUT/android/index.android.bundle")" = "$(hbcver "$OUT/base/index.android.bundle")" ] || { echo "REFUSED: Android Hermes bytecode version differs from the base's"; exit 3; }
[ "$(hbcver "$OUT/ios/main.jsbundle")" = "$(hbcver "$BASE_APP/main.jsbundle")" ] || { echo "REFUSED: iOS Hermes bytecode version differs from the base's"; exit 3; }
# Android compiles Metro's assets into res/ at build time: every one must already
# be a resource of the base APK, by name and density. Release builds shorten the
# file paths (res/Bn.png), so this reads the resource table, not the zip. aapt2
# re-encodes images, so content is not comparable here: a changed asset is
# js-only.mjs's to catch (it fingerprints every bundled image).
"$BT/aapt2" dump resources "$BASE_APK" > "$OUT/base/resources.txt"
missing=$( cd "$OUT/android/assets" && find . -type f | sed 's#^\./##' | "$NODE" -e '
  const table = require("fs").readFileSync(process.argv[1], "utf8");
  const have = new Set();
  let name;
  for (const line of table.split("\n")) {
    const r = line.match(/^\s+resource 0x[0-9a-f]+ (\S+)/);
    if (r) { name = r[1]; continue; }
    const c = line.match(/^\s+\(([^)]*)\) \(file\)/);
    if (c && name) have.add(`${name}@${c[1]}`);
  }
  const files = require("fs").readFileSync(0, "utf8").split("\n").filter(Boolean);
  for (const f of files) {
    const [dir, file] = f.split("/");
    const [type, ...qual] = dir.split("-");
    const key = `${type}/${file.replace(/\.[^.]+$/, "")}@${qual.join("-")}`;
    if (!have.has(key)) console.log(key);
  }' "$OUT/base/resources.txt" )
[ -z "$missing" ] || { echo "$missing" | sed 's/^/  not a resource of the base APK: /'; echo "REFUSED: bundled assets missing from the base APK's resources"; exit 3; }
# The iOS assets must match the ones in the base .app (a new or changed asset needs the full build path too).
( cd "$OUT/ios/assets" && find . -type f | sort | xargs shasum -a 256 ) > "$OUT/ios/assets.sha"
( cd "$BASE_APP" && find ./assets -type f | sort | xargs shasum -a 256 ) > "$OUT/base/ios-assets.sha"
diff -q "$OUT/ios/assets.sha" "$OUT/base/ios-assets.sha" > /dev/null || { echo "REFUSED: the iOS assets differ from the base .app's"; exit 3; }
lap "checks"

# APK: replace the stored entry, align as AGP does (16 KB pages for .so), re-sign v2 only, like the base.
cp "$BASE_APK" "$OUT/repack/in.apk"
mkdir -p "$OUT/repack/assets" && cp "$OUT/android/index.android.bundle" "$OUT/repack/assets/index.android.bundle"
( cd "$OUT/repack" && zip -q -0 -X in.apk assets/index.android.bundle )
"$BT/zipalign" -f -P 16 4 "$OUT/repack/in.apk" "$OUT/repack/aligned.apk"
"$BT/apksigner" sign --ks "$KS" --ks-pass pass:android --ks-key-alias androiddebugkey --key-pass pass:android \
  --v1-signing-enabled false --v2-signing-enabled true --v3-signing-enabled false \
  --out "$OUT/keyring-swapped.apk" "$OUT/repack/aligned.apk"
"$BT/apksigner" verify "$OUT/keyring-swapped.apk"
"$BT/zipalign" -c -P 16 4 "$OUT/keyring-swapped.apk" > /dev/null
unzip -p "$OUT/keyring-swapped.apk" assets/index.android.bundle | cmp -s - "$OUT/android/index.android.bundle" || { echo "FAILED: the APK does not carry the new bundle"; exit 4; }
crc() { unzip -v "$1" | awk 'NR>3 && NF>=8 {print $7, $8}' | grep -v -E ' (META-INF/[^ ]+\.(SF|RSA|EC|DSA)|META-INF/MANIFEST\.MF|assets/index\.android\.bundle)$' | sort; }
diff <(crc "$BASE_APK") <(crc "$OUT/keyring-swapped.apk") > /dev/null || { echo "FAILED: entries besides the bundle changed"; exit 4; }
lap "apk"

# Simulator .app: replace the bundle, re-sign ad hoc (what Xcode does for the simulator).
rm -rf "$OUT/KeyRing-swapped.app" && cp -R "$BASE_APP" "$OUT/KeyRing-swapped.app"
cp "$OUT/ios/main.jsbundle" "$OUT/KeyRing-swapped.app/main.jsbundle"
codesign --force --sign - --preserve-metadata=identifier,entitlements "$OUT/KeyRing-swapped.app" > /dev/null 2>&1
codesign --verify --deep --strict "$OUT/KeyRing-swapped.app"
changed=$(diff -rq "$BASE_APP" "$OUT/KeyRing-swapped.app" | grep -v -e '/main.jsbundle ' -e '/_CodeSignature/' -e "/KeyRing and " || true)
[ -z "$changed" ] || { echo "FAILED: files besides the bundle changed:"; echo "$changed"; exit 4; }
lap "app"

echo "android $(sha "$OUT/android/index.android.bundle")  apk $(sha "$OUT/keyring-swapped.apk")"
echo "ios     $(sha "$OUT/ios/main.jsbundle")"
echo OK
