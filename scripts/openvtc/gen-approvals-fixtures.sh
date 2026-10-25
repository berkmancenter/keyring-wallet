#!/usr/bin/env bash
# Generate the fixtures bifold's approvalsPolicy.ts is tested against: what the
# VTI SDK's own `synthesize_rego` produces for each case, at the VTI commit
# pinned in PINS.json. The VTA byte-compares the Rego module a client writes
# with the one it derives itself, so Keyring's TypeScript port must match the
# SDK exactly. Re-run this at every VTI bump and commit the result in bifold.
#
#   scripts/openvtc/gen-approvals-fixtures.sh [path/to/bifold]
#
# Reads    <bifold>/packages/core/src/modules/trust-tasks/__tests__/fixtures/approvals-cases.json
# Writes   <bifold>/packages/core/src/modules/trust-tasks/__tests__/fixtures/approvals-rego.json
#
# Needs external/verifiable-trust-infrastructure (setup-external.mjs) and cargo.
# A cargo build: say so to the other lanes first (one heavy build at a time).
# It builds vta-sdk with no default features, in a throwaway worktree at the
# pin, with a cached target directory so later runs are quick.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
BIFOLD="${1:-$ROOT/bifold}"
FIX="$BIFOLD/packages/core/src/modules/trust-tasks/__tests__/fixtures"
# external/ is gitignored, so a worktree has none: use the main checkout's.
MAIN="$(cd "$(git -C "$ROOT" rev-parse --git-common-dir)/.." && pwd)"
VTI="$MAIN/external/verifiable-trust-infrastructure"
PIN="$(node -e "console.log(require('$HERE/PINS.json').repos['verifiable-trust-infrastructure'].sha)")"
TARGET="${CARGO_TARGET_DIR:-$HOME/.cache/keyring-vti-approvals-target}"

[ -f "$FIX/approvals-cases.json" ] || { echo "no cases at $FIX/approvals-cases.json" >&2; exit 1; }
[ -d "$VTI/.git" ] || [ -f "$VTI/.git" ] || { echo "no VTI clone at $VTI: run setup-external.mjs" >&2; exit 1; }

WORK="$(mktemp -d "${TMPDIR:-/tmp}/vti-approvals-XXXXXX")"
cleanup() { git -C "$VTI" worktree remove --force "$WORK/vti" >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

git -C "$VTI" cat-file -e "$PIN^{commit}" 2>/dev/null || git -C "$VTI" fetch -q origin "$PIN"
git -C "$VTI" worktree add -q --detach "$WORK/vti" "$PIN"
mkdir -p "$WORK/vti/vta-sdk/examples"
cat > "$WORK/vti/vta-sdk/examples/approvals_fixtures.rs" <<'RS'
// Throwaway: written by Keyring's gen-approvals-fixtures.sh, never committed upstream.
use std::io::Read;
use vta_sdk::approvals::{synthesize_rego, ApprovalRule};

#[derive(serde::Deserialize)]
struct Case {
    name: String,
    rules: Vec<ApprovalRule>,
}

fn main() {
    let mut input = String::new();
    std::io::stdin().read_to_string(&mut input).expect("read cases");
    let cases: Vec<Case> = serde_json::from_str(&input).expect("parse cases");
    let out: Vec<serde_json::Value> = cases
        .into_iter()
        .map(|c| serde_json::json!({ "name": c.name, "rules": c.rules, "rego": synthesize_rego(&c.rules) }))
        .collect();
    println!("{}", serde_json::to_string_pretty(&out).expect("write fixtures"));
}
RS

echo "generating at VTI $PIN (target $TARGET)…" >&2
OUT="$(cd "$WORK/vti" && CARGO_TARGET_DIR="$TARGET" cargo run -q -p vta-sdk --no-default-features --example approvals_fixtures < "$FIX/approvals-cases.json")"
node -e "
const cases = JSON.parse(process.argv[1]);
const out = { vti: '$PIN', generatedBy: 'scripts/openvtc/gen-approvals-fixtures.sh', cases };
require('fs').writeFileSync('$FIX/approvals-rego.json', JSON.stringify(out, null, 2) + '\n');
console.error('wrote ' + cases.length + ' cases to $FIX/approvals-rego.json');
" "$OUT"
# In bifold's own style, so its prettier check passes.
(cd "$BIFOLD/packages/core" && npx --no-install prettier --write "$FIX/approvals-rego.json" >/dev/null) ||
  echo "prettier not run: format approvals-rego.json in bifold before committing" >&2
