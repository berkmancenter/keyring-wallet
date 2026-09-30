#!/usr/bin/env bash
# Point the wallet at the local lab or at the VTA Farm.
#
#   ./use-stack.sh lab     the stack up.sh runs, behind ngrok
#   ./use-stack.sh farm    the Farm-hosted VTA, mediator and community
#   ./use-stack.sh         say which one is selected
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
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
APP="$(cd "$HERE/../../../app" && pwd)"
TARGET="${1:-}"

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
[ -f "$SRC" ] || { echo "no $SRC — nothing to switch to" >&2; exit 1; }

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
