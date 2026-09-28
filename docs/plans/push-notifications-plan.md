# Push notifications — waking a backgrounded phone without telling Apple or Google anything

**Scope.** How Keyring tells a person that something is waiting when the app is
in the background or closed. It uses a Signal-style contentless push sent by
OpenVTC's push wake-up gateway, and the phone composes the notification itself.
The plan covers the app side (registration, wake handling, notification copy),
the server side (the gateway, its identity, its hosting package) and the path
that later carries message notifications.

**Relation to other work.**
- Registering the phone's push handle rides on device registration with the
  person's agent (the "new phone is a new device" work). This plan starts after
  that has shipped.
- The gateway's DIDComm identity and its mediator come from the VTI stack that
  the [OpenVTC integration plan](./openvtc-integration-plan.md) covers.
- The [release flow](./release-flow-plan.md) is unchanged. The push-enabled
  signing profile is a new credential it carries.

**Reviews.** See [`push-notifications-plan/`](./push-notifications-plan/):

| Companion | Contents |
|---|---|
| [2026-09-28-al.md](./push-notifications-plan/2026-09-28-al.md) | The review of the first draft (2026-09-26), and the decisions of 2026-09-28: which v2 mediator, iPhone phase scope, no mailbox swap, test isolation, hosting. Also the superseded positions: a bundled Credo mediator, silent-push-only iPhone, "simulators cannot receive pushes", and two earlier cost figures |

---

## 1. The design at a glance

The push is a **doorbell**, not a letter. The **mailbox** is the DIDComm
mediator, which already holds the phone's messages until the phone collects
them. A push says only "go check your mailbox".

1. The person's agent (their VTA) needs their OK: an approval or a step-up.
2. The agent sends `push/wake` to the gateway for the phone's **opaque handle**.
   The agent never sees the phone's platform push token.
3. The gateway holds Keyring's APNs and FCM credentials. It sends a push that
   carries no content. Apple and Google learn only that a Keyring push went to
   this phone at this time.
4. The phone shows a notification it composes itself. It loads the details from
   the agent over Keyring's own encrypted channel.

**Why the gateway and not the mediator holds the push token.** The mediator
already knows which connections deliver to which phone. Handing it the platform
token would put routing and device identity with one party. The gateway sees
tokens but no messages. The mediator sees messages but no tokens. For the same
reason, Credo's own mediator push path is not used (§5.2).

**How the gateway receives wake-ups.** At the pinned commit the gateway does not
listen for DIDComm. With a provisioned identity it connects **out** to its
mediator and processes the `push/*` messages waiting there
(vti-push-gateway `33bc8052`, `README.md`, "DIDComm transport (preferred)").
So it needs no public inbound port for DIDComm. It keeps one HTTPS endpoint,
for the HTTPS transport and for registrations that don't use DIDComm.

## 2. The locked wallet

Keyring's wallet is locked by the person's PIN or biometrics. A phone woken in
the background cannot open it, and the design does not weaken that.

| App state when the push arrives | What the person sees |
| --- | --- |
| Locked, or closed | A generic notification: "An approval is waiting in Keyring". Tapping it opens Keyring; after unlocking, the request is on screen |
| In the background and unlocked | The phone fetches the request and names it in the notification |

Signal's notification extension can read message content because it holds a
separate notification key. Keyring has no such key and does not add one: a key
the extension could use while the wallet is locked would be a second way into
the wallet.

The wallet locks itself shortly after the app goes to the background. So the
generic text is the usual case, not a fallback, and test plans treat it as
expected behaviour.

## 3. iPhone needs a visible push

Apple treats a silent (background) push as low priority:

