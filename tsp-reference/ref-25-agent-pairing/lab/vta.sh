#!/bin/sh
# The rung's lab VTA: one VTA on localhost that serves its own did:webvh.
#
#   lab/vta.sh up <vta binary> <the commit it was built from>
#   lab/vta.sh down
#   lab/vta.sh status
#
# It follows upstream's own local recipe (VTI `local-dev/vta-root-webvh-setup.toml`): a plaintext secret backend,
# no mediator, a did:webvh on http://localhost, and VTA_ALLOW_PRIVATE_ENDPOINTS=1 so a loopback DID resolves.
# Nothing is public: no tunnel, no DID host, no pnm and no keychain. Every `up` makes a new, empty VTA whose one
# administrator is a did:key the rung holds (LAB_DIR/vta/admin-seed.hex, mode 0600, outside the repository).
#
# Build a binary from a checkout of OpenVTC/verifiable-trust-infrastructure at the commit under test:
#   cargo build --locked -p vta-service        # default features; the binary is target/debug/vta
#
# Environment: LAB_DIR (default ~/vti-stack/agent-connect-lab), LAB_VTA_PORT (8161).
set -eu

here=$(cd "$(dirname "$0")" && pwd)
lab=${LAB_DIR:-$HOME/vti-stack/agent-connect-lab}
port=${LAB_VTA_PORT:-8161}
dir=$lab/vta
base=http://127.0.0.1:$port

sha256() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
running() { [ -f "$dir/vta.pid" ] && kill -0 "$(cat "$dir/vta.pid")" 2>/dev/null; }
stop() {
  if running; then
    kill "$(cat "$dir/vta.pid")" 2>/dev/null || true
    i=0; while running && [ $i -lt 50 ]; do sleep 0.1; i=$((i + 1)); done
  fi
  rm -f "$dir/vta.pid"
}

case "${1:-}" in
up)
  bin=${2:-}; commit=${3:-}
  [ -x "$bin" ] && [ -n "$commit" ] || { echo "usage: $0 up <vta binary> <the commit it was built from>" >&2; exit 2; }
  mkdir -p "$dir"; chmod 700 "$lab" "$dir"
  stop
  export VTA_ALLOW_PRIVATE_ENDPOINTS=1 RUST_MIN_STACK=33554432
  admin=$(node "$here/admin-key.mjs" "$dir/admin-seed.hex")
  cat > "$dir/setup.toml" <<RECIPE
config_path      = "$dir/config.toml"
data_dir         = "$dir/data"
public_url       = "http://localhost:$port"
vta_name         = "agent-connect-lab"
data_dir_exists  = "delete"
overwrite_config = true
admin_did        = "$admin"
admin_label      = "keyring-admin"

[server]
host = "127.0.0.1"
port = $port

[log]
level  = "info"
format = "text"

[secrets]
backend = "plaintext"

[messaging]
kind = "skip"

[vta_did]
kind = "create_webvh"
url  = "http://localhost:$port"
RECIPE
  (cd "$dir" && "$bin" setup --from setup.toml > setup.log 2>&1) || { echo "vta setup failed; see $dir/setup.log" >&2; exit 1; }
  chmod 600 "$dir/setup.log" "$dir/setup.toml"
  did=$(sed -n 's/^ *VTA DID: *\(did:[^ ]*\).*/\1/p' "$dir/setup.log" | head -n 1)
  [ -n "$did" ] || { echo "setup printed no VTA DID; see $dir/setup.log" >&2; exit 1; }
  (
    cd "$dir"
    nohup "$bin" --config config.toml > vta.log 2>&1 < /dev/null &
    echo $! > "$dir/vta.pid"
  )
  i=0; until curl -fs -m 2 "$base/.well-known/did.jsonl" >/dev/null 2>&1; do
    i=$((i + 1)); running || { echo "the VTA exited; see $dir/vta.log" >&2; exit 1; }
    [ $i -lt 150 ] || { echo "the VTA did not answer on $base" >&2; exit 1; }; sleep 0.2
  done
  version=$("$bin" --version 2>/dev/null | sed -n 's/^vta \(.*\)$/\1/p' | head -n 1)
  printf '{"running": true, "baseUrl": "%s", "vtaDid": "%s", "adminDid": "%s", "adminSeedFile": "%s", "source": {"repository": "OpenVTC/verifiable-trust-infrastructure", "commit": "%s", "version": "%s", "profile": "debug"}, "binarySha256": "%s"}\n' \
    "$base" "$did" "$admin" "$dir/admin-seed.hex" "$commit" "$version" "$(sha256 "$bin")" > "$dir/status.json"
  cat "$dir/status.json"
  ;;
down)
  stop; rm -f "$dir/status.json"; echo "stopped" ;;
status)
  running && [ -f "$dir/status.json" ] || { echo '{"running": false}'; exit 1; }
  cat "$dir/status.json" ;;
*)
  echo "usage: $0 up <vta binary> <commit> | down | status" >&2; exit 2 ;;
esac
