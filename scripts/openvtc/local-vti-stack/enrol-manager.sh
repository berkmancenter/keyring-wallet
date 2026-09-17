#!/usr/bin/env bash
# Enrol a phone as the manager of a local VTA — the stand-in for the enrolment
# QR the plan proposes to a farm (§9 request 2). Upstream does this as a paste
# between two terminals; a farm console would do it behind a scanned link. Here
# it is one command, and it is deliberately the ONLY thing that touches the VTA
# on the phone's behalf: the phone minted the DID, the operator admits it.
#
#   ./enrol-manager.sh <did> [vta-name] [role]      default vta-name=alice, role=admin
#
# The VTA's store is locked while it runs, so the daemon is stopped, the ACL
# entry written, and the daemon started again. Ports: alice 8110, bob 8112,
# community 8111.
set -euo pipefail

DID="${1:?usage: enrol-manager.sh <did> [vta-name] [role]}"
NAME="${2:-alice}"
ROLE="${3:-admin}"
STACK_DIR="${STACK_DIR:-$HOME/vti-stack}"
VTA_BIN="${VTA_BIN:-$HOME/Documents/vti-main/target/debug/vta}"
export RUST_MIN_STACK="${RUST_MIN_STACK:-33554432}"

case "$NAME" in
  alice) PORT=8110 ;;
  community) PORT=8111 ;;
  bob) PORT=8112 ;;
  *) echo "unknown vta: $NAME" >&2; exit 1 ;;
esac

pid=$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null | head -1 || true)
# Kill by PID only — never by name pattern.
[ -n "$pid" ] && kill "$pid" && sleep 3

"$VTA_BIN" --config "$STACK_DIR/$NAME/config.toml" import-did --did "$DID" --role "$ROLE" --label "keyring-$ROLE" 2>&1 \
  | sed -e 's/\x1b\[[0-9;]*m//g' | grep -E "imported|already|rror" || true

nohup "$VTA_BIN" --config "$STACK_DIR/$NAME/config.toml" > "$STACK_DIR/logs/$NAME.log" 2>&1 &
for _ in $(seq 1 30); do
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t >/dev/null 2>&1 && { echo "enrolled $DID on $NAME as $ROLE"; exit 0; }
  sleep 1
done
echo "$NAME did not come back on :$PORT" >&2
exit 1
