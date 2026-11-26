#!/bin/sh
# The rung's lab mediator: the wallet mailbox's pinned mediator, on loopback.
#
#   lab/mediator.sh up <open|mailbox|deny>   start it in one configuration (see mediator_config.py)
#   lab/mediator.sh down                     stop it and its Redis
#   lab/mediator.sh status                   what is running, as JSON
#
# Nothing here is public: the mediator listens on 127.0.0.1, its identity is a did:peer, and its Redis is a
# separate instance on its own port with nothing saved to disk. No tunnel, no VTA, no shared host.
#
# Build the two binaries once, from the pinned clone (scripts/openvtc/setup-external.mjs puts it there):
#   cd external/affinidi-messaging-mediator
#   cargo build --locked -p affinidi-messaging-mediator
#   cargo build --locked -p affinidi-messaging-mediator-setup --no-default-features
#
# Environment: MEDIATOR_SRC (the clone), LAB_DIR (state and keys, default ~/vti-stack/agent-connect-lab),
# LAB_MEDIATOR_PORT (7061), LAB_REDIS_PORT (6391).
set -eu

here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../../.." && pwd)
src=${MEDIATOR_SRC:-$repo/external/affinidi-messaging-mediator}
lab=${LAB_DIR:-$HOME/vti-stack/agent-connect-lab}
port=${LAB_MEDIATOR_PORT:-7061}
redis_port=${LAB_REDIS_PORT:-6391}
mailbox=$repo/deploy/keyring-messaging/mailbox/mailbox.toml
bin=$src/target/debug/mediator
setup=$src/target/debug/mediator-setup
dir=$lab/mediator
base=http://127.0.0.1:$port/mediator/v1

sha256() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
running() { [ -f "$dir/mediator.pid" ] && kill -0 "$(cat "$dir/mediator.pid")" 2>/dev/null; }

stop_mediator() {
  if running; then
    kill "$(cat "$dir/mediator.pid")" 2>/dev/null || true
    i=0; while running && [ $i -lt 50 ]; do sleep 0.1; i=$((i + 1)); done
  fi
  rm -f "$dir/mediator.pid"
}

case "${1:-}" in
up)
  mode=${2:-}
  case "$mode" in open|mailbox|deny) ;; *) echo "usage: $0 up <open|mailbox|deny>" >&2; exit 2 ;; esac
  [ -x "$bin" ] && [ -x "$setup" ] || { echo "build the mediator first (see the top of this file): $bin" >&2; exit 1; }
  command -v redis-server >/dev/null 2>&1 || { echo "redis-server is required (7.1 or later, below 9.0)" >&2; exit 1; }
  mkdir -p "$dir" "$lab/redis"; chmod 700 "$lab" "$dir"

  if ! redis-cli -p "$redis_port" ping >/dev/null 2>&1; then
    redis-server --port "$redis_port" --bind 127.0.0.1 --save "" --appendonly no --dir "$lab/redis" \
      --daemonize yes --pidfile "$lab/redis/redis.pid" --logfile "$lab/redis/redis.log" >/dev/null
    i=0; until redis-cli -p "$redis_port" ping >/dev/null 2>&1; do i=$((i + 1)); [ $i -lt 50 ] || { echo "redis did not start" >&2; exit 1; }; sleep 0.1; done
  fi

  if [ ! -f "$dir/conf/mediator.toml" ]; then
    cat > "$dir/recipe.toml" <<RECIPE
[deployment]
type = "local"
protocols = ["didcomm", "tsp"]
use_vta = false
[identity]
did_method = "did:peer"
public_url = "http://127.0.0.1:$port"
[secrets]
storage = "file://$dir/conf/secrets.json"
allow_plaintext_file = true
[security]
ssl = "none"
admin = "generate"
jwt_mode = "generate"
network_mode = "open"
cors = "none"
[database]
url = "redis://127.0.0.1:$redis_port/"
[storage]
backend = "redis"
[output]
config_path = "$dir/conf/mediator.toml"
listen_address = "127.0.0.1:$port"
api_prefix = "/mediator/v1/"
[install]
enabled = false
RECIPE
    # The setup tool prints key material "for bookkeeping"; its output is kept in a private file, not shown.
    (cd "$dir" && "$setup" --from recipe.toml > setup.log 2>&1) || { echo "mediator-setup failed; see $dir/setup.log" >&2; exit 1; }
    chmod 600 "$dir/setup.log"
  fi

  stop_mediator
  # Every run starts from an empty store: accounts take the default ACL when they are made, so a store left
  # from another mode would carry that mode's accounts. The instance is this lab's alone.
  redis-cli -p "$redis_port" flushall >/dev/null
  python3 "$here/mediator_config.py" "$mode" "$dir/conf/mediator.toml" "$mailbox" "$dir/conf/mediator-$mode.toml" > "$dir/config-$mode.json"
  chmod 600 "$dir/conf/mediator-$mode.toml"
  # Every descriptor is redirected, so the mediator never holds the caller's terminal or pipe open.
  (
    cd "$dir"
    RUST_LOG=${RUST_LOG:-info} nohup "$bin" -c "conf/mediator-$mode.toml" > mediator.log 2>&1 < /dev/null &
    echo $! > "$dir/mediator.pid"
  )
  i=0; until curl -fs -m 2 "$base/healthchecker" >/dev/null 2>&1; do
    i=$((i + 1)); running || { echo "the mediator exited; see $dir/mediator.log" >&2; exit 1; }
    [ $i -lt 100 ] || { echo "the mediator did not answer on $base" >&2; exit 1; }; sleep 0.2
  done
  printf '%s' "$mode" > "$dir/mode"
  exec "$0" status
  ;;
down)
  stop_mediator
  if [ -f "$lab/redis/redis.pid" ]; then redis-cli -p "$redis_port" shutdown nosave >/dev/null 2>&1 || true; fi
  echo "stopped"
  ;;
status)
  running || { echo '{"running": false}'; exit 1; }
  mode=$(cat "$dir/mode")
  did=$(curl -fs -m 3 "$base/.well-known/did" | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"])')
  python3 - "$mode" "$did" "$base" "$(git -C "$src" rev-parse HEAD)" "$(sed -n 's/^version = "\(.*\)"/\1/p' "$src/Cargo.toml" | head -n 1)" "$(sha256 "$bin")" "$dir/config-$mode.json" "$dir/mediator.log" <<'PY'
import json, sys
mode, did, base, commit, version, digest, config, log = sys.argv[1:]
print(json.dumps({
    "running": True,
    "mode": mode,
    "mediatorDid": did,
    "restEndpoint": base,
    "source": {"repository": "affinidi/affinidi-messaging-mediator", "commit": commit, "version": version, "profile": "debug"},
    "binarySha256": digest,
    "config": json.load(open(config)),
    "log": log,
}, indent=2))
PY
  ;;
*)
  echo "usage: $0 up <open|mailbox|deny> | down | status" >&2; exit 2 ;;
esac
