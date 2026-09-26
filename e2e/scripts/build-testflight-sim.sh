#!/usr/bin/env bash
# A Release build for the iOS simulator with the environment TestFlight builds
# get — so a pre-PR run tests the configuration testers have, not the one the
# harness is comfortable with (2026-09-22: TestFlight 206 shipped two bugs that
# only existed without VTI_VTA_DID, which every debug run had baked in).
#
# What TestFlight bakes: no VTI_* value at all, since build 216 (keyring-wallet
# #121). The tester links their own agent and brings their own community; no
# agent, community, VTI mediator or persona host is built in. So every VTI_* key
# in app/.env is dropped here, and everything else (the DIDComm mediator URLs
# and the rest) comes from app/.env as it is.
#
# A harness build that needs a value baked in says so explicitly:
# TESTFLIGHT_OVERRIDES=<file of KEY=VALUE> adds exactly those keys (an empty
# VALUE leaves the key out). Nothing else can put one back.
#
#   e2e/scripts/build-testflight-sim.sh            # → prints the .app path
#   TESTFLIGHT_ENV_ONLY=1 e2e/scripts/build-testflight-sim.sh
#                                                  # → prints the .env it would build with, builds nothing
#
# Release bundles resolve @bifold/core from its built lib/, so core is built
# first. app/.env is restored afterwards whatever happens.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP="$ROOT/app"

# The heads this artefact is made from, checked before anything is built: a
# build whose bifold is not the pinned commit is how an afternoon of Farm rungs
# came to test screens that were two PRs old (2026-09-22). ALLOW_UNPINNED=1 is
# the deliberate way past it, for testing a branch on purpose.
"$ROOT/e2e/scripts/heads.sh" || exit 1
DD="${TESTFLIGHT_BUILD_DIR:-$APP/ios/build/release-sim}"
BACKUP="$(mktemp)"
cp "$APP/.env" "$BACKUP"
trap 'cp "$BACKUP" "$APP/.env"; rm -f "$BACKUP"' EXIT

# The store config: no VTI_* key survives from app/.env.
grep -vE '^VTI_[A-Z0-9_]*=' "$BACKUP" > "$APP/.env" || true
# TESTFLIGHT_OVERRIDES=<file of KEY=VALUE>: add those keys, explicitly (a Farm
# harness build that must bake a community); an empty VALUE leaves the key out.
if [ -n "${TESTFLIGHT_OVERRIDES:-}" ]; then
  while IFS='=' read -r key value || [ -n "$key" ]; do
    [ -z "$key" ] || [ "${key#\#}" != "$key" ] && continue
    grep -vE "^${key}=" "$APP/.env" > "$APP/.env.tmp" || true
    mv "$APP/.env.tmp" "$APP/.env"
    if [ -n "$value" ]; then printf '%s=%s\n' "$key" "$value" >> "$APP/.env"; fi
  done < "$TESTFLIGHT_OVERRIDES"
fi
# Say what is baked, so a build log shows it: nothing, for the store config.
baked="$(grep -oE '^VTI_[A-Z0-9_]*' "$APP/.env" | tr '\n' ' ' || true)"
echo "build-testflight-sim: VTI keys baked in: ${baked:-none (store config)}" >&2
if [ "${TESTFLIGHT_ENV_ONLY:-}" = 1 ]; then
  cat "$APP/.env"
  exit 0
fi

(cd "$ROOT/bifold" && yarn workspace @bifold/core build >/dev/null)
(cd "$ROOT/bifold/packages/trust-tasks" && yarn build >/dev/null)
# A stale generated header keeps the old values (VETTING_RUNBOOK traps).
find "$DD" -name GeneratedInfoPlistDotEnv.h -delete 2>/dev/null || true
# TESTFLIGHT_SDK=iphoneos: the same Release build for a real device, signed
# with the team the device runs use (IOS_TEAM_ID).
SDK="${TESTFLIGHT_SDK:-iphonesimulator}"
SIGN=()
[ "$SDK" = iphoneos ] && SIGN=(-allowProvisioningUpdates DEVELOPMENT_TEAM="${IOS_TEAM_ID:-947XHQ9DVC}" CODE_SIGN_STYLE=Automatic)
(cd "$APP/ios" && xcodebuild -workspace AriesBifold.xcworkspace -scheme AriesBifold -configuration Release \
  -sdk "$SDK" -derivedDataPath "$DD" ONLY_ACTIVE_ARCH=YES ARCHS=arm64 ${SIGN[@]+"${SIGN[@]}"} >"$DD.log" 2>&1) || {
  echo "build-testflight-sim: xcodebuild failed — see $DD.log" >&2
  exit 1
}
echo "$DD/Build/Products/Release-$SDK/KeyRing.app"
