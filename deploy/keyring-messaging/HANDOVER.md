# Keyring push gateway: handover

This document is for the engineer who will run Keyring's push wake-up gateway on
a server. It covers:
- what the gateway does, and what it doesn't;
- how to get the image;
- every setting and secret;
- what the host needs;
- a go-live checklist and the production test we'll run with you;
- the known gaps.

Everything referred to here is in this folder (`deploy/keyring-messaging/`).
Secrets are not in this document; each one says where it comes from.

Status: tested end to end on a real iPhone against a local copy of this setup
(2026-09-29). With the app in the background, and after it was force-quit, the
phone showed the notification within about 5 seconds of the request. With the
app open it showed nothing, which is by design.

## 1. What the gateway is

Keyring is a wallet app. Each person has an **agent** (a VTA, a server-side
service that acts for them). Sometimes the agent needs the person, for example
to approve a request. If the app is closed, the agent can't reach it. The
gateway solves that one problem: it is a **doorbell**.

```
                ┌──────────────── one-time registration (HTTPS) ────────────────┐
                │  phone → gateway: "here is my push token" → gateway: "your handle is H"
                │  phone → agent:   "wake me at gateway G, handle H"             │
                ▼                                                                │
  ┌────────┐  signed push/wake (DIDComm/TSP)  ┌───────────┐   APNs / FCM    ┌───────┐
  │ agent  │ ── via its DIDComm v2 mediator ─▶│  gateway  │ ──────────────▶ │ phone │
  │ (VTA)  │                                  │ (this)    │  "something is  │       │
  └────────┘                                  └───────────┘   waiting"      └───┬───┘
       ▲                                                                        │
       └──────────── the phone opens Keyring and fetches the real request ──────┘
                         directly from its agent, over its own encrypted channel
```

**What it holds:**
- Keyring's Apple (APNs) and Google (FCM) push credentials;
- the phones' push tokens, each behind an opaque random **handle**.

The agent only ever sees the handle, never the token.

**What it sends:** a push with **no content**. Apple and Google see that a
Keyring push went to a phone at a certain time, and nothing else. The phone
shows one fixed line from its own strings ("Something is waiting for you in
Keyring."), then gets the actual request from its agent.

**What it doesn't do:**
- It carries no messages.
- It holds no user data beyond push tokens.
- It isn't Keyring's DIDComm mailbox (the mediator the app uses), and it doesn't
  replace it.

**Who may use it:**
- A phone may register itself (HTTPS, anonymous, rate-limited). The phone must
  name an agent the gateway serves.
- Only that agent may set who is allowed to wake the handle (`push/provision`).
- Only agents on that list may wake it (`push/wake`).

Both calls are documents signed by the agent's own key (Data Integrity,
`eddsa-jcs-2022`, purpose `authentication`). Transport identity never
authorises anything.

## 2. The image

