#!/usr/bin/env bash
# Bring up a local VTI stack: three VTAs (applicant, community host, vetter),
# a VTC, an Affinidi-style mediator and a DID-hosting daemon, each behind its
# own public HTTPS hostname.
#
# Every step here was run by hand on 2026-09-15 (see
# docs/plans/keyring-on-the-vta-farm/community_vetting_subtask.md and
# tsp-reference/ref-20-local-vetting/README.md); this script is that sequence,
# with the parts that bit recorded as code rather than as prose.
#
#   ./up.sh            bring everything up, print stack.env
#   ./up.sh --stop     stop what this script started
#
# Requires: cargo, cloudflared, redis, and the three upstream checkouts below.
set -euo pipefail

STACK_DIR="${STACK_DIR:-$HOME/vti-stack}"
VTI_SRC="${VTI_SRC:-$HOME/Documents/vti-main}"                      # VTI at origin/main
WEBVH_SRC="${WEBVH_SRC:-$HOME/Documents/affinidi-webvh-service}"    # DID hosting
TDK_SRC="${TDK_SRC:-$HOME/Documents/affinidi-tdk-rs}"               # mediator

VTA_BIN="$VTI_SRC/target/debug/vta"
VTC_BIN="$VTI_SRC/target/debug/vtc"
PNM_BIN="$VTI_SRC/target/debug/pnm"
MEDIATOR_BIN="$TDK_SRC/target/debug/mediator"
MEDIATOR_SETUP_BIN="$TDK_SRC/target/debug/mediator-setup"
WEBVH_BIN="$WEBVH_SRC/target/debug/did-hosting-daemon"

# vta-service 0.28.0 overflows a worker stack handling vta/contexts/create/1.0
# on a debug build. Measured, reproducible, and this is the workaround.
export RUST_MIN_STACK="${RUST_MIN_STACK:-33554432}"

log() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

stop_stack() {
  log "stopping"
  for port in 8110 8111 8112 8200 8534 7037; do
    pid=$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | head -1 || true)
    # Kill by PID only — never by name pattern.
    [ -n "$pid" ] && kill "$pid" && echo "  stopped :$port (pid $pid)"
  done
  if [ -f "$STACK_DIR/ngrok.pid" ]; then
    # Kill by PID only — never by name pattern.
    kill "$(cat "$STACK_DIR/ngrok.pid")" 2>/dev/null && echo "  stopped ngrok"
    rm -f "$STACK_DIR/ngrok.pid"
  fi
  pkill -f "cloudflared tunnel --url http://localhost:81" 2>/dev/null || true
  pkill -f "cloudflared tunnel --url http://localhost:8200" 2>/dev/null || true
  pkill -f "cloudflared tunnel --url http://localhost:8534" 2>/dev/null || true
  pkill -f "cloudflared tunnel --url http://localhost:7037" 2>/dev/null || true
}

if [ "${1:-}" = "--stop" ]; then stop_stack; exit 0; fi

for bin in "$VTA_BIN" "$VTC_BIN" "$PNM_BIN" "$MEDIATOR_BIN" "$MEDIATOR_SETUP_BIN" "$WEBVH_BIN"; do
  [ -x "$bin" ] || { echo "missing: $bin — build it first (see README)"; exit 1; }
done
redis-cli ping >/dev/null 2>&1 || { echo "redis is not running: brew services start redis"; exit 1; }

# Re-running this script re-provisions, and a running daemon holds a lock on the
# store being rewritten ("FjallError: Locked"). So stop first, always.
stop_stack
sleep 3

mkdir -p "$STACK_DIR"/{alice,community,bob,vtc,dids,mediator/conf,logs}
cd "$STACK_DIR"

# ---------------------------------------------------------------- tunnels ---
# Quick tunnels mint a new hostname per run, and a did:webvh is bound to its
# hostname — so a new tunnel means new DIDs and a rebuilt app/.env. Reserved
# domains are what makes a stack survive a restart; see the README.
open_tunnel() { # name port -> echoes hostname
  local name=$1 port=$2
  nohup cloudflared tunnel --url "http://localhost:$port" > "logs/tunnel-$name.log" 2>&1 &
  for _ in $(seq 1 30); do
    host=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "logs/tunnel-$name.log" 2>/dev/null | head -1 || true)
    [ -n "$host" ] && { echo "${host#https://}"; return 0; }
    sleep 1
  done
  echo "tunnel for $name never came up" >&2; exit 1
}

