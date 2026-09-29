# Keyring push gateway

A Docker Compose package that runs OpenVTC's
[push wake-up gateway](https://github.com/OpenVTC/vti-push-gateway) behind
Caddy, with automatic HTTPS. The gateway is the implementation of the
[`binding/push/0.1`](https://trusttasks.org/binding/push/0.1) doorbell: it
holds Keyring's Apple and Google push credentials and sends a contentless push
when a person's agent asks it to. The design, and why this package holds only
the gateway, are in
[`docs/plans/push-notifications-plan.md`](../../docs/plans/push-notifications-plan.md).

Keyring's mailbox (its DIDComm mediator) is **not** in this package. It keeps
running where it runs today. The gateway receives agents' wake-ups through the
shared VTI DIDComm v2 mediator named in its identity file.

> **Status: test.** Not deployed anywhere. The image is built by CI
> (`.github/workflows/push-gateway-image.yml`), which also runs the checks in
> [First run](#first-run-echo-sender-no-keys). Read
> [Unknowns](#unknowns-and-unverified) before you deploy it.

## What runs

| Service | What it is | Reachable at |
|---|---|---|
| `gateway` | `vti-push-gateway`, built from source at commit `e542a9d7` (`gateway/Dockerfile`), because upstream publishes no image. It gives out opaque wake handles for registered push tokens, and sends a contentless push when an allowed agent sends a signed `push/wake`. | `https://GATEWAY_HOST` |
| `caddy` | A reverse proxy. It gets and renews the Let's Encrypt certificate for `GATEWAY_HOST`. | ports 80 and 443 |

Only Caddy publishes ports. The gateway serves its Prometheus metrics only on
`127.0.0.1:9300` inside its own container, and Caddy answers `/metrics` with a
404.

How a phone and its agent use it (plan §4.4):
1. The phone sends `push/register` over HTTPS and gets a wake handle back.
2. The phone gives the handle to its agent with `device/set-wake/0.2`.
3. The agent sends a signed `push/provision` to the gateway.

Later the agent sends a signed `push/wake`, and the gateway pushes.

## Prerequisites

- A Linux server with Docker Engine and the Compose v2 plugin.
- A **DNS A record** (and AAAA if you have IPv6) for the gateway's hostname,
  created before the first start, since Caddy asks for a certificate on boot.
- **Ports 80 and 443 open** inbound (TCP, plus UDP 443 for HTTP/3).
- Outbound HTTPS to:
  - `api.push.apple.com` and `api.sandbox.push.apple.com`;
  - `fcm.googleapis.com` and `oauth2.googleapis.com`;
  - Let's Encrypt;
  - the shared VTI mediator and the `did:webvh` hosts, once the gateway has an
    identity.
- The gateway image (next section).

## Getting the image

Either option works:

- **From CI (preferred).** The `push-gateway-image` workflow builds the image on
  a GitHub runner and uploads it as an Actions artifact. Nothing is published
  to a registry. Load it with:
  ```sh
  gh run download <run-id> -R berkmancenter/keyring-wallet -n vti-push-gateway-image-arm64   # or -amd64
  docker load -i vti-push-gateway.tar
  ```
- **Build on the host:** `docker compose build gateway`. The Rust build needs
  about 4 GB of RAM and several minutes.

## Secrets to place

Nothing secret goes in the repository. `.env`, `secrets/` and `data/` are
gitignored.

| File in `secrets/` | What | `.env` settings |
|---|---|---|
| `AuthKey_<KEYID>.p8` | APNs token-auth key (Apple Developer → Keys → Apple Push Notifications service) | `GATEWAY_APNS_KEY_FILE=/run/secrets/gateway/AuthKey_<KEYID>.p8`, `GATEWAY_APNS_KEY_ID`, `GATEWAY_APNS_TEAM_ID` |
| `fcm-service-account.json` | A service account holding only the *Firebase Cloud Messaging API Admin* role, with a JSON key | `GATEWAY_FCM_SERVICE_ACCOUNT_FILE=/run/secrets/gateway/fcm-service-account.json` |
| `gateway-identity.json` | The gateway's `did:webvh` identity ([Gateway identity](#gateway-identity-one-time)) | `GATEWAY_IDENTITY_FILE=/run/secrets/gateway/gateway-identity.json` |

The paths in `.env` are paths inside the container. The gateway runs as uid
10001, and with `GATEWAY_STRICT_KEY_PERMS=1` it refuses to start if a secret is
readable by anyone else:

```sh
sudo chown -R 10001:10001 secrets data/gateway
sudo chmod 700 secrets data/gateway && sudo chmod 600 secrets/*
```

Whether an APNs push goes to the sandbox or to production is chosen per
registration by the app (`environment` in `push/register`), not by the gateway.
A development build registers as sandbox.

## First run (echo sender, no keys)

The gateway has a dev **echo sender**. It accepts every platform, logs wakes
and delivers nothing. So the gateway can be brought up and checked before any
push credentials exist.

```sh
cd deploy/keyring-messaging
cp .env.example .env
# set GATEWAY_HOST; for this run: GATEWAY_DEV_ECHO_SENDER=1
# and GATEWAY_ALLOWED_CONTROLLERS=<the agent DID you test with>
mkdir -p data/gateway secrets
docker compose config >/dev/null
docker compose up -d
docker compose ps        # gateway healthy
```

Check it (the CI workflow runs the same three checks against the bare image):

```sh
curl -fsS https://$GATEWAY_HOST/healthz            # → ok
# a registration naming a served agent is accepted and returns a wake handle
curl -s https://$GATEWAY_HOST/trust-tasks -H 'content-type: application/json' -d '{
  "id":"urn:uuid:00000000-0000-4000-8000-000000000001",
  "type":"https://trusttasks.org/spec/push/register/0.2",
  "payload":{"registration":{"platform":"fcm","token":"first-run-test"},
             "controllerVtaDid":"<a DID in GATEWAY_ALLOWED_CONTROLLERS>"}}'
# a registration naming any other agent is refused: permissionDenied
```

A wake needs more than this:
- The gateway accepts `push/provision` and `push/wake` only as documents signed
  by an agent, addressed to the gateway's **DID** (plan §4.4).
- Without an identity file the gateway serves `push/register` only.
- Upstream's `test-wake*` helpers need an identity **and** open mode
  (`GATEWAY_ALLOWED_CONTROLLERS=*`).

So the wake path is tested after [Gateway identity](#gateway-identity-one-time).

**Turn the echo sender off before real use.** Clear `GATEWAY_DEV_ECHO_SENDER`,
then run `docker compose up -d gateway`. While it's on, a wake for a platform
with no credentials is reported `delivered` and silently dropped.

## Gateway identity (one-time)

The gateway is a VTA integration with its own `did:webvh`, made from the VTA's
`push-gateway` DID template against a VTA where you have admin rights. This
package does not automate it.

1. Mint the DID with `URL` set to **the mediator's DID** (the gateway connects
   out to it), `ROUTING_KEYS` empty, and `SERVICE_TSP` set. The gateway
   warns at startup unless its DID document carries
   `{ "id": "{DID}#tsp", "type": "TSPTransport", "serviceEndpoint": "<mediator DID>" }`.
   That is `pnm bootstrap provision-request --template push-gateway …` on the
   gateway's side, then `pnm bootstrap provision-integration --request … --out …`
   by the VTA's admin; HANDOVER.md §8 has the full commands and who runs each.
2. Open the sealed bundle into the identity file the gateway reads, with
   `tools/gateway-identity`. **Do not run `pnm bootstrap open` on this bundle.**
   For a `TemplateBootstrap` payload it prints a summary, writes nothing, and
   deletes the single-use seed, which loses the gateway's keys. Back up the seed
   (`<pnm config dir>/bootstrap-secrets/<bundle-id>.key`) first either way.
   ```sh
   cd tools/gateway-identity && cargo build --release
   ./target/release/gateway-identity --bundle <bundle.armor> \
     --seed <bundle-id>.key --digest <sha256 from the provisioner> \
     --mediator <mediator DID> --out ../../secrets/gateway-identity.json
   ```
   It opens the bundle with vta-sdk's `open_bundle`, keeps the seed, and writes
   this file with mode 0600 (`src/identity.rs`):
   ```jsonc
   { "did": "did:webvh:…:push-gateway",
     "signing":      { "id": "did:webvh:…#key-0", "privateKeyMultibase": "z…" },
     "keyAgreement": { "id": "did:webvh:…#key-1", "privateKeyMultibase": "z…" },
     "mediator": "did:webvh:…:mediator" }
   ```
3. Save it as `secrets/gateway-identity.json` (owner 10001, mode 0600), set
   `GATEWAY_IDENTITY_FILE`, and run `docker compose up -d gateway`.

The file holds the gateway's private keys. Back it up with the other secrets.

## Backups

Treat all of these as credentials:

| What | Why |
|---|---|
| `data/gateway/gateway-store.json` | The handle registry. **Raw device push tokens are in clear text** (upstream's Security notes). Copy it with its 0600 mode, encrypt the backup, and restrict who can read it. |
| `secrets/` | The APNs key, the FCM service account, the gateway identity |
| `.env` | Configuration; no secret values, but needed to restore |
| `data/caddy/` | Optional: certificates are re-issued, but keeping them avoids Let's Encrypt rate limits |

Restore by putting back `.env`, `secrets/` and `data/gateway/`, then running
`docker compose up -d`.

## Updating (pin bumps)

The gateway is pinned by commit, and Caddy, Rust and Debian by tag and digest.
Nothing updates on its own.

- **Gateway:** move `GATEWAY_COMMIT` (a full 40-character SHA) only together
  with the agents it serves. Gateway PR #32 changed how provisions and wakes
  are authorised, and a gateway and an agent on opposite sides of such a
  change can't talk. Read the upstream README diff for new or renamed
  `GATEWAY_*` variables, then rebuild or reload the image and run
  `docker compose up -d gateway`.
- **Caddy, Rust, Debian:** bump the tag and digest together. Get the digest with
  `docker buildx imagetools inspect <image>:<tag>`.

## Local testing

For a local run with no DNS, set `GATEWAY_HOST=localhost`, `SITE_SCHEME=http`
and `HTTP_PORT=8380` (any free port) in `.env`, and reach the gateway at
`http://localhost:8380`. A phone needs a public HTTPS hostname: put a tunnel in
front of Caddy's HTTP port and set `GATEWAY_HOST` to the tunnel's hostname.

## Unknowns and unverified

- **Not deployed.** CI builds the image and checks health and registration.
  On the project's local VTI lab (VTI `2240aa7e`), with a real identity and the
  echo sender, an agent's `device/set-wake` produced a signed `push/provision`
  that reached the gateway through the lab mediator and was accepted, and
  upstream's signed `test-wake-fcm` returned `delivered`. An agent-triggered
  wake (a step-up approval by a second party) and delivery to real phones
  haven't run yet.
- **The identity commands.** `pnm bootstrap provision-integration` is the verb
  at VTI `2240aa7e`. Upstream has no tool that writes the gateway's identity
  file; `tools/gateway-identity` fills that gap.
- **Which agents a shared gateway serves** (exact DIDs or `*`) is not decided
  (plan §5.4).
- **No unregister.** A removed phone's token stays in the store (plan §8).
- **Multi-arch.** The gateway builds for whatever the host or runner is. CI
  builds `linux/amd64`.
