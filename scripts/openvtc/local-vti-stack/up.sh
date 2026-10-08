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
PNM_BIN="${PNM_BIN:-$HOME/vti-stack/bin/pnm}"   # signed, stable (sign-lab-tool.sh)
MEDIATOR_BIN="$TDK_SRC/target/debug/mediator"
MEDIATOR_SETUP_BIN="$TDK_SRC/target/debug/mediator-setup"
WEBVH_BIN="$WEBVH_SRC/target/debug/did-hosting-daemon"

# vta-service 0.28.0 overflows a worker stack handling vta/contexts/create/1.0
# on a debug build. Measured, reproducible, and this is the workaround.
export RUST_MIN_STACK="${RUST_MIN_STACK:-33554432}"

log() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

stop_stack() {
  log "stopping"
  # SIGTERM then *wait*. A daemon holds an LSM store open for as long as it is
  # alive, and this script's next act is to re-provision — deleting data dirs
  # out from under a process that has not finished shutting down. That race
  # leaves a half-deleted store which recovers as "Recovered less tables than
  # expected" and then refuses to open at all, while the surviving old data
  # serves yesterday's DID against today's config. Measured 2026-09-19.
  for port in 8110 8111 8112 8200 8534 7037; do
    pid=$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | head -1 || true)
    # Kill by PID only — never by name pattern.
    [ -n "$pid" ] || continue
    kill "$pid" && echo "  stopping :$port (pid $pid)"
    for _ in $(seq 1 30); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 1
    done
    if kill -0 "$pid" 2>/dev/null; then
      echo "  :$port (pid $pid) ignored SIGTERM after 30s — SIGKILL"
      kill -9 "$pid" 2>/dev/null || true
      sleep 2
    fi
    # The port outliving the process means something else holds it; provisioning
    # on top of that is how the store gets corrupted, so stop rather than guess.
    if lsof -nP -iTCP:"$port" -sTCP:LISTEN -t >/dev/null 2>&1; then
      echo "  :$port is still held after killing $pid — refusing to re-provision" >&2
      exit 1
    fi
    echo "  stopped :$port"
  done
  for pidfile in "$STACK_DIR"/ngrok.pid "$STACK_DIR"/tunnel-*.pid; do
    [ -f "$pidfile" ] || continue
    # Kill by PID only — never by name pattern. A `pkill -f` here once matched
    # far more than it was aimed at; every tunnel writes a pid file instead.
    kill "$(cat "$pidfile")" 2>/dev/null && echo "  stopped $(basename "$pidfile" .pid)"
    rm -f "$pidfile"
  done
}

if [ "${1:-}" = "--stop" ]; then stop_stack; exit 0; fi

# On Linux sign-lab-tool.sh only makes the stable ~/vti-stack/bin/<tool> link, so
# create a missing pnm link here rather than failing on a forgotten prerequisite.
if [ "$(uname)" = "Linux" ] && [ ! -x "$PNM_BIN" ] && [ "$PNM_BIN" = "$HOME/vti-stack/bin/pnm" ]; then
  echo "creating $PNM_BIN via sign-lab-tool.sh pnm"
  VTI_SRC="$VTI_SRC" "$(dirname "$0")/../sign-lab-tool.sh" pnm || true
fi
for bin in "$VTA_BIN" "$VTC_BIN" "$PNM_BIN" "$MEDIATOR_BIN" "$MEDIATOR_SETUP_BIN" "$WEBVH_BIN"; do
  [ -x "$bin" ] || { echo "missing: $bin — build it first (see README)"; exit 1; }
done
# REDIS_PORT: point the stack at a dedicated instance instead of the default
# 6379 (a shared host's Redis may hold someone else's data in db0). Default unchanged.
REDIS_PORT="${REDIS_PORT:-6379}"
# REDIS_DB: a database index on that instance (0-15), so the mediator's keys stay out of
# db0 when the instance also holds other data. Default unset = db0, the URL unchanged.
REDIS_DB="${REDIS_DB:-}"
case "$REDIS_DB" in ""|[0-9]|1[0-5]) ;; *) echo "REDIS_DB must be 0-15, got: $REDIS_DB"; exit 1;; esac
REDIS_URL="redis://127.0.0.1:$REDIS_PORT/$REDIS_DB"
redis-cli -p "$REDIS_PORT" ping >/dev/null 2>&1 || { echo "redis is not running on port $REDIS_PORT: brew services start redis (macOS), or redis-server --port $REDIS_PORT --save \"\" (Linux)"; exit 1; }

