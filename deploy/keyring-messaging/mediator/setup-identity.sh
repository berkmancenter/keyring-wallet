#!/bin/sh
# One-time: create the mediator's identity with upstream's mediator-setup.
#
#   sudo ./mediator/setup-identity.sh
#
# Reads MEDIATOR_HOST from .env. Writes, owned by the mediator's uid (10002),
# mode 0600:
#   secrets/mediator/mediator-secrets.json  the mediator's private keys
#   secrets/mediator/admin-monitor.json     its admin identity, with private key:
#                                           mediator-account registers the
#                                           gateway with it (HANDOVER.md §8)
# and prints the MEDIATOR_DID and MEDIATOR_ADMIN_DID lines to put in .env.
#
# Refuses to overwrite an existing identity: a new one is a new mediator DID,
# which means a new gateway identity too (HANDOVER.md §8).
set -eu
cd "$(dirname "$0")/.."

host=$(sed -n 's/^MEDIATOR_HOST=//p' .env | tail -n 1)
if [ -z "$host" ]; then
  echo "set MEDIATOR_HOST in .env first" >&2; exit 1
fi
if [ -e secrets/mediator/mediator-secrets.json ]; then
  echo "secrets/mediator/mediator-secrets.json exists; not overwriting the mediator's identity" >&2
  exit 1
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT INT TERM HUP
sed "s#@MEDIATOR_HOST@#$host#g" mediator/mediator-build.toml > "$work/recipe.toml"
chmod 0777 "$work"

docker compose up -d --wait redis
docker compose run --rm --no-deps --user 0:0 --entrypoint mediator-setup \
  -v "$work:/setup" mediator --from /setup/recipe.toml

mediator_did=$(sed -n 's/^mediator_did *= *"did:\/\/\(.*\)"/\1/p' "$work/mediator.toml")
admin_did=$(sed -n 's/^admin_did *= *"did:\/\/\(.*\)"/\1/p' "$work/mediator.toml")
if [ -z "$mediator_did" ] || [ -z "$admin_did" ] || [ ! -s "$work/mediator-secrets.json" ] \
   || [ ! -s "$work/admin-monitor.json" ]; then
  echo "mediator-setup did not produce a DID, an admin DID, a secrets file and an admin profile:" >&2
  ls -la "$work" >&2
  exit 1
fi

mkdir -p secrets/mediator
install -m 0600 "$work/mediator-secrets.json" secrets/mediator/mediator-secrets.json
install -m 0600 "$work/admin-monitor.json" secrets/mediator/admin-monitor.json
chown -R 10002:10002 secrets/mediator
chmod 0700 secrets/mediator

echo
echo "Mediator identity created. Put these two lines in .env:"
echo
echo "MEDIATOR_DID=$mediator_did"
echo "MEDIATOR_ADMIN_DID=$admin_did"
