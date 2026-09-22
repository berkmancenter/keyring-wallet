#!/usr/bin/env bash
# Is the stack actually able to run a ceremony right now?
#
#   ./stack-health.sh          report; exit 1 if anything is wrong
#   ./stack-health.sh --heal   restart what is down, then report
#
# Written after an evening in which three separate runs failed for reasons
# that had nothing to do with the thing under test: a VTA that had exited so
# its tunnel answered 502, a tunnel endpoint that went offline, and a VTC
# whose mediator websocket dropped at 05:55 and never came back — leaving a
# community that answered REST perfectly and was deaf to every DIDComm
# request for the next eleven hours. None of those announce themselves. Each
# one presents as the app misbehaving.
#
# Run this before an e2e rung. A minute here is cheaper than a wrong diagnosis.
set -uo pipefail

STACK_DIR="${STACK_DIR:-$HOME/vti-stack}"
VTI_SRC="${VTI_SRC:-$HOME/Documents/vti-main}"
TDK_SRC="${TDK_SRC:-$HOME/Documents/affinidi-tdk-rs}"
WEBVH_SRC="${WEBVH_SRC:-$HOME/Documents/affinidi-webvh-service}"
HEAL=0
[ "${1:-}" = "--heal" ] && HEAL=1

# A VTA started without this overflows a worker stack handling
# `vta/webvh/dids/create/1.0` and aborts the whole process — the client then
# reports "the VTA did not answer", which reads as a timeout rather than a
# crash. up.sh exports it; anything that restarts a service must too, or a
# heal quietly produces an agent that dies on the first persona mint.
export RUST_MIN_STACK="${RUST_MIN_STACK:-33554432}"

problems=0
healed=0
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; problems=$((problems + 1)); }
log()  { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
# A problem that --heal actually fixed is no longer a reason to refuse the run.
# Without this the script healed everything and still exited 1 saying "1
# problem(s) — fix before reading anything into an e2e failure", which is both
# wrong and exactly the kind of false signal this script exists to remove.
fixed() { printf '  \033[32m✓\033[0m %s\n' "$1"; problems=$((problems - 1)); healed=$((healed + 1)); }

# name port config-path binary
services() {
  cat <<EOF
alice 8110 $STACK_DIR/alice/config.toml $VTI_SRC/target/debug/vta
community 8111 $STACK_DIR/community/config.toml $VTI_SRC/target/debug/vta
bob 8112 $STACK_DIR/bob/config.toml $VTI_SRC/target/debug/vta
vtc 8200 $STACK_DIR/vtc/config.toml $VTI_SRC/target/debug/vtc
dids 8534 $STACK_DIR/dids/config.toml $WEBVH_SRC/target/debug/did-hosting-daemon
EOF
}

log "processes"
while read -r name port config bin; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN -t >/dev/null 2>&1; then
    ok "$name listening on :$port"
  elif [ "$HEAL" = 1 ]; then
    bad "$name was not listening on :$port — restarting"
    nohup "$bin" --config "$config" > "$STACK_DIR/logs/$name.log" 2>&1 &
    sleep 14
    lsof -nP -iTCP:"$port" -sTCP:LISTEN -t >/dev/null 2>&1 && fixed "$name came back" || bad "$name would not start"
  else
    bad "$name is NOT listening on :$port"
  fi
done < <(services)

if lsof -nP -iTCP:7037 -sTCP:LISTEN -t >/dev/null 2>&1; then
  ok "mediator listening on :7037"
else
  bad "mediator is NOT listening on :7037 (restart it from up.sh)"
fi

log "tunnels"
# A 502 means the tunnel is up and nothing is behind it — the shape a dead
# service takes from the outside, and the one that reads as a client problem.
for h in alice community bob vtc dids mediator; do
  body=$(mktemp)
  code=$(curl -s -o "$body" -w "%{http_code}" --max-time 12 "https://keyring-vti-$h.ngrok.app/" 2>/dev/null)
  # ngrok answers its own refusals with an HTML page naming an ERR_NGROK_ code
  # (4026: the account is out of credit). That is the edge, not the service —
  # and a VTA whose own hostname is refused cannot resolve its own DID.
  ngrok_err=$(grep -oE "ERR_NGROK_[0-9]+" "$body" | head -1); rm -f "$body"
  case "$code" in
    502|000) bad "$h tunnel answers $code — nothing behind it" ;;
    *) if [ -n "$ngrok_err" ]; then bad "$h tunnel refused by ngrok ($ngrok_err, HTTP $code) — see ngrok.com/docs/errors"
       else ok "$h tunnel answers $code"; fi ;;
  esac
done

log "every agent's DIDComm ear"
# The same outage that deafened the VTC took the community and bob VTAs with
# it, and nothing said so: each kept serving REST while its websocket stayed
# down for eleven hours. A persona mint then fails with "the VTA did not
# answer", which reads as the VTA being gone when it is listening perfectly.
#
# A VTA that boots while its own DID cannot be fetched (a tunnel refusing, as
# ngrok's ERR_NGROK_4026 did to alice on 2026-09-21) skips DIDComm for the
# whole boot — "DIDComm messaging not started this boot" — and never retries.
# That is healed like a drop.
for n in alice community bob; do
  last=$(grep -nE "messaging connected to mediator|WebSocket connection dropped|Error creating websocket|DIDComm messaging not started this boot" \
    "$STACK_DIR/logs/$n.log" 2>/dev/null | tail -1)
  case "$last" in
    *"connected to mediator"*) ok "$n's last websocket event was a connect" ;;
    "") bad "no websocket events in $n's log" ;;
    *)
      if [ "$HEAL" = 1 ]; then
        case "$last" in
          *"not started this boot"*) bad "$n skipped DIDComm at boot — restarting it" ;;
          *) bad "$n's last websocket event was a DROP — restarting it" ;;
        esac
        case "$n" in alice) port=8110 ;; community) port=8111 ;; bob) port=8112 ;; esac
        for pid in $(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null); do
          kill "$pid"
          for _ in $(seq 1 30); do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
        done
        nohup "$VTI_SRC/target/debug/vta" --config "$STACK_DIR/$n/config.toml" \
          > "$STACK_DIR/logs/$n.log" 2>&1 &
        sleep 20
        grep -q "messaging connected to mediator" "$STACK_DIR/logs/$n.log" 2>/dev/null \
          && fixed "$n reconnected" || bad "$n did not reconnect"
      else
        case "$last" in
          *"not started this boot"*) bad "$n skipped DIDComm at boot — it is deaf on DIDComm (--heal restarts it)" ;;
          *) bad "$n's last websocket event was a DROP — it is deaf on DIDComm (--heal restarts it)" ;;
        esac
      fi
      ;;
  esac
