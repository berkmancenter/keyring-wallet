# Keyring wallet mailbox

The Affinidi messaging mediator that Keyring phones sign in to: each phone opens
one wallet mailbox (a DID that signs in here over DIDComm v2, holds one live
WebSocket, and receives every v2 contact's mail through it). This folder is its
deploy package: the image, the mediator's configuration, Redis and Caddy.

It is the M3 step of the mediator migration plan
(`docs/plans/mediator-migration-plan/m3_affinidi_mailbox_subtask.md`). Its
infrastructure (VM `kpush-mailbox`, static IP, data disk, Secret Manager
secrets, uptime checks) and its runbook live in the private infrastructure
repository (`keyring-push-gateway-infra`, `docs/operations.md`, "The wallet
mailbox"); the two changes are a pair and are reviewed together.

## How it differs from the gateway's mediator

`../mediator/` is the push gateway's mediator and does not change. The two
share an upstream project and nothing else:

| | Gateway's mediator (`../mediator/`) | Wallet mailbox (this folder) |
| --- | --- | --- |
| Upstream | `affinidi-tdk-rs` at v0.33.1 | `affinidi-messaging-mediator` at v0.53.0 (`f6ed8159`) |
| Who signs in | the gateway only (`explicit_allow`; Caddy refuses public `/authenticate`) | any phone (`explicit_deny`, open sign-up; `/authenticate` is public) |
| Relaying onward | yes, for the gateway (`external_forwarding = "true"`) | never (`external_forwarding = "false"`, no `SEND_FORWARDED` in the default) |
| Identity | `did:peer:2` | `did:webvh` on `MAILBOX_HOSTNAME`, served with its `did:web` form |
| Keys | a file synced to the VM | GCP Secret Manager, read by the mediator itself (`gcp_secrets://`) |
| Rate limits | per-IP only | per-IP (with Caddy trusted for `X-Forwarded-For`) and per-DID |
| Wake | none | `[processors.wake]` on, upstream defaults |
| Host | `kpush-gateway`, with the gateway | its own VM, `kpush-mailbox` |

## Files

- `Dockerfile`: builds `mediator` and `mediator-setup` from source at
  `MEDIATOR_COMMIT`, `--locked`, on upstream's pinned toolchain and base image
  digests; asserts the checkout is that commit; runs as uid 10001. The cargo
  features are the build argument `MEDIATOR_FEATURES` (default: upstream's
  defaults `didcomm,tsp,redis-backend,jemalloc,vta` plus `secrets-gcp`).
- `mailbox.toml`: the mediator's settings, each with the reason for its value.
  Values still being measured in the lab say `PENDING S2` or `PENDING S5`.
- `docker-compose.yml`: mediator, Redis (AOF on) and Caddy. Only Caddy
  publishes ports; Caddy sits at a fixed address on the `edge` network, the
  only address whose `X-Forwarded-For` the mediator trusts.
- `Caddyfile`: one HTTPS site on `MAILBOX_HOSTNAME`, everything proxied
  (including sign-in and the WebSocket upgrade), `/mediator/v1/metrics` refused.
- `setup-identity.sh` and `setup-recipe.toml`: make the mailbox's identity.
- `.env.example`: the settings compose reads.

## The hostname comes first

`MAILBOX_HOSTNAME` is a placeholder until a reviewer picks it from the servers
already in use. The mailbox's DID is made on it (`did:webvh:<scid>:<hostname>`,
resolvable as `https://<hostname>/.well-known/did.jsonl`, with the `did:web`
form at `/.well-known/did.json`), so:

1. choose the hostname, and keep it: a new hostname is a new mailbox DID, and
   every phone's mailbox names the old one;
2. only then make the identity (next section).

## Identity and keys

`setup-identity.sh` runs upstream's `mediator-setup` in the mailbox image, on
your own machine, in a temporary checkout of this package with `.env`
holding `MAILBOX_HOSTNAME` and `GCP_PROJECT`. It writes into
`secrets/mailbox-identity/` (gitignored):

| File | What it is | Where it goes |
| --- | --- | --- |
| `mediator-secrets-bundle.json` | operating keys, JWT signing key, admin credential, did:webvh update keys, as one Secret Manager bundle | `<MAILBOX_SECRET_PREFIX>mediator_secrets_bundle` (the mediator reads it directly) |
| `admin-monitor.json` | the admin did:key and its private key | an operator-only backup secret |
| `did.jsonl` | the public DID log | the host serves it (`./did/did.jsonl`, mounted read-only) |
| `did-web.json` | the `did:web` form of the document | reference only; the mediator derives it from the log |

and prints `MAILBOX_MEDIATOR_DID` and `MAILBOX_ADMIN_DID` (not secret). The
bundle is the file backend's `entries` map wrapped in upstream's
`secrets-bundle` envelope (upstream `affinidi-messaging-mediator-common`,
`src/secrets/bundle.rs` and `backends/file.rs`); the mediator checks its version
and kind when it opens it, and refuses to start on a wrong shape.

The Secret Manager secrets must exist before the mediator first starts, with a
value in the bundle: the mediator only reads and adds versions, and the
service account is granted access to exactly those secret ids. One secret,
`<prefix>mediator_probe_readonly`, exists and stays empty on purpose: `/readyz`
reads it and expects "not found".

Losing every copy of the bundle means a new mailbox DID. Keep the encrypted
offline backup the infrastructure runbook describes.

## Running it

```sh
cp .env.example .env    # fill in MAILBOX_HOSTNAME, GCP_PROJECT, the two DIDs
docker compose config   # static check
docker compose up -d
```

The mediator reads Secret Manager with Application Default Credentials: on a
GCE VM, its service account through the metadata server. On the production
host none of this is done by hand: the VM renders `.env`, writes `did/did.jsonl`
and starts the stack (infrastructure runbook).

Checks once it runs:

- `https://<MAILBOX_HOSTNAME>/mediator/v1/livez` answers `{"status":"alive"}`;
- `https://<MAILBOX_HOSTNAME>/mediator/v1/readyz` answers `200`;
- `https://<MAILBOX_HOSTNAME>/.well-known/did.jsonl` is the DID log;
- `POST https://<MAILBOX_HOSTNAME>/mediator/v1/authenticate/challenge` is
  answered from outside (unlike the gateway's mediator, which answers `403`).

## Updating

The image tag is `MAILBOX_IMAGE_TAG`, `<MEDIATOR_COMMIT>-pN`. Any change to
what is built (a new commit, other `MEDIATOR_FEATURES`, a new base image or a
Dockerfile edit) gets a new tag; an image is never pushed over an existing
tag, since a host keeps the image it already has under a tag and a rollback
needs the previous one under its own. The first is
`f6ed8159a761344a96b5256e09c10e36cd2359d7-p1`.

A change to `mailbox.toml` needs only a restart of the mediator. A change of
hostname needs a new identity (above).

## Still being measured

The `PENDING` values in `mailbox.toml` and `docker-compose.yml`:
`cors_allow_origin`, `trust_task_verification`, `enable_inter_mediator_relay`
and the per-IP rate limit (S2), and the queue limits and Redis memory (S5).
`global_acl_default` (with `ANON_RECEIVE` and the `SEND_FORWARDED_CHANGE`
self-flag) and the per-DID rate limit carry values measured in the lab at
v0.53.0.

## Evidence
