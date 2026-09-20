#!/usr/bin/env bash
# Turn a freshly provisioned stack into a community an applicant can apply to.
#
# `up.sh` leaves six services running and a community that can do nothing: its
# ACL is empty, so its own admin cannot authenticate; no statement type is
# registered; no criterion is published. Every one of those steps was walked by
# hand on 2026-09-19 and each one is mechanical, so they live here rather than
# in a runbook nobody re-reads.
#
#   ./community-setup.sh              admin credential, ACL, statement type, criterion
#   ./community-setup.sh --criterion <file>   publish a different criterion instead
#
# Idempotent: safe to re-run against a stack that is already set up.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
STACK_DIR="${STACK_DIR:-$HOME/vti-stack}"
VTI_SRC="${VTI_SRC:-$HOME/Documents/vti-main}"
VTA_BIN="$VTI_SRC/target/debug/vta"
VTC_BIN="$VTI_SRC/target/debug/vtc"
ADMIN="$REPO/tsp-reference/ref-20-local-vetting/vtc-admin.mjs"
CRED="$STACK_DIR/vtc-admin-credential.json"
STATEMENT_TYPE="https://firstperson.network/endorsements/identity-vetting/0.1"

CRITERION="$STACK_DIR/criterion.json"
[ "${1:-}" = "--criterion" ] && { CRITERION="${2:?--criterion needs a file}"; }

# shellcheck disable=SC1091
source "$STACK_DIR/stack.env"
BASE="$VTC_URL/v1"

log() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }

# Stop a daemon and WAIT. Both `vta export-admin` and `vtc acl add` are offline
# operations — a running daemon holds the LSM store and they fail with
# "FjallError: Locked". Killing without waiting is how the store gets corrupted
# (see up.sh's stop_stack for the same lesson learned the hard way).
stop_and_wait() { # port -> echoes nothing, leaves the port free
  local port=$1 pid
  pid=$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | head -1 || true)
  [ -n "$pid" ] || return 0
  kill "$pid"
  for _ in $(seq 1 30); do kill -0 "$pid" 2>/dev/null || return 0; sleep 1; done
  kill -9 "$pid" 2>/dev/null || true
  sleep 2
}

log "exporting the community VTA's admin credential"
# The credential is minted with the VTA and re-minted whenever the stack is
# re-provisioned, so a stale one from a previous run authenticates against a
# community that no longer exists — and says so only as a 401.
stop_and_wait 8111
ADMIN_B64=$("$VTA_BIN" --config "$STACK_DIR/community/config.toml" export-admin 2>&1 \
  | grep -A 4 "vtc-host" | grep -oE '^\s+ey[A-Za-z0-9_-]+' | tr -d ' ' | head -1 || true)
if [ -z "$ADMIN_B64" ]; then
  echo "could not find the vtc-host admin credential in export-admin's output" >&2
  exit 1
fi
python3 - "$ADMIN_B64" "$CRED" <<'PY'
import base64, json, sys
c, out = sys.argv[1], sys.argv[2]
d = json.loads(base64.urlsafe_b64decode(c + "=" * (-len(c) % 4)))
open(out, "w").write(json.dumps(d, indent=2) + "\n")
print(f"  admin {d['did']}")
PY
chmod 600 "$CRED"
nohup "$VTA_BIN" --config "$STACK_DIR/community/config.toml" \
  > "$STACK_DIR/logs/community.log" 2>&1 &
sleep 12

log "granting that admin in the VTC's ACL"
# A freshly provisioned VTC has an EMPTY ACL: its own admin_did cannot
# authenticate until it is added offline. Recorded as ref-20 finding 4.
ADMIN_DID=$(python3 -c "import json;print(json.load(open('$CRED'))['did'])")
stop_and_wait 8200
"$VTC_BIN" --config "$STACK_DIR/vtc/config.toml" acl add --did "$ADMIN_DID" --role admin 2>&1 \
  | grep -E "Added|already" | sed 's/^/  /' || true
nohup "$VTC_BIN" --config "$STACK_DIR/vtc/config.toml" > "$STACK_DIR/logs/vtc.log" 2>&1 &
sleep 12

log "registering the statement type"
node "$ADMIN" "$BASE" "$VTC_DID" "$CRED" register-type "$STATEMENT_TYPE" "Identity vetting statement" \
  >/dev/null 2>&1 || echo "  (already registered)"

log "publishing the criterion"
node "$ADMIN" "$BASE" "$VTC_DID" "$CRED" put-criterion "$CRITERION" >/dev/null
echo "  $(basename "$CRITERION")"

log "the manifest an applicant now reads"
node "$ADMIN" "$BASE" "$VTC_DID" "$CRED" manifest 2>&1 | python3 -c '
import sys, json
t = sys.stdin.read(); i = t.find("{")
d = json.loads(t[i:t.rfind("}") + 1])
b = d.get("body", d)
for c in b.get("criteria", []):
    v = c.get("vetting")
    if not v:
        print(f"  {c.get(chr(34)+chr(34)) or c.get(\"id\")}: no vetting requirement")
        continue
    print(f"  {c.get(\"id\")}: {v.get(\"minStatements\")} statement(s), "
          f"methods {v.get(\"acceptedMethods\")}, max age {v.get(\"maxStatementAge\")}")
    if v.get("minByMethod"):
        print(f"    per-method floors: {v[\"minByMethod\"]}")
    if v.get("independence"):
        print(f"    independence: {v[\"independence\"]}")
'

echo
echo "Community is ready. A vetter still has to be admitted and granted:"
echo "  ./invite-persona.sh <vetter did> member     # admit them"
echo "  node $ADMIN $BASE \$VTC_DID $CRED vetter-grant <vetter did>"