# An ngrok.yml in the stack dir names the hostnames. Validate it now, before the
# stop/re-provision below: a missing tunnel name or a keyring-vti-* domain (the
# live shared stack's, refused unless LAB_ALLOW_LIVE_DOMAINS=1) must fail early.
NGROK_HOSTS=""
if [ -f "$STACK_DIR/ngrok.yml" ]; then
  NGROK_HOSTS=$("$(dirname "$0")/ngrok-lab-config.sh" --hosts "$STACK_DIR/ngrok.yml") || exit 1
  command -v ngrok >/dev/null || { echo "ngrok is not installed or not on PATH"; exit 1; }
fi

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
  echo $! > "$STACK_DIR/tunnel-$name.pid"
  for _ in $(seq 1 30); do
    host=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "logs/tunnel-$name.log" 2>/dev/null | head -1 || true)
    [ -n "$host" ] && { echo "${host#https://}"; return 0; }
    sleep 1
  done
  echo "tunnel for $name never came up" >&2; exit 1
}

# ngrok fails on its own, after this script has moved on: a plan that caps a
# session's endpoints (ERR_NGROK_324 / 18021), a bad token, a domain the account
# does not own. Nothing downstream notices, and the run hangs at "provisioning
# the VTAs" against hostnames that answer ERR_NGROK_3200 (offline) — measured
# 2026-10-01. So watch the process and its log for NGROK_WATCH_SECS, and fail
# fast with the log's tail.
NGROK_WATCH_SECS="${NGROK_WATCH_SECS:-30}"
scrub_log() { # stdin -> stdout, with anything token-shaped masked
  sed -E 's/(authtoken|auth_token|token)([=: "]+)[A-Za-z0-9_-]{16,}/\1\2<scrubbed>/Ig; s/\b[0-9][A-Za-z0-9]{20,}_[A-Za-z0-9]{20,}\b/<scrubbed>/g'
}
ngrok_fail() { # reason
  echo "ngrok failed: $1" >&2
  echo "--- tail of $STACK_DIR/logs/ngrok.log (token-scrubbed) ---" >&2
  tail -n 20 "$STACK_DIR/logs/ngrok.log" 2>/dev/null | scrub_log >&2 || true
  echo "---" >&2
  echo "hint: ERR_NGROK_324 / ERR_NGROK_18021 mean the plan allows fewer than six concurrent endpoints" >&2
  echo "      (the lab needs six); ERR_NGROK_105/107 a bad authtoken in $STACK_DIR/ngrok.yml;" >&2
  echo "      ERR_NGROK_334 / 3200 a domain already online elsewhere or not reserved on this account." >&2
  stop_stack >/dev/null 2>&1 || true
  exit 1
}
watch_ngrok() {
  local pid i
  pid=$(cat "$STACK_DIR/ngrok.pid")
  for i in $(seq 1 "$NGROK_WATCH_SECS"); do
    kill -0 "$pid" 2>/dev/null || ngrok_fail "the ngrok process exited after ${i}s"
    if grep -q 'ERR_NGROK_' "$STACK_DIR/logs/ngrok.log" 2>/dev/null; then
      ngrok_fail "the log reports an ERR_NGROK_* error"
    fi
    sleep 1
  done
}
# Each public hostname has to answer something before anything is provisioned
# behind it. No backend runs yet, so a 502 (ERR_NGROK_8012: tunnel up, nothing
# listening) is the GOOD answer; ERR_NGROK_3200 means the endpoint is offline.
# HTTP/1.1 + bounded retry: ngrok can answer an early HTTP/2 request with 421.
check_public_hosts() { # host...
  local h try hdr code
  for h in "$@"; do
    for try in $(seq 1 10); do
      hdr=$(curl -sS --http1.1 -m 8 -o /dev/null -D - "https://$h/" 2>/dev/null || true)
      code=$(printf '%s' "$hdr" | head -1 | awk '{print $2}')
      if [ -n "$code" ] && [ "$code" != 421 ] && ! printf '%s' "$hdr" | grep -qi '^ngrok-error-code: *3200'; then
        echo "  $h answers (HTTP $code)"; continue 2
      fi
      sleep 3
    done
    ngrok_fail "https://$h/ never answered (offline, ERR_NGROK_3200, or HTTP 421 for 30s)"
  done
}

