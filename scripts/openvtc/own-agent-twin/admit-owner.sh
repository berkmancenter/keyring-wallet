#!/usr/bin/env bash
# The Farm stand-in: admit a DID as the twin agent's owner, the way the VTA
# Farm's "Admin DID → Provision agent" does.
#
#   ./admit-owner.sh <did> [label]          label defaults to farm-admin-did
#
# What the Farm grants a pasted Admin DID is not documented (own_agent_subtask.md
# §2, measurement M2). Upstream's guide pairs that paste with
#
#   vta import-did --did <X> --role admin
#
# (VTI ed672fff docs/05-design-notes/pnm-setup-deferred-vta-did.md:23), which
# writes an unrestricted, permanent admin: role admin, no contexts, no expiry,
# createdBy "cli:import-did" (vta-service/src/import_did.rs:57-71). This script
# runs exactly that command and nothing else — no --context, no expiry.
#
# import-did opens the VTA's store directly, and fjall holds an exclusive lock
# per data dir while the daemon runs (vta-service/src/main.rs, "The daemon must
# be stopped before running this command"), so the twin is stopped for the
# write and started again. That is also the Farm's order: the Admin DID is
# written before the agent comes online. Only the twin is ever stopped; the
# names alice, bob and community are refused (lib.sh).
set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd)/lib.sh"
# The twin's own DID, for the mediator-side readiness check below.
[ -n "${TWIN_VTA_DID:-}" ] || TWIN_VTA_DID=$(sed -n 's/^TWIN_VTA_DID=//p' "$TWIN_ENV" 2>/dev/null)

DID="${1:?usage: admit-owner.sh <did> [label]}"
LABEL="${2:-farm-admin-did}"
case "$DID" in did:*) ;; *) echo "not a DID: $DID" >&2; exit 2 ;; esac
[ -f "$TWIN_ENV" ] || { echo "the twin is not set up: run ./twin-vta.sh up" >&2; exit 1; }

echo "==> admitting on $TWIN (the Farm's Admin DID stand-in): ${DID:0:60}…"
twin_stop

# import-did asks "Overwrite?" on a DID it already holds, which a script
# cannot answer. Look first, with the store still ours.
held=$("$VTA_BIN" --config "$TWIN_DIR/config.toml" acl get "$DID" 2>&1 | strip_ansi || true)
if echo "$held" | grep -q "$DID" && ! echo "$held" | grep -qiE "not found|no acl entry|no entry"; then
  echo "  already in the ACL — left as it is:"
  echo "$held" | grep -E "^ *(DID|Role|Label|Contexts|Created|Expires)" | sed 's/^ */    /'
else
  "$VTA_BIN" --config "$TWIN_DIR/config.toml" import-did --did "$DID" --role admin --label "$LABEL" 2>&1 \
    | strip_ansi | grep -E "DID imported|Role|Contexts|Label|rror" | sed 's/^/  /'
fi

started_at=$(date -u +%FT%T)
twin_start
# Ready for a phone once the agent is back on its mediator. It first waits to
# resolve its own DID through the tunnel, with backoff; one start of five in the
# proof run took over 60 s there (the lab's tunnels drop requests now and then),
# and once (2026-09-25 20:04Z) it logged "DIDComm messaging started" and never
# connected. So wait up to 90 s, and if it has not connected, restart it once.
wait_connected() {
  # carol does not always log "messaging connected to mediator" (2026-09-25
  # 20:07Z: connected, per the mediator, and never logged it), so the mediator's
  # own record counts too: an authentication by carol's DID since this start.
  local since="$1"
  for _ in $(seq 1 90); do
    if sed -e 's/\x1b\[[0-9;]*m//g' "$TWIN_LOG" 2>/dev/null | grep -q "messaging connected to mediator"; then
      return 0
    fi
    if sed -e 's/\x1b\[[0-9;]*m//g' "$STACK_DIR/logs/mediator.log" 2>/dev/null \
      | awk -v s="$since" '$1 >= s' | grep -qF "Authentication successful for $TWIN_VTA_DID"; then
      return 0
    fi
    sleep 1
  done
  return 1
}
if wait_connected "$started_at"; then
  echo "  $TWIN is back on the mediator"
  exit 0
fi
echo "  $TWIN did not connect to the mediator within 90 s; restarting it once"
twin_stop
started_at=$(date -u +%FT%T)
twin_start
if wait_connected "$started_at"; then
  echo "  $TWIN is back on the mediator (after one restart)"
  exit 0
fi
echo "  $TWIN did not reconnect to the mediator after a restart — see $TWIN_LOG" >&2
exit 1
