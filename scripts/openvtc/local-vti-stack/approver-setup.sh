#!/usr/bin/env bash
# The approver rung's policy, on the local `alice` VTA, through pnm — the same
# surface a person would use from the TUI. One phone is the manager (it asks
# for keys), another is the approver (it must consent before a key leaves).
#
#   ./approver-setup.sh add <approverDid> [taskType]   add the DID to the set and require consent
#   ./approver-setup.sh clear [taskType]               stop requiring consent
#
# Default task type: keys/export-secret/0.1 — the moment a persona's key is
# borrowed, which is the most consequential thing the manager asks for.
set -euo pipefail
STACK_DIR="${STACK_DIR:-$HOME/vti-stack}"
export PNM_HOME="${PNM_HOME:-$STACK_DIR/pnm-alice}"
PNM="${PNM_BIN:-$HOME/Documents/vti-main/target/debug/pnm}"
VTA_SLUG="${VTA_SLUG:-alice}"
SET="${APPROVER_SET:-keyring-approvers}"
TASK_DEFAULT="https://trusttasks.org/spec/keys/export-secret/0.1"
strip() { sed -e 's/\x1b\[[0-9;]*m//g' | grep -v "█\|╗\|╝\|║\|^\s*$" || true; }

case "${1:-}" in
  add)
    DID="${2:?approver DID}"; TASK="${3:-$TASK_DEFAULT}"
    "$PNM" --vta "$VTA_SLUG" approvals approvers add "$SET" "$DID" 2>&1 | strip | tail -2 || true
    "$PNM" --vta "$VTA_SLUG" approvals require "$TASK" --consent --set "$SET" 2>&1 | strip | tail -2 || true
    "$PNM" --vta "$VTA_SLUG" approvals list 2>&1 | strip | tail -6 || true
    true
    ;;
  clear)
    TASK="${2:-$TASK_DEFAULT}"
    "$PNM" --vta "$VTA_SLUG" approvals remove "$TASK" 2>&1 | strip | tail -2 || true
    true
    ;;
  *) echo "usage: approver-setup.sh add <did> [taskType] | clear [taskType]" >&2; exit 1 ;;
esac