The gateway is OpenVTC's
[`vti-push-gateway`](https://github.com/OpenVTC/vti-push-gateway), pinned at
commit **`e542a9d77a7369f4f3da01d573107ea155c80691`**, plus one patch of ours.

| Way | How |
| --- | --- |
| **Download the CI build (preferred)** | The `push-gateway-image` workflow builds the image on GitHub runners for `amd64` and `arm64`, runs the gateway's own test suite with our patch applied, and uploads each image as a run artifact. Nothing is pushed to a registry. `gh run download <run-id> -R berkmancenter/keyring-wallet -n vti-push-gateway-image-amd64`, then `docker load -i vti-push-gateway.tar`. The image is tagged `keyring-messaging/vti-push-gateway:<commit>`. |
| **Build it yourself** | `docker compose build gateway` in this folder (multi-stage Rust; about 4 GB RAM and several minutes). It checks out the pinned commit, verifies it, and applies `gateway/patches/*.patch`; the build fails if a patch no longer applies. |

**The patch, `gateway/patches/0001-…visible-alert…patch`: why it exists.**
Upstream sends every wake as a *silent* background push. On iPhone, Apple
throttles those ("don't try to send more than two or three per hour") and drops
them after a force-quit ("If something force quits or kills the app, the system
discards the held notification"). An approval can't depend on that.

With `GATEWAY_ALERT_LOC_KEY` set, the patch sends an **interactive** wake as a
visible notification that the phone's system displays itself:
- APNs `alert`, priority 10, `loc-key`, collapse ID;
- FCM notification message, `body_loc_key`, collapse key.

Background wakes stay silent. The payload names a localisation key, never text.
The patch is self-contained, with tests and a README section, and is a candidate
for contributing upstream (tracked as CONTRIB-01). It hasn't been submitted; the
project does that itself, so please don't open anything upstream.

Moving to a newer upstream commit means re-applying the patch there and
regenerating it (see `gateway/patches/README.md`). Only move it together with
the agents the gateway serves: provision/wake authorisation changed in upstream
PR #32, and a gateway and an agent on opposite sides of such a change can't talk
to each other.

## 3. Settings and secrets

Copy `.env.example` to `.env` and fill it in. Secrets are **files** in
`./secrets/`, mounted read-only at `/run/secrets/gateway/`. Set them owner-only
for uid 10001, the user the gateway runs as:

```sh
sudo chown -R 10001:10001 secrets data/gateway
sudo chmod 700 secrets data/gateway && sudo chmod 600 secrets/*
```

`GATEWAY_STRICT_KEY_PERMS=1` (the default here) refuses to start if a secret is
readable by anyone else.

### 3.1 Apple (APNs)

| Setting | Value | Comes from |
| --- | --- | --- |
| `GATEWAY_APNS_KEY_FILE` | `/run/secrets/gateway/AuthKey_<KEYID>.p8` | **Secret.** Keyring's APNs auth key, shared privately by the project lead |
| `GATEWAY_APNS_KEY_ID` | the key's ID | the project lead (not secret) |
| `GATEWAY_APNS_TEAM_ID` | Apple Developer team ID | the project lead (not secret) |
| `GATEWAY_APNS_TOPICS` | `asml.bkc.harvard.wallet.pushtest` for the test; later add `asml.bkc.harvard.wallet` | fixed; registrations naming another topic are refused |

The app says per registration whether its token is for Apple's **sandbox**
(development builds) or **production**, so the gateway needs no setting for it.

### 3.2 Google (FCM)

| Setting | Value | Comes from |
| --- | --- | --- |
| `GATEWAY_FCM_SERVICE_ACCOUNT_FILE` | `/run/secrets/gateway/fcm-service-account.json` | **Secret.** A key for a service account that holds only the *Firebase Cloud Messaging API Admin* role, shared privately by the project lead |

### 3.3 Visible alert mode (patch 0001)

| Setting | Value |
| --- | --- |
| `GATEWAY_ALERT_LOC_KEY` | `KEYRING_WAKE`, the string key the app defines in every language |
| `GATEWAY_ALERT_COLLAPSE_ID` | `keyring-wake` (merges repeated wakes into one notification) |
| `GATEWAY_ALERT_TITLE_LOC_KEY`, `GATEWAY_FCM_ANDROID_CHANNEL_ID` | leave blank |

### 3.4 The gateway's own identity

The gateway has its own `did:webvh`. Agents address their wake-ups to it, and it
receives them through a DIDComm v2 mediator it connects **out** to. It needs no
inbound port for this. The identity comes from a VTA, as an "integration" made
from the VTA's `push-gateway` DID template. Three steps:

1. **Request** (on the machine that will hold the identity, with `pnm`):
   ```sh
   pnm bootstrap provision-request --template push-gateway \
     --var URL=<the mediator's DID> \
     --var SERVICE_TSP='{"id":"{DID}#tsp","type":"TSPTransport","serviceEndpoint":"<the mediator's DID>"}' \
     --var WEBVH_SERVER=<the DID-hosting server id> \
     --context-hint push-gateway
   ```
   This stores a one-time seed under pnm's config directory
   (`bootstrap-secrets/<bundle-id>.key`) and writes a `request.json`.
   - `URL` is the **mediator's DID**, because the gateway is reached through it.
   - `SERVICE_TSP` adds the TSP entry the gateway checks for at startup.
2. **Approve** (by an admin of that VTA):
   ```sh
   pnm --vta <vta> bootstrap provision-integration --request request.json \
     --context push-gateway --create-context
   ```
   This prints a SHA-256 **digest** and writes a sealed `bundle.armor`.
3. **Open it into the identity file**, with our tool, `tools/gateway-identity`:
   ```sh
   cp <pnm config>/bootstrap-secrets/<bundle-id>.key ./seed-backup.key   # back it up first
   cd tools/gateway-identity && cargo build --release
   ./target/release/gateway-identity --bundle bundle.armor --seed <bundle-id>.key \
     --digest <digest from step 2> --mediator <the mediator's DID> \
     --out ../../secrets/gateway-identity.json
   ```
   Then set `GATEWAY_IDENTITY_FILE=/run/secrets/gateway/gateway-identity.json`.

> **Do not run `pnm bootstrap open` on this bundle.** For this bundle type it
> prints a summary, writes nothing, and **deletes the one-time seed first**. The
> gateway's keys are then gone for good, and you'd have to start over. No
> upstream tool writes the gateway's identity file (tracked as finding VTI-53),
> which is why `tools/gateway-identity` exists. It opens the bundle with the VTA
> SDK's documented `open_bundle`, keeps the seed, and writes the file mode 0600.

**The mediator account:** none to create by hand on a mediator that admits new
DIDs by default. The gateway registers itself the first time it authenticates.
On a mediator that denies unknown DIDs, its admin must allow the gateway's DID.

### 3.5 Which agents it serves: a decision for you

`GATEWAY_ALLOWED_CONTROLLERS` lists the agents (VTA DIDs) whose phones may
register. It is required: **unset means every registration is refused.**

| Option | What it means | Limits |
| --- | --- | --- |
| **An exact list** of agent DIDs | Only those agents' phones can register or wake. No wildcards or patterns, by upstream's design | Every new person's agent means a configuration change and a restart |
| **`*` (open mode)** | Any agent may register phones | Upstream logs a warning. The bounds still hold: at most 4096 live handles per agent, a handle no agent provisions is dropped after 1 hour, and per-sender and per-handle budgets apply |

For the production test (§5) the list is just our test agent's DID, which we'll
send you. What production needs is **open**, and it's your call with the project
lead.

### 3.6 Everything else

| Setting | Value / note |
| --- | --- |
| `GATEWAY_HOST` | your public hostname, e.g. `push.example.org` |
| `GATEWAY_STORE_FILE` | `/data/gateway-store.json` (set by the compose file); the handle registry |
| `GATEWAY_HTTP_PER_SEC` / `GATEWAY_HTTP_BURST` | `100` / `400`. Behind the proxy every phone shares one IP, so the upstream default (10/s) is too low |
| `GATEWAY_DEV_ECHO_SENDER` | **blank in production.** When on, wakes are logged and never sent |
| `GATEWAY_METRICS_TOKEN` (optional) | a bearer token for `/metrics`, which listens only on the container's loopback |
| `GATEWAY_LOG` | `vti_push_gateway=info,tower_http=info` |

## 4. What the host needs

- **Docker** with Compose v2.
- **A public HTTPS hostname.** Phones register at `https://<host>/trust-tasks`.
  Caddy in this package gets and renews the certificate itself; it needs a DNS
  record and ports 80/443 open.
- **Outbound access** to:
  - `api.push.apple.com` and `api.sandbox.push.apple.com`;
  - `fcm.googleapis.com` and `oauth2.googleapis.com`;
  - the DIDComm v2 mediator;
  - the `did:webvh` hosts.
- **A persistent volume** for `data/gateway` (the handle registry). It holds
  phones' push tokens **in clear text**, so protect it and its backups like
  credentials.
- **Backups:**
  - `data/gateway/gateway-store.json`, encrypted;
  - `secrets/` (the APNs key, FCM key and identity);
  - `.env`.
  Restore means putting them back and running `docker compose up -d`.
- **Health:** `GET https://<host>/healthz` returns `ok`, and the container has a
  healthcheck. **Metrics:** Prometheus on the container's `127.0.0.1:9300`
  (`gateway_register_total`, `gateway_provision_total`, and
  `gateway_wake_total{outcome=delivered|transient_failure|token_unregistered|not_allowed}`).
- **Logs:** `docker compose logs gateway`. No message content is ever logged,
  because there is none.

## 5. Go-live checklist and production test

1. The image is loaded (§2), and the `.env` and `secrets/` are in place (§3),
   with permissions set.
2. DNS points at the host, ports 80/443 are open, and `docker compose up -d`
   brings up `https://<host>/healthz` → `ok`.
3. The startup log shows:
   - `APNs sender enabled`;
   - `FCM … sender enabled`;
   - `visible alert mode … loc_key=KEYRING_WAKE`;
   - `controller allowlist controllers=N listed`;
   - `DID document advertises TSPTransport`.
   There's **no** echo-sender warning.
4. Send us the URL. **The production test**, which we run with you:
   - We build the push-test app with `PUSH_GATEWAY_URL=https://<host>` and
     install it on a test iPhone and Android phone.
   - The phone links to our test agent (its DID is in your allowlist) and turns
     notifications on. You should see `gateway_register_total` and
     `gateway_provision_total{outcome="ok"}` go up.
   - We trigger an approval request from the agent, with the app in the
     background, force-quit, and open. Expected: the line appears in the first
     two cases, nothing in the third, and `gateway_wake_total{outcome="delivered"}`
     goes up each time.
5. After the test passes, the release app's bundle ID is added to
   `GATEWAY_APNS_TOPICS`, and the release build is pointed at your URL. Push goes
   live only then.

## 6. Known gaps

- **No unregister.** A removed phone's handle and token stay in the store. They
  can't be used once no agent wakes them, but they are still stored tokens.
- **Disabling or wiping a device at the agent doesn't clear its wake channel**
  (tracked as VTI-Q37). Only the phone clearing its own channel does. Keyring's
  app clears it when it unlinks; a phone that is lost can't.
- **Timing is visible.** The gateway, Apple and Google see *when* a wake goes
  out, and that correlates with the agent's activity. The content is never
  visible.
- **The upstream pin must move with the agents** (§2).