done

log "every VTA can mint a served persona"
# A VTA with no DID-hosting server registered mints personas "serverless":
# created, keys held, served by nobody — the phone then fails at "community
# session as persona" with a 404 naming the persona (VTI-20). The runner VTA,
# bob, had none on 2026-09-22 and cost a run. Read-only: each VTA's own pnm
# home lists its servers; a VTA with no pnm home here is skipped.
for n in alice community bob; do
  home="$STACK_DIR/pnm-$n"
  [ -d "$home" ] || continue
  servers=$(PNM_HOME="$home" "$VTI_SRC/target/debug/pnm" --vta "$n" did-mgmt servers list 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -c "did:webvh" || true)
  if [ "${servers:-0}" -gt 0 ]; then ok "$n has a DID host registered"; else bad "$n has NO DID host registered — persona mints will not resolve (pnm did-mgmt servers add --id dids --did \$DIDS_DID)"; fi
done

log "the DID host's DIDComm ear"
# The gap that cost a rebuild at 03:00 on 2026-09-21. Restarting the mediator
# drops every client socket, and the DID-hosting daemon does not always get one
# back — its last three websocket events were "Error creating websocket
# connection" and it simply stayed deaf, serving HTTP the whole time so both
# the process check and the tunnel check passed. A persona mint then fails as
# `bad gateway: ... request timed out after 30s` inside the VTA, which reads as
# a VTA fault and is not one. Everything that mints a DID depends on this
# socket, so it is checked like the others.
last=$(grep -nE "DIDComm service started successfully|messaging service started|Error creating websocket|WebSocket connection dropped" \
  "$STACK_DIR/logs/dids.log" 2>/dev/null | tail -1)
case "$last" in
  *"service started"*) ok "the DID host's last messaging event was a start" ;;
  "") bad "no messaging events in the DID host's log" ;;
  *)
    if [ "$HEAL" = 1 ]; then
      bad "the DID host's last messaging event was a FAILURE — restarting it"
      for pid in $(lsof -nP -iTCP:8534 -sTCP:LISTEN -t 2>/dev/null); do
        kill "$pid"
        for _ in $(seq 1 30); do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
      done
      nohup "$WEBVH_SRC/target/debug/did-hosting-daemon" --config "$STACK_DIR/dids/config.toml" \
        > "$STACK_DIR/logs/dids.log" 2>&1 &
      sleep 25
      grep -q "DIDComm service started successfully" "$STACK_DIR/logs/dids.log" 2>/dev/null \
        && fixed "the DID host reconnected" || bad "the DID host did not reconnect"
    else
      bad "the DID host is deaf on DIDComm — every persona mint will time out (--heal restarts it)"
    fi
    ;;
esac

log "the community's DIDComm ear"
# The one that cost the most: the VTC serves REST happily while its mediator
# websocket is gone, so a manifest fetch succeeds and every Trust Task asked
# over DIDComm goes unanswered. Trust the LAST event in the log, not the
# presence of a connect line somewhere in it.
last=$(grep -nE "connected to mediator|WebSocket connection dropped|Error creating websocket" \
  "$STACK_DIR/logs/vtc.log" 2>/dev/null | tail -1)
case "$last" in
  *"connected to mediator"*) ok "VTC's last websocket event was a connect" ;;
  "") bad "no websocket events in the VTC log at all" ;;
  *)
    if [ "$HEAL" = 1 ]; then
      bad "VTC's last websocket event was a DROP — restarting it"
      pid=$(lsof -nP -iTCP:8200 -sTCP:LISTEN -t 2>/dev/null | head -1)
      if [ -n "$pid" ]; then
        kill "$pid"
        for _ in $(seq 1 30); do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
      fi
      nohup "$VTI_SRC/target/debug/vtc" --config "$STACK_DIR/vtc/config.toml" \
        > "$STACK_DIR/logs/vtc.log" 2>&1 &
      sleep 20
      grep -q "connected to mediator" "$STACK_DIR/logs/vtc.log" 2>/dev/null \
        && fixed "VTC reconnected" || bad "VTC did not reconnect"
    else
      bad "VTC's last websocket event was a DROP — it is deaf on DIDComm (--heal restarts it)"
    fi
    ;;
esac

echo
if [ "$problems" -le 0 ]; then
  if [ "$healed" -gt 0 ]; then
    printf '\033[32mstack looks able to run a ceremony (%d healed)\033[0m\n' "$healed"
  else
    printf '\033[32mstack looks able to run a ceremony\033[0m\n'
  fi
  exit 0
fi
printf '\033[31m%d problem(s) — fix before reading anything into an e2e failure\033[0m\n' "$problems"
exit 1
