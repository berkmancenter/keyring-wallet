#!/usr/bin/env bash
# Build the push-test variant of the Android app: application ID
# asml.bkc.harvard.wallet.pushtest, the Keyring Firebase project, and a push
# gateway named in app/.env.pushtest. It installs beside the release app.
# See README.md here and docs/plans/push-notifications-plan.md §6.
#
#   scripts/push-test/build-android.sh      # → the APK path, then adb install -r it
#
# A release build type with JS bundled (no Metro), signed with the debug
# keystore: without PLAY_STORE_JKS_PASSWD the release signing config falls
# back to it (app/android/app/build.gradle). Nothing here changes the release
# build: the suffix needs -PkeyringPushTest, and the Firebase file is copied in
# for this build only and removed on exit.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
KEYS=${KEYRING_PUSH_DIR:-$HOME/.keyring-push}
FIREBASE=$KEYS/app/google-services.json
ENV_FILE=$ROOT/app/.env.pushtest
DEST=$ROOT/app/android/app/src/release/google-services.json

die() { echo "build-android: $*" >&2; exit 1; }

[ -f "$FIREBASE" ] || die "no $FIREBASE (the Keyring Firebase project's config for the pushtest app)"
python3 - "$FIREBASE" <<'EOF' || die "$FIREBASE has no client for asml.bkc.harvard.wallet.pushtest"
import json, sys
d = json.load(open(sys.argv[1]))
names = [c["client_info"]["android_client_info"]["package_name"] for c in d.get("client", [])]
sys.exit(0 if "asml.bkc.harvard.wallet.pushtest" in names else 1)
EOF
[ -f "$ENV_FILE" ] || die "no $ENV_FILE: copy app/.env and set PUSH_GATEWAY_URL"
grep -Eq '^PUSH_GATEWAY_URL=.+' "$ENV_FILE" || die "PUSH_GATEWAY_URL is empty in $ENV_FILE"
[ ! -e "$DEST" ] || die "$DEST already exists; remove it if it is left from an interrupted build"

mkdir -p "$(dirname "$DEST")"
cp "$FIREBASE" "$DEST"
trap 'rm -f "$DEST"; rmdir "$(dirname "$DEST")" 2>/dev/null || true' EXIT

cd "$ROOT/app/android"
# react-native-config resolves ENVFILE relative to app/.
ENVFILE=.env.pushtest ./gradlew assembleRelease -PkeyringPushTest

APK=$ROOT/app/android/app/build/outputs/apk/release/app-release.apk
echo "push-test APK: $APK"
echo "install beside the release app: adb -s <serial> install -r \"$APK\""