> "the system may throttle the delivery of background notifications if the total
> number becomes excessive. The number of background notifications allowed by the
> system depends on current conditions, but don't try to send more than two or
> three per hour."
> — Apple, [*Pushing background updates to your App*](https://developer.apple.com/documentation/usernotifications/pushing-background-updates-to-your-app)

The same page: "If something force quits or kills the app, the system discards
the held notification."

An approval that someone is waiting on cannot depend on that. So Phase 2 adds a
**visible push marked for modification** (`mutable-content`). It carries fixed,
generic text and no server address. A small notification service extension
inside the app can replace that text when it is able to. That is Signal's
technique, and it arrives after a force-quit. **iPhone ships Phases 1 and 2
together.** Android ships on Phase 1: a high-priority FCM data message that
shows a notification reaches a backgrounded app.

The gateway at `33bc8052` sends only contentless pushes. That is upstream's
rule, and generic fixed text arguably fits it. The Phase 2 change is proposed
upstream, but Keyring may have to carry it as its own patch (§8).

## 4. Phases

| Phase | Delivers | Ships on |
| --- | --- | --- |
| 1 | Approvals and step-ups reach a backgrounded phone | Android |
| 2 | The visible, modifiable push and the notification service extension | iPhone, together with Phase 1 |
| 3 | Message notifications. Built in from the start, **off by default**, switched on when the messaging server sends wake-ups | Both, later |

### 4.1 Phase 1 steps and acceptance criteria

| # | Step | Done when |
| --- | --- | --- |
| 1.1 | Keyring's own Firebase project replaces the inherited BC Government one (`bc-wallet-mobile` in `app/android/app/google-services.json`) | The test build's `google-services.json` names the Keyring project; FCM issues a token on an Android device |
| 1.2 | Remove the inherited BC Wallet push helper (`app/src/utils/PushNotificationsHelper.ts`, today commented out in `useBCAgentSetup.ts` and `container-imp.ts`) | No code path registers a token with the mediator; `yarn lint`, `yarn typecheck` and `yarn test` pass |
| 1.3 | iOS push entitlement (`aps-environment`), the Remote notification background mode, and a push-enabled signing profile; the test app ID first (§6) | A test build on a real iPhone obtains an APNs device token |
| 1.4 | Notification library, Android notification channel, and permission prompts. The copy is owned by the UI plan | Denying permission leaves the app fully usable; granting it shows a test notification on both platforms |
| 1.5 | Registration, as part of registering the phone as a device of the person's agent. The phone sends `push/register` (platform token and the agent's DID) and gets back a wake handle. The agent then sends `push/provision` for that handle, naming the allowed triggers (vti-push-gateway `33bc8052`, `README.md`, "API"). The token is re-registered when it changes. On unlink or revoke, the agent stops waking the handle and the app drops its token | After registering, the agent can wake the phone. After a revoke, no wake reaches the phone. The gateway at the pin has no unregister verb, so a stale handle stays in its store until it's cleaned up (§8) |
| 1.6 | Wake handling: generic notification when locked; fetch and name when unlocked; tapping opens the approval | All four cases pass on a real device: locked + background, locked + closed, unlocked + background, and a tap from each |
| 1.7 | The gateway image is built on a CI runner and hosted (§5) | The image builds from `33bc8052` on CI. A first run with the gateway's test sender registers a handle and "delivers" a wake with no Apple or Google keys |
| 1.8 | End to end: a VTA sends a wake and the phone shows the notification | Measured on a real Android phone and, with Phase 2, a real iPhone. Timings are recorded per step |

### 4.2 Phase 2 steps and acceptance criteria

| # | Step | Done when |
| --- | --- | --- |
| 2.1 | Gateway change: a visible `mutable-content` push with fixed generic text and no server address | The push payload holds only the fixed text and flags. A patch against the pinned commit is carried in the package |
| 2.2 | iOS notification service extension, with its own app ID and signing profile | After a force-quit, a wake still shows the generic notification on a real iPhone |

### 4.3 Phase 3 steps and acceptance criteria

| # | Step | Done when |
| --- | --- | --- |
| 3.1 | Message notifications: one per burst ("3 new messages from Alice"), grouped per conversation, none while Keyring is open, with a per-contact mute | Ten messages in quick succession produce one notification |
| 3.2 | The messaging server wakes the phone when messages queue for it. **Blocked on upstream**: the VTI mediator does not send wake-ups for queued messages yet | Upstream ships it, or Keyring contributes it |
| 3.3 | Gateway: one wake per burst per phone (collapsing), with a per-phone cap | A burst produces one wake at the gateway's metrics |
| 3.4 | A setting to turn message notifications on or off, off by default until tested at scale | The setting persists, and off means no message wake-ups are requested |