log "opening tunnels"
# Reserved ngrok domains if there is a config for them, quick tunnels otherwise.
# The difference is not convenience: a did:webvh is bound to the host it was
# minted behind, so a per-run hostname re-mints every DID in the stack and
# forces `app/.env` re-baked and both apps rebuilt. Reserved domains survive a
# restart, which is what makes this a fixture you can come back to.
if [ -f "$STACK_DIR/ngrok.yml" ]; then
  # Hostnames come from the lab's own config (validated above, before the stack
  # was stopped). ONLY the six named tunnels start, and ONLY from this config:
  # never --all, and never the user's ~/.config/ngrok/ngrok.yml, which on a
  # shared host holds someone else's tunnels. The config carries its own
  # authtoken (ngrok config add-authtoken <token> --config "$STACK_DIR/ngrok.yml").
  # LAB_ALLOW_LIVE_DOMAINS=1 is the Mac stack owner's path: it keeps that
  # stack's original behaviour of layering the default config underneath.
  NGROK_CONFIGS=(--config "$STACK_DIR/ngrok.yml")
  if [ "${LAB_ALLOW_LIVE_DOMAINS:-}" = "1" ] && [ -f "$HOME/.config/ngrok/ngrok.yml" ]; then
    NGROK_CONFIGS=(--config "$HOME/.config/ngrok/ngrok.yml" "${NGROK_CONFIGS[@]}")
  fi
  nohup ngrok start alice community bob vtc dids mediator "${NGROK_CONFIGS[@]}" \
    > "$STACK_DIR/logs/ngrok.log" 2>&1 &
  echo $! > "$STACK_DIR/ngrok.pid"
  eval "$NGROK_HOSTS"
  watch_ngrok
  check_public_hosts "$ALICE_HOST" "$COMMUNITY_HOST" "$BOB_HOST" "$VTC_HOST" "$DIDS_HOST" "$MED_HOST"
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
"$MEDIATOR_SETUP_BIN" $FORCE_MEDIATOR --non-interactive --deployment local --protocol tsp \
  --did-method peer --public-url "https://$MED_HOST" --mediator-url "https://$MED_HOST" \
  --secret-storage file --ssl none --database-url "$REDIS_URL" \
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
# Take THIS build's stored-function library, every time.
#
# `mediator-setup` writes an `atm-functions.lua` at the version that generated
# it, and nothing refreshes it when the binary moves. The mediator detects the
# mismatch and warns, but the warning is easy to miss and the failure it
# describes is silent: a library predating the per-relationship queue
# accounting never writes PEER_Q, so `peer_queue_count` reads 0 and
# `limits.queue.peer` NEVER FIRES. The gate is configured, reported as present,
# and inert. Measured 2026-09-20 — the lab had been running `degraded` on a
# 0.26-era library under a 0.28.9 binary, so every per-peer queue observation
# made here before that date was taken with the gate switched off.
cp "$TDK_SRC/crates/messaging/affinidi-messaging-mediator/conf/atm-functions.lua" \
  "$STACK_DIR/mediator/conf/atm-functions.lua" 2>/dev/null \
  && echo "  stored-function library refreshed from this build"
