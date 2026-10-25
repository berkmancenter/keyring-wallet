#!/usr/bin/env bash
# Remove every ACL row a run added to the twin agent, so the next run starts
# from the baseline twin-vta.sh recorded (the harness admin only).
#
#   ./reset.sh            delete each entry not in acl-baseline.json
#   ./reset.sh --dry-run  say what would be deleted
#
# The twin is dedicated to this harness, so "not in the baseline" is exactly
# "added by a run": the Farm stand-in's rows (admit-owner.sh), the phones'
# long-term keys after their swaps, and a backup phone's rows. Deletes are
# online (`pnm acl delete` as the harness admin, through pnm-locked); nothing
# is stopped. Baseline rows are never touched.
set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd)/lib.sh"

DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1
[ -f "$TWIN_DIR/acl-baseline.json" ] || { echo "no baseline at $TWIN_DIR/acl-baseline.json — run ./twin-vta.sh up" >&2; exit 1; }

json=$(twin_acl_json) || { echo "could not read $TWIN's ACL with pnm (is the twin up?)" >&2; exit 1; }
extra=$(printf '%s' "$json" | python3 -c '
import json, sys
base = {e["subject"] for e in json.load(open(sys.argv[1]))}
for e in json.load(sys.stdin):
    if e["subject"] not in base:
        print(e["subject"])
' "$TWIN_DIR/acl-baseline.json")

if [ -z "$extra" ]; then
  echo "$TWIN: nothing to remove (the ACL is the baseline)"
  exit 0
fi
failed=0
while IFS= read -r did; do
  [ -n "$did" ] || continue
  if [ "$DRY" = 1 ]; then
    echo "  would delete ${did}"
    continue
  fi
  if twin_pnm acl delete "$did" >/dev/null 2>&1; then
    echo "  deleted ${did}"
  else
    echo "  could NOT delete ${did}" >&2
    failed=1
  fi
done <<< "$extra"
exit "$failed"
