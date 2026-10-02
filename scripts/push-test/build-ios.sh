#!/usr/bin/env bash
# Build the push-test variant of the iOS app for a real device: bundle ID
# asml.bkc.harvard.wallet.pushtest, the push-only entitlements
# (AriesBifold-PushTest.entitlements) and the "Keyring Push Test Dev"
# development profile. It installs beside the release app. See README.md here
# and docs/plans/push-notifications-plan.md §6.
#
#   scripts/push-test/build-ios.sh          # → the .app path, then devicectl install it
#
# Build settings given on the xcodebuild command line apply to every target,
# Pods included, and a provisioning profile there fails the Pods targets. So the
# app target's own settings are switched for this one build, from a backup of
# the project file that is restored on exit; nothing is left changed.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
KEYS=${KEYRING_PUSH_DIR:-$HOME/.keyring-push}
PROFILE=$KEYS/app/Keyring_Push_Test_Dev.mobileprovision
ENV_FILE=$ROOT/app/.env.pushtest
PBX=$ROOT/app/ios/AriesBifold.xcodeproj/project.pbxproj
PLIST=$ROOT/app/ios/AriesBifold/Info.plist
DERIVED=${DERIVED_DATA:-$ROOT/app/ios/build/pushtest}

die() { echo "build-ios: $*" >&2; exit 1; }

[ -f "$PROFILE" ] || die "no $PROFILE"
[ -f "$ENV_FILE" ] || die "no $ENV_FILE: copy app/.env and set PUSH_GATEWAY_URL"
grep -Eq '^PUSH_GATEWAY_URL=.+' "$ENV_FILE" || die "PUSH_GATEWAY_URL is empty in $ENV_FILE"
for f in "$PBX" "$PLIST"; do
  git -C "$ROOT" diff --quiet -- "$f" || die "$f has uncommitted changes; this script restores it from a copy"
done

# The profile where Xcode looks for manual signing.
UUID=$(security cms -D -i "$PROFILE" | plutil -extract UUID raw -)
for dir in "$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles" "$HOME/Library/MobileDevice/Provisioning Profiles"; do
  mkdir -p "$dir" && cp "$PROFILE" "$dir/$UUID.mobileprovision"
done

# Each value belongs to the app target's Debug and Release configurations only.
expect_twice() {
  local n
  n=$(grep -cF "$1" "$PBX" || true)
  [ "$n" = 2 ] || die "expected '$1' twice in project.pbxproj, found $n: the project changed; update this script"
}
expect_twice 'PRODUCT_BUNDLE_IDENTIFIER = asml.bkc.harvard.wallet;'
expect_twice 'CODE_SIGN_ENTITLEMENTS = AriesBifold/AriesBifold.entitlements;'
expect_twice 'CODE_SIGN_STYLE = Automatic;'
expect_twice 'PROVISIONING_PROFILE_SPECIFIER = "";'

BACKUP=$(mktemp)
BACKUP_PLIST=$(mktemp)
cp "$PBX" "$BACKUP"
cp "$PLIST" "$BACKUP_PLIST"
# Put the project file back however this ends: a normal exit, a failed build,
# ctrl-C, or a kill. A signal alone does not always run an EXIT trap, so each
# signal exits explicitly and the EXIT trap does the one restore. Only SIGKILL
# escapes it; then the next run refuses the dirty file (above), and
# `git checkout -- app/ios/AriesBifold.xcodeproj/project.pbxproj` recovers it.
restore() {
  if [ -n "${BACKUP:-}" ] && [ -f "$BACKUP" ]; then
    cp "$BACKUP" "$PBX" && rm -f "$BACKUP"
  fi
  if [ -n "${BACKUP_PLIST:-}" ] && [ -f "$BACKUP_PLIST" ]; then
    cp "$BACKUP_PLIST" "$PLIST" && rm -f "$BACKUP_PLIST"
  fi
}
trap restore EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP
sed -i '' \
  -e 's/PRODUCT_BUNDLE_IDENTIFIER = asml\.bkc\.harvard\.wallet;/PRODUCT_BUNDLE_IDENTIFIER = asml.bkc.harvard.wallet.pushtest;/' \
  -e 's#CODE_SIGN_ENTITLEMENTS = AriesBifold/AriesBifold\.entitlements;#CODE_SIGN_ENTITLEMENTS = AriesBifold/AriesBifold-PushTest.entitlements;#' \
  -e 's/CODE_SIGN_STYLE = Automatic;/CODE_SIGN_STYLE = Manual;/' \
  -e 's/PROVISIONING_PROFILE_SPECIFIER = "";/PROVISIONING_PROFILE_SPECIFIER = "Keyring Push Test Dev";/' \
  "$PBX"

# The phone reaches a push gateway on the Mac over the local network
# (http://<mac>.local:<port>), which App Transport Security refuses in the
# release app: it allows plain HTTP to localhost only. The push-test build, and
# only it, allows local networking; the release Info.plist never does
# (app/__tests__/push/releaseAts.test.ts).
/usr/libexec/PlistBuddy -c 'Add :NSAppTransportSecurity:NSAllowsLocalNetworking bool true' "$PLIST"

cd "$ROOT/app/ios"
# react-native-config resolves ENVFILE relative to app/.
ENVFILE=.env.pushtest xcodebuild \
  -workspace AriesBifold.xcworkspace -scheme AriesBifold -configuration Release \
  -destination 'generic/platform=iOS' -derivedDataPath "$DERIVED" build

restore
if ! git -C "$ROOT" diff --quiet -- "$PBX" "$PLIST"; then
  git -C "$ROOT" diff --stat -- "$PBX" "$PLIST" >&2
  die "project.pbxproj or Info.plist did not come back clean; run: git checkout -- app/ios/AriesBifold.xcodeproj/project.pbxproj app/ios/AriesBifold/Info.plist"
fi
echo "project.pbxproj and Info.plist restored:"
git -C "$ROOT" diff --stat -- "$PBX" "$PLIST"
echo "  (no changes)"

APP=$DERIVED/Build/Products/Release-iphoneos/KeyRing.app
echo "push-test app: $APP"
echo "install beside the release app: xcrun devicectl device install app --device <udid> \"$APP\""
