#!/bin/sh
# Idempotent VTA boot: provision on first start, then run.
#
# The two settings that make this work in a container (and that the upstream
# docs call out for exactly this case):
#   • data_dir_exists = "reuse" — a mounted volume is not treated as a
#     conflict, so restarts don't wipe or refuse.
#   • a non-keyring secrets backend — containers have no OS keyring. This
#     dev image uses "plaintext"; sealed/CI images should use "config_seed".
set -eu

CONFIG=/data/config.toml
SETUP=/data/setup.toml

if [ ! -f "$CONFIG" ]; then
  echo "[entrypoint] no config found — provisioning a fresh VTA"
  cat > "$SETUP" <<TOML
config_path      = "$CONFIG"
data_dir         = "/data/store"
public_url       = "${VTA_PUBLIC_URL:-http://localhost:8100}"
vta_name         = "${VTA_NAME:-vti-local}"
data_dir_exists  = "reuse"
overwrite_config = true

[server]
host = "0.0.0.0"
port = 8100

[log]
level  = "${VTA_LOG_LEVEL:-info}"
format = "text"

[secrets]
backend = "plaintext"

[messaging]
kind = "skip"

[vta_did]
kind = "create_webvh"
url  = "${VTA_PUBLIC_URL:-http://localhost:8100}"
TOML
  vta setup --from "$SETUP"

  # Optional: advertise TSP at first boot when a mediator DID is supplied.
  # This is the DID-document mutation that adds `#tsp` / TSPTransport — note
  # it changes the document with NO key rotation.
  if [ -n "${VTA_TSP_MEDIATOR_DID:-}" ]; then
    echo "[entrypoint] advertising TSP via $VTA_TSP_MEDIATOR_DID"
    vta --config "$CONFIG" services tsp enable --mediator-did "$VTA_TSP_MEDIATOR_DID"
  fi

  # Optional: seed the first admin without sealing the VTA (reversible).
  if [ -n "${VTA_ADMIN_DID:-}" ]; then
    echo "[entrypoint] granting admin to $VTA_ADMIN_DID"
    vta --config "$CONFIG" import-did --did "$VTA_ADMIN_DID" --role admin --label local-admin
  fi
else
  echo "[entrypoint] existing config found — reusing /data"
fi

echo "[entrypoint] starting VTA on :8100"
exec vta --config "$CONFIG"
