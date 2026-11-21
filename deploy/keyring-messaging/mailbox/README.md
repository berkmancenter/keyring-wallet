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
- `docker-compose.ci.yml`: CI only, never used on the VM. Laid over
  `docker-compose.yml` by the repository's "Mailbox mediator image" check so
  the mediator boots on a runner with no GCP and no Caddy (its header says
  exactly what differs).

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

Lab, 2026-11-21, `affinidi-messaging-mediator` v0.53.0 (`f6ed8159`), built from the pinned clone with
`cargo build --release --locked -p affinidi-messaging-mediator` (default features: didcomm, tsp, redis-backend,
jemalloc, vta) and `mediator-setup` from the same commit. One local instance with its own Redis (append-only on),
`mediator_acl_mode = "explicit_deny"` and this directory's values for the default ACL, external forwarding and the
per-DID limit (`evidence/mediator-config-changes-f6ed8159.diff` is the whole difference from what `mediator-setup`
wrote). Deviations from the deployment: a did:peer identity naming `http://127.0.0.1` (the deployment's is on its
hostname), file secrets, no TLS, no proxy except where row D says so. Clients: Node, Credo 0.7.1-pr-2704 for
envelopes, the mailbox design of bifold `walletMailbox.ts` (one mailbox DID per phone, pairwise contact DIDs, every
send a routing/2.0 forward over the sender's own session). The harness is `evidence/wallet-s2.mjs` and
`evidence/rate-probe.mjs`; outputs are beside them, with lab DIDs shortened.

| Row | Result |
|---|---|
| A0 open sign-up | four fresh DIDs sign in with no admin step, one socket each |
| A1 CONTROL, before the flag | a mailbox send is refused, `e.p.authorization.send_forwarded` |
| A2 the phone sets its own flag | each phone sets `SEND_FORWARDED` on its own account with a signed `messaging/account/update` (`did` = the sha256 hex of its DID, the mediator's account key); the answer shows `sendForwarded: true` |
| A3 sends | two pairs connect over v2 OOB and deliver both ways through the mailbox |
| A4 CONTROL | an account that never set its flag is still refused |
| B `external_forwarding = "false"` | a forward whose next hop has no account here is refused, `e.p.delivery.refused` ("next hop has no account on this mediator" in the mediator's log); A3 is the control |
| C per-DID limit, 20/s burst 10 | 60 authenticated requests in one burst from one DID: 10 × 200, 50 × 429 |
| D per-IP limit behind a proxy | `trust_xff_cidrs` = the proxy's address, limit 5/s burst 5: 40 requests with a rotating `X-Forwarded-For` are 40 buckets (no 429); 40 with the same address, 35 × 429. CONTROL, nothing trusted: the rotating addresses are one bucket, 35 × 429. This proves the bucketing, not the shipped values (100/s, burst 50), which were not run and stay `PENDING S2` in `mailbox.toml` |
| E open → enrolled | restarted with `mediator_acl_mode = "explicit_allow"` (Redis AOF on): an existing account signs in again; a new DID is refused at the challenge, 403 `authentication.blocked` |
| F what the store holds | every Redis key dumped and searched: 0 occurrences of any contact DID; the positive control (the stored frame's `did:key` recipient) found once; mailbox DIDs 13 times (accounts, sessions, handles), by design |
| R1, R2 unauthenticated `POST /inbound` | an anoncrypt forward whose next hop is a phone's mailbox, and an anoncrypt message addressed straight to a mailbox DID: both 401 "Missing credentials". CONTROL with `SEND_FORWARDED` added to the default (implicit relay on): still refused, 400 `w.m.message.anonymous` (the relay path needs an authcrypt inner) and 403 "Anonymous direct delivery is not allowed by this mediator". The control's assertion was written expecting acceptance, so its output file reports `0 passed, 2 failed`: the refusal is the finding. It probed anoncrypt inners only; an authcrypt inner from a stranger, which that setting would admit, was not probed |
| W1 `wake/set` | `wakeCapable: true` |
| W2 CONTROL | recipient online: a send plus `wake/request` rings nothing |
| W3 CONTROL | recipient offline with no handle: nothing |
| W4 wake | recipient offline with a handle: ONE `push/wake/0.2` reaches the (stand-in) gateway, payload `{handle, mediator, urgency: "interactive", v: 1}`, issued and signed by the mediator (proof purpose authentication); no second ring. The sender's id (sha256 of the inner JWE's bytes, attached as `data.base64`) equals the mediator's stored id; attached as `data.json` it does not, since the mediator re-serialises it |

One line in `run-s2-main-f6ed8159.txt` is the harness's, not the mediator's: `(bob frame: Error deleting key …)` is
printed by the harness's frame handler while bob's agent is shutting down after the last row (a frame arrived during
shutdown; packing its acknowledgement made an ephemeral key whose cleanup found the store closed). Every row had
passed before it; it affects none.

Two doors that do not exist in this build, for the record: the Aries v1 anonymous-forward path
(`allow_unauthenticated_forwards`) is compiled out, since the image has no `didcomm-v1` feature; and were the
unauthenticated relay door ever opened, upstream gives that session `DENY_ALL,SEND_MESSAGES,SEND_FORWARDED` only
(`jwt_auth.rs`, `relay_anonymous_acls`), never an inbox or the self-management rights.

Findings applied to `mailbox.toml`: `ANON_RECEIVE` in the default (without it A3 was refused, "recipient is not
accepting anonymous messages": Credo's inner forward layer is anoncrypt, while the forward's outer sender stays
authenticated and gated by `SEND_FORWARDED`); `trust_task_verification = "enforce"` (every row's Trust Task is
signed and accepted under it); `enable_inter_mediator_relay = "false"` (the lab ran closed).

Not measured here: the real push-gateway path (the stand-in gateway was an account on the same mediator), TLS and
the did:webvh identity, the soak (S5), refusal at the hard cap (S5b), mail from a contact on another mediator. This
directory's `Dockerfile`, compose file and `setup-identity.sh` are exercised by the repository's "Mailbox mediator
image" check (`.github/workflows/push-gateway-image.yml`, job `mailbox`), which runs on every pull request touching
`deploy/keyring-messaging/**`, on amd64 and arm64: it builds the image at the pinned commit, creates an identity with
`setup-identity.sh` on a throwaway hostname, boots the mediator with Redis on the file secrets backend
(`docker-compose.ci.yml`: CI has no Secret Manager and no Caddy) and probes `livez`, `readyz` (`"status":"ready"`,
the text the uptime check matches) and an unauthenticated `POST /inbound` (401, rows R1 and R2). The sibling
"Mediator image" checks build the gateway's mediator from `../mediator/` and say nothing about this package. Every
key in `mailbox.toml` was checked by hand against upstream's config schema at v0.53.0, which no check automates: the
mediator accepts an unknown key in silence (VTI-06).
