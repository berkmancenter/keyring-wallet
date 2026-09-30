#!/usr/bin/env bash
# Read the twin agent's ACL — for people and for the runner's assertions.
#
#   ./show-acl.sh                         a table (full DIDs)
#   ./show-acl.sh --json                  the entries as JSON
#   ./show-acl.sh --owner <did>           exit 0 iff <did> is an unrestricted,
#                                         permanent admin (role admin, no
#                                         contexts, no expiry); else exit 1
#   ./show-acl.sh --absent <did>          exit 0 iff <did> has no entry
#   ./show-acl.sh --new                   only entries not in acl-baseline.json
#
# Online: `pnm acl list --json` on the RUNNING twin, as its harness admin
# (the pnm profile twin-vta.sh set up), through pnm-locked. Nothing stops.
# --offline reads the store with `vta acl list` instead, which needs the twin
# stopped (fjall's lock), so it stops and restarts it; not for use mid-run.
set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd)/lib.sh"

MODE=table OFFLINE=0 SUBJECT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --json) MODE=json ;;
    --new) MODE=new ;;
    --owner) MODE=owner; SUBJECT="${2:?--owner needs a DID}"; shift ;;
    --absent) MODE=absent; SUBJECT="${2:?--absent needs a DID}"; shift ;;
    --offline) OFFLINE=1 ;;
    *) echo "usage: show-acl.sh [--json|--new|--owner <did>|--absent <did>] [--offline]" >&2; exit 2 ;;
  esac
  shift
done
[ -f "$TWIN_ENV" ] || { echo "the twin is not set up: run ./twin-vta.sh up" >&2; exit 1; }

if [ "$OFFLINE" = 1 ]; then
  twin_stop >&2
  raw=$("$VTA_BIN" --config "$TWIN_DIR/config.toml" acl list 2>&1 | strip_ansi || true)
  twin_start >&2
  # The offline CLI prints a table, not JSON: show it and answer from it.
  case "$MODE" in
    owner | absent)
      echo "--offline answers only table/--json questions; use the online read for --$MODE" >&2
      exit 2 ;;
  esac
  printf '%s\n' "$raw"
  exit 0
fi

json=$(twin_acl_json) || { echo "could not read $TWIN's ACL with pnm (is the twin up? ./twin-vta.sh status)" >&2; exit 1; }

# The program is a variable, so the entries can come in on stdin.
read -r -d '' PROG <<'PY' || true
import json, os, sys
mode, subject, baseline_path, twin = sys.argv[1:5]
entries = json.load(sys.stdin)
base = set()
if os.path.exists(baseline_path):
    base = {e["subject"] for e in json.load(open(baseline_path))}

def contexts(e):
    # pnm 0.19.0 names an entry's contexts "scopes"; newer builds "contexts".
    return e.get("contexts", e.get("scopes")) or []

def unrestricted_permanent_admin(e):
    return e.get("role") == "admin" and not contexts(e) and not e.get("expiresAt")

if mode == "json":
    print(json.dumps(entries, indent=1)); sys.exit(0)
if mode == "owner":
    hit = [e for e in entries if e["subject"] == subject]
    if not hit:
        print(f"NO ENTRY for {subject}"); sys.exit(1)
    e = hit[0]
    ok = unrestricted_permanent_admin(e)
    print(f"{'OWNER' if ok else 'NOT AN OWNER'}: role={e.get('role')} contexts={contexts(e) or 'unrestricted'} "
          f"expires={e.get('expiresAt') or 'never'} label={e.get('label')} createdBy={e.get('createdBy')}")
    sys.exit(0 if ok else 1)
if mode == "absent":
    present = any(e["subject"] == subject for e in entries)
    print(f"{'PRESENT' if present else 'ABSENT'}: {subject}")
    sys.exit(1 if present else 0)
shown = [e for e in entries if mode != "new" or e["subject"] not in base]
print(f"{twin}: {len(entries)} ACL entr{'y' if len(entries) == 1 else 'ies'}"
      + (f", {len(shown)} not in the baseline" if mode == "new" else ""))
for e in shown:
    tag = "baseline" if e["subject"] in base else "run"
    print(f"- [{tag}] {e['subject']}")
    print(f"    role={e.get('role')} contexts={contexts(e) or 'unrestricted'} expires={e.get('expiresAt') or 'never'} "
          f"label={e.get('label')} createdBy={e.get('createdBy')} createdAt={e.get('createdAt')}")
PY
printf '%s' "$json" | python3 -c "$PROG" "$MODE" "$SUBJECT" "$TWIN_DIR/acl-baseline.json" "$TWIN"
