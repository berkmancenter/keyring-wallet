#!/usr/bin/env bash
# The admin's half of "I was invited": issue an InvitationCredential to a DID
# on the local community, and print the link a console would show as a QR
# (keyring://vti/invitation?c=<base64url(credential)>).
#
#   ./invite-persona.sh <did> [role]          role defaults to member
#   ./invite-persona.sh --invitation-only     drop the vetting criterion (allow on invitation)
#   ./invite-persona.sh --restore-criteria    put the vetting criterion back
#
# Uses tsp-reference/ref-20-local-vetting/vtc-admin.mjs against the stack in
# ~/vti-stack — the same REST surface the admin portal fronts.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
ADMIN="$REPO/tsp-reference/ref-20-local-vetting/vtc-admin.mjs"
STACK_DIR="${STACK_DIR:-$HOME/vti-stack}"
# shellcheck disable=SC1091
source "$STACK_DIR/stack.env"
CRED="$STACK_DIR/vtc-admin-credential.json"
BASE="$VTC_URL/v1"

case "${1:-}" in
  --invitation-only)
    node "$ADMIN" "$BASE" "$VTC_DID" "$CRED" delete-criterion vetted-member >/dev/null 2>&1 || true
    echo "community is invitation-only"; exit 0 ;;
  --restore-criteria)
    node "$ADMIN" "$BASE" "$VTC_DID" "$CRED" put-criterion "$STACK_DIR/criterion.json" >/dev/null
    echo "vetting criterion restored"; exit 0 ;;
esac

DID="${1:?usage: invite-persona.sh <did> [role]}"
ROLE="${2:-member}"
out=$(node "$ADMIN" "$BASE" "$VTC_DID" "$CRED" invite "$DID" "$ROLE" 2>&1)
node - "$out" <<'JS'
const raw = process.argv[2];
const start = raw.indexOf("{");
const doc = JSON.parse(raw.slice(start, raw.lastIndexOf("}") + 1));
const vc = doc.vic ?? doc.credential ?? doc.invitation ?? doc.payload?.vic ?? doc;
if (!Array.isArray(vc.type) || !vc.type.includes("InvitationCredential")) {
  console.error("no InvitationCredential in the reply:\n" + raw.slice(0, 600));
  process.exit(1);
}
const c = Buffer.from(JSON.stringify(vc)).toString("base64url");
console.log(`INVITATION_LINK=keyring://vti/invitation?c=${c}`);
JS
