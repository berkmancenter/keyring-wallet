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
PNM_BIN="${PNM_BIN:-$HOME/vti-stack/bin/pnm}"   # signed, stable (sign-lab-tool.sh)
ADMIN="$REPO/tsp-reference/ref-20-local-vetting/vtc-admin.mjs"
CRED="$STACK_DIR/vtc-admin-credential.json"
STATEMENT_TYPE="https://firstperson.network/endorsements/identity-vetting/0.1"

CRITERION="$STACK_DIR/criterion.json"
[ "${1:-}" = "--criterion" ] && { CRITERION="${2:?--criterion needs a file}"; }

# Default criterion, written only when none exists (an edited one is never
# overwritten). It is ref-20's criterion-two-statements.json with ONE declared
# lab deviation: minStatements = 1 instead of 2. The lab has a single vetter
# persona, so the fixture's two-distinct-vetters bar could never be met; claims
# that need the two-statement bar must be proved with the fixture itself
# (--criterion <fixture>), not with this default.
if [ "$CRITERION" = "$STACK_DIR/criterion.json" ] && [ ! -s "$CRITERION" ]; then
  python3 - "$REPO/tsp-reference/ref-20-local-vetting/fixtures/criteria/criterion-two-statements.json" "$CRITERION" <<'PY'
import json, sys
src, out = sys.argv[1], sys.argv[2]
d = json.load(open(src))
d["vetting"]["minStatements"] = 1
d["description"] = "One statement from a vetter (lab default; the fixture asks for two)"
open(out, "w").write(json.dumps(d, indent=2) + "\n")
PY
  echo "  wrote default criterion $CRITERION (minStatements=1, lab deviation)"
fi

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

# `approver-setup.sh` drives alice's VTA through a pnm profile named `alice`,
# and nothing created one — so every call it made failed, `|| true` swallowed
# each failure, and the approver rung reported only that the consent rule "did
# not stick". The profile is minted the same two-phase way as the community's:
# pnm mints an admin did:key, the VTA imports it offline, pnm binds the result.
log "creating the alice pnm profile (approver-setup drives the VTA through it)"
export PNM_HOME="$STACK_DIR/pnm-alice"
rm -rf "${PNM_HOME:?}" && mkdir -p "$PNM_HOME"
ALICE_ADMIN=$("$PNM_BIN" setup --name alice --overwrite 2>&1 | grep -o 'did:key:z[A-Za-z0-9]*' | head -1)
if [ -n "$ALICE_ADMIN" ]; then
  stop_and_wait 8110
  "$VTA_BIN" --config "$STACK_DIR/alice/config.toml" import-did \
    --did "$ALICE_ADMIN" --role admin --label pnm-alice >/dev/null 2>&1 || true
  nohup "$VTA_BIN" --config "$STACK_DIR/alice/config.toml" \
    > "$STACK_DIR/logs/alice.log" 2>&1 &
  sleep 14
  "$PNM_BIN" setup continue alice --vta-did "$ALICE_VTA_DID" >/dev/null 2>&1 || true
  echo "  admin $ALICE_ADMIN"
else
  echo "  could not mint an alice admin DID — approver-setup will fail" >&2
fi
unset PNM_HOME

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
    cid = c.get("id")
    v = c.get("vetting")
    if not v:
        print(f"  {cid}: no vetting requirement")
        continue
    # Names are bound first so the f-strings hold no quotes: this script sits in
    # a single-quoted shell string, and before Python 3.12 an f-string expression
    # may not contain a backslash either.
    ms, am, age = v.get("minStatements"), v.get("acceptedMethods"), v.get("maxStatementAge")
    print(f"  {cid}: {ms} statement(s), methods {am}, max age {age}")
    floors, indep = v.get("minByMethod"), v.get("independence")
    if floors:
        print(f"    per-method floors: {floors}")
    if indep:
        print(f"    independence: {indep}")
'

echo
echo "Community is ready. A vetter still has to be admitted and granted:"
echo "  ./invite-persona.sh <vetter did> member     # admit them"
echo "  node $ADMIN $BASE \$VTC_DID $CRED vetter-grant <vetter did>"
