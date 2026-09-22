#!/usr/bin/env bash
# Restart the six local services on whatever binaries are built now, keeping
# every config, DID and store as it is. This is the in-place path — `up.sh`
# provisions from scratch and mints new DIDs, which is the wrong tool for
# "the binaries moved to a new release".
#
#   ./restart.sh            stop + start everything
#   ./restart.sh alice      just that service (alice | bob | community | vtc | mediator | dids)
#
# Ports: mediator 7037 · dids 8534 · vtc 8200 · alice 8110 · community 8111 · bob 8112.
# Kill by PID only — never by name pattern.
set -uo pipefail
STACK_DIR="${STACK_DIR:-$HOME/vti-stack}"
VTI_SRC="${VTI_SRC:-$HOME/Documents/vti-main}"
TDK_SRC="${TDK_SRC:-$HOME/Documents/affinidi-tdk-rs}"
WEBVH_SRC="${WEBVH_SRC:-$HOME/Documents/affinidi-webvh-service}"
VTA_BIN="$VTI_SRC/target/debug/vta"; VTC_BIN="$VTI_SRC/target/debug/vtc"
MEDIATOR_BIN="$TDK_SRC/target/debug/mediator"; WEBVH_BIN="$WEBVH_SRC/target/debug/did-hosting-daemon"
export RUST_MIN_STACK="${RUST_MIN_STACK:-33554432}"
mkdir -p "$STACK_DIR/logs"

port_of() { case "$1" in mediator) echo 7037;; dids) echo 8534;; vtc) echo 8200;; alice) echo 8110;; community) echo 8111;; bob) echo 8112;; esac; }
stop() { local p; p=$(lsof -nP -iTCP:"$(port_of "$1")" -sTCP:LISTEN -t 2>/dev/null | head -1); [ -n "$p" ] && kill "$p" && echo "  stopped $1 (pid $p)"; }
wait_up() { for _ in $(seq 1 40); do lsof -nP -iTCP:"$(port_of "$1")" -sTCP:LISTEN -t >/dev/null 2>&1 && return 0; sleep 1; done; echo "  $1 did not come up on :$(port_of "$1")" >&2; return 1; }
start() {
  case "$1" in
    mediator) # the stored-function library must match the binary being started,
              # or the per-relationship queue gate is configured and inert
              cp "$TDK_SRC/crates/messaging/affinidi-messaging-mediator/conf/atm-functions.lua" \
                "$STACK_DIR/mediator/conf/atm-functions.lua" 2>/dev/null && echo "  stored-function library refreshed"
              (cd "$STACK_DIR/mediator" && nohup "$MEDIATOR_BIN" -c "$STACK_DIR/mediator/conf/mediator.toml" > "$STACK_DIR/logs/mediator.log" 2>&1 &) ;;
    dids)     (cd "$STACK_DIR" && nohup "$WEBVH_BIN" --config dids/config.toml > logs/dids.log 2>&1 &) ;;
    vtc)      (cd "$STACK_DIR" && nohup "$VTC_BIN" --config vtc/config.toml > logs/vtc.log 2>&1 &) ;;
    alice|community|bob) (cd "$STACK_DIR" && nohup "$VTA_BIN" --config "$1/config.toml" > "logs/$1.log" 2>&1 &) ;;
  esac
  wait_up "$1" && echo "  started $1"
}
# Order matters on the way up: the mediator first (everything logs in to it),
# then the DID host (VTAs resolve through it), then the agents, then the VTC.
ORDER="mediator dids alice community bob vtc"
if [ $# -gt 0 ]; then ORDER="$*"; fi
for s in $ORDER; do stop "$s"; done
sleep 2
for s in $ORDER; do start "$s"; done
