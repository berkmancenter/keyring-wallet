#!/usr/bin/env bash
# Does an openvtc vetter accept the Vetting Card Keyring sends? Runs the VTI
# SDK's own verify_card (the check openvtc's vetter runs) on a card Keyring's
# shipping sendCard produces. No simulator, no network: the card is signed by
# a did:key. A few seconds once card-verify is built.
#
#   scripts/openvtc/card-verify/check-keyring-card.sh
#   CARD_VERIFY_BUILD=1 scripts/openvtc/card-verify/check-keyring-card.sh   # build card-verify first (a heavy compile: declare it)
#
# Then the reverse direction: the vetted/1 statement Keyring's vetter makes
# over that card, checked by vta-sdk's verify_statement, check_against_card and
# check_against_session (what an openvtc applicant runs on a statement it
# receives), and the vetter's eligibility presentation with its role VAC.
#
#   BIFOLD_DIR=<bifold checkout> …   # check a bifold other than the submodule
#
# Exit 0 and the OK lines when both pass; non-zero otherwise.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
HERE="$ROOT/scripts/openvtc/card-verify"
VTI="$ROOT/external/verifiable-trust-infrastructure"
BIFOLD="${BIFOLD_DIR:-$ROOT/bifold}"
BIN="$VTI/target/release/card-verify"

# The verifier is only as good as the SDK it is built from: the pinned one.
want="$(node -e "process.stdout.write(require('$ROOT/scripts/openvtc/PINS.json').repos['verifiable-trust-infrastructure'].sha)")"
have="$(git -C "$VTI" rev-parse HEAD)"
case "$have" in
  "$want"*) ;;
  *) echo "check-keyring-card: external/verifiable-trust-infrastructure is at ${have:0:8}, the pin is $want — run scripts/openvtc/setup-external.mjs" >&2; exit 1 ;;
esac
if [ -n "$(git -C "$VTI" status --porcelain)" ]; then
  echo "check-keyring-card: the VTI clone has local changes; the verifier would not be the pinned SDK" >&2
  exit 1
fi

if [ "${CARD_VERIFY_BUILD:-}" = 1 ] || [ ! -x "$BIN" ]; then
  if [ "${CARD_VERIFY_BUILD:-}" != 1 ]; then
    echo "check-keyring-card: $BIN is not built; rerun with CARD_VERIFY_BUILD=1 (a cargo build — declare it first)" >&2
    exit 1
  fi
  (cd "$HERE" && CARGO_TARGET_DIR="$VTI/target" cargo build --release)
fi

OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT
(cd "$BIFOLD/packages/core" && CARD_OUT="$OUT" TZ=GMT yarn jest src/modules/trust-tasks/__tests__/cardConformance.test.ts >"$OUT/jest.log" 2>&1) || {
  echo "check-keyring-card: the card producer failed — $OUT/jest.log" >&2
  tail -20 "$OUT/jest.log" >&2
  trap - EXIT
  exit 1
}
echo "check-keyring-card: VTI ${have:0:8} (pinned), bifold $(git -C "$BIFOLD" rev-parse --short=8 HEAD)"
"$BIN" "$OUT/card.json" "$OUT/expect.json"
if [ "$("$BIN" shape 2>/dev/null)" != v1 ]; then
  echo "check-keyring-card: $BIN is not a DTG Credentials v1 build; rerun with CARD_VERIFY_BUILD=1" >&2
  exit 1
fi
if [ ! -f "$OUT/statement-v1.json" ] || [ ! -f "$OUT/eligibility-v1.json" ]; then
  echo "check-keyring-card: this bifold writes no statement-v1.json or eligibility-v1.json (before keyring-bifold#358); the statement and eligibility checks were not run" >&2
  exit 1
fi
"$BIN" verify-statement "$OUT/statement-v1.json" "$OUT/card.json" "$OUT/session.json" "$OUT/expect.json"
"$BIN" verify-eligibility "$OUT/eligibility-v1.json" "$OUT/expect.json" eligibilityV1
