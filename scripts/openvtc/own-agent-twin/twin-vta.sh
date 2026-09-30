#!/usr/bin/env bash
# The own-agent twin's VTA: a dedicated lab agent standing in for a person's new
# agent on the VTA Farm (own_agent_subtask.md §8, "Offline twin").
#
#   ./twin-vta.sh up        provision once, then (re)start; idempotent
#   ./twin-vta.sh status    what is running, its DID, its ACL
#   ./twin-vta.sh stop      stop the VTA by its PID (config, store, tunnel kept)
#   ./twin-vta.sh down      stop, and also close its ngrok tunnel
#
# Defaults: name `carol`, port 8113, data $STACK_DIR/carol/data, config
# $STACK_DIR/carol/config.toml, log $STACK_DIR/logs/carol.log (capped), public
# host keyring-vti-carol.ngrok.app. Override with TWIN_NAME / TWIN_PORT /
# TWIN_HOST. The names alice, bob and community are refused.
#
# How it is built — the lab's own recipe (local-vti-stack/up.sh, setup_vta),
# for one more agent, without touching the running ones:
#
#   - Hostname: a did:webvh is bound to its host, so the twin gets its own
#     reserved ngrok domain. It is ADDED TO THE RUNNING ngrok agent through its
#     local API (POST :4040/api/tunnels), so the six lab tunnels are never
#     restarted. ~/vti-stack/ngrok.yml is not edited: after an ngrok restart,
#     run `up` again to re-add the tunnel (same domain, same DID).
#   - Mediator: the lab's (MEDIATOR_DID in stack.env), `messaging.kind =
#     "existing"`, as bob. Nothing is registered on the mediator by hand; the
#     VTA sets up its own account there when it starts, as bob's did.
#   - TSP advertised with the offline `vta services tsp enable`, as bob's DID
#     document advertises it.
#   - The DID host is NOT registered (that needs the shared dids daemon stopped
#     for an ACL write). The own-agent flow mints no personas; joining a
#     community from the twin is out of scope.
#   - A harness admin: a pnm profile named after the twin, admitted with
#     `vta import-did` before first use, so show-acl.sh / reset.sh read and
#     write the ACL online. Its rows are recorded in acl-baseline.json and
#     are never removed by reset.sh.
#
# Kill by PID only: `stop` kills the PID listening on the twin's port, and only
# after checking its command line names this twin's config.
set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd)/lib.sh"

CMD="${1:-up}"

tunnel_url() {
  curl -s -m 5 "$NGROK_API/tunnels/$TWIN" 2>/dev/null \
    | python3 -c 'import sys,json; print(json.load(sys.stdin).get("public_url",""))' 2>/dev/null || true
}

ensure_tunnel() {
  if ! curl -s -m 5 -o /dev/null "$NGROK_API/tunnels"; then
    echo "the lab's ngrok agent is not answering on $NGROK_API — start the lab first (local-vti-stack/up.sh or restart.sh); this script does not start or restart ngrok" >&2
    exit 1
  fi
  local url
  url=$(tunnel_url)
  if [ "$url" = "https://$TWIN_HOST" ]; then
    echo "  tunnel $TWIN → :$TWIN_PORT already open ($url)"
    return 0
  fi
  if [ -n "$url" ]; then
    echo "an ngrok tunnel named $TWIN exists but serves $url, not https://$TWIN_HOST — refusing to replace it" >&2
    exit 1
  fi
  curl -s -m 20 -X POST -H 'Content-Type: application/json' "$NGROK_API/tunnels" \
    -d "{\"name\":\"$TWIN\",\"proto\":\"http\",\"addr\":\"$TWIN_PORT\",\"domain\":\"$TWIN_HOST\"}" >/dev/null
  url=$(tunnel_url)
  [ "$url" = "https://$TWIN_HOST" ] || { echo "could not open the tunnel to $TWIN_HOST (the ngrok account must allow the domain)" >&2; exit 1; }
  echo "  tunnel $TWIN → :$TWIN_PORT opened ($url)"
}

