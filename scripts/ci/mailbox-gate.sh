#!/usr/bin/env bash
# The store build's mailbox gate: refuse to spend build minutes on a build whose wallet mailbox would ship switched
# off because the repository secret MAILBOX_MEDIATOR_DID is empty. The app treats an empty value as "no mailbox" and
# runs on v1 only, no check goes red, and a tester's Developer switch does nothing: a silently inert build (decided
# 2026-11-21, "add a build check").
#
# Reads two environment variables and prints nothing of their values:
#   MAILBOX_MEDIATOR_DID   the secret, as the workflow passes it (empty when the secret is unset)
#   ALLOW_NO_MAILBOX       "true" for a deliberate build without a mailbox (the workflow_dispatch input)
# Exit 0 = build may go on; exit 1 = refused, with a plain message on stderr.
set -eu
if [ -n "${MAILBOX_MEDIATOR_DID:-}" ]; then
  echo "✅ MAILBOX_MEDIATOR_DID is set (the mailbox opens for testers with the Developer switch on)"
  exit 0
fi
if [ "${ALLOW_NO_MAILBOX:-false}" = "true" ]; then
  echo "ℹ️ MAILBOX_MEDIATOR_DID is not set, and allow_no_mailbox=true: building with the mailbox switched off, deliberately"
  exit 0
fi
echo "❌ MAILBOX_MEDIATOR_DID is not set: the mailbox would ship switched off. Set the repository secret, or dispatch with allow_no_mailbox=true." >&2
exit 1
