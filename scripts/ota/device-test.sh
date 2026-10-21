#!/bin/bash
# The device-test channel's moves, for ota-publish.yml (channel device-test): the OTA trial on the quick-install
# test app, which carries its own throwaway public key and the device-test channel, never a store key or the
# production channel. Like e2e/gate/ci/ota-ctl.sh, the change a bundle carries is a commit made here, unsigned and
# never pushed, on top of the verified commit the run checked out; nothing of it reaches any branch.
#
#   device-test.sh publish    a JS-only change, signed with the test key (the trial's "an update loads")
#   device-test.sh tamper     the same, signed with a throwaway key (the phone must refuse it)
#   device-test.sh crash      a bundle that throws while its JS loads (the phone must roll back)
#   device-test.sh mismatch   a bundle built on a native change (no installed build has its fingerprint)
#   device-test.sh disable    withdraw BUNDLE_ID, which must be a device-test bundle
#   device-test.sh cleanup    delete every device-test bundle from the server
#
# Publishing needs OTA_BASE (the test app's own build commit), OTA_PUBLIC_KEY_FILE (the test public key, from
# scripts/ota/signing-key.mjs), OTA_SIGNING_KEY, PLATFORM. All need OTA_SERVER_URL and HOT_UPDATER_AUTH_TOKEN.
# The tier check is skipped (ota-deploy --skip-tier, device-test only): the mismatch step must be able to carry a
# native change, and nothing published here can reach a store build.
set -euo pipefail

CHANNEL=device-test
cmd=${1:?publish, tamper, crash, mismatch, disable or cleanup}
cd "$(dirname "$0")/../.."
[ -d app/src/ota ] || { echo "not a wallet checkout with the OTA module: $PWD"; exit 1; }
: "${OTA_SERVER_URL:?}" "${HOT_UPDATER_AUTH_TOKEN:?}"

cli() { (cd app && npx hot-updater "$@"); }

# The ids of this channel's bundles, from the server's own listing.
channel_ids() {
  cli bundle list -c "$CHANNEL" --json --limit 100 \
    | node -e '
      const raw = JSON.parse(require("fs").readFileSync(0, "utf8"));
      const rows = Array.isArray(raw) ? raw : raw.data ?? [];
      for (const b of rows) {
        if (b.channel !== process.argv[1]) { console.error(`listing returned ${b.id} on channel ${b.channel}`); process.exit(1) }
        console.log(b.id);
      }' "$CHANNEL"
}

commit_change() { # commit_change MESSAGE FILE... : a local commit of exactly these files
  # No hooks at all. --no-verify skips pre-commit and commit-msg but not prepare-commit-msg, a lefthook hook
  # that, finding no lefthook, probes `swift package lefthook` in the repo root; on a runner with Swift that
  # leaves an untracked .build/ behind, and ota-deploy then refuses the tree (run 39565363897).
  HUSKY=0 LEFTHOOK=0 git -c core.hooksPath=/dev/null \
    -c user.email=ota-device-test@example.invalid -c user.name="OTA device test" -c commit.gpgsign=false \
    commit -q --no-verify -m "$1" -- "${@:2}"
}

publish() { # publish MESSAGE
  : "${OTA_BASE:?}" "${OTA_PUBLIC_KEY_FILE:?}" "${OTA_SIGNING_KEY:?}" "${PLATFORM:?}"
  OTA_PUBLIC_KEY="$(cat "$OTA_PUBLIC_KEY_FILE")" OTA_CHANNEL="$CHANNEL" node scripts/ota/native-config.mjs
  # The native fingerprint this bundle is built for: it must equal the test app's own (Developer -> OTA ->
  # Native fingerprint, or its build copy's app/fingerprint.json), or no phone is offered the bundle.
  node -e 'const f = JSON.parse(require("fs").readFileSync("app/fingerprint.json", "utf8"));
    for (const p of ["ios", "android"]) console.log(`device-test: ${p} fingerprint ${f[p]?.hash ?? "?"}`)'
  (cd app && node scripts/ota-deploy.mjs --base "$OTA_BASE" --platform "$PLATFORM" --channel "$CHANNEL" \
    --skip-tier --after-native-config --message "$1")
}

stamp="${GITHUB_RUN_ID:-local}-$(date -u +%s)"
case "$cmd" in
  publish | tamper)
    echo "export const OTA_DEVICE_TEST_MARK = '$cmd-$stamp'" >> app/src/ota/otaConfig.ts
    commit_change "device-test: a JS-only change ($cmd)" app/src/ota/otaConfig.ts
    publish "device-test $cmd $(git rev-parse --short HEAD)" ;;
  crash)
    printf "throw new Error('device-test: a bundle that crashes at load')\n%s\n" "$(cat app/index.js)" > app/index.js
    commit_change "device-test: a bundle that crashes at load" app/index.js
    publish "device-test crash $(git rev-parse --short HEAD)" ;;
  mismatch)
    note='// device-test: a native edit, so this bundle matches no installed build'"'"'s fingerprint'
    for f in app/ios/AriesBifold/AppDelegate.mm app/android/app/src/main/java/ca/bc/gov/BCWallet/MainApplication.kt; do
      printf '\n%s\n' "$note" >> "$f"
    done
    echo "export const OTA_DEVICE_TEST_MARK = 'mismatch-$stamp'" >> app/src/ota/otaConfig.ts
    commit_change "device-test: a bundle built on a native change" app/src/ota/otaConfig.ts \
      app/ios/AriesBifold/AppDelegate.mm app/android/app/src/main/java/ca/bc/gov/BCWallet/MainApplication.kt
    publish "device-test mismatch $(git rev-parse --short HEAD)" ;;
  disable)
    : "${BUNDLE_ID:?the bundle to withdraw}"
    if ! channel_ids | grep -qx "$BUNDLE_ID"; then
      echo "::error::$BUNDLE_ID is not a $CHANNEL bundle; refusing to withdraw it"; exit 1
    fi
    cli bundle disable "$BUNDLE_ID" -y
    echo "device-test: withdrew $BUNDLE_ID" ;;
  cleanup)
    ids=$(channel_ids)
    if [ -z "$ids" ]; then echo "device-test: no $CHANNEL bundles on the server"; exit 0; fi
    echo "device-test: deleting $(echo "$ids" | wc -l | tr -d ' ') $CHANNEL bundle(s):"; echo "$ids"
    # shellcheck disable=SC2086  # one id per word
    cli bundle delete $ids -y
    left=$(channel_ids)
    [ -z "$left" ] || { echo "::error::still on the server: $left"; exit 1; }
    echo "device-test: the $CHANNEL channel is empty" ;;
  *) echo "unknown: $cmd"; exit 64 ;;
esac