log "opening tunnels"
# Reserved ngrok domains if there is a config for them, quick tunnels otherwise.
# The difference is not convenience: a did:webvh is bound to the host it was
# minted behind, so a per-run hostname re-mints every DID in the stack and
# forces `app/.env` re-baked and both apps rebuilt. Reserved domains survive a
# restart, which is what makes this a fixture you can come back to.
if [ -f "$STACK_DIR/ngrok.yml" ]; then
  nohup ngrok start --all --config "$HOME/.config/ngrok/ngrok.yml" --config "$STACK_DIR/ngrok.yml" \
    > "$STACK_DIR/logs/ngrok.log" 2>&1 &
  echo $! > "$STACK_DIR/ngrok.pid"
  sleep 8
  ALICE_HOST=keyring-vti-alice.ngrok.app
  COMMUNITY_HOST=keyring-vti-community.ngrok.app
  BOB_HOST=keyring-vti-bob.ngrok.app
  VTC_HOST=keyring-vti-vtc.ngrok.app
  DIDS_HOST=keyring-vti-dids.ngrok.app
  MED_HOST=keyring-vti-mediator.ngrok.app
else
  ALICE_HOST=$(open_tunnel alice 8110)
  COMMUNITY_HOST=$(open_tunnel community 8111)
  BOB_HOST=$(open_tunnel bob 8112)
  VTC_HOST=$(open_tunnel vtc 8200)
  DIDS_HOST=$(open_tunnel dids 8534)
  MED_HOST=$(open_tunnel mediator 7037)
fi
echo "  alice=$ALICE_HOST community=$COMMUNITY_HOST bob=$BOB_HOST"
echo "  vtc=$VTC_HOST dids=$DIDS_HOST mediator=$MED_HOST"

# --------------------------------------------------------------- mediator ---
log "provisioning the mediator"
# A second run refuses to overwrite an existing setup, since re-running the
# wizard rotates every key it holds. On this stack that is exactly what is
# wanted: the mediator's DID encodes its endpoints, so a moved host is a new
# mediator either way.
FORCE_MEDIATOR=""
[ -f "$STACK_DIR/mediator/conf/mediator.toml" ] && FORCE_MEDIATOR="--force-reprovision"
# shellcheck disable=SC2086
"$MEDIATOR_SETUP_BIN" $FORCE_MEDIATOR --non-interactive --deployment local --protocol didcomm \
  --did-method peer --public-url "https://$MED_HOST" --mediator-url "https://$MED_HOST" \
  --secret-storage file --ssl none --database-url redis://127.0.0.1/ \
  --admin generate --listen-address 127.0.0.1:7037 \
  --config "$STACK_DIR/mediator/conf/mediator.toml" >/dev/null
MED_DID=$(grep '^mediator_did' mediator/conf/mediator.toml | sed 's/.*did:\/\///; s/"$//')
echo "$MED_DID" > mediator/did.txt
# A phone's WebSocket upgrade carries an Origin header (React Native sends one;
# Node's `ws` does not), and with `cors_allow_origin` unset the mediator answers
# /ws with 403 "Origin not permitted by CORS policy". Auth here is a bearer
# subprotocol rather than an ambient cookie, so a wildcard is safe for a local
# stack — a real deployment names the origins it serves instead.
# The key belongs to the config's [security] table — the generated file
# documents it there, commented out. Put anywhere else (appended at the end,
# or at the top level) TOML scopes it to a different table, the mediator
# never sees it, and /ws goes on answering 403 with the setting apparently
# in the file.
python3 - "$STACK_DIR/mediator/conf/mediator.toml" <<'PYEOF'
import sys
path = sys.argv[1]
lines = [l for l in open(path).read().splitlines() if not l.startswith("cors_allow_origin")]
marker = next((i for i, l in enumerate(lines) if l.startswith("# cors_allow_origin")), None)
if marker is None:
    security = lines.index("[security]")
    marker = security
lines.insert(marker + 1, 'cors_allow_origin = "*"')
open(path, "w").write("\n".join(lines) + "\n")
PYEOF
# `functions_file` in that config is relative, so the mediator only finds
# ./conf/atm-functions.lua when it runs from its own directory.
(cd "$STACK_DIR/mediator" && nohup "$MEDIATOR_BIN" -c "$STACK_DIR/mediator/conf/mediator.toml" > "$STACK_DIR/logs/mediator.log" 2>&1 &)
sleep 8