## 5. Server package

A Docker Compose package, `deploy/keyring-messaging/`, sets up the server.

### 5.1 Contents

- **vti-push-gateway**, built from source at `33bc8052`. There is no published
  upstream image. The build is multi-stage Rust, runs as a non-root user, and
  mounts secrets read-only. It runs on a CI runner, not on the host.
- **Caddy** for HTTPS, with automatic Let's Encrypt certificates, for one
  hostname. The gateway's metrics listener stays on its own loopback.
- **`.env.example`** listing every setting without secret values. Secrets are
  mounted as files from a git-ignored `secrets/` folder.
- **A README** covering:
  - prerequisites;
  - a first run with the gateway's test sender;
  - the identity step (§5.3);
  - backups;
  - pin bumps.

The gateway limits HTTP requests per client IP. Behind Caddy every phone
arrives from Caddy's address, so the package raises `GATEWAY_HTTP_PER_SEC` and
`GATEWAY_HTTP_BURST` from their defaults (10 a second, burst 40). The
gateway's per-DID and registration limits still apply.

### 5.2 What the package leaves out, and why

- **Keyring's mailbox (the Credo DIDComm v1 mediator).** It stays where it runs
  today. Moving phones to a new mailbox changes `MEDIATOR_URL`, and existing
  installs don't follow a new URL on their own. That migration is its own piece
  of work and is not bundled with push.
- **A DIDComm v2 mediator.** The gateway uses the shared VTI mediator (§5.3),
  and running a second one only for the gateway is avoided.
- **Credo's mediator push module** (`MEDIATOR_USE_PUSH_NOTIFICATIONS`). It
  hands the FCM token to the mediator, the pairing §1 rules out.

### 5.3 The gateway's identity

The gateway is a provisioned VTA integration with its own `did:webvh`, made
from the VTA's `push-gateway` DID template. That template requires `URL`, the
DIDComm service endpoint. The gateway reaches its mediator from outside, so
`URL` is **the mediator's DID** (a mediated DIDComm v2 service) and
`ROUTING_KEYS` stays empty.

At the pinned commit the command is
`pnm bootstrap provision-integration --template push-gateway --var URL=<mediator DID>`,
and the sealed bundle is opened into the gateway's identity file
(vti-push-gateway `33bc8052`, `src/identity.rs` module docs). That file holds:
- the gateway's DID;
- its Ed25519 signing key (`#key-0`) and X25519 key-agreement key (`#key-1`),
  as `privateKeyMultibase`;
- the mediator's DID.

**Not yet confirmed against current VTI:**
- whether `provision-integration` is still the verb, rather than
  `did-mgmt dids create --template`;
- the exact bundle-open command.

Both are settled when the local test environment is provisioned (§6).

### 5.4 Hosting

The server needs:
- a Linux host with Docker;
- inbound 80/443 for one DNS name;
- outbound access to the shared mediator, APNs (`api.push.apple.com`, or
  `api.sandbox.push.apple.com` for development builds) and FCM.

