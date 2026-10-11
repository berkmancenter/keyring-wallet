#!/bin/bash
# The OTA leg's server-side moves, for e2e/run-ota.mjs (which calls it between app launches). Run from the wallet
# root of a throwaway CI checkout: it commits there (unsigned, never pushed) and publishes with a throwaway key.
#   ota-ctl.sh publish      commit a JS-only change and publish it to ring 0; prints "id=<bundle id>" last
#   ota-ctl.sh crash        the same, with a bundle that throws while its JS loads
#   ota-ctl.sh disable <id> withdraw a bundle (phones on it roll back)
# Needs OTA_BASE (the store build's commit), OTA_SERVER_URL, OTA_SIGNING_KEY, HOT_UPDATER_AUTH_TOKEN, OTA_CHANNEL.
set -euo pipefail
cmd=${1:?publish, crash or disable}
: "${OTA_BASE:?}" "${OTA_SERVER_URL:?}" "${OTA_SIGNING_KEY:?}" "${OTA_CHANNEL:?}"
git config user.email ota-ci@example.invalid; git config user.name "OTA CI"; git config commit.gpgsign false

publish() {
  local out id
  out=$(cd app && BIFOLD_GIT="$PWD/../bifold" node scripts/ota-deploy.mjs --base "$OTA_BASE" --platform android --channel "$OTA_CHANNEL" --message "$1" 2>&1) || { echo "$out"; exit 1; }
  echo "$out" | tail -5
  id=$(echo "$out" | sed -n 's/.*android bundle \([0-9a-f-]*\) is on .*/\1/p' | tail -1)
  [ -n "$id" ] || { echo "no bundle id in ota-deploy's output"; exit 1; }
  echo "id=$id"
}

case "$cmd" in
  publish)
    # A JS-only change the tier check reads as ota: a constant in the OTA module.
    echo "export const OTA_CI_MARK = '${GITHUB_RUN_ID:-local}-$(date -u +%s)'" >> app/src/ota/otaConfig.ts
    git commit -qam "ci: a JS-only change for the OTA leg"
    publish "ota-ci good $(git rev-parse --short HEAD)" ;;
  crash)
    # Throws while the bundle's JS loads: the loader must catch it and relaunch on the previous bundle.
    printf "throw new Error('ota-ci: a bundle that crashes at load')\n%s\n" "$(cat app/index.js)" > app/index.js
    git commit -qam "ci: a bundle that crashes at load"
    publish "ota-ci crash $(git rev-parse --short HEAD)"
    git revert --no-edit HEAD >/dev/null ;;
  disable)
    (cd app && npx hot-updater bundle disable "${2:?bundle id}" -y) ;;
  *) echo "unknown: $cmd"; exit 64 ;;
esac