# ------------------------------------------------------------ DID hosting ---
log "provisioning DID hosting (self-managed: no VTA of its own)"
cat > dids/recipe.toml <<EOF
[deployment]
service = "daemon"
vta_mode = "self-managed"

[output]
config_path = "$STACK_DIR/dids/config.toml"

[server]
host = "127.0.0.1"
port = 8534
log_level = "info"
log_format = "text"
data_dir = "$STACK_DIR/dids/data"

[identity]
public_url = "https://$DIDS_HOST"
# Without a mediator the daemon's own DID carries NO service entry, and a VTA
# refuses to register it ("has no supported webvh endpoint") — so no persona
# can be minted on it. With one, the DID advertises DIDCommMessaging.
mediator_did = "$MED_DID"
transport = "didcomm"

[daemon]
enable_control = true
enable_server  = true
enable_witness = true
enable_watcher = false

[secrets]
backend = "plaintext"
confirm_plaintext = true

[admin]
mode = "generate"
EOF
# Same story as the mediator: a provisioned install refuses to be overwritten,
# and a moved host means new DIDs regardless. The store has to go too: a force
# re-provision keeps the daemon's old DID, bound to the old hostname, and the
# new host then 404s on its own identity.
FORCE_DIDS=""
[ -f "$STACK_DIR/dids/config.toml" ] && { FORCE_DIDS="--force-reprovision"; rm -rf "$STACK_DIR/dids/data"; }
# shellcheck disable=SC2086
"$WEBVH_BIN" setup --from dids/recipe.toml --non-interactive $FORCE_DIDS 2>&1 | grep -E "admin did|Private key" | sed 's/^/  dids daemon /' || true
nohup "$WEBVH_BIN" --config dids/config.toml > logs/dids.log 2>&1 &
sleep 6
DIDS_DID=$(curl -s "https://$DIDS_HOST/.well-known/did.jsonl" | tail -1 | python3 -c 'import sys,json; d=json.loads(sys.stdin.read()); print((d.get("state") or d).get("id",""))' 2>/dev/null || true)
echo "  dids daemon DID: $DIDS_DID"

# ------------------------------------------------------------------- VTAs ---
# `messaging.kind = "existing"` at setup time, never `skip` + `services didcomm
# enable` afterwards: that leaves the DID document without a #vta-didcomm entry
# and every later command refuses with "on-disk state is inconsistent".
setup_vta() {
  local name=$1 port=$2 host=$3
  cat > "$name/setup.toml" <<EOF
config_path      = "$STACK_DIR/$name/config.toml"
data_dir         = "$STACK_DIR/$name/data"
public_url       = "https://$host"
vta_name         = "$name"
data_dir_exists  = "delete"
overwrite_config = true

[server]
host = "127.0.0.1"
port = $port

[secrets]
backend = "plaintext"

[messaging]
kind = "existing"
did  = "$MED_DID"

[vta_did]
kind = "create_webvh"
url  = "https://$host"
EOF
  "$VTA_BIN" setup --from "$name/setup.toml" 2>&1 | grep -E "VTA DID" | awk '{print $3}'
}

log "provisioning the VTAs"
ALICE_DID=$(setup_vta alice 8110 "$ALICE_HOST")
COMMUNITY_DID=$(setup_vta community 8111 "$COMMUNITY_HOST")
BOB_DID=$(setup_vta bob 8112 "$BOB_HOST")
for n in alice community bob; do
  nohup "$VTA_BIN" --config "$n/config.toml" > "logs/$n.log" 2>&1 &
done
sleep 14

# ------------------------------------------------------------------- PNM ----
log "enrolling the community admin (the paste a QR would replace)"
export PNM_HOME="$STACK_DIR/pnm-community"
# A pnm profile remembers the mediator DID it enrolled against. Re-provisioning
# the mediator mints a new one, and a stale profile then packs to keys the
# mediator no longer holds — which surfaces as a bare 403 on /authenticate
# ("No local secret matches any JWE recipient" in the mediator's own log).
[ -n "$PNM_HOME" ] && rm -rf "${PNM_HOME:?}"
mkdir -p "$PNM_HOME"
# pnm also keeps a profile outside PNM_HOME (macOS: ~/Library/Application
# Support/pnm), and refuses `setup` while one exists for this name.
yes | "$PNM_BIN" vta remove community >/dev/null 2>&1 || true
PNM_DID=$("$PNM_BIN" setup --name community 2>&1 | grep -o 'did:key:z[A-Za-z0-9]*' | head -1)
pid=$(lsof -nP -iTCP:8111 -sTCP:LISTEN -t | head -1); kill "$pid"; sleep 3
"$VTA_BIN" --config community/config.toml import-did --did "$PNM_DID" --role admin --label pnm-community >/dev/null
nohup "$VTA_BIN" --config community/config.toml > logs/community.log 2>&1 &
sleep 10
"$PNM_BIN" setup continue community --vta-did "$COMMUNITY_DID" >/dev/null