| Option | Cost a month |
| --- | --- |
| A collaborator's server, as offered | $0 |
| Existing project servers | $0 |
| A separate 2 GB, 1 vCPU server | $12 ([DigitalOcean Basic](https://www.digitalocean.com/pricing/droplets), checked 2026-09-28) |

**Not decided.** Where the gateway runs after the local test is open, and is
waiting on the collaborator who offered hosting. If it's a server the project
doesn't operate, the APNs key and the FCM service account live there. Who can
read `secrets/` and the backups is then agreed before the keys are handed
over.

## 6. Testing in isolation

Push is tested apart from the release app and from the rest of the project's
test infrastructure, until it works end to end on a real device:

- **A separate app ID**, `asml.bkc.harvard.wallet.pushtest`, with a matching
  Android application ID. It has its own development provisioning profile and
  its own entry in the Keyring Firebase project. The release app ID's
  capabilities, its signing profile (the `BUILD_PROVISION_PROFILE_BASE64`
  secret) and the committed `google-services.json` stay unchanged until the
  test passes. A capability change on an app ID means regenerating the
  profiles signed against it, which is why the release ID waits.
- **A local stack.** The gateway runs in its own Docker stack. Its identity and
  mediator come from the project's local VTI lab, not the hosted stack, whose
  DID creation was failing when this plan was written. The lab adds only:
  - a gateway DID;
  - a mediator account for it;
  - a dedicated test VTA that sends the wake-ups.

  No existing lab agent or persona takes part.
- **Development builds use the APNs sandbox.** The gateway is set to sandbox for
  the test build.
- **Simulators and emulators carry the automated part.**
  - "Simulator now supports remote notifications in iOS 16 when running in
    macOS 13 on Mac computers with Apple silicon or T2 processors", through the
    APNs sandbox, including notification service extensions
    ([Xcode 14 release notes](https://developer.apple.com/documentation/xcode-release-notes/xcode-14-release-notes)).
  - Android emulators with Google Play services receive FCM.
  - Register → wake → notify runs there. Force-quit, Low Power Mode and the
    release build are tested on real phones.

  This hasn't been measured on the project's machines yet: step 1.7's first run
  checks it.

## 7. Cost

Running it costs little. Nearly all the cost is engineering time.

| Item | Cost | Basis |
| --- | --- | --- |
| Apple Developer Program | $99 a year, already paid | Existing membership |
| APNs | $0 | Included in the Developer Program |
| Firebase Cloud Messaging | $0 | "No-cost" on the Spark and Blaze plans ([Firebase pricing](https://firebase.google.com/pricing)) |
| Gateway hosting | $0 on an existing server; $12 a month separately | §5.4 |
| HTTPS certificate | $0 | Let's Encrypt |

The limits are far above Keyring's use, which is a few approval wake-ups per
person per day:
- FCM allows 600,000 messages a minute per project, and 240 a minute and 5,000
  an hour per device. Collapsible messages burst to 20 per device and refill
  one every 3 minutes
  ([FCM throttling and quotas](https://firebase.google.com/docs/cloud-messaging/throttling-and-quotas)).
- APNs has no per-message fee. The silent-push limit is in §3.

Phase 3 stays inside these limits by design:
- no push while Keyring is open;
- one wake per burst;
- visible notifications for anything a person should see. Apple throttles
  silent pushes, and Android deprioritises high-priority messages that never
  show a notification.

## 8. Limits, risks and dependencies

- **Only approvals and step-ups wake the phone.** Agents send wake-ups only for
  those today. Membership cards, vetter grants, invitations and messages wait
  until the person opens the app. They wake the phone once upstream's agents
  and messaging server send wake-ups for them (3.2), and Keyring is ready for
  that.
- **The pin must follow the agents.** Upstream draft PR #32 on vti-push-gateway
  changes how agents authenticate to the gateway, and agents don't sign those
  calls yet. The package pins `33bc8052`, the commit before that change. When
  the hosted agents move to the new authentication, the pin moves with them,
  or the gateway starts refusing their wake-ups.
- **The Phase 2 patch may stay Keyring's** (§3).
- **The shared mediator is a dependency.** The gateway needs a `did:webvh` and
  an account on the shared DIDComm v2 mediator, and agents must be able to
  reach it. Until the hosted stack can create DIDs, the gateway lives on the
  local lab (§6).
- **Push tokens are stored in clear text** in the gateway's store. Its volume
  and backups are protected like credentials.
- **No unregister.** The gateway's API at the pin has `push/register`,
  `push/provision` and `push/wake` only. A revoked phone's handle and token stay
  in the store; they are harmless once no trigger uses them, but they are still
  a stored token. Whether re-provisioning the handle with no allowed triggers
  is accepted is untested.

Upstream sources read: vti-push-gateway `33bc8052` and upstream VTI `ed672fff`.
The app facts are from `main` at `fa5c70e`.
