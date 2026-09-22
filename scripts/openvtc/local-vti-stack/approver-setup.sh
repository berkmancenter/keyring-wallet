#!/usr/bin/env bash
# The approver rung's policy, on the runner VTA (bob; alice is reserved for
# Alberto's TestFlight phone since 2026-09-22), through pnm — the same
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
VTA_SLUG="${VTA_SLUG:-${RUNNER_VTA:-bob}}"
export PNM_HOME="${PNM_HOME:-$STACK_DIR/pnm-$VTA_SLUG}"
PNM="${PNM_BIN:-$HOME/Documents/vti-main/target/debug/pnm}"
SET="${APPROVER_SET:-keyring-approvers}"
TASK_DEFAULT="https://trusttasks.org/spec/keys/export-secret/0.1"
strip() { sed -e 's/\x1b\[[0-9;]*m//g' | grep -v "█\|╗\|╝\|║\|^\s*$" || true; }

case "${1:-}" in
  add)
    DID="${2:?approver DID}"; TASK="${3:-$TASK_DEFAULT}"
    # One approver per run. Earlier runs' approvers (a phone reinstalled, a
    # manager re-minted) otherwise stay in the set, and every one of them adds a
    # signed request to the refusal's `details` — three were enough to push it
    # past the framework's size bound, and the VTA then sent the bare code with
    # no challenge in it (2026-09-21).
    for stale in $("$PNM" --vta "$VTA_SLUG" approvals list 2>&1 | strip | grep -oE 'did:[a-z]+:[^ ]+' | sort -u); do
      [ "$stale" = "$DID" ] && continue
      "$PNM" --vta "$VTA_SLUG" approvals approvers remove "$SET" "$stale" >/dev/null 2>&1 || true
    done
    "$PNM" --vta "$VTA_SLUG" approvals approvers add "$SET" "$DID" 2>&1 | strip | tail -2 || true
    # The rule is what actually holds a task; `|| true` used to swallow a
    # transient failure here and the run then found "no approval rules" only
    # when the borrow completed unheld. Verify, and retry a few times.
    for _ in 1 2 3 4 5; do
      "$PNM" --vta "$VTA_SLUG" approvals require "$TASK" --consent --set "$SET" 2>&1 | strip | tail -2 || true
      if "$PNM" --vta "$VTA_SLUG" approvals list 2>&1 | strip | grep -q "$TASK"; then break; fi
      sleep 2
    done
    "$PNM" --vta "$VTA_SLUG" approvals list 2>&1 | strip | tail -6 || true
    "$PNM" --vta "$VTA_SLUG" approvals list 2>&1 | strip | grep -q "$TASK" || { echo "approver-setup: the consent rule for $TASK did not stick" >&2; exit 1; }
    true
    ;;
  clear)
    TASK="${2:-$TASK_DEFAULT}"
    "$PNM" --vta "$VTA_SLUG" approvals remove "$TASK" 2>&1 | strip | tail -2 || true
    true
    ;;
  *) echo "usage: approver-setup.sh add <did> [taskType] | clear [taskType]" >&2; exit 1 ;;
esac