provision() {
  [ -f "$STACK_DIR/stack.env" ] || { echo "no $STACK_DIR/stack.env — the lab is not set up" >&2; exit 1; }
  local med
  med=$(bash -c ". '$STACK_DIR/stack.env'; printf %s \"\$MEDIATOR_DID\"")
  [ -n "$med" ] || { echo "MEDIATOR_DID missing from stack.env" >&2; exit 1; }
  mkdir -p "$TWIN_DIR"
  cat > "$TWIN_DIR/setup.toml" <<EOF
config_path      = "$TWIN_DIR/config.toml"
data_dir         = "$TWIN_DIR/data"
public_url       = "https://$TWIN_HOST"
vta_name         = "$TWIN"
data_dir_exists  = "delete"
overwrite_config = true

[server]
host = "127.0.0.1"
port = $TWIN_PORT

[secrets]
backend = "plaintext"

# VTA 0.42's setup refuses services.tsp = true on this mediator: the lab
# mediator's did:peer advertises no TSPTransport (from_toml.rs
# mediator_lacks_tsp). bob's #tsp predates that check. So mint without it and
# add it offline below, which leaves the twin's DID document shaped like bob's
# and the Farm runners' (#tsp, #vta-didcomm, #vta-rest).
[services]
tsp = false

[messaging]
kind = "existing"
did  = "$med"

[vta_did]
kind = "create_webvh"
url  = "https://$TWIN_HOST"
EOF
  echo "  vta setup --from $TWIN_DIR/setup.toml"
  local out
  out=$("$VTA_BIN" setup --from "$TWIN_DIR/setup.toml" 2>&1 | strip_ansi) || { echo "$out" >&2; exit 1; }
  local did
  did=$(printf '%s\n' "$out" | grep -o 'did:webvh:[^[:space:]]*' | head -1 || true)
  [ -n "$did" ] || { echo "vta setup printed no VTA DID:" >&2; echo "$out" | head -c 4000 >&2; exit 1; }
  echo "  VTA DID $did"
  # TSP: the lab's phones reach their agent over TSP as well as DIDComm, and a
  # fresh setup advertises DIDComm only (bob's #tsp entry was added this way).
  "$VTA_BIN" --config "$TWIN_DIR/config.toml" services tsp enable --mediator-did "$med" 2>&1 | strip_ansi | grep -iE "tsp|rror" | head -5 || true
  # ...and the runtime switch, as bob's config.toml has it.
  sed -i '' '/^\[services\]/,/^\[/ s/^tsp = false/tsp = true/' "$TWIN_DIR/config.toml"
  printf 'TWIN_SLUG=%s\nTWIN_VTA_DID=%s\nTWIN_VTA_URL=https://%s\nTWIN_PORT=%s\nTWIN_DIR=%s\nMEDIATOR_DID=%s\n' \
    "$TWIN" "$did" "$TWIN_HOST" "$TWIN_PORT" "$TWIN_DIR" "$med" > "$TWIN_ENV"
}

pnm_has_profile() {
  grep -q "^\[vtas\.$TWIN\]" "$HOME/Library/Application Support/pnm/config.toml" 2>/dev/null
}

