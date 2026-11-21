#!/bin/sh
# One-time: make the mailbox's identity with upstream's mediator-setup, AFTER
# MAILBOX_HOSTNAME is chosen (the DID is made on that hostname).
#
#   ./setup-identity.sh
#
# Run it on your own machine, in a temporary checkout of this package, with the
# mailbox image loaded locally (keyring-messaging/mailbox-mediator:<MAILBOX_IMAGE_TAG>)
# and MAILBOX_HOSTNAME and GCP_PROJECT set in .env. It writes, mode 0600, into
# secrets/mailbox-identity/ (gitignored):
#   mediator-secrets-bundle.json  the mailbox's keys, JWT key and admin credential,
#                                 as the Secret Manager bundle the mediator reads
#                                 (push it: secret-push.sh mailbox <file>)
#   admin-monitor.json            its admin identity, with private key
#                                 (push it: secret-push.sh mailbox-admin <file>)
#   did.jsonl                     its public DID log (not secret; the host serves it)
#   did-web.json                  the did:web form of its document (reference)
# and prints the MAILBOX_MEDIATOR_DID and MAILBOX_ADMIN_DID lines.
#
# Refuses to overwrite an existing identity: a new one is a new mailbox DID,
# and every phone's mailbox names the old one.
set -eu
cd "$(dirname "$0")"

host=$(sed -n 's/^MAILBOX_HOSTNAME=//p' .env 2>/dev/null | tail -n 1)
if [ -z "$host" ]; then
  echo "set MAILBOX_HOSTNAME in .env first (the DID is made on it)" >&2; exit 1
fi
case "$host" in
  *://*|*/*|*example.*|*.invalid) echo "MAILBOX_HOSTNAME=$host is not a real bare hostname" >&2; exit 1 ;;
esac
out=secrets/mailbox-identity
if [ -e "$out" ]; then
  echo "$out exists; not overwriting the mailbox's identity" >&2
  exit 1
fi
command -v jq >/dev/null 2>&1 || { echo "jq is required" >&2; exit 1; }

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT INT TERM HUP
sed "s#@MAILBOX_HOSTNAME@#$host#g" setup-recipe.toml > "$work/recipe.toml"
chmod 0777 "$work"

docker compose up -d --wait redis
# mediator-setup prints the admin's private key "for operator bookkeeping".
# It is already in admin-monitor.json, so keep it out of terminals and logs.
if ! docker compose run --rm -T --no-deps --user "$(id -u):$(id -g)" \
     --entrypoint mediator-setup -v "$work:/setup" mediator \
     --from /setup/recipe.toml > "$work/setup.log" 2>&1; then
  sed -E 's/(Private key \(multibase\): ).*/\1(not shown)/' "$work/setup.log" >&2
  exit 1
fi
sed -E 's/(Private key \(multibase\): ).*/\1(not shown: it is in admin-monitor.json)/' "$work/setup.log"

mediator_did=$(sed -n 's/^mediator_did *= *"did:\/\/\(.*\)"/\1/p' "$work/mediator.toml")
admin_did=$(sed -n 's/^admin_did *= *"did:\/\/\(.*\)"/\1/p' "$work/mediator.toml")
case "$mediator_did" in
  did:webvh:*:"$host") ;;
  *) echo "mediator-setup made '$mediator_did', not a did:webvh on $host" >&2; exit 1 ;;
esac
case "$admin_did" in
  did:key:z*) ;;
  *) echo "mediator-setup made no admin did:key ('$admin_did')" >&2; exit 1 ;;
esac
for f in mediator-secrets.json admin-monitor.json did.jsonl; do
  [ -s "$work/$f" ] || { echo "mediator-setup did not write $f:" >&2; ls -la "$work" >&2; exit 1; }
done

# The file backend's store is {"entries": {name: base64url(entry)}}; the
# Secret Manager bundle holds the same map inside a versioned envelope
# (upstream affinidi-messaging-mediator-common src/secrets/bundle.rs and
# backends/file.rs). The mediator checks version and kind when it opens it.
jq -e '.entries | type == "object" and length > 0' "$work/mediator-secrets.json" >/dev/null \
  || { echo "mediator-secrets.json has no entries object" >&2; exit 1; }
umask 077
mkdir -p "$out"
jq -c '{version: 1, kind: "secrets-bundle", data: {entries: .entries}}' \
  "$work/mediator-secrets.json" > "$out/mediator-secrets-bundle.json"
install -m 0600 "$work/admin-monitor.json" "$out/admin-monitor.json"
install -m 0600 "$work/did.jsonl" "$out/did.jsonl"
[ -s "$work/did-web.json" ] && install -m 0600 "$work/did-web.json" "$out/did-web.json"
chmod 0700 "$out"
# For a local run of this stack: the DID log where docker-compose.yml mounts it.
mkdir -p did && cp "$work/did.jsonl" did/did.jsonl && chmod 0644 did/did.jsonl

echo
echo "Mailbox identity created in $out/. Push the two secret files, keep did.jsonl"
echo "for the host, then put these two lines in .env (or terraform.tfvars):"
echo
echo "MAILBOX_MEDIATOR_DID=$mediator_did"
echo "MAILBOX_ADMIN_DID=$admin_did"
