# Keyring push gateway: handover

This document is for a backend engineer who will run Keyring's push wake-up
gateway, and the mediator it receives wake-ups through, on a server. It assumes you know Linux, Docker and DNS. It assumes no
background in Keyring or in the identity technology it uses: §1 defines every
term. It is self-contained, so you can read it without the repository.
Secrets are not in it; each one says where it comes from.

> **STATUS: ready to deploy for a staging test. Not yet production-ready.**
>
> **Proven**
> - End to end on a real iPhone, against a local copy of this setup
>   (2026-09-29). The phone showed the notification with the app in the
>   background and after it was force-quit: 5 wakes sent, 5 delivered, each
>   within about 5 seconds. With the app open it showed nothing, which is by
>   design.
> - The Apple push key: Apple accepted it and delivered to that iPhone, on
>   Apple's development (sandbox) channel.
> - The gateway image: CI builds it for amd64 and arm64 and passes upstream's
>   own test suite with our patch applied.
>
> **Not yet proven**
> - **The bundled mediator.** The iPhone test ran through our lab's mediator:
>   the same Affinidi release, and the same settings except the two relay
>   changes in §7. The package's own mediator is set up but untested:
>   - that CI builds and boots it is not yet confirmed;
>   - no wake-up has yet crossed from an agent's mediator to it.
>
>   We prove it in our lab before you deploy.
> - A real Android phone. The gateway loads the Google key at startup, but no
>   notification has been sent through Google yet.
> - Apple's production channel, used by App Store and TestFlight builds.
> - Running on a real server, with public HTTPS, a public hostname and a
>   persistent volume.
>
> **Open decisions** (§3)
> - Which agents the gateway serves (the allowlist).
> - Which VTA issues the gateway's identity, and which DID host publishes it.
> - Whether the production agents' mediator relays to other mediators (§3).
>
> **The production test in §10 is what turns it production-ready.**

**Contents**