harness_admin() {
  if pnm_has_profile; then
    echo "  pnm profile $TWIN already set up"
    return 0
  fi
  local cfg="$HOME/Library/Application Support/pnm/config.toml" default_before default_after
  default_before=$(grep '^default_vta' "$cfg" 2>/dev/null || true)
  # Phase 1: mint the harness's admin did:key (pnm keeps it in the login
  # keychain, service pnm-cli, account vta:<slug>). JSON on stdout.
  local minted admin
  minted=$("$PNM_LOCKED" --vta "$TWIN" setup --name "$TWIN" 2>&1 | strip_ansi) || { echo "$minted" >&2; exit 1; }
  admin=$(printf '%s' "$minted" | grep -o 'did:key:z[A-Za-z0-9]*' | head -1 || true)
  [ -n "$admin" ] || { echo "pnm setup minted no did:key:" >&2; echo "$minted" | head -c 2000 >&2; exit 1; }
  echo "  harness admin (pnm setup key) $admin"
  # Admit it the way the Farm admits a pasted Admin DID: offline, VTA stopped.
  twin_stop
  "$VTA_BIN" --config "$TWIN_DIR/config.toml" import-did --did "$admin" --role admin --label twin-harness 2>&1 | strip_ansi | grep -E "imported|Role|Contexts|rror" || true
  twin_start
  sleep 6
  # Phase 2: pnm authenticates and rotates off the setup key onto its own.
  . "$TWIN_ENV"
  "$PNM_LOCKED" --vta "$TWIN" setup continue "$TWIN" --vta-did "$TWIN_VTA_DID" 2>&1 | strip_ansi | tail -5
  default_after=$(grep '^default_vta' "$cfg" 2>/dev/null || true)
  if [ "$default_before" != "$default_after" ]; then
    # pnm's default must stay what the other sessions rely on.
    python3 - "$cfg" "$default_before" <<'PY'
import sys
path, line = sys.argv[1], sys.argv[2]
t = open(path).read().splitlines()
t = [l for l in t if not l.startswith("default_vta")]
if line: t.insert(0, line)
open(path, "w").write("\n".join(t) + "\n")
PY
    echo "  restored pnm's $default_before (setup had changed it)"
  fi
}

baseline() {
  local json
  json=$(twin_acl_json) || { echo "could not read $TWIN's ACL with pnm" >&2; exit 1; }
  printf '%s\n' "$json" > "$TWIN_DIR/acl-baseline.json"
  echo "  ACL baseline: $(python3 -c 'import json,sys; print(len(json.load(open(sys.argv[1]))))' "$TWIN_DIR/acl-baseline.json") entr(y/ies) → $TWIN_DIR/acl-baseline.json"
}

case "$CMD" in
  up)
    echo "==> own-agent twin: $TWIN (:$TWIN_PORT, https://$TWIN_HOST)"
    ensure_tunnel
    if [ ! -f "$TWIN_DIR/config.toml" ] || [ ! -f "$TWIN_ENV" ]; then
      [ -z "$(twin_listener)" ] || { echo "port $TWIN_PORT is in use and $TWIN is not provisioned — refusing" >&2; exit 1; }
      provision
    else
      echo "  already provisioned ($TWIN_DIR)"
    fi
    twin_start
    harness_admin
    # The DID must resolve from outside, through the tunnel, before a phone is
    # given it.
    . "$TWIN_ENV"
    for _ in $(seq 1 20); do
      got=$(curl -s -m 8 "https://$TWIN_HOST/.well-known/did.jsonl" | tail -1 \
        | python3 -c 'import sys,json; d=json.loads(sys.stdin.read()); print((d.get("state") or d).get("id",""))' 2>/dev/null || true)
      [ "$got" = "$TWIN_VTA_DID" ] && break
      sleep 2
    done
    [ "$got" = "$TWIN_VTA_DID" ] || { echo "https://$TWIN_HOST does not serve $TWIN_VTA_DID (got \"$got\")" >&2; exit 1; }
    echo "  resolves: $TWIN_VTA_DID"
    [ -f "$TWIN_DIR/acl-baseline.json" ] || baseline
    echo "==> up. Environment for the runner: $TWIN_ENV"
    cat "$TWIN_ENV"
    ;;
  status)
    pid=$(twin_listener)
    if [ -n "$pid" ]; then state="running, pid $pid"; else state="not running"; fi
    echo "twin $TWIN: $state · port $TWIN_PORT · data $TWIN_DIR/data · log $TWIN_LOG"
    echo "tunnel: $(tunnel_url || true)"
    [ -f "$TWIN_ENV" ] && cat "$TWIN_ENV"
    ;;
  stop)
    twin_stop
    ;;
  down)
    twin_stop
    curl -s -m 10 -X DELETE "$NGROK_API/tunnels/$TWIN" >/dev/null && echo "  closed tunnel $TWIN"
    ;;
  *)
    echo "usage: twin-vta.sh [up|status|stop|down]" >&2
    exit 2 ;;
esac
