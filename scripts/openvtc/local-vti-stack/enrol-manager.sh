#!/usr/bin/env bash
# Enrol a phone as the manager of a local VTA — the stand-in for the enrolment
# QR the plan proposes to a farm (§9 request 2). Upstream does this as a paste
# between two terminals; a farm console would do it behind a scanned link (see
# enrol-page/ for the QR version of exactly that). Here it is one command, and
# it is deliberately the ONLY thing that touches the VTA on the phone's behalf:
# the phone minted the DID, the operator admits it.
#
#   ./enrol-manager.sh [--offline] <did> [vta-name] [role]
#                                   default vta-name=$RUNNER_VTA (bob), role=admin
#
# alice is reserved for Alberto's TestFlight phone (2026-09-22): runners enrol
# on the runner VTA, bob, unless told otherwise.
#
# ONLINE (default): grants on the RUNNING VTA with `pnm acl create`, as that
# VTA's existing admin (PNM_HOME, default $STACK_DIR/pnm-<vta-name>). Upstream
# supports granting on a live VTA, so nothing is stopped or restarted — other
# sessions on the same stack are undisturbed. The entry is permanent, as the
# offline path's always was, unless EXPIRES is set (e.g. EXPIRES=1h for a phone
# that rotates to its own long-lived key right after, as linking does). If the
# DID already has an entry (409 / "already exists"), the role is moved with
# `pnm acl change-role` (compare-and-swap, tried from each other role); if it
# already holds the role, that is success — re-enrolling an enrolled phone is
# idempotent, which kept-state runner chains rely on. An existing entry's
# expiry is left as it is.
#
# --offline: the old path. The VTA's store is locked while it runs, so the
# daemon is stopped, the ACL entry written with `vta import-did`, and the
# daemon started again. No expiry. Use it only when no admin credential is at
# hand. Ports: alice 8110, bob 8112, community 8111.
set -euo pipefail

MODE=online
if [ "${1:-}" = "--offline" ]; then MODE=offline; shift; fi
DID="${1:?usage: enrol-manager.sh [--offline] <did> [vta-name] [role]}"
NAME="${2:-${RUNNER_VTA:-bob}}"
ROLE="${3:-admin}"
STACK_DIR="${STACK_DIR:-$HOME/vti-stack}"
VTA_BIN="${VTA_BIN:-$HOME/Documents/vti-main/target/debug/vta}"
export RUST_MIN_STACK="${RUST_MIN_STACK:-33554432}"

# A lab VTA's port matters only offline (the daemon is stopped and restarted).
# Online, any VTA pnm knows will do — a Farm VTA included (PNM_HOME names it).
case "$NAME" in
  alice) PORT=8110 ;;
  community) PORT=8111 ;;
  bob) PORT=8112 ;;
  *) PORT="" ;;
esac
if [ "$MODE" != online ] && [ -z "$PORT" ]; then
  echo "unknown lab vta: $NAME (offline mode needs a lab VTA; online works with any pnm VTA)" >&2
  exit 1
fi

if [ "$MODE" = online ]; then
  PNM="${PNM_BIN:-$HOME/Documents/vti-main/target/debug/pnm}"
  export PNM_HOME="${PNM_HOME:-$STACK_DIR/pnm-$NAME}"
  strip() { sed -e 's/\x1b\[[0-9;]*m//g'; }
  expiry=()
  [ -n "${EXPIRES:-}" ] && expiry=(--expires "$EXPIRES")
  if out=$("$PNM" --vta "$NAME" acl create --did "$DID" --role "$ROLE" ${expiry[@]+"${expiry[@]}"} --label "keyring-$ROLE" 2>&1); then
    [ -n "$out" ] && echo "$out" | strip
    echo "enrolled $DID on $NAME as $ROLE${EXPIRES:+ (expires in $EXPIRES)}"
    exit 0
  fi
  out=$(echo "$out" | strip)
  if ! echo "$out" | grep -qiE "409|already exists|conflict"; then
    echo "$out" >&2
    echo "pnm acl create failed on $NAME (PNM_HOME=$PNM_HOME)" >&2
    exit 1
  fi
  # The entry exists: create never changes it, so move the role with the
  # compare-and-swap change-role, trying each role it might currently hold.
  for from in admin initiator application reader; do
    [ "$from" = "$ROLE" ] && continue
    if moved=$("$PNM" --vta "$NAME" acl change-role --did "$DID" --from "$from" --to "$ROLE" --reason "enrol-manager re-enrol" 2>&1); then
      [ -n "$moved" ] && echo "$moved" | strip
      echo "re-enrolled $DID on $NAME: $from -> $ROLE (existing expiry unchanged)"
      exit 0
    fi
  done
  # No other role moved to ROLE: the entry already holds it. Confirm, then
  # report success — the phone is enrolled, which is what was asked.
  if held=$("$PNM" --vta "$NAME" acl get "$DID" 2>&1) && echo "$held" | strip | grep -qiE "\b$ROLE\b"; then
    echo "$DID is already enrolled on $NAME as $ROLE (existing entry and expiry unchanged)"
    exit 0
  fi
  echo "$held" | strip >&2
  echo "$DID already has an ACL entry on $NAME, but not as $ROLE, and change-role did not apply" >&2
  exit 1
fi

# ---- --offline: stop, import, restart ----
pid=$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null | head -1 || true)
# Kill by PID only — never by name pattern.
[ -n "$pid" ] && kill "$pid" && sleep 3

# import-did creates the entry but never downgrades an existing one, so a
# re-enrol at a lower role (e.g. admin -> initiator, needed for consent to
# apply) is a change-role, tried after the import "already exists".
imported=$("$VTA_BIN" --config "$STACK_DIR/$NAME/config.toml" import-did --did "$DID" --role "$ROLE" --label "keyring-$ROLE" 2>&1 | sed -e 's/\x1b\[[0-9;]*m//g' || true)
echo "$imported" | grep -E "imported|already|rror" || true
if echo "$imported" | grep -qi "already"; then
  for from in admin initiator application reader; do
    [ "$from" = "$ROLE" ] && continue
    out=$("$VTA_BIN" --config "$STACK_DIR/$NAME/config.toml" acl change-role --did "$DID" --from "$from" --to "$ROLE" 2>/dev/null | sed -e 's/\x1b\[[0-9;]*m//g' || true)
    if echo "$out" | grep -qEi "changed|→"; then echo "$out" | grep -Ei "changed|→"; break; fi
  done
fi
true

nohup "$VTA_BIN" --config "$STACK_DIR/$NAME/config.toml" > "$STACK_DIR/logs/$NAME.log" 2>&1 &
for _ in $(seq 1 30); do
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t >/dev/null 2>&1 && { echo "enrolled $DID on $NAME as $ROLE"; exit 0; }
  sleep 1
done
echo "$NAME did not come back on :$PORT" >&2
exit 1