# Since tdk-rs #843 (our VTI-07) the mediator resolves `functions_file` against
# the config file's own directory, and the working-directory form is a
# deprecated fallback it warns about. The library sits beside mediator.toml.
# `-i.bak` + rm: the one in-place form both BSD (macOS) and GNU sed accept.
sed -i.bak 's|^functions_file = "./conf/atm-functions.lua"|functions_file = "atm-functions.lua"|' \
  "$STACK_DIR/mediator/conf/mediator.toml" 2>/dev/null || true
rm -f "$STACK_DIR/mediator/conf/mediator.toml.bak"

# Keep the queue limits at UPSTREAM DEFAULTS rather than whatever the
# generating version happened to ship. `queued_send_messages_per_peer` did not
# exist before #828 (0.27.0), so a config generated earlier omits it entirely;
# the soft/hard pair was 200/1000 where upstream now ships 2000/10000. A lab
# that quietly runs tighter limits than a real deployment produces findings
# that do not transfer — and the VTA Farm runs stock.
python3 - "$STACK_DIR/mediator/conf/mediator.toml" <<'PYEOF'
import re, sys
path = sys.argv[1]
t = open(path).read()
for key, val in (("queued_send_messages_soft", "2000"),
                 ("queued_send_messages_hard", "10000")):
    t = re.sub(rf'^{key} = "\d+"$', f'{key} = "{val}"', t, count=1, flags=re.M)
if "queued_send_messages_per_peer" not in t:
    t = t.replace('queued_send_messages_soft = "2000"',
                  'queued_send_messages_per_peer = "50"\n\nqueued_send_messages_soft = "2000"', 1)
open(path, "w").write(t)
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
# The setup prints a generated admin did:key AND its private key, shown once.
# Never let that reach this script's output or logs: capture it, keep only those
# two lines in a 0600 file, and print a pointer.
DIDS_ADMIN_FILE="$STACK_DIR/dids/admin-credentials.txt"
DIDS_SETUP_OUT=$("$WEBVH_BIN" setup --from dids/recipe.toml --non-interactive $FORCE_DIDS 2>&1) || true
( umask 077; printf '%s\n' "$DIDS_SETUP_OUT" | grep -E "admin did|Private key" > "$DIDS_ADMIN_FILE" || true )
chmod 600 "$DIDS_ADMIN_FILE" 2>/dev/null || true
unset DIDS_SETUP_OUT
echo "  dids daemon admin credentials written to $DIDS_ADMIN_FILE, mode 0600"
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

# TSP is a CARGO FEATURE on vta-service, not merely a config flag, and it is OFF
# by default (`default = ["setup","keyring","rest","didcomm","cli-synthesis"]`).
# A default build has no TSP dispatcher at all, so setting `tsp = true` in
# config.toml is inert — which is exactly how an evening was spent on
# 2026-09-20 wondering why flipping it changed nothing. Build the agents with:
#
#   cargo build --bin vta --features tsp
#
# The MEDIATOR has the same trap, and it cost the most: its default features
# carry no `tsp`, so it cannot classify a TSP frame at all. The phone then sends
# a correct invite and a correct task, the VTC logs nothing, and nothing
# anywhere says why — the frames vanish between the two. Build it with:
#
#   cargo build --bin mediator --features tsp
#
# vtc-service is the opposite: `tsp` is ON by default, receive-side, because a
# DID document is a contract and a binary that cannot serve what its document
# advertises drops every conforming client's messages.
if ! "$VTA_BIN" services --help >/dev/null 2>&1; then
  echo "  note: this vta binary has no 'services' surface — TSP advertisement will be skipped" >&2
fi

