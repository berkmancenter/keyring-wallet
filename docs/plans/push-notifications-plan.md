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
  signing profile is a new credential it carries; no second profile is needed,
  because the app has no notification extension (§3).
- [`docs/VTI_UPSTREAM_FINDINGS.md`](../VTI_UPSTREAM_FINDINGS.md) (`:866`,
  `:1809`) holds upstream's device and wake-up answers. Step 1.5 and the pin
  rule in §8 follow that log's discipline of separating what was measured from
  what was read from source.
- [`message-protection-plan.md`](./message-protection-plan.md) covers the
  pickup loop, the deaf-socket problem and the mediator's queue expiry (7 days
  by default). Together they bound how long a queued message waits for a
  push-woken phone.
- The `binding/push/0.1` note in the
  [OpenVTC integration plan](./openvtc-integration-plan.md) describes the same
  doorbell, and this plan implements it. The gateway is that binding's
  implementation: vti-push-gateway `e542a9d7`, `README.md` line 4 cites
  [`binding/push/0.1`](https://trusttasks.org/binding/push/0.1), and the phone
  and agent sides of §4.1 follow it.

**Reviews.** See [`push-notifications-plan/`](./push-notifications-plan/):

| Companion | Contents |
|---|---|
| [2026-09-28-al.md](./push-notifications-plan/2026-09-28-al.md) | The review of the first draft (2026-09-26), and the decisions of 2026-09-28: which v2 mediator, iPhone phase scope, no mailbox swap, test isolation, hosting. Also the superseded positions: a bundled Credo mediator, silent-push-only iPhone, "simulators cannot receive pushes", and two earlier cost figures. Its Part 3 answers the review below: the register path (F2), the background handler (F3), the gateway pin move to `e542a9d7`, unregister, and `binding/push/0.1`. Its Part 4 records how push ships: built in and off, bifold's push framework reused rather than removed, the build-time push-test variant, no notification extension (one neutral line by key), and the gateway's visible-alert mode as a self-contained patch |
| [2026-09-28-bam.md](./push-notifications-plan/2026-09-28-bam.md) | The review of the plan against the code it lands in: the lock behaviour, the registration anchor, background execution, iOS signing, the test app ID, the dormant-code scope, Firebase compatibility, privacy metadata, and the testing and coverage requirements |

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
   this phone at this time (§8 lists the timing metadata that remains).
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
(vti-push-gateway `e542a9d7`, `README.md`, "TSP and DIDComm transports").
So it needs no public inbound port for DIDComm. It keeps one HTTPS endpoint,
for the HTTPS transport and for registrations that don't use DIDComm.

## 2. The locked wallet

Keyring's wallet is locked by the person's PIN or biometrics. A phone woken in
the background cannot open it, and the design does not weaken that.

**How the lock behaves.** The lock is a timeout, 5 minutes by default and set by
the person (`autoLockTime`, `0` meaning never)
(`bifold/packages/core/src/constants.ts` `defaultAutoLockTime`;
`contexts/store.tsx`). It is evaluated only when the app returns to the
foreground (`contexts/activity.tsx`, the `background -> active` transition);
backgrounding clears the inactivity timer. So nothing locks the wallet while the
process sleeps, and a process that was just backgrounded still holds an unlocked
wallet. A killed process holds no wallet state at all. The lock state is
therefore not a predicate a background handler can rely on.

**The background handler never opens the agent.** Whatever the lock state, a
push that arrives while the app is not in the foreground produces the generic
notification and nothing else. The handler does not open an agent, start message
pickup or read the wallet. A named notification needs the agent open, which
means either a key the handler can use while the wallet is locked or a fetch
inside the few seconds an operating system gives a background handler (about 30
seconds on iPhone, and Android limits high-priority messages that show no
notification). The first is the second way into the wallet that this design
rules out. The second makes the text depend on a fetch that can fail, and a
person's approval cannot.

| App state when the push arrives | What the person sees |
| --- | --- |
| Closed, or in the background (locked or not) | A generic notification: "An approval is waiting in Keyring". Tapping it opens Keyring; after unlocking, the request is on screen |
| In the foreground | No push is sent for a request the open app already receives; a push that still arrives is not shown as a notification |

Signal's notification extension can read message content because it holds a
separate notification key. Keyring has no such key and does not add one.

The generic text is the only text, not a fallback, and test plans treat it as
expected behaviour. The person's auto-lock setting changes nothing about what
the notification says.

## 3. iPhone needs a visible push

Apple treats a silent (background) push as low priority:

> "the system may throttle the delivery of background notifications if the total
> number becomes excessive. The number of background notifications allowed by the
> system depends on current conditions, but don't try to send more than two or
> three per hour."
> — Apple, [*Pushing background updates to your App*](https://developer.apple.com/documentation/usernotifications/pushing-background-updates-to-your-app)

The same page: "If something force quits or kills the app, the system discards
the held notification."

An approval that someone is waiting on cannot depend on that. So Phase 2 makes
the wake a **plain visible notification**: an APNs `alert` push (priority 10)
that the system shows itself, whatever state the app is in, carrying one
neutral line by key:

> "If the text of your notification messages is predetermined, you can store
> your message strings in the Localizable.strings file of your app bundle and use
> the title-loc-key, subtitle-loc-key, and loc-key payload keys to specify which
> strings you want to display."
> — Apple, [*Generating a remote notification*](https://developer.apple.com/documentation/usernotifications/generating-a-remote-notification)

The phone shows the line in its own language, and the payload carries only the
key. Every wake uses the same key, so Apple cannot tell an approval from a
message. `apns-collapse-id` merges repeated wakes.

**No notification service extension.** An extension exists to change a
notification's content on the phone; it runs only for a payload with
`mutable-content: 1` and has "about 30 seconds" to do it
([*Modifying content in newly delivered notifications*](https://developer.apple.com/documentation/usernotifications/modifying-content-in-newly-delivered-notifications)).
The line never changes (§2) and nothing is encrypted, so an extension would
have nothing to do. Signal needs one because it names the sender; Keyring does
not. Upstream's own iPhone app has none either (vta-mobile-agent-ios, wakes by
background push only). **iPhone ships Phases 1 and 2 together.**

Android does the same with an FCM *notification* message whose
`android.notification.body_loc_key` names a string resource in the app: the
system tray shows it while the app is in the background or closed, with no
local-notification library, and in the foreground it reaches the app, which
shows nothing.

The gateway at `e542a9d7` sends only background (APNs) and data-only (FCM)
pushes, so Phase 2 is a gateway change (2.1): a visible-alert mode, off unless
configured, applied to interactive wakes. It is kept as a self-contained patch
against the pinned commit, as a candidate to contribute upstream (§8).

## 4. Phases

| Phase | Delivers | Ships on |
| --- | --- | --- |
| 1 | Approvals and step-ups reach a backgrounded phone | Android |
| 2 | The visible wake: one neutral line by key (APNs alert, FCM notification) | iPhone, together with Phase 1; Android too |
| 3 | Message notifications. Built in from the start, **off by default**, switched on when the messaging server sends wake-ups | Both, later |

### 4.1 Phase 1 steps and acceptance criteria

**How it ships.** Push is built into the app and off: a build carries no push gateway unless it is the push-test variant, so testers see no prompt and no switch and nothing registers. The first build to carry it holds registration, the switch and the logging handlers; the visible wake (Phase 2: the gateway's alert mode and the app's strings) follows in a later build, and needs no new native dependency.

**Gates.** Every step ends with `cd app && TZ=GMT yarn jest`, root
`yarn typecheck` and `yarn lint` passing. A step that changes `bifold/` also
passes `cd bifold/packages/core && yarn test`, and lands as its own submodule
commit with the sign-off trailer last (root `CLAUDE.md`).

| # | Step | Done when |
| --- | --- | --- |
| 1.0 | A push-test variant, `asml.bkc.harvard.wallet.pushtest`, switched on at build time rather than by a new Xcode configuration or Gradle flavor, so the release pipeline's schemes, Pods configurations and Gradle task names are untouched: Android adds the `.pushtest` suffix only under `-PkeyringPushTest`; iOS uses a push-only `AriesBifold-PushTest.entitlements` and `scripts/push-test/build-ios.sh` switches the app target to it, with the pushtest bundle ID and the development profile, for one build. The Keyring Firebase config and the profile come from outside the repository (`~/.keyring-push`) | The variant installs beside the release app. A build without the switches is unchanged. `build-ios.sh` restores `project.pbxproj` on every exit, ctrl-C or kill signal and ends by showing it clean |
| 1.1 | Keyring's own Firebase project replaces the inherited BC Government one (`bc-wallet-mobile` in `app/android/app/google-services.json`) | The test build's `google-services.json` names the Keyring project, and the plan records which of its values are committed. The Firebase BoM and the RNFirebase version resolve to a compatible pair, which is recorded (`app/package.json` has `~21.14.0`; `app/android/app/build.gradle` pins `firebase-bom:26.8.0`). FCM issues a token on an Android device, and a foreground and a background message are received on a New Architecture build (`newArchEnabled=true`) |
| 1.2 | Remove the inherited BC Wallet push path from `app/`: `src/utils/PushNotificationsHelper.ts` (it calls `agent.modules.pushNotificationsFcm`, which `bc-agent-modules.ts` does not register), its commented references in `src/hooks/useBCAgentSetup.ts`, `container-imp.ts` and `src/onboarding.ts`, the `UserDeniedPushNotifications` and `DeviceToken` keys in `src/store.tsx`, and `MEDIATOR_USE_PUSH_NOTIFICATIONS`. Bifold's push framework stays: 1.4 reuses it | No code path registers a token with the mediator. A test fails if `pushNotificationsFcm`, `PushNotificationsHelper`, `MEDIATOR_USE_PUSH_NOTIFICATIONS` or `setDeviceInfo` reappears in the app source |
| 1.3 | iOS push entitlement (`aps-environment`, absent from `AriesBifold.entitlements` today), a push-enabled App ID and signing profile; the test app ID first (§6). Confirm that `remote-notification` is set in `Info.plist` (it is), and review the unused `audio` and `voip` modes: `voip` implies PushKit obligations that App Review checks | A test build on a real iPhone obtains an APNs device token. The `audio` and `voip` modes are removed or their use is justified in writing. A sandbox push reaches an iOS simulator (§6) |
| 1.4 | The permission and the switch through bifold's push framework: the app supplies `enablePushNotifications` (`status` and `setup` read and ask for the notification permission; `toggle` turns wake-ups on with 1.5 and off by clearing the wake channel), which drives bifold's Settings switch. The app supplies it **only** when the build sets `PUSH_GATEWAY_URL`. The Android notification channel is declared with 1.6's strings. The copy is owned by the UI plan | Without `PUSH_GATEWAY_URL` there is no configuration, so no prompt, no switch and no registration (a unit test). With it, the Settings switch appears, turning it on registers and turning it off clears the channel; a refusal is logged, never shown as an error. Denying permission leaves the app fully usable. A sandbox push reaches an Android emulator with Google Play services (§6) |
| 1.5a | Add `device/set-wake/0.2` to the agent-device client in `bifold/` (`packages/core/src/modules/trust-tasks/module/vtaDevices.ts`, beside `registerThisDevice`, over the same agent port), as its own submodule commit. Add the `push/register` HTTPS client in `app/`: it is specific to the gateway, so it is not a `@bifold/*` package and needs none of the four wiring entries | The new task is covered by unit tests in `bifold/packages/core` (request shape, a clearing call with no `wakeHandle`, a refusal). The `app/` client is covered by unit tests against a stubbed gateway (success, `permissionDenied`, `taskFailed`) |
| 1.5 | Registration, by the path in §4.4: after `device/register`, the phone sends `push/register` to the gateway over HTTPS, receives the gateway-made wake handle, and conveys it to its agent with `device/set-wake/0.2`. The agent provisions the gateway. On a token change the phone registers again and sends the new handle. On unlink or revoke, the agent clears the device's wake channel; that is authoritative, and the app dropping its token is best effort, since a wiped phone cannot do it | After registering, the agent can wake the phone. After a revoke, no wake reaches the phone. A token refreshed while the phone is offline is re-registered on next launch. Unit tests cover register, refresh (including while offline) and clear. The test agent's log shows its provision reached the gateway, because a failed provision is never reported to the phone (§4.4) |
| 1.6 | Wake handling per §2. The system shows the visible wake (Phase 2) from the app's own strings: `Localizable.strings` on iOS, a string resource on Android, one neutral line in each supported language. The app's background and foreground handlers log the wake's known hints and never open the agent, start pickup or read the wallet; the foreground shows nothing. Tapping the notification opens the approvals after unlocking | Unit tests cover the hints read and nothing else done, and that the line's key exists in every supported language. On a real device: background and closed each show the line, and a tap from each lands on the approvals. The attended runs use `yarn e2e:vrc:devices` or its single-device equivalent, so the iPhone criterion is reproducible |
| 1.7 | The gateway image is built on a CI runner and hosted (§5) | The image builds from `e542a9d7` on CI. A first run with the gateway's test sender registers a handle and "delivers" a wake with no Apple or Google keys. The rate-limit settings of §5.1 are set, with a test that the package's configuration carries them |
| 1.8 | End to end: a VTA sends a wake and the phone shows the notification | Measured on a real Android phone and, with Phase 2, a real iPhone. Timings are recorded per step. The failure-mode matrix of §6.1 passes |

### 4.2 Phase 2 steps and acceptance criteria

| # | Step | Done when |
| --- | --- | --- |
| 2.1 | Gateway change: a visible-alert mode, off unless configured. For an interactive wake it sends an APNs `alert` push (priority 10, `apns-collapse-id`, `aps.alert.loc-key`) and an FCM notification message (`android.notification.body_loc_key`, `collapse_key`); background wakes stay silent. A self-contained patch against the pinned commit, carried in the package, not mixed with Keyring's own changes | The payload holds only the key, the flags and the existing hints; the collapse ID is set; with the mode unset the payloads are unchanged. Gateway-side tests cover each. A short rationale and a README section go with the patch |
| 2.2 | The line's strings in the app (1.6), with the same key the gateway sends | A wake after a force-quit shows the line on a real iPhone, attended, on `yarn e2e:vrc:devices` |

### 4.3 Phase 3 steps and acceptance criteria

| # | Step | Done when |
| --- | --- | --- |
| 3.1 | Message notifications: one per burst ("3 new messages from Alice"), grouped per conversation, none while Keyring is open, with a per-contact mute | Ten messages in quick succession produce one notification |
| 3.2 | The messaging server wakes the phone when messages queue for it. **Blocked on upstream**: the VTI mediator does not send wake-ups for queued messages yet | Upstream ships it, or Keyring contributes it |
| 3.3 | Gateway: one wake per burst per phone (collapsing), with a per-phone cap | A burst produces one wake at the gateway's metrics |
| 3.4 | A setting to turn message notifications on or off, off by default until tested at scale | The setting persists, and off means no message wake-ups are requested |

### 4.4 Registration and authorisation

Registration uses two Trust Tasks that already exist, and no new one. This is
upstream's documented end-to-end path: "device `push/register` → gateway →
handle → `device/set-wake` → VTA → `push/provision` → gateway" (VTI `2240aa7e`,
`docs/05-design-notes/mobile-agent-architecture.md:561`). It also follows
upstream's advice to extend existing tasks before drafting new ones
(`docs/VTI_UPSTREAM_FINDINGS.md:1809`).

1. **The phone registers with the gateway.**
   - It sends `push/register/0.2`, with
     `{ registration: { platform, token, topic }, controllerVtaDid }`, to the
     gateway's `POST /trust-tasks` over HTTPS (gateway `README.md:108,202-206`).
   - Registration is the one anonymous task, so it carries no proof
     (`README.md:126`).
   - HTTPS is the transport because it needs no DIDComm v2 or TSP client in
     the wallet. It is also the only transport where anonymous registration
     is rate-limited per source: "per peer IP over HTTPS; the TSP and DIDComm
     paths have no trustworthy anonymous source" (`README.md`, "Who can spend
     the record").
2. **The gateway makes the handle.** It is 32 random bytes in base58
   (`src/api.rs:178-182`), created on registration (`api.rs:384`) and returned
   as `{ wakeHandle: { gateway, handle } }` (`api.rs:403`). Nothing in the
   handle derives from the token or the person, and the agent never sees the
   token. With an identity file set, `wakeHandle.gateway` is the gateway's DID
   (`README.md`, `GATEWAY_IDENTITY_FILE`). That matters, because the VTA wakes
   only a gateway named by a DID (VTI `vta-service/src/trust_tasks/step_up.rs`,
   `trigger_gateway_wake`: "URL gateway → HTTPS path (follow-up)").
3. **The phone gives the handle to its agent.**
   - It sends `device/set-wake/0.2`, with
     `{ wakeHandle, pushPlatform?, suggestedTriggers? }` → `{ pushCapable, triggerPolicy? }`.
     The proof is required (`mobile-agent-architecture.md:550-555`).
   - The handle rides this separate task, not an extension of
     `device/register`. `set-wake` exists for exactly this.
   - `0.2` because `0.1` is deprecated. The VTA "still accepts 0.1 during the
     migration window but it will be removed in a future release", and the
     `0.2` bump changed no values (VTI `vta-sdk/src/trust_tasks.rs:212-219`).
     Both reach the same handler (`vta-service/src/trust_tasks/wire_v0_2.rs:122-127`).
   - In Phase 1 the phone suggests no triggers, so the allowlist is the agent
     alone. Phase 3 suggests the messaging server's DID.
4. **The agent provisions the gateway.**
   - On a successful `set-wake` the VTA sends a signed `push/provision` with
     the handle's allowlist (`vta-service/src/trust_tasks/device.rs:150-197`,
     `provision_gateway`).
   - The send is spawned and best effort: a failure is logged at the agent and
     never reaches the phone.
   - `set-wake` with no `wakeHandle` "clears the channel"
     (`mobile-agent-architecture.md:553-554`). That is how unlink and revoke
     stop wakes, even when the phone has been wiped.
5. **Wakes and provisions are signed documents.**
   - The gateway authorises `push/provision` and `push/wake` only by an
     `eddsa-jcs-2022` Data Integrity proof with `proofPurpose: authentication`,
     made by the document's `issuer`.
   - The document names this gateway as `recipient`, its `issuedAt` is within
     5 minutes, and its `id` has not been accepted before. No transport identity
     or HTTP header authorises anything (gateway `README.md`, "Authentication").
   - `push/provision` must come from the handle's `controllerVtaDid`, and
     `push/wake` from a DID on its allowlist.
   - VTA `2240aa7e` signs both that way (`step_up.rs`, `trigger_gateway_wake`
     and `sign_outbound_request`). The phone signs nothing at the gateway.

**The bifold change.** `vtaDevices.ts` carries `device/register`, `heartbeat`,
`list` and `wipe` (`:30-34`), and no `set-wake`. Step 1.5a adds it. The rest of
that file's device tasks are also `0.1` and on the same deprecation list (VTI
`vta-service/src/deprecation.rs:662-684`). Moving them is a wire-name change
outside this plan.

## 5. Server package

A Docker Compose package, `deploy/keyring-messaging/`, sets up the server.

### 5.1 Contents

- **vti-push-gateway**, built from source at `e542a9d7`. There is no published
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

`GATEWAY_ALLOWED_CONTROLLERS` lists the agents (controller VTAs) the gateway
serves.
- A `push/register` naming any other `controllerVtaDid` is refused with
  `permissionDenied`, and so is a provision by a controller no longer on the
  list (gateway `src/api.rs:366-374`; `README.md`, "Which controllers are
  served").
- The list holds exact DIDs: "No patterns: a DID-method or host pattern would
  admit every DID anyone can mint under that method or host"
  (`src/controllers.rs:9-15`).
- Unset serves nothing. `*` is an explicit open mode, which logs a warning at
  startup and keeps every other bound.
- In the local test (§6) the list is the dedicated test agent's DID. The
  production value is not decided (§5.4).

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

The gateway also serves `push/*` over TSP on the same mediator connection. At
startup it warns unless its DID document carries
`{ "id": "{DID}#tsp", "type": "TSPTransport", "serviceEndpoint": "<mediator DID>" }`
(gateway `README.md`, "TSP and DIDComm transports"). The DID is minted with the
template's `SERVICE_TSP` variable set, or the entry is added afterwards with the
VTA's `dids edit`.

At the pinned commit the command is
`pnm bootstrap provision-integration --template push-gateway --var URL=<mediator DID>`,
and the sealed bundle is opened into the gateway's identity file
(vti-push-gateway `e542a9d7`, `README.md`, "Identity is provisioned like any
integration"; `src/identity.rs` module docs). That file holds:
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

**Not decided: which agents a shared gateway serves.** Each Keyring user has
their own agent, so each has a different controller DID. A production gateway
either:
- lists every user's agent DID in `GATEWAY_ALLOWED_CONTROLLERS`. That is exact
  match only (§5.1), so each new user means a configuration change; or
- runs the open mode `*`. Its bounds still hold: at most 4096 live handles per
  controller, a handle no agent provisions is dropped after an hour, and
  per-issuer and per-handle record budgets apply (gateway `README.md`, "Who can
  spend the record").

This is waiting on the collaborator who offered hosting, together with where the
gateway runs.

## 6. Testing in isolation

Push is tested apart from the release app and from the rest of the project's
test infrastructure, until it works end to end on a real device:

- **A separate app ID**, `asml.bkc.harvard.wallet.pushtest`, with a matching
  Android application ID, built by the variant step 1.0 creates. The project has
  no switch for it today: both bundle and application IDs are literals and there
  are no flavors. It has its own development provisioning profile and
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

  This hasn't been measured on the project's machines yet. Steps 1.3 and 1.4
  check it, because they have Apple and Google keys and a test build; step 1.7's
  test sender does not reach APNs or FCM.

The automated tier is a script of the gateway stack, not part of `e2e/`, until
the flow is proven; the attended real-phone tier runs on `yarn e2e:vrc:devices`.
The shared machine has real memory limits, so emulators and simulators run one
at a time, and the two platforms do not run together.

### 6.1 Failure-mode matrix

Wake delivery is exercised for each of these, with the expected result recorded
in the test:
- permission denied;
- token missing;
- gateway unreachable;
- handle unknown;
- stale token;
- app force-quit;
- device wiped;
- the agent not on `GATEWAY_ALLOWED_CONTROLLERS` (register refused with
  `permissionDenied`);
- the agent's provision lost. It is best effort (§4.4), so the phone registers
  but can't be woken, and the agent's log shows why;
- another device removed, then its wake triggered (§8).

Denied permission and a missing token leave the app usable. An unknown handle
or a stale token is refused by the gateway, and it doesn't reach the agent as a
delivery.

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
- **The pin must follow the agents.**
  - The gateway authorises provisions and wakes only by the signed-document
    rule of §4.4 (vti-push-gateway PR #32, merged 2026-09-26).
  - The package pins `e542a9d7`, which carries it, because the agents it
    serves (VTI `2240aa7e`) sign that way.
  - A gateway older than PR #32 refuses those documents. An agent older than
    that PR can't reach this one.
  - The pin moves only together with the agents the gateway serves.
- **The Phase 2 gateway patch may stay Keyring's** (§3). It is kept self-contained so it can be offered upstream as it stands.
- **The shared mediator is a dependency.** The gateway needs a `did:webvh` and
  an account on the shared DIDComm v2 mediator, and agents must be able to
  reach it. Until the hosted stack can create DIDs, the gateway lives on the
  local lab (§6).
- **Timing is observable.** The gateway, APNs and FCM see when each wake goes
  out, and that correlates with the agent's activity. Wakes set `apns-collapse-id`
  and the FCM `collapse_key`, because an empty push carries no `thread-id` and
  the platform would not otherwise deduplicate repeated wakes; the FCM limits in
  §7 bound this.
- **A token can go stale unseen.** A token refreshed or revoked while the phone
  cannot reach the gateway leaves the gateway waking a dead token until the app
  next launches and re-registers (1.5). A wiped phone never re-registers, so the
  agent-side stop is what ends its wakes.
- **Push tokens are stored in clear text** in the gateway's store. Its volume
  and backups are protected like credentials.
- **No unregister at the gateway, so removal is Keyring's job.**
  - The gateway's API has `push/register`, `push/provision` and `push/wake`
    only. A revoked phone's handle and token stay in its store: harmless once
    no trigger uses them, but still a stored token. A provisioned handle is
    never swept.
  - Keyring's device-removal flow therefore ends a removed device's wakes at
    the agent:
    - **Removing this phone:** it sends `device/set-wake/0.2` with no
      `wakeHandle` (clearing its channel) before it unlinks, then drops its
      token. It registers a fresh handle if it is linked again.
    - **Removing another device:** `set-wake` acts only on the caller's own
      device. VTI's `device/disable` and `device/wipe` mark the binding without
      clearing its wake channel (VTI `vta-service/src/operations/device.rs:342-436`;
      only `set-wake` clears it, `:471`). So whether a disabled or wiped device
      can still be woken is unverified. Step 1.8's matrix includes "remove
      another device, then trigger its wake". If the agent still wakes it, that
      is recorded as an upstream finding.

## 9. Open questions

- **Which agents a shared gateway serves** (§5.4), and **where it runs**. Both
  are waiting on the collaborator who offered hosting.

Upstream sources read: vti-push-gateway `e542a9d7` (and `33bc8052`, the first
draft's pin) and upstream VTI `2240aa7e`. The app facts are from `main` at
`fa5c70e` and `bifold` at `b8768fd3`.