# ------------------------------------------------------------------- VTC ----
# Two phases, and `transports` is fixed at mint: a VTC that should be reachable
# over DIDComm has to say so here, or it needs re-provisioning to add it.
log "provisioning the VTC"
"$VTC_BIN" setup --setup-key-out "$STACK_DIR/vtc/setup-key.json" --context vtc >/dev/null
SETUP_DID=$(grep -o 'did:key:z[A-Za-z0-9]*' vtc/setup-key.json | head -1 || true)
[ -n "$SETUP_DID" ] || SETUP_DID=$("$VTC_BIN" setup --setup-key-out "$STACK_DIR/vtc/setup-key.json" --context vtc 2>&1 | grep -o 'did:key:z[A-Za-z0-9]*' | head -1)
"$PNM_BIN" contexts create --id vtc --name "VTC" --admin-did "$SETUP_DID" --admin-expires 4h >/dev/null
cat > vtc/setup.toml <<EOF
config_path    = "$STACK_DIR/vtc/config.toml"
base_url       = "https://$VTC_HOST"
vta_did        = "$COMMUNITY_DID"
setup_key_file = "$STACK_DIR/vtc/setup-key.json"
context        = "vtc"

[messaging]
mediator_did = "$MED_DID"
transports   = ["didcomm"]
mediator_url = "https://$MED_HOST"

[secrets]
backend = "plaintext"
EOF
VTC_DID=$(cd vtc && "$VTC_BIN" setup --from setup.toml 2>&1 | grep '^vtc_did=' | cut -d= -f2)

# A freshly provisioned VTC has an EMPTY ACL — its own admin_did cannot
# authenticate until it is added offline, on a stopped daemon.
VTC_ADMIN=$(cd "$STACK_DIR" && "$VTA_BIN" --config community/config.toml export-admin 2>/dev/null | grep -A1 "vtc-host" | grep -o 'did:key:z[A-Za-z0-9]*' | head -1 || true)
nohup "$VTC_BIN" --config vtc/config.toml > logs/vtc.log 2>&1 &
sleep 12

# Each VTA that will mint personas on the daemon needs an ACL entry there —
# written offline, so the daemon is bounced once for all three.
pid=$(lsof -nP -iTCP:8534 -sTCP:LISTEN -t | head -1); kill "$pid"; sleep 3
for d in "$ALICE_DID" "$COMMUNITY_DID" "$BOB_DID"; do
  "$WEBVH_BIN" add-acl --config dids/config.toml --did "$d" --role owner --label vta >/dev/null 2>&1 || true
done
nohup "$WEBVH_BIN" --config dids/config.toml > logs/dids.log 2>&1 &
sleep 6

cat > stack.env <<EOF
DIDS_DID=$DIDS_DID
ALICE_VTA_DID=$ALICE_DID
ALICE_URL=https://$ALICE_HOST
COMMUNITY_VTA_DID=$COMMUNITY_DID
COMMUNITY_URL=https://$COMMUNITY_HOST
BOB_VTA_DID=$BOB_DID
BOB_URL=https://$BOB_HOST
VTC_DID=$VTC_DID
VTC_URL=https://$VTC_HOST
MEDIATOR_DID=$MED_DID
MEDIATOR_URL=https://$MED_HOST
DIDS_URL=https://$DIDS_HOST
EOF

log "up"
cat stack.env
cat <<EOF

Next:
  1. grant the VTC admin in its ACL (stopped daemon):
       $VTC_BIN --config $STACK_DIR/vtc/config.toml acl add --did <admin did:key> --role admin
  2. bake the app's .env and rebuild:
       VTI_MEDIATOR_DID=$MED_DID
       VTI_COMMUNITY_DID=$VTC_DID
  3. community setup (statement type, criterion) via
     tsp-reference/ref-20-local-vetting/vtc-admin.mjs
EOF
