#!/usr/bin/env bash
# Point the wallet at the local lab or at the VTA Farm.
#
#   ./use-stack.sh lab     the stack up.sh runs, behind ngrok
#   ./use-stack.sh farm    the Farm-hosted VTA, mediator and community
#   ./use-stack.sh         say which one is selected
#   ./use-stack.sh lab --private    leave app/.env ALONE (see below)
#
# THE SWAP IS NOT ENOUGH ON ITS OWN. react-native-config reads `.env` at NATIVE
# BUILD TIME and bakes the values into the binary, so restarting Metro changes
# nothing and the app goes on talking to whatever it was built against. That
# looked like a stale-cache bug for most of a session once. Rebuild after
# switching:
#
#   cd app && yarn ios          # or: yarn android
#
# and for an e2e run, rebuild the e2e output too — `yarn ios` and the e2e
# harness install from DIFFERENT build directories, so one can be current while
# the other is not.
#
# PRIVATE BUILDS (opt-in). The swap above overwrites app/.env, which is shared
# by everything built from this checkout. A lab APK that must not disturb that
# file is built straight from the lab env file instead: `--private` (or
# LAB_ENV_FILE=<path>, absolute or relative to app/) does NOT touch app/.env and
# prints the build command. react-native-config's Android gradle reads
# $ENVFILE (relative to app/, else as given) in place of `.env`:
#
#   cd app/android && ENVFILE=.env.lab ./gradlew assembleDebug
#
# The APK lands in the shared app/android/app/build/outputs/apk/debug/, so copy
# it somewhere private and point the e2e runners at the copy with ANDROID_APK
# (see e2e/README.md). Default behaviour, without the flag, is unchanged.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
APP="$(cd "$HERE/../../../app" && pwd)"
TARGET="${1:-}"
PRIVATE=0
[ "${2:-}" = "--private" ] && PRIVATE=1
[ -n "${LAB_ENV_FILE:-}" ] && PRIVATE=1

current() {
  if [ ! -f "$APP/.env" ]; then echo "none"; return; fi
  if grep -q "^VTI_VTA_DID=.*ic3\.dev" "$APP/.env" 2>/dev/null; then echo "farm"
  elif grep -q "^VTI_VTA_DID=.*ngrok" "$APP/.env" 2>/dev/null; then echo "lab"
  else echo "unrecognised"; fi
}

if [ -z "$TARGET" ]; then
  echo "selected: $(current)"
  echo "available: lab$([ -f "$APP/.env.lab" ] || echo ' (missing app/.env.lab)')," \
       "farm$([ -f "$APP/.env.farm" ] || echo ' (missing app/.env.farm)')"
  exit 0
fi

case "$TARGET" in
  lab|farm) ;;
  *) echo "usage: use-stack.sh [lab|farm]" >&2; exit 2 ;;
esac

SRC="$APP/.env.$TARGET"
if [ -n "${LAB_ENV_FILE:-}" ]; then
  case "$LAB_ENV_FILE" in /*) SRC="$LAB_ENV_FILE" ;; *) SRC="$APP/$LAB_ENV_FILE" ;; esac
fi
[ -f "$SRC" ] || { echo "no $SRC — nothing to switch to" >&2; exit 1; }

if [ "$PRIVATE" = 1 ]; then
  echo "private: app/.env left untouched; values come from $SRC"
  grep "^VTI_" "$SRC" | sed 's/^/  /'
  echo
  echo "Build against it (the values are baked at native build time):"
  echo "  (cd $APP/android && ENVFILE=${LAB_ENV_FILE:-.env.$TARGET} ./gradlew assembleDebug)"
  echo "then copy the APK out of the shared build dir and use ANDROID_APK=<copy>."
  exit 0
fi

# Keep whatever is there now under its own name before overwriting, so a hand
# edit made against the live file is never silently discarded.
was="$(current)"
if [ "$was" = "lab" ] || [ "$was" = "farm" ]; then
  cp "$APP/.env" "$APP/.env.$was"
fi
cp "$SRC" "$APP/.env"

echo "switched to: $TARGET"
grep "^VTI_" "$APP/.env" | sed 's/^/  /'
echo
echo "NOW REBUILD — the values are baked at native build time:"
echo "  (cd $APP && yarn ios)      # or yarn android"
