#!/usr/bin/env bash
# A Release build for the iOS simulator with the environment TestFlight builds
# get — so a pre-PR run tests the configuration testers have, not the one the
# harness is comfortable with (2026-09-22: TestFlight 206 shipped two bugs that
# only existed without VTI_VTA_DID, which every debug run had baked in).
#
# What TestFlight bakes (keyring-wallet #68): VTI_MEDIATOR_DID,
# VTI_COMMUNITY_DID, VTI_PERSONA_BASE_URL. What it does NOT: VTI_VTA_DID (the
# tester links an agent instead) and VTI_PROBE_ON_START (a developer probe).
# Everything else comes from app/.env as it is.
#
#   e2e/scripts/build-testflight-sim.sh            # → prints the .app path
#
# Release bundles resolve @bifold/core from its built lib/, so core is built
# first. app/.env is restored afterwards whatever happens.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP="$ROOT/app"
DD="$APP/ios/build/release-sim"
BACKUP="$(mktemp)"
cp "$APP/.env" "$BACKUP"
trap 'cp "$BACKUP" "$APP/.env"; rm -f "$BACKUP"' EXIT

grep -vE '^(VTI_VTA_DID|VTI_PROBE_ON_START)=' "$BACKUP" > "$APP/.env"
for key in VTI_MEDIATOR_DID VTI_COMMUNITY_DID VTI_PERSONA_BASE_URL; do
  grep -qE "^${key}=.+" "$APP/.env" || { echo "build-testflight-sim: app/.env has no $key — TestFlight builds bake it" >&2; exit 1; }
done

(cd "$ROOT/bifold" && yarn workspace @bifold/core build >/dev/null)
(cd "$ROOT/bifold/packages/trust-tasks" && yarn build >/dev/null)
# A stale generated header keeps the old values (VETTING_RUNBOOK traps).
find "$DD" -name GeneratedInfoPlistDotEnv.h -delete 2>/dev/null || true
(cd "$APP/ios" && xcodebuild -workspace AriesBifold.xcworkspace -scheme AriesBifold -configuration Release \
  -sdk iphonesimulator -derivedDataPath "$DD" ONLY_ACTIVE_ARCH=YES ARCHS=arm64 >"$DD.log" 2>&1) || {
  echo "build-testflight-sim: xcodebuild failed — see $DD.log" >&2
  exit 1
}
echo "$DD/Build/Products/Release-iphonesimulator/KeyRing.app"