1. [What the gateway is, and the terms used here](#1-what-the-gateway-is-and-the-terms-used-here)
2. [What we send you, and who to ask](#2-what-we-send-you-and-who-to-ask)
3. [Decisions to settle first](#3-decisions-to-settle-first)
4. [Getting the package and the image](#4-getting-the-package-and-the-image)
5. [From zero: a fresh server to a running gateway](#5-from-zero-a-fresh-server-to-a-running-gateway)
6. [The settings (`.env`), annotated](#6-the-settings-env-annotated)
7. [The services (`docker-compose.yml`), explained](#7-the-services-docker-composeyml-explained)
8. [The two identities: who does what](#8-the-two-identities-who-does-what)
9. [Host needs, backups and monitoring](#9-host-needs-backups-and-monitoring)
10. [Go-live checklist and the production test](#10-go-live-checklist-and-the-production-test)
11. [Troubleshooting](#11-troubleshooting)
12. [Updates, secret rotation and rollback](#12-updates-secret-rotation-and-rollback)
13. [Moving to a shared mediator later](#13-moving-to-a-shared-mediator-later)
14. [Known gaps](#14-known-gaps)

## 1. What the gateway is, and the terms used here

Keyring is a wallet app for phones. Each person using it has an **agent**: a
server-side service that acts for them. Sometimes the agent needs the person,
for example to approve a request. If the app is closed, the agent can't reach
it. The gateway solves that one problem: it is a **doorbell**. The agent rings
it, the phone shows a notification, and the person opens Keyring, which then
fetches the actual request from the agent directly.

```
                ┌──────────────── one-time registration (HTTPS) ────────────────┐
                │  phone → gateway: "here is my push token" → gateway: "your handle is H"
                │  phone → agent:   "wake me at gateway G, handle H"             │
                ▼                                                                │
  ┌────────┐ signed push/wake ┌──────────┐ relay ┌──────────────┐ ┌─────────┐ APNs/FCM ┌───────┐
  │ agent  │ ────────────────▶│ agent's  │──────▶│ gateway's    │▶│ gateway │────────▶ │ phone │
  │ (VTA)  │  (DIDComm/TSP)   │ mediator │       │ mediator     │ │         │"some-    │       │
  └────────┘                  └──────────┘       └──────────────┘ └─────────┘ thing is └───┬───┘
                                                  (this package: both boxes)  waiting"    │
       ▲                                                                        │
       └──────────── the phone opens Keyring and fetches the real request ──────┘
                         directly from its agent, over its own encrypted channel
```

### Terms

| Term | Meaning here |
| --- | --- |
| **APNs / FCM** | Apple Push Notification service and Firebase Cloud Messaging: Apple's and Google's services that deliver notifications to phones. Sending through them needs the app publisher's credentials, which is why this gateway exists |
| **Push token** | An address Apple or Google gives the app on one phone. With it and the publisher's credentials, anyone can notify that phone |
| **Handle** | A random string the gateway gives the phone in exchange for its push token. The agent only ever sees the handle, never the token |
| **DID** | Decentralized Identifier: a string such as `did:webvh:…` that names a party. Resolving it gives a small JSON *DID document* listing the party's public keys and how to reach it. Every party here (each agent, the gateway, the mediator) has one |
| **`did:webvh`** | A kind of DID whose document is published as a file on an ordinary web server (a **DID host**), with a signed history of changes. Resolving it is an HTTPS fetch from that host |
| **VTA** | Verifiable Trust Agent: the server software each person's agent runs on (from OpenVTC's open-source *VTI*, Verifiable Trust Infrastructure). A VTA also *issues* identities to services such as this gateway (§8). It has admins, who run commands against it with `pnm`, its command-line tool |
| **DIDComm v2** | A messaging protocol between DIDs: each message is encrypted to the recipient's DID keys and signed by the sender's |
| **Mediator** | A DIDComm v2 relay: a mailbox server that holds messages for a DID until that DID connects and collects them. Mediators also relay messages to each other. This package bundles one (Affinidi's, the kind the VTI stack runs) that serves only the gateway: agents' mediators relay wake-ups to it, and the gateway collects them over a connection it opens *out*, so the gateway itself opens no port for agents |
| **TSP** | Trust Spanning Protocol: a second protocol for sending signed and encrypted messages between DIDs. The gateway accepts wakes over both TSP and DIDComm, through the same mediator. A `TSPTransport` entry in its DID document tells agents how to reach it over TSP |
| **Trust Task** | A small signed JSON document naming one operation, such as `push/register`, `push/provision` or `push/wake`. The gateway's whole interface is three Trust Tasks |
| **Controller / allowlist** | The agent a handle belongs to is its *controller*. The allowlist (`GATEWAY_ALLOWED_CONTROLLERS`) names the agents the gateway serves |

### What it holds, sends and does

**It holds:**
- Keyring's Apple (APNs) and Google (FCM) push credentials;
- the phones' push tokens, each behind a handle.

**It sends** a push with **no content**. Apple and Google see that a Keyring
push went to a phone at a certain time, and nothing else. The phone shows one
fixed line from its own strings ("Something is waiting for you in Keyring."),
then gets the actual request from its agent.

**It doesn't:**
- carry messages;
- hold user data beyond push tokens;
- replace Keyring's mailbox, the mediator the app itself uses.

**Who may use it.** The three Trust Tasks, in order:
1. **`push/register`**: a phone registers itself over HTTPS, anonymously and
   rate-limited, and gets a handle. It must name an agent the gateway serves.
2. **`push/provision`**: only that agent may then say which agents are allowed
   to wake the handle. Normally that is just itself.
3. **`push/wake`**: only agents on that list may wake it.

Steps 2 and 3 must be documents signed by the agent's own DID key (a Data
Integrity proof, `eddsa-jcs-2022`, purpose `authentication`). How a message
arrived never authorises anything.

**How it's reached:**
- **Phones reach it over HTTPS.** That is the only inbound traffic.
- **Agents reach it through the bundled mediator.** An agent sends a wake-up
  to its own mediator, which relays it over HTTPS to the gateway's mediator.
  The gateway collects it there. So the gateway's mediator needs its own public
  HTTPS hostname, and the agents' mediators must be allowed to relay to other
  mediators (§3).

**You're done with this section when** you can say what the gateway stores
(credentials, and tokens behind handles), what it sends (a push with no
content), and how each side reaches it (phones by HTTPS, agents through their
mediator and then the bundled one).

## 2. What we send you, and who to ask

The project lead is your contact for everything below.

| What | How it reaches you |
| --- | --- |
| The APNs auth key (`.p8` file), its key ID and the Apple team ID | Privately, from the project lead |
| The FCM service-account key (`.json` file) | Privately, from the project lead |
| The package folder, and a current image or CI run ID (§4) | A link to the branch, or a tarball plus the image file |
| The decisions in §3 | Agreed with the project lead before you start |
| The identity approval (§8, step 2) | You send `request.json`. The VTA admin sends back `bundle.armor`, and the digest by a separate channel |
| The test agent's DID, for the allowlist during the production test | From us, before the test |
| The production test (§10) | Scheduled with you once the checklist's first steps pass |

**You're done with this section when** you have the two key files, the key
and team IDs, and the package, and you know who the VTA admin and the
mediator admin are.

## 3. Decisions to settle first

Settle these with the project lead before §5. The package works either way;
they change which values go into `.env` and who runs §8.

| Decision | What it means | Recommendation |
| --- | --- | --- |
| **Which VTA issues the gateway's identity** | An admin of that VTA runs §8 step 2 | The VTA service that hosts Keyring's agents in production. Its admin runs step 2 (the project lead, or that service's operator), so you don't need to run a VTA yourself |
| **Which DID host (`WEBVH_SERVER`)** | Where the gateway's `did:webvh` document is published. Anyone resolving the gateway's DID fetches it from there | The DID host that VTA already publishes its own DIDs on |
| **Whether the production agents' mediator relays** | A wake-up leaves the agent's own mediator as a relay to the bundled one, and the gateway's reply comes back the same way. That mediator must relay to other mediators and accept relays from them | Nothing for you to set. The project checks that mediator's configuration once it is known (§14); the VTI lab's does both |
| **Which agents it serves (`GATEWAY_ALLOWED_CONTROLLERS`)** | An exact list of agent DIDs, or `*` for any agent. More below | **Still an open question**, for you and the project lead. We recommend `*` for production, for the reason below |

**The allowlist, in more detail.** The setting is required: unset means every
registration is refused.

| Option | What it means | Limits |
| --- | --- | --- |
| **An exact list** of agent DIDs | Only those agents' phones can register or be woken. No wildcards or patterns, by upstream's design | Every new person's agent means a configuration change and a restart |
| **`*` (open mode)** | Any agent may register phones | The gateway logs a warning at startup. The bounds still hold: at most 4096 live handles per agent, a handle no agent provisions is dropped after 1 hour, and per-sender and per-handle budgets apply |

Why we recommend `*`: each Keyring user has their own agent, so an exact list
would need a change and a restart for every new user. Open mode still lets an
agent wake only the phones that registered with it and that it provisioned,
and the limits above still apply. For the production test the list is just
our test agent's DID, either way.

The mediator itself is not a decision: the package bundles it (§7), and you run
it. It may move to a shared mediator later (§13).

**You're done with this section when** you have, in writing:
- the issuing VTA and its admin;
- the DID host's id;
- the allowlist choice for production.

## 4. Getting the package and the image

**The package** is the folder `deploy/keyring-messaging/` in the public
repository `berkmancenter/keyring-wallet`. It isn't on `main` yet: it lives on
the branch `deploy/push-gateway-test` (draft pull request #241). Either clone
that branch, which needs no GitHub access rights:

```sh
git clone -b deploy/push-gateway-test https://github.com/berkmancenter/keyring-wallet.git
cd keyring-wallet/deploy/keyring-messaging
```

or ask the project lead for a tarball of the folder. It contains:

| Path | What it is |
| --- | --- |
| `docker-compose.yml` | The two services (§7) |
| `Caddyfile` | The HTTPS proxy's one site |
| `.env.example` | The settings template (§6) |
| `gateway/Dockerfile`, `gateway/entrypoint.sh` | Builds the gateway from upstream source at a pinned commit, with our patch |
| `gateway/patches/0001-…visible-alert…patch` | Our one patch (below) |
| `mediator/Dockerfile` | Builds the mediator from upstream source at a pinned commit |
| `mediator/mediator.toml` | The mediator's settings (§7) |
| `mediator/setup-identity.sh`, `mediator/mediator-build.toml` | Create the mediator's own identity (§8) |
| `tools/gateway-identity/` | A small Rust tool that writes the gateway's identity file (§8) |
| `README.md` | A shorter operator reference |

**The image.** The gateway is OpenVTC's
[`vti-push-gateway`](https://github.com/OpenVTC/vti-push-gateway), pinned at
commit **`e542a9d77a7369f4f3da01d573107ea155c80691`**, plus one patch of ours.
Upstream publishes no image, so there are two ways to get one:

| Way | How |
| --- | --- |
| **Download the CI build (preferred)** | The `push-gateway-image` workflow builds the image on GitHub runners for `amd64` and `arm64`. It runs the gateway's own test suite with our patch applied, then uploads each image as a run artifact. Nothing is pushed to a registry. Anyone logged in to GitHub can download it (the repository is public), but **artifacts are kept for 14 days only**, so ask the project lead for a current run's ID, or for the image file itself. |
| **Build it yourself** | `docker compose build gateway` in the package folder. It is a multi-stage Rust build, needing about 4 GB of RAM and several minutes. It fetches the pinned commit, checks it is exactly that commit, and applies `gateway/patches/*.patch`; the build fails if a patch no longer applies. |

To load a CI build (`gh` is GitHub's CLI, logged in with `gh auth login`; pick
`amd64` for most servers):

```sh
gh run download <run-id> -R berkmancenter/keyring-wallet -n vti-push-gateway-image-amd64
docker load -i vti-push-gateway.tar
docker image ls keyring-messaging/vti-push-gateway
```

Expected: `docker load` prints
`Loaded image: keyring-messaging/vti-push-gateway:e542a9d77a7369f4f3da01d573107ea155c80691`,
and `docker image ls` lists that tag.

**Why the patch exists.** Upstream sends every wake as a *silent* background
push. On iPhone, Apple throttles those ("don't try to send more than two or
three per hour") and drops them after a force-quit ("If something force quits
or kills the app, the system discards the held notification"). An approval
can't depend on that.

With `GATEWAY_ALERT_LOC_KEY` set, the patch sends an **interactive** wake as a
visible notification that the phone's system displays itself:
- APNs `alert`, priority 10, `loc-key`, collapse ID;
- FCM notification message, `body_loc_key`, collapse key.

Background wakes stay silent. The payload names a localisation key, never text.
The patch is self-contained, with its own tests, and is a candidate for
contributing upstream (tracked as CONTRIB-01). It hasn't been submitted; the
project does that itself, so please don't open anything upstream.

**The mediator's image** is Affinidi's `affinidi-messaging-mediator` v0.33.1,
commit **`555806151b30a4ba2085a29384c8e048307e0083`**: the release our lab
runs, and the one the iPhone test went through. Affinidi's newest published
image is far older, so it is built from source the same two ways:
- the same workflow uploads `messaging-mediator-image-amd64` and `-arm64`
  (14 days), which you load with `docker load -i messaging-mediator.tar`;
- or `docker compose build mediator` (a large Rust build: allow 8 GB of RAM
  and 20 minutes or more).

**You're done with this section when** `docker image ls | grep keyring-messaging`
lists `vti-push-gateway:e542a9d7…` and `messaging-mediator:55580615…` on the
server.

## 5. From zero: a fresh server to a running gateway

This walkthrough assumes a fresh **Ubuntu 24.04 LTS** VM with a public IP and
`sudo`. Any Linux with Docker Engine and Compose v2 works; only step 1 differs.
With the CI image the VM needs little, since the gateway is one small Rust
process. Building the image on the VM instead needs about 4 GB of RAM.
Throughout, replace `push.example.org` with your hostname.

**1. Install Docker Engine and the Compose plugin**, using Docker's documented
apt method:

```sh
sudo apt-get update
sudo apt-get install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo docker run --rm hello-world
sudo docker compose version
```

Expected: `Hello from Docker!`, then `Docker Compose version v2.…`.

**2. Open the firewall.** Allow inbound TCP 80 and 443 and UDP 443 (for
HTTP/3), plus SSH for yourself. Nothing else is inbound, because DIDComm is
outbound to the mediator. With `ufw`:

```sh
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp && sudo ufw allow 443/tcp && sudo ufw allow 443/udp
sudo ufw enable
sudo ufw status
```

Expected: `Status: active`, with `OpenSSH`, `80/tcp`, `443/tcp` and `443/udp`
set to `ALLOW`. Open the same ports in the cloud provider's firewall or
security group, if it has one. Outbound access is listed in §9.

**3. Point DNS at the server.** Create an A record for each of the two
hostnames, and AAAA records if the VM has IPv6: one for the gateway
(`push.example.org` here) and one for its mediator (`mediator.example.org`). Do
this **before** the first start: Caddy asks Let's Encrypt for both certificates
on boot, and that fails until the names resolve to this server.

```sh
dig +short push.example.org
dig +short mediator.example.org
```

Expected: this server's public IP, twice.

**4. Get the package** (§4) into `/opt`:

```sh
sudo git clone -b deploy/push-gateway-test https://github.com/berkmancenter/keyring-wallet.git /opt/keyring-wallet
sudo ln -s /opt/keyring-wallet/deploy/keyring-messaging /opt/keyring-messaging
cd /opt/keyring-messaging && ls
```

Expected: `Caddyfile  HANDOVER.md  README.md  docker-compose.yml  gateway  tools`
(and `.env.example`, which `ls -a` shows).

**5. Get the images** (§4). Either `sudo docker load -i vti-push-gateway.tar`
and `sudo docker load -i messaging-mediator.tar` with the CI artifacts, or
`sudo docker compose build gateway mediator`.

**6. First boot, without credentials.** This checks DNS, TLS and the proxy
before any secret is on the machine. It uses the gateway's *echo sender*,
which accepts registrations, logs wakes and delivers nothing.

```sh
sudo cp .env.example .env
sudo mkdir -p data/gateway secrets
sudo chown -R 10001:10001 data/gateway secrets
sudo chmod 700 data/gateway secrets
sudo nano .env
#   GATEWAY_HOST=push.example.org
#   MEDIATOR_HOST=mediator.example.org
#   GATEWAY_DEV_ECHO_SENDER=1
#   GATEWAY_ALLOWED_CONTROLLERS=did:example:first-run-check
sudo docker compose config >/dev/null && echo config-ok
sudo docker compose up -d gateway caddy     # the mediator comes in step 8
sleep 30; sudo docker compose ps
curl -fsS https://push.example.org/healthz; echo
```

Expected:
- `config-ok`;
- `docker compose ps` lists `keyring-messaging-gateway-1` as `Up … (healthy)`
  and `keyring-messaging-caddy-1` as `Up`;
- the `curl` prints `ok`.

If the `curl` fails with a TLS error, give Caddy a minute to get its
certificate, and check `sudo docker compose logs caddy` (§11).

Then check that the allowlist is enforced. First, register naming the listed
agent:

```sh
curl -s https://push.example.org/trust-tasks -H 'content-type: application/json' -d '{
  "id":"urn:uuid:00000000-0000-4000-8000-000000000001",
  "type":"https://trusttasks.org/spec/push/register/0.2",
  "payload":{"registration":{"platform":"fcm","token":"first-run-test"},
             "controllerVtaDid":"did:example:first-run-check"}}'; echo
```

Expected: a JSON document whose payload holds a `handle` (a random string).
Now send it again with `"controllerVtaDid":"did:example:someone-else"` and a
new `id` (change the last digit). Expected: a rejection whose code is
`permissionDenied`.

**7. Place the real secrets.** Put the files from the project lead (§2) in
`secrets/` and set the permissions. The gateway runs as uid 10001 and refuses
to start if a secret is readable by anyone else:

```sh
sudo cp AuthKey_<KEYID>.p8 fcm-service-account.json /opt/keyring-messaging/secrets/
sudo chown -R 10001:10001 secrets data/gateway
sudo chmod 700 secrets data/gateway && sudo chmod 600 secrets/*
sudo ls -ln secrets
```

Expected: each file shows `-rw-------` and owner `10001 10001`.

**8. Create the mediator's identity and start it** (§8, part A). The result:
- `MEDIATOR_DID` and `MEDIATOR_ADMIN_DID` in `.env`;
- the mediator running and healthy;
- its login endpoint refused from outside.

**9. Create the gateway's identity** (§8, part B), naming the mediator's DID.
The result is `secrets/gateway-identity.json`.

**10. Fill in `.env` for real** (§6). Clear `GATEWAY_DEV_ECHO_SENDER`, and set
the Apple, Google, identity and allowlist values. Then run:

```sh
sudo docker compose up -d
sleep 20; sudo docker compose logs --tail 80 gateway
```

**11. Verify.** Work through the go-live checklist in §10. Its startup lines
tell you each part is configured. If a line is missing or an error appears,
see §11.

**You're done with this section when**:
- `https://push.example.org/healthz` returns `ok`;
- `sudo docker compose ps` shows the gateway and mediator `healthy`;
- the log shows every line in §10 step 3;
- the echo-sender warning is gone.

## 6. The settings (`.env`), annotated

`docker compose` reads `.env` from the package folder. Nothing in `.env` is a
secret value. The secrets are files in `./secrets/`, which appear inside the
container at `/run/secrets/gateway/`, and `.env` only names their paths. Here
is the full file with the values production needs; `<…>` marks what you fill
in.

```sh
###############################################################################
# Hostname and ports
###############################################################################

# Public hostname, no scheme. Needs a DNS A/AAAA record pointing at this
# server before the first start (Caddy gets its certificate on boot).
GATEWAY_HOST=<push.example.org>

# https = Caddy gets and renews a Let's Encrypt certificate itself.
# (http is only for a local run, or behind a tunnel that terminates TLS.)
SITE_SCHEME=https

# The mediator's public hostname, no scheme. Its own DNS record pointing here.
# Agents' mediators relay wake-ups to https://<this>/mediator/v1/inbound.
MEDIATOR_HOST=<mediator.example.org>

# Host ports Caddy publishes. Keep 80/443 on a server: the certificate
# challenge needs port 80.
HTTP_PORT=80
HTTPS_PORT=443

###############################################################################
# Push gateway (OpenVTC/vti-push-gateway)
###############################################################################

# The upstream commit the image is built from, which is also the image tag.
# Change it only as part of an update the project gives you (§12).
GATEWAY_COMMIT=e542a9d77a7369f4f3da01d573107ea155c80691

# Which agents the gateway serves: exact DIDs separated by commas or spaces,
# or * for any agent (§3). Unset or empty = every phone registration is
# refused.
GATEWAY_ALLOWED_CONTROLLERS=<the test agent's DID, for the production test>

# The gateway's identity file (§8), as a path INSIDE the container.
# Blank = HTTPS-only: phones can register, but no agent can reach the
# gateway, so nothing is ever provisioned or woken.
GATEWAY_IDENTITY_FILE=/run/secrets/gateway/gateway-identity.json

# Apple: the auth key file, its Key ID and the team ID (§2). Set all three,
# or none (APNs off). The two IDs are not secret; the .p8 is.
# Sandbox or production is chosen per registration by the app, not here.
GATEWAY_APNS_KEY_FILE=/run/secrets/gateway/AuthKey_<KEYID>.p8
GATEWAY_APNS_KEY_ID=<KEYID>
GATEWAY_APNS_TEAM_ID=<TEAMID>

# The app bundle IDs registrations may name, comma-separated. A registration
# naming any other is refused. The test app only, until the production test
# passes; then add the release app (§10).
GATEWAY_APNS_TOPICS=asml.bkc.harvard.wallet.pushtest

# Google: the service-account key file. Blank = FCM off.
GATEWAY_FCM_SERVICE_ACCOUNT_FILE=/run/secrets/gateway/fcm-service-account.json

# Visible alert mode (our patch): an interactive wake (an approval waiting) is
# shown by the phone's system as a notification, using the app's own string
# for this key, in the phone's language. Background wakes stay silent.
# Blank = every wake silent (upstream behaviour).
GATEWAY_ALERT_LOC_KEY=KEYRING_WAKE
GATEWAY_ALERT_TITLE_LOC_KEY=
# Repeated wakes replace each other on the phone instead of stacking up.
GATEWAY_ALERT_COLLAPSE_ID=keyring-wake
GATEWAY_FCM_ANDROID_CHANNEL_ID=

# 1 = refuse to start when a secret file is readable beyond its owner
# (uid 10001 in the container). Keep it at 1.
GATEWAY_STRICT_KEY_PERMS=1

# Dev echo sender: logs wakes and delivers NOTHING, yet reports them
# delivered. Only for the first boot (§5 step 6). MUST be blank in production.
GATEWAY_DEV_ECHO_SENDER=

# Rate limit on POST /trust-tasks, per client IP. Behind Caddy every phone
# shares Caddy's address, so this is a global limit in practice; upstream's
# default (10/s, burst 40) is too low for that.
GATEWAY_HTTP_PER_SEC=100
GATEWAY_HTTP_BURST=400

# Log filter. Blank = vti_push_gateway=info,tower_http=info
GATEWAY_LOG=

###############################################################################
# Mediator (Affinidi messaging mediator)
###############################################################################

# The upstream commit the mediator image is built from, which is also its tag:
# affinidi-messaging-mediator v0.33.1. Change it only as part of an update the
# project gives you (§12).
MEDIATOR_COMMIT=555806151b30a4ba2085a29384c8e048307e0083

# The mediator's own DID (did:peer:2…) and its admin DID (did:key:…), without a
# did:// prefix. mediator/setup-identity.sh creates both and prints these lines
# (§8, part A).
MEDIATOR_DID=<did:peer:2…>
MEDIATOR_ADMIN_DID=<did:key:…>
```

Blank values are fine: the image's entrypoint unsets every empty `GATEWAY_*`
variable, so the gateway sees only what you filled in. Changing `.env` takes
effect with `sudo docker compose up -d`, which recreates the container.

**You're done with this section when**:
- no `<…>` placeholder is left in `.env`;
- `GATEWAY_DEV_ECHO_SENDER` is blank;
- `sudo docker compose config >/dev/null` exits without an error.

## 7. The services (`docker-compose.yml`), explained

The compose project is called `keyring-messaging`. It has four services on two
private networks, and **only Caddy publishes ports**:
- `edge`, which has outbound internet, carries the gateway, the mediator and
  Caddy;
- `store` has no route out at all, and carries only the mediator and Redis.

**`gateway`**: `vti-push-gateway`.
- **Image:** `keyring-messaging/vti-push-gateway:<GATEWAY_COMMIT>`, loaded or
  built as in §4.
- **Listens:** on port 8300, reachable only from Caddy on the `edge` network.
  Prometheus metrics listen on `127.0.0.1:9300` inside its own container, so
  nothing outside the container can reach them.
- **Settings:** all come from `.env` (§6). The compose file fixes a few itself:
  - the store file is `/data/gateway-store.json`;
  - the metrics bind is `127.0.0.1:9300`;
  - the log filter comes from `GATEWAY_LOG`.
- **Volumes:**
  - `./data/gateway` → `/data`, read-write: the handle registry. It holds
    phones' push tokens in clear text (§9).
  - `./secrets` → `/run/secrets/gateway`, read-only: the APNs key, FCM key and
    identity file.
- **Health check:** `GET /healthz` inside the container every 15 s.
  `docker compose ps` shows `healthy` once it passes.
- **Restart policy:** `unless-stopped`. A gateway that exits on a
  configuration error restarts in a loop, which shows in `docker compose ps`
  (§11).
- **Watchtower:** labelled so it never auto-updates. Updates are deliberate
  (§12).

**`mediator`**: Affinidi's messaging mediator, the gateway's post office.
- **Image:** `keyring-messaging/messaging-mediator:<MEDIATOR_COMMIT>`, loaded
  or built as in §4.
- **Listens:** on port 7037, reachable only from Caddy.
- **Settings:** `mediator/mediator.toml`, mounted read-only. These are our
  lab mediator's settings, with two relay changes:
  - it accepts relays from other mediators explicitly
    (`enable_inter_mediator_relay = "true"`);
  - it knows its own public URL (`LOCAL_ENDPOINTS`, from `MEDIATOR_HOST`), so
    it delivers messages for itself locally instead of relaying them to
    itself.

  Its identity (`MEDIATOR_DID`, `ADMIN_DID`) and Redis address come from the
  environment.
- **Who may use it:**
  - Anyone may relay a message in, on `/mediator/v1/inbound`. That is how
    agents' mediators deliver wake-ups.
  - Only the gateway can log in. Caddy refuses the login endpoint
    (`/mediator/v1/authenticate…`) from public addresses. Inside the stack,
    `MEDIATOR_HOST` resolves to Caddy itself (a network alias), so the gateway
    logs in from a private address.
  - Without a login, nobody can collect messages or send through it.
- **Volumes:** `./secrets/mediator` → `/run/secrets/mediator`, read-only. It
  holds the mediator's keys, owned by uid 10002.
- **Health check:** `GET /mediator/v1/livez` every 15 s.

**`redis`**: the mediator's store (Redis 7.4, pinned by digest).
- **Holds:** messages waiting for the gateway, sessions and accounts. It
  persists to `./data/redis` (append-only file).
- **Network:** `store` only, so nothing but the mediator can reach it.

**`caddy`**: the HTTPS proxy.
- **Image:** `caddy:2.11.4-alpine`, pinned by digest.
- **Publishes:** `HTTP_PORT` → 80, and `HTTPS_PORT` → 443 on both TCP and UDP.
- **Certificates:** gets and renews Let's Encrypt certificates for
  `GATEWAY_HOST` and `MEDIATOR_HOST`.
- **Routing:**
  - `GATEWAY_HOST` goes to `gateway:8300`, except `/metrics`, which answers
    404.
  - `MEDIATOR_HOST` goes to `mediator:7037`, WebSockets included. Its login
    endpoint answers 403 to public addresses.
- **Network alias:** `MEDIATOR_HOST`, on `edge`.
- **Volumes:**
  - `./Caddyfile`, read-only;
  - `./data/caddy/data` and `./data/caddy/config`, for certificates and
    ACME state.
- **Expiry notices:** no ACME contact email is set. To get certificate expiry
  notices, add a global block, `{ email ops@example.org }`, at the top of
  `Caddyfile`.

What the gateway serves publicly:

| Path | Who calls it |
| --- | --- |
| `https://GATEWAY_HOST/trust-tasks` (POST) | Phones: `push/register` |
| `https://GATEWAY_HOST/healthz` | You, and your monitoring |
| `https://MEDIATOR_HOST/mediator/v1/inbound` | Agents' mediators, relaying wake-ups |
| `https://MEDIATOR_HOST/mediator/v1/livez`, `…/readyz` | You, and your monitoring |
| `https://MEDIATOR_HOST/mediator/v1/authenticate…`, `wss://MEDIATOR_HOST/mediator/v1/ws` | The gateway only, from inside the stack |

Agents never call the gateway over HTTPS. Their `push/provision` and
`push/wake` arrive through the mediator.

**You're done with this section when**:
- `sudo docker compose ps` shows the gateway and mediator `healthy`, and Redis
  and Caddy `Up`;
- `curl -s -o /dev/null -w '%{http_code}\n' https://push.example.org/metrics`
  prints `404`;
- `curl -s -o /dev/null -w '%{http_code}\n' -X POST https://mediator.example.org/mediator/v1/authenticate/challenge`
  prints `403`.

## 8. The two identities: who does what

The mediator and the gateway each have their own DID. The mediator's comes
first, because the gateway's DID document names it.

### Part A: the mediator's identity (you, 5 minutes)

The mediator's DID is a self-contained `did:peer:2`. Its document is encoded
in the DID string itself, so it needs no DID host and no VTA. It names the
mediator's keys and its URLs on `MEDIATOR_HOST`. Upstream's `mediator-setup`
tool creates it, and `mediator/setup-identity.sh` runs that tool for you:

```sh
cd /opt/keyring-messaging
grep ^MEDIATOR_HOST= .env                  # must be your mediator hostname
sudo ./mediator/setup-identity.sh
```

Expected: the tool's own output, then:

```
Mediator identity created. Put these two lines in .env:

MEDIATOR_DID=did:peer:2.Vz6Mk…
MEDIATOR_ADMIN_DID=did:key:z6Mk…
```

It also writes `secrets/mediator/mediator-secrets.json`, the mediator's
private keys, and `secrets/mediator/admin-monitor.json`, its admin identity for
upstream's `mediator-console`. Both are owned by uid 10002, mode 0600. It
refuses to run a second time: a new mediator identity means a new gateway
identity too.

Copy the two lines into `.env`, then start the mediator and check it:

```sh
sudo docker compose up -d mediator
sleep 20; sudo docker compose ps mediator redis
curl -fsS https://mediator.example.org/mediator/v1/livez; echo
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://mediator.example.org/mediator/v1/authenticate/challenge
```

Expected:
- the mediator is `healthy` and Redis is `Up`;
- `livez` answers;
- the login endpoint prints `403`, because only the gateway may log in.

The hostname in the DID is fixed. Changing `MEDIATOR_HOST` later means a new
mediator DID, and with it a new gateway identity, so pick the hostname you'll
keep.

### Part B: the gateway's identity

The gateway has its own `did:webvh`. Agents address their wake-ups to it, and
it receives them through the mediator it connects **out** to. The identity is
an "integration" that a VTA issues from its built-in `push-gateway` DID
template (§3 decides which VTA). The result is one JSON file holding:
- the gateway's DID;
- its two private keys, one for signing and one for decrypting;
- the mediator's DID.

The gateway reads it through `GATEWAY_IDENTITY_FILE`.

**Tools.** Both are Rust command-line tools; building them needs Rust 1.95 or
later (install it with [rustup](https://rustup.rs)). Run steps 1 and 3 on the
server itself, or on a trusted machine you then copy the identity file from.
- `pnm` (the VTA's command-line tool), from OpenVTC's
  [`verifiable-trust-infrastructure`](https://github.com/OpenVTC/verifiable-trust-infrastructure).
  Build it from the same release the issuing VTA runs; ask its admin which one.
  ```sh
  git clone https://github.com/OpenVTC/verifiable-trust-infrastructure.git && cd verifiable-trust-infrastructure
  git checkout <the release the VTA admin names>
  cargo build --package pnm-cli --release     # → target/release/pnm
  ```
- `gateway-identity`, in this package:
  ```sh
  cd tools/gateway-identity && cargo build --release   # → target/release/gateway-identity
  ```

| Step | Who | Where | Result |
| --- | --- | --- | --- |
| 1. Request | **You** | Your machine | `request.json`. The one-time seed stays with you |
| 2. Approve | **The issuing VTA's admin** | Their machine | `bundle.armor`, and a digest |
| 3. Open | **You** | Your machine | `gateway-identity.json` |
| 4. Install | **You** | The server | The gateway starts with its DID |

In every command below, `<the mediator's DID>` is `MEDIATOR_DID` from `.env`
(Part A), the whole `did:peer:2…` string.

**Step 1, request (you).**

```sh
pnm bootstrap provision-request --template push-gateway \
  --var URL=<the mediator's DID> \
  --var SERVICE_TSP='{"id":"{DID}#tsp","type":"TSPTransport","serviceEndpoint":"<the mediator's DID>"}' \
  --var WEBVH_SERVER=<the DID host's id> \
  --context-hint push-gateway
```

- `URL` is the **mediator's DID**, because the gateway is reached through it.
- `SERVICE_TSP` adds the TSP entry the gateway checks for at startup. Type
  `{DID}` literally: the VTA fills it in.
- `WEBVH_SERVER` is the DID host's id as the issuing VTA knows it; its admin
  tells you the value.

Expected: `Provision bootstrap request written to …` and `Seed saved: …`.
The seed is a one-time key under pnm's config directory, at
`bootstrap-secrets/<bundle-id>.key`. Back up the seed now, because it is the only way to open the bundle:

```sh
cp <pnm config dir>/bootstrap-secrets/<bundle-id>.key ./seed-backup.key
```

Send `request.json` to the VTA's admin. It holds no secret: the seed never
leaves your machine.

**Step 2, approve (the VTA's admin).**

```sh
pnm --vta <vta> bootstrap provision-integration --request request.json \
  --context push-gateway --create-context --out bundle.armor
```

Expected: the VTA mints the gateway's DID, then pnm prints a SHA-256
**digest** (64 hex characters) and writes a sealed `bundle.armor`, which only
your seed can open. The admin sends you both, the digest by a different
channel than the bundle (a message, or read out on a call). Checking it proves
the bundle is the one they made.

**Step 3, open (you).**

```sh
./target/release/gateway-identity --bundle bundle.armor --seed <bundle-id>.key \
  --digest <digest from step 2> --mediator <the mediator's DID> \
  --out gateway-identity.json
```

Expected: `wrote gateway-identity.json (0600)`, then the gateway's `did:`,
its two key IDs and the mediator, and `The seed and the bundle were not
modified.` It never deletes the seed
or the bundle, and never prints a private key. The file looks like this:

```jsonc
{ "did": "did:webvh:…",
  "signing":      { "id": "did:webvh:…#key-0", "privateKeyMultibase": "z…" },
  "keyAgreement": { "id": "did:webvh:…#key-1", "privateKeyMultibase": "z…" },
  "mediator": "did:…(the mediator)" }
```

> **Do not run `pnm bootstrap open` on this bundle.** For this bundle type it
> prints a summary, writes nothing, and **deletes the one-time seed first**. The
> gateway's keys are then gone for good, and you'd have to start over from
> step 1. No upstream tool writes the gateway's identity file (tracked as
> finding VTI-53), which is why `tools/gateway-identity` exists. It opens the
> bundle with the VTA SDK's documented `open_bundle`.

There is no mediator account to create: the gateway registers itself the first
time it logs in to the bundled mediator.

**Step 4, install (you).**

```sh
sudo install -o 10001 -g 10001 -m 600 gateway-identity.json /opt/keyring-messaging/secrets/
# in .env: GATEWAY_IDENTITY_FILE=/run/secrets/gateway/gateway-identity.json
cd /opt/keyring-messaging && sudo docker compose up -d gateway
sleep 20; sudo docker compose logs --tail 80 gateway | grep -E 'mediator listener|TSPTransport'
```

Expected, two lines naming the gateway's DID and the mediator (your
`MEDIATOR_DID`):
- `mediator listener started (TSP and DIDComm)`;
- `DID document advertises TSPTransport`.

The identity file holds the gateway's private keys. Back it up with the other
secrets (§9). Then delete the working copies of the seed, the bundle and the
file from the machine where you ran steps 1–3, if that wasn't the server.

**You're done with this section when**:
- the mediator is healthy, and its login endpoint is refused from outside;
- the two gateway lines above appear;
- both identities are backed up (§9);
- you've sent the project lead the gateway's DID and the mediator's DID.

## 9. Host needs, backups and monitoring

- **Docker** with Compose v2.
- **Two public HTTPS hostnames** with DNS pointing at the host:
  - the gateway's, where phones register (`https://<gateway host>/trust-tasks`);
  - the mediator's, where agents' mediators relay wake-ups. It must be
    reachable from the internet, like the gateway's.
- **Inbound:** TCP 80 and 443, and UDP 443. That's all: there is **no inbound
  port for DIDComm**, which is outbound to the mediator.
- **Outbound HTTPS:**
  - `api.push.apple.com` and `api.sandbox.push.apple.com`;
  - `fcm.googleapis.com` and `oauth2.googleapis.com`;
  - Let's Encrypt (`acme-v02.api.letsencrypt.org`);
  - the agents' mediators (the gateway's replies are relayed to them);
  - the `did:webvh` hosts: the DID host of the gateway's own DID, and those of
    the agents it verifies.
- **A persistent volume** for `data/`:
  - `data/gateway` holds phones' push tokens **in clear text**, so protect it
    and its backups like credentials;
  - `data/redis` holds the mediator's queued messages and sessions.
- **Memory:** the running stack is small (both services are Rust). Building
  the mediator image on the host needs about 8 GB; loading the CI image
  needs nothing extra.

**Backups.** Treat all of these as credentials:

| What | Why |
| --- | --- |
| `data/gateway/gateway-store.json` | The handle registry, with raw push tokens in clear text. Copy it with its 0600 mode, encrypt the backup, and restrict who can read it |
| `secrets/` | The APNs key, the FCM key, the gateway identity, and in `secrets/mediator/` the mediator's keys and admin identity |
| `data/redis/` | Optional. Messages waiting for the gateway, and sessions. Losing it loses only wake-ups in flight at that moment |
| `.env` | The configuration: no secret values, but needed to restore |
| `data/caddy/` | Optional. Certificates are re-issued, but keeping them avoids Let's Encrypt rate limits |

Restore by putting back `.env`, `secrets/` and `data/gateway/`, owned by 10001
with the modes from §5, and `secrets/mediator/` owned by 10002. Then load the image and run `sudo docker compose up -d`.

Losing the store is survivable but disruptive. Every phone's handle is gone,
so wakes stop until each phone turns notifications off and on again in
Keyring. Losing the gateway's identity file means a new identity (§8). Agents then
refuse to wake the new DID, so every phone has to register again too. Losing
the mediator's keys means a new mediator DID, and so a new gateway identity as
well.

**Monitoring.**
- **Health:** `GET https://<gateway host>/healthz` returns `ok`, and
  `GET https://<mediator host>/mediator/v1/livez` answers. Both containers
  have their own health checks (`docker compose ps`), and
  `…/mediator/v1/readyz` reports the mediator's components, Redis included.
- **Metrics:** Prometheus text format on the container's loopback only. Read
  them with:
  ```sh
  sudo docker compose exec gateway curl -s http://127.0.0.1:9300/metrics
  ```
  The ones to watch:
  - `gateway_register_total`;
  - `gateway_provision_total{outcome=…}`;
  - `gateway_wake_total{outcome=delivered|transient_failure|token_unregistered|not_allowed}`.

  A rising `transient_failure` means Apple or Google are refusing; check the
  log (§11). `token_unregistered` is normal churn: an app deleted, or a token
  replaced.
- **Logs:** `sudo docker compose logs gateway`, `… logs mediator` (JSON lines),
  and `… logs caddy` for certificates. No message content is
  ever logged, because there is none.

**You're done with this section when**:
- a backup of the three items above exists off the server, encrypted;
- `/healthz` is in your monitoring;
- you can read the metrics.

## 10. Go-live checklist and the production test

1. Both images are loaded (§4), and `.env` and `secrets/` are in place
   (§6, §8), with owners 10001 (gateway) and 10002 (`secrets/mediator`) and
   modes 700/600.
2. DNS points both hostnames at the host, the firewall is open (§5), and
   `sudo docker compose up -d` brings up:
   - `https://<gateway host>/healthz` → `ok`;
   - `https://<mediator host>/mediator/v1/livez` answering;
   - the mediator's login endpoint refused from outside (`403`, §8 part A).
3. `sudo docker compose logs gateway` shows all of these:
   - `APNs sender enabled`, with the key and team IDs (compare them with the
     ones you were sent);
   - `FCM (Firebase Cloud Messaging) sender enabled`;
   - `visible alert mode: interactive wakes are shown as notifications`, with
     `loc_key=KEYRING_WAKE`;
   - `APNs topic allow-list`, naming the test app;
   - `controller allowlist` with `controllers=N listed`, or the open-mode
     warning if `*` was chosen (§3);
   - `mediator listener started (TSP and DIDComm)`, naming your
     `MEDIATOR_DID`;
   - `DID document advertises TSPTransport`.

   It shows **no** echo-sender warning, and no `ERROR` lines.
   `sudo docker compose logs mediator` shows no `ERROR` lines either.
4. Send us the gateway's URL, the gateway's DID and the mediator's DID. **The production test**, which we
   run with you:
   - We build Keyring's push-test app with `https://<host>` as its gateway, and
     install it on a test iPhone and a test Android phone.
   - Each phone links to our test agent (its DID is in your allowlist) and
     turns notifications on. `gateway_register_total` and
     `gateway_provision_total{outcome="ok"}` go up.
   - We trigger an approval request from the agent three times: with the app
     in the background, after a force-quit, and with the app open. Expected:
     the line appears in the first two cases and not in the third, and
     `gateway_wake_total{outcome="delivered"}` goes up each time.
5. After the test passes, add the release app's bundle ID to the topics and
   restart:
   ```sh
   # in .env: GATEWAY_APNS_TOPICS=asml.bkc.harvard.wallet.pushtest,asml.bkc.harvard.wallet
   sudo docker compose up -d gateway
   ```
   If you chose an exact allowlist, keep adding agents' DIDs as the project
   sends them. Keyring then ships a release pointing at this URL; when is the
   project's call. Push goes live for users only then.

**You're done when** the production test passes on both phones and the release
app's bundle ID is in `GATEWAY_APNS_TOPICS`. The gateway is then
production-ready.

## 11. Troubleshooting

Start with `sudo docker compose ps` and
`sudo docker compose logs --tail 100 gateway`. A **fatal** error makes the
gateway exit before it serves anything: the log ends in a line starting
`Error:`, the container shows `Restarting`, and `/healthz` fails. Everything
else is a `WARN` or `ERROR` line while the gateway keeps running.

**At startup: fatal (the container restarts in a loop)**

| Log says | Cause | Fix |
| --- | --- | --- |
| `read APNs auth key /run/secrets/gateway/…: No such file or directory` (likewise `read FCM service-account key …` or `read identity file …`) | The path in `.env` doesn't match a file in `secrets/` | Compare the file name in `secrets/` with the setting. The setting uses the in-container path `/run/secrets/gateway/<name>` |
| `read … : Permission denied` | The file isn't owned by uid 10001 | `sudo chown 10001:10001 secrets/*` |
| `… has mode 0644; GATEWAY_STRICT_KEY_PERMS requires owner-only permissions (chmod 600)` | The secret is readable by others | `sudo chmod 600 secrets/*` and `sudo chmod 700 secrets` |
| `parse identity file: …` | `GATEWAY_IDENTITY_FILE` points at the wrong file, such as the bundle or the seed | Point it at the output of `gateway-identity` (§8, step 3) |
| `egress policy: …` | A malformed `GATEWAY_APNS_TOPICS` value | Comma-separated bundle IDs, no wildcards |
| An error naming `GATEWAY_ALLOWED_CONTROLLERS` | A malformed allowlist | Exact DIDs separated by commas or spaces, or a lone `*` |
| `set GATEWAY_HOST in .env` or `set MEDIATOR_HOST in .env` (from `docker compose`, before anything starts) | `.env` is missing, or has no host | `sudo cp .env.example .env` and set both |

**The mediator**

| You see | Cause | Fix |
| --- | --- | --- |
| The mediator restarts in a loop, and its log names its DID or `did://` | `MEDIATOR_DID` or `MEDIATOR_ADMIN_DID` is blank or has a typo | Copy the two lines `setup-identity.sh` printed into `.env` exactly, without `did://` |
| The mediator restarts in a loop, and its log names the secrets file | `secrets/mediator/mediator-secrets.json` is missing, or not readable by uid 10002 | `sudo chown -R 10002:10002 secrets/mediator && sudo chmod 700 secrets/mediator && sudo chmod 600 secrets/mediator/*` |
| The mediator waits, or its `readyz` reports the database down | Redis isn't healthy | `sudo docker compose ps redis` and `… logs redis`; check `data/redis` is writable |
| `setup-identity.sh` says the identity exists | It refuses to replace the mediator's keys | Intended. To really start over, move `secrets/mediator/` aside first: this makes a new mediator DID, and so a new gateway identity (§8) |
| The login endpoint answers something other than `403` from outside | The Caddyfile's mediator site was changed, or a proxy in front of Caddy hides the caller's address | Restore the `@public_login` block. Behind another proxy, tell us: the rule relies on seeing public addresses |
| The gateway logs `mediator listener failed to start` and Caddy logs a `403` on `/mediator/v1/authenticate` | The gateway reached the mediator from a public address, bypassing the network alias | Check that Caddy has the `MEDIATOR_HOST` alias on `edge` (`sudo docker compose config`), and that the gateway is on `edge` |
| Agents' wake-ups never arrive; the mediator log shows a refusal on `/inbound` with an `authorization.…` code | The relay settings of the agents' mediator and ours disagree (for example `relay_mode`) | Send us the log lines and the time. `relay_mode` must be the same on both mediators |

**At startup: runs, but degraded**

| Log says | Cause | Fix |
| --- | --- | --- |
| `GATEWAY_APNS_KEY_FILE set but GATEWAY_APNS_KEY_ID / GATEWAY_APNS_TEAM_ID missing; APNs disabled` | One of the two IDs is blank | Fill both in `.env` |
| `APNs sender init failed; echo fallback` | The `.p8` file isn't a valid APNs key, for example a truncated copy | Get the file again from the project lead |
| `FCM sender init failed; echo fallback` | The service-account JSON is malformed or incomplete | Get the file again |
| `no push sender is configured — every push/register will be refused` | Neither APNs nor FCM is set | Fill in §6's Apple and Google settings |
| `GATEWAY_ALLOWED_CONTROLLERS is unset or empty — every push/register will be refused` | No allowlist | Set it (§3) |
| `GATEWAY_APNS_TOPICS not set` | Any iOS app could register | Set it to the test app's bundle ID |
| `GATEWAY_DEV_ECHO_SENDER is set — … Do not enable this in production.` | Left on from the first boot | Clear it and run `sudo docker compose up -d gateway`. While it's on, wakes are reported delivered and nothing is sent |
| `no GATEWAY_IDENTITY_FILE — TSP and DIDComm disabled, HTTPS-only` | No identity yet | Do §8. Until then phones can register, but nothing can be provisioned or woken |
| `mediator listener failed to start; HTTPS-only` | The gateway couldn't connect or log in to the mediator named in its identity file. The bundled mediator may be down, the network alias may be missing (see "The mediator" above), or the gateway's DID may not resolve | Check `sudo docker compose ps mediator`. Check the alias. Check that the DID resolves (next row) |
| `could not resolve the gateway's DID to check its TSPTransport service` | The DID host is unreachable from the server, or the DID isn't published there | Check outbound access to the DID host. Ask the VTA's admin whether the DID was published |
| `the gateway's DID document has no TSPTransport service …` | Step 1 ran without `SERVICE_TSP` | Agents can't find the gateway over TSP. Redo §8 with `SERVICE_TSP` set |
| `the gateway's TSPTransport service does not name the mediator it listens on` | `SERVICE_TSP` and `--mediator` named different mediators | Redo §8 part B with `MEDIATOR_DID` in all three places |

**While running**

| Log says, or you see | Cause | Fix |
| --- | --- | --- |
| `APNs rejected the wake` with `status=403` and `reason=InvalidProviderToken` | The key ID or team ID doesn't match the `.p8`, or the key was revoked | Compare the IDs in the `APNs sender enabled` line with what you were sent; ask the project lead |
| `APNs rejected the wake` with `reason=TopicDisallowed` or `BadTopic` | The key can't send for that bundle ID | Ask the project lead: the key must belong to the Apple team that owns the app |
| `gateway_wake_total{outcome="token_unregistered"}` rises for every iPhone | A sandbox token was sent to production, or the other way round. The app says which per registration, so this means a mismatched app build | Tell us, with the time |
| `FCM OAuth2 token exchange failed` | The service-account key was revoked or deleted in Google Cloud | Ask the project lead for a new key |
| `FCM rejected the wake` with `status=403` or `SENDER_ID_MISMATCH` | The service account lacks the *Firebase Cloud Messaging API Admin* role, or belongs to a different Firebase project than the app | Ask the project lead |
| `APNs send failed`, `FCM send failed` or `push send exceeded the wake timeout` | The network to Apple or Google | Check outbound access (§9). These count as `transient_failure`, and the agent retries |
| `refusing registration naming a controller this gateway does not serve` | A phone linked to an agent that isn't on the allowlist | Expected for strangers. For a real user, add their agent's DID, or use `*` (§3) |
| `rate limit exceeded; refusing the request` | More registrations than `GATEWAY_HTTP_PER_SEC`/`_BURST` allow | Raise them in `.env` |
| `refusing push/* document`, with a reason | An agent's `push/provision` or `push/wake` failed a check: its signature, the addressee, a replay, or not being allowed | One-offs are expected. A steady stream from one agent means that agent and the gateway disagree, often after an update (§12). Tell us, with the time |
| Caddy log: certificate errors, `NXDOMAIN`, or `timeout during connect` | DNS doesn't point here yet, or port 80 is closed | Fix DNS or the firewall. Caddy retries by itself |
| A phone shows nothing, but the wake shows `delivered` | Notifications are off for Keyring on the phone, or the app was open (by design, nothing shows then) | Check the phone's notification settings for Keyring |

If you're stuck, send the project lead the component (`gateway` or `caddy`),
the UTC time window, and the relevant log lines. Log lines contain DIDs and
handles, but no tokens or keys.

## 12. Updates, secret rotation and rollback

Nothing updates by itself. The gateway is pinned by commit, and Caddy, Rust
and Debian by tag and digest. **Don't move the gateway's upstream commit on
your own.** Its protocol has to match the agents it serves: authorisation
changed in upstream PR #32, and a gateway and an agent on opposite sides of
such a change can't talk to each other. When an update is due, the project
sends you:
- the updated package, with the new `GATEWAY_COMMIT` and a patch that applies
  to it;
- a CI image.

**Updating the gateway**

```sh
cd /opt/keyring-messaging
# 1. Record what runs now, and back up the store.
grep ^GATEWAY_COMMIT .env
sudo cp -p data/gateway/gateway-store.json data/gateway/gateway-store.json.pre-update
# 2. Get the new package and image (§4), then set the new GATEWAY_COMMIT in .env.
# 3. Recreate the gateway only; Caddy keeps serving.
sudo docker compose up -d gateway
sleep 20; sudo docker compose logs --tail 80 gateway   # the §10 step-3 lines again
curl -fsS https://push.example.org/healthz; echo
```

Keep the old image until the new one has run for a while: don't run
`docker image prune` yet.

**Rolling back**

```sh
# 1. Put the old GATEWAY_COMMIT back in .env (and the old package files, if they changed).
# 2. If the new version wrote the store, restore the backup.
sudo docker compose stop gateway
sudo cp -p data/gateway/gateway-store.json.pre-update data/gateway/gateway-store.json
# 3. Start the old image.
sudo docker compose up -d gateway
```

The old image is still loaded under its commit tag, so this takes seconds.
Registrations made between the update and the rollback are lost with the
restored store. Those phones register again when notifications are turned off
and on.

**Updating the mediator** works the same way, with `MEDIATOR_COMMIT` and the
mediator's image. Back up `data/redis/` first as well as the gateway's store,
and roll back by restoring both and the old commit. The mediator's DID and keys
don't change on an update.

**Updating Caddy.** Bump its tag and digest together in `docker-compose.yml`.
Read the digest with `docker buildx imagetools inspect caddy:<tag>`, then run
`sudo docker compose up -d caddy`. Roll back by restoring the old line.

**Changing settings.** Edit `.env`, then run `sudo docker compose up -d`.

**Rotating a secret** (a new APNs key, FCM key or gateway identity):

```sh
sudo install -o 10001 -g 10001 -m 600 <new file> /opt/keyring-messaging/secrets/<name>
# if the file name changed: update the path (and, for APNs, the key ID) in .env
sudo docker compose up -d gateway      # after an .env change
sudo docker compose restart gateway    # if only the file's contents changed
```

A new APNs or FCM key changes nothing for phones. A **new identity** is
different: it is a new DID, and agents only wake the gateway their phones
registered with. Rotate the identity only with the project, as it means every
phone registers again.

**You're done with an update when**:
- the §10 step-3 lines appear again;
- `/healthz` returns `ok`;
- `gateway_wake_total{outcome="delivered"}` keeps rising with normal use.

## 13. Moving to a shared mediator later

The bundled mediator exists because no shared DIDComm v2 mediator is available
to us yet. Later, the gateway may move to one: for example the mediator the
production agents use, once that service is stable. Then:
- **It saves** running the mediator and Redis, the second hostname, and the
  inter-mediator relay hop (wake-ups would be delivered locally).
- **It needs** a new gateway identity, or an edit to the existing one, whose
  `URL`, `SERVICE_TSP` and identity-file `mediator` name the shared mediator's
  DID instead of `MEDIATOR_DID` (§8 part B). If the shared mediator is closed
  to unknown DIDs, its admin must also allow the gateway's DID.
- **Phones:** a *new* gateway DID means every phone registers again. Editing
  the existing DID document instead keeps them (the VTA's DID editing), but
  that path hasn't been tried.
- **Then** stop and remove the `mediator` and `redis` services and the
  mediator's Caddy site, and keep `secrets/mediator/` until the move is
  confirmed.

The project decides when, and sends you the steps for that mediator.

## 14. Known gaps

- **The bundled mediator is unproven across mediators.** Until the lab proof
  (STATUS box) passes:
  - no wake-up has crossed from an agent's own mediator to it;
  - nobody has checked that a stranger's relayed message, addressed to anyone
    but the gateway, is not forwarded onward. If it is, the relay settings are
    tightened before you deploy.
- **The agents' mediator must relay.** The production agents' mediator has to
  relay to other mediators and accept relays back (§3). The project checks its
  configuration once it is known.

- **No unregister.** A removed phone's handle and token stay in the store. They
  can't be used once no agent wakes them, but they are still stored tokens.
- **Disabling or wiping a device at the agent doesn't clear its wake channel**
  (tracked as VTI-Q37). Only the phone clearing its own channel does. Keyring's
  app clears it when it unlinks; a phone that is lost can't.
- **Timing is visible.** The gateway, Apple and Google see *when* a wake goes
  out, and that correlates with the agent's activity. The content is never
  visible.
- **The upstream commits move with the agents** (§12).
