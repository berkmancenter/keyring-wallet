#!/usr/bin/env bash
# The Android twin of build-testflight-sim.sh: a Release APK with the
# environment a store build gets, for the emulator — so an Android run tests
# the configuration testers have (no VTI_VTA_DID, no probe).
#
#   e2e/scripts/build-testflight-android.sh            # → prints the .apk path
#   TESTFLIGHT_OVERRIDES=<file of KEY=VALUE> …         # e.g. a Farm build
#
# A release APK bundles @bifold/core from its built lib/, and a plain
# assembleRelease keeps a stale JS bundle, so core is built first and the
# bundle task is forced to run. app/.env is restored whatever happens.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP="$ROOT/app"

# The heads this artefact is made from, checked before anything is built: a
# build whose bifold is not the pinned commit is how an afternoon of Farm rungs
# came to test screens that were two PRs old (2026-09-22). ALLOW_UNPINNED=1 is
# the deliberate way past it, for testing a branch on purpose.
"$ROOT/e2e/scripts/heads.sh" || exit 1
BACKUP="$(mktemp)"
cp "$APP/.env" "$BACKUP"
trap 'cp "$BACKUP" "$APP/.env"; rm -f "$BACKUP"' EXIT

grep -vE '^(VTI_VTA_DID|VTI_PROBE_ON_START)=' "$BACKUP" > "$APP/.env"
if [ -n "${TESTFLIGHT_OVERRIDES:-}" ]; then
  while IFS='=' read -r key value; do
    [ -z "$key" ] || [ "${key#\#}" != "$key" ] && continue
    grep -vE "^${key}=" "$APP/.env" > "$APP/.env.tmp" && mv "$APP/.env.tmp" "$APP/.env"
    [ -n "$value" ] && printf '%s=%s\n' "$key" "$value" >> "$APP/.env"
  done < "$TESTFLIGHT_OVERRIDES"
fi
for key in VTI_MEDIATOR_DID VTI_COMMUNITY_DID; do
  grep -qE "^${key}=.+" "$APP/.env" || { echo "build-testflight-android: app/.env has no $key — store builds bake it" >&2; exit 1; }
done

(cd "$ROOT/bifold" && yarn workspace @bifold/core build >/dev/null)
(cd "$ROOT/bifold/packages/trust-tasks" && yarn build >/dev/null)
LOG="$APP/android/build-release.log"
(cd "$APP/android" && ./gradlew app:createBundleReleaseJsAndAssets --rerun-tasks app:assembleRelease >"$LOG" 2>&1) || {
  echo "build-testflight-android: gradle failed — see $LOG" >&2
  exit 1
}
ls -t "$APP"/android/app/build/outputs/apk/release/*.apk | head -1