log "provisioning the VTAs"
ALICE_DID=$(setup_vta alice 8110 "$ALICE_HOST")
COMMUNITY_DID=$(setup_vta community 8111 "$COMMUNITY_HOST")
BOB_DID=$(setup_vta bob 8112 "$BOB_HOST")
# The approver rung (run-vti-approve.js) needs alice to ENFORCE its policies.
# `setup` writes `[policy] enforcement = false`, and with it off the VTA stores
# the consent rule `approver-setup.sh` writes — `pnm approvals list` shows it —
# and never evaluates it: the key borrow runs unheld and nothing says why
# (2026-09-21). Enforcement is config-only; no pnm command sets it.
sed -i.bak '/^\[policy\]/,/^\[/ s/^enforcement = false/enforcement = true/' alice/config.toml
rm -f alice/config.toml.bak
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
# pnm also keeps a profile list outside PNM_HOME (macOS: ~/Library/Application
# Support/pnm/config.toml), and refuses `setup` while one exists for this name.
# That file also holds `default_vta`, which is the part that bites: a leftover
# profile for a VTA this script re-mints every run leaves the default pointing
# at a DID that no longer resolves, and every pnm command then fails with
# "does not match the top-level 'id' in any DIDDoc version" — naming a DID that
# appears nowhere in this run's output, which is what makes it hard to place.
# So drop every profile for a name this stack owns, and pin the slug explicitly
# rather than trusting whatever the default happens to be.
for n in alice bob community; do
  "$PNM_BIN" vta remove "$n" --yes >/dev/null 2>&1 || true
done
export PNM_VTA=community
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
# A current vtc refuses a setup DID whose ACL entry carries no one-time hand-off
# (VTI-ACL-053); a pnm from before that (e.g. VTI a96fe02f) has no such flag and
# its vtc does not ask for one, so pass it only where pnm knows it.
ADMIN_HANDOFF=""
"$PNM_BIN" contexts create --help 2>&1 | grep -q -- '--admin-handoff' && ADMIN_HANDOFF="--admin-handoff"
# shellcheck disable=SC2086
"$PNM_BIN" contexts create --id vtc --name "VTC" --admin-did "$SETUP_DID" --admin-expires 4h $ADMIN_HANDOFF >/dev/null
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
# The VTC has no `overwrite_config` of its own: `setup --from` refuses outright
# while a config exists ("VTC already configured at …"), so a second run of this
# script never reached this far. The VTAs already re-provision from scratch each
# run, so the community's identity is re-minted anyway — carrying the old VTC
# config forward would only pair a new VTA with a stale community.
rm -rf "$STACK_DIR/vtc/config.toml" "$STACK_DIR/vtc/data"
# Captured rather than piped: with `pipefail`, a `grep` that matches nothing
# aborts the script, and since the command's own output is what was being
# grepped, the reason went to the same pipe and was never seen. A silent exit 1
# in the middle of a bring-up is expensive to place; print what it said.
VTC_SETUP_OUT=$(cd vtc && "$VTC_BIN" setup --from setup.toml 2>&1) || {
  echo "vtc setup --from failed:" >&2
  echo "$VTC_SETUP_OUT" >&2
  exit 1
}
VTC_DID=$(printf '%s\n' "$VTC_SETUP_OUT" | grep '^vtc_did=' | cut -d= -f2 || true)
if [ -z "$VTC_DID" ]; then
  echo "vtc setup --from printed no vtc_did= line; its output was:" >&2
  echo "$VTC_SETUP_OUT" >&2
  exit 1
fi

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

# An ACL entry on the daemon is only half of it: each VTA also has to have the
# daemon REGISTERED as a hosting server, or its persona mints fall back to
# "serverless" — created, keys held, and served by nobody. The DID then 404s
# and the phone fails at "community session as persona" with a resolution
# error naming the persona rather than the missing registration. That is
# VTI-20, and it cost an evening; `[VTA-PROBE] servers 0` is the tell.
# Offline, so each VTA is stopped, registered, and started again.
log "registering the DID host with each VTA (else persona mints are serverless)"
for n in alice community bob; do
  case "$n" in alice) port=8110;; community) port=8111;; bob) port=8112;; esac
  pid=$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | head -1 || true)
  if [ -n "$pid" ]; then
    kill "$pid"
    for _ in $(seq 1 30); do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
  fi
  if "$VTA_BIN" --config "$n/config.toml" did-mgmt servers add \
       --id dids --did "$DIDS_DID" --label "local dids daemon" >/dev/null 2>&1; then
    echo "  $n -> dids"
  else
    echo "  $n -> already registered"
  fi
  nohup "$VTA_BIN" --config "$n/config.toml" > "logs/$n.log" 2>&1 &
done
sleep 12

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
