# e2e:vrc against the production mediator — connect-failure findings (2026-08-18)

Session context: first two-device e2e ladder run on `feat/trust-tasks-integration`
(M2 ceremony slice), iPhone 17 Pro simulator (iOS 26.3) + Pixel_6_API_33 emulator,
production mediator `credo-mediator.asml.berkmancenter.org`. The reference rung for
mediated transport is `tsp-reference/ref-06v1b-mediated` (and `ref-06v1d-carrier`'s
`run-mediated.mjs`, which doubles as the mediator health probe).

## Symptom

iOS wallet, "Paste a URL" screen: pasting a **valid** relationship invitation
(decoded and verified — well-formed OOB 1.1 invitation with mediator routing keys)
produced the "URL not recognized" error modal on every attempt.

## Diagnosis chain

1. The pasted URL was correct — the full 948-char invitation was delivered to the
   input (verified from the Appium wire log) and decodes cleanly.
2. Simulator syslog showed the real failure at the exact submit moment:
   `Error sending message to https://credo-mediator...: Network request failed`
   ("The network connection was lost").
3. **Red herring, first pass**: the connection objects carry a `quic-connection`
   label and the mediator advertises `alt-svc: h3=":443"`, which pointed at
   HTTP/3 flakiness from the simulator. Disabling h3 in the sim
   (`defaults write -g CFNetworkHTTP3Override -int 3`) did NOT fix it — and the
   detailed `com.apple.network` trace of the failing request shows plain
   TCP + TLS 1.3, not QUIC.
4. **Actual cause**: the failing POST reused a keep-alive connection idle for
   ~49 s (`reused_after_ms=48778`) and hit `Connection reset by peer` — the
   mediator side had dropped the idle socket without the client noticing.
   CFNetwork logs `can retry(N)`: NSURLSession never auto-retries
   non-idempotent requests, so the didexchange request died on the stale
   socket and credo's 15 s connection wait then expired.
5. Android never shows this because OkHttp transparently retries requests that
   fail on stale pooled connections; NSURLSession does not — hence iOS-only.
6. The mediator itself is healthy: `ref-06v1d-carrier/run-mediated.mjs`
   (host-side Node — fresh connections, no long idle gaps) passes: mediation
   granted, store-and-forward + pickup green. The prod mediator stays the e2e
   target; no local-mediator fallback needed.

## Remedy applied

`RetryingHttpOutboundTransport` in `app/src/hooks/useBCAgentSetup.ts` — a
subclass of credo's `DidCommHttpOutboundTransport` whose `sendMessage` retries
once on failure. The retry opens a fresh connection, exactly the behavior OkHttp
gives Android for free. A duplicate delivery in the
processed-but-connection-died edge case is tolerated by credo's receivers.

(The sim-side h3 override was left in place on the e2e simulator — harmless,
but it is NOT the fix and new sims don't need it.)

A server-side complement — raising the proxy/app idle keep-alive timeout or
closing idle connections cleanly at the mediator — needs infra access we do not
currently have; parked.

## Second failure layer: live-mode pickup loses messages (found same session)

With the HTTP retry in place the didexchange request reached the mediator
(200 OK on the fresh connection). The exchange still died, and the trace shows
why — a receiver-side loss:

1. Android's mediator websocket (PickUpV2 **live mode**) died silently ~90 s
   after onboarding (emulator NAT / proxy idle reaping; no close event reaches
   the app).
2. The mediator live-pushed the inbound didexchange request into that dead
   socket and did **not** requeue it — when Android's credo finally noticed and
   reconnected (~5 minutes later), the mediator's status message reported
   `message_count: 0`. The message was lost outright.
3. The wallet UI meanwhile showed "You connected with … and can now message
   securely" — the chat hook renders that banner whenever a connection *record*
   exists, with no state check (`chat-messages.tsx`), so a half-open handshake
   looks connected.

Control evidence: a host-side probe (`tsp-reference/ref-06v1d-carrier/
run-idle-probe.mjs` — the rung harness with a 90 s idle window inserted,
PickUpV2LiveMode like the wallet) PASSES from the host, where the socket
survives idle. The loss needs the silent-death + live-push combination.

**Remedy applied**: switched the wallet from `PickUpV2LiveMode` to `PickUpV2`
periodic polling (10 s interval, `bc-agent-modules.ts` +
`useBCAgentSetup.ts`) — every delivery is then request/ack'd against the
mediator's queue, and each poll self-heals a dead socket. Live mode can return
once the mediator requeues unacked live deliveries.

## Resolution: green run on the prod mediator (2026-08-18, ~16:25 local)

With both remedies live (`RetryingHttpOutboundTransport` + `PickUpV2` polling),
`run-vrc-exchange.js` passed end-to-end against the production mediator:
didexchange completed, VRC offers exchanged and accepted, credential in both
wallets, contacts visible ("Alice Anderson"/"Bob Baker"). The layer-3 failure
(run bwe4g97gc: iOS never created a connection record and never POSTed the
didexchange — CFNetwork showed only 853-byte pickup polls; failure screenshot
sat on Contacts "No contacts yet") did **not** reproduce and is judged a
client-side one-off at/before the OOB accept (likely a dropped `ScanPastedUrl`
press), not a mediator queue bug. Also recovered from the mediator's own logs
(13:17 local): `CredoError: Unable to parse incoming message: unrecognized
format` followed 10 s later by a return-route rxjs `TimeoutError` (`seen: 0`) —
the mediator-side face of a swallowed wallet send (pairs with draft issue 4).

### Third failure layer: dynamic import() breaks the trust-task open in dev

The green run exposed one more: on the inviter, the RCE v4 gate fired
(`Received relationshipDid … (RCE v4)`) but the deterministic proposer died with
`Trust-task exchange open failed: Could not load bundle`. The
`import('../trust-tasks/ceremony')` in `vrc-manager.ts` (added to break a module
cycle) compiles under Metro to an async split-bundle fetch
(`LoadBundleFromServerRequestError` from expo's async-require); the fetch fails
at runtime in dev builds (~300 ms, request never reaches Metro). Fixed by
switching to an inline lazy `require()` — same cycle-breaking, stays in the main
bundle. Release builds were never affected (single bundle).

### Correction: the "client-side one-off" recurred — intermittent iOS no-send

The bwe4g97gc judgment above ("one-off at/before the OOB accept") did not
hold: the same signature recurred in the evening runs (2 of 7 that day) with
a crucial difference — this time iOS **did** create the connection record and
navigate to chat, yet CFNetwork still shows zero HTTP attempts beyond pickup
polls: no didexchange POST, no failed task, no cancelled task. The mechanism
that makes this silent: bifold's `connectFromInvitation` → credo
`receiveInvitation` auto-accepts by observing connection-record state; the
didexchange send itself is dispatched in the background, and iOS surfaces
only error-level JS logs to the system log (info/debug never reach os_log;
Metro does not stream client logs in RN 0.81) — so a background send that
dies quietly leaves a chat screen, a connection record, and an empty wire.
Same-day control: with roles flipped (`PLATFORMS=ios,android`), Android's
paste→didexchange send worked instantly and cleanly. OPEN — needs iOS-side
JS observability (error-level breadcrumbs around the accept/send path, or an
RCTLog forwarding change) before it can be root-caused.

### Fourth failure layer: relationshipDid race silently kills one issuance leg

With the trust-task propose actually executing (post-`require()` fix), the next
run failed differently: Android's holder leg completed but its issuer leg never
ran — iOS sat on "waiting for counterparty" until the flow timeout. Cause: the
BasicMessageHandler's issuance trigger in `vrc-manager.ts` looked up
`myRelationshipDid` **8 ms before** the connection handler finished creating it
("Creating new relationshipDid" 16:32:12.740 → lookup fails 12.748 → "Created
and stored" 12.764) and on a miss it error-logged and returned — a terminal,
silent abort of this side's issuance. The trust-task proposer running inline
shifted timings just enough to lose the race that the older code won by
accident. Fix: poll the lookup (250 ms × 20, 5 s cap) before giving up.
`getOrCreateRelationshipDid` was deliberately not used there: its
find-then-create is not concurrency-safe and a parallel call could mint a
second, divergent DID for the same counterparty (worth hardening separately).

## Issues worth reporting upstream (drafts only — nothing posted without approval)

1. **bifold-wallet — `PasteUrl.tsx` collapses every connect failure into
   "URL not recognized"** (verified present upstream at
   `packages/core/src/screens/PasteUrl.tsx`, bare `catch` → `ErrorInvalidUrl`).
   A network/timeout failure during `connectFromScanOrDeepLink` renders as a
   URL-validity error, sending users (and this session, for a while) down the
   wrong path. Minimal fix: distinguish parse errors from downstream
   connect/transport errors and message them separately.
2. **credo-ts — `DidCommHttpOutboundTransport.sendMessage` never retries a
   failed send**, so on iOS (NSURLSession: no auto-retry of non-idempotent
   requests) a single stale keep-alive socket kills a DIDComm exchange, while
   Android (OkHttp: transparent stale-connection retry) is immune. Candidate
   ask: one retry on network-level failure in the transport, restoring
   cross-platform parity. Our app-level `RetryingHttpOutboundTransport` is the
   working patch and the natural shape of the upstream PR.
3. **credo-ts — the OOB accept path surfaces that send failure as an opaque
   rxjs `TimeoutError`** — the underlying transport error is logged but not
   attached to the thrown error. Candidate ask: propagate the send error as
   the rejection reason.
4. **credo-ts — `DidCommHttpOutboundTransport` treats any HTTP status as
   success** (`response.ok` never checked): a mediator 5xx leaves the message
   silently undelivered with only a debug-level "not a DIDComm message" log.
   Candidate ask: throw on non-2xx so callers (and retry wrappers) can react.
5. **Mediator (Berkman infra / credo mediator) — live-mode delivery into a
   dead websocket is not requeued**: the socket can die without the server
   noticing, the pushed message is counted delivered, and the recipient's next
   status-request sees `message_count: 0`. Pickup V2 live mode expects
   `messages-received` acks — unacked deliveries should return to the queue.
6. **bifold-wallet — chat renders "You connected with … and can now message
   securely" for any connection record regardless of state**
   (`hooks/chat-messages.tsx`, `connectedMessage`) — a handshake that never
   completed still tells the user they are connected.

## e2e harness hardening landed alongside (e2e/, this branch)

- `WDA_LOCAL_PORT` capability override (`lib/config.js`) — WebDriverAgent
  defaults to :8100, which collides with anything else there (locally: the
  Cypress VTA). Run with `WDA_LOCAL_PORT=8101`.
- Paste-and-submit retry loop (`lib/flows.js`) — detects the error modal via its
  "Try Again" CTA (RN Modal testIDs don't surface on iOS) and retypes, catching
  XCUITest's occasional dropped-character flake on ~1000-char strings. Note the
  detection window is 5 s: instant parse rejects are caught; network failures
  (modal appears ~15 s post-submit, after credo's timeout) intentionally are not.
- Known-good device pair for unattended runs: `Pixel_6_API_33` +
  `IOS_DEVICE_NAME="iPhone 17 Pro"`. The `API36_S25_A` AVD refuses to launch the
  app ("Error type 3: Activity class does not exist") despite a clean install —
  environment quirk, avoid it for e2e.

## Fourth failure layer: the witness never picks up its mail (2026-08-31, bam)

Session context: `yarn e2e:vrc:witnessed:android-only` on `feat/trust-tasks-integration`,
two physical Android phones, witness-server run by the e2e harness against the same
production mediator. Failed 4/4 identically at
`witness.waitForParticipants(2, 120000)` — *"only 0/2 participant(s) connected"* —
including once fully attended with both phones unlocked, which rules out Doze.

### Symptom

Both wallets accepted the witness's reusable OOB invitation, created a connection
record with `theirLabel: "e2e-witness"`, and sent their `didexchange/1.1/request`.
The witness logged **nothing at all** afterwards — no connection-state-changed, no
message-received, no problem-report — so the `state === 'completed'` gate in
`WitnessService.registerMessageHandlers` never opened and no `witness-announcement`
was ever sent. Meanwhile the witness's own outbound traffic worked throughout:
mediation request, `keylist-update` (ACKed), locality heartbeats, WebSocket
teardown at shutdown. Sending fine, receiving nothing, no error on either side.

### Diagnosis

The witness ran `MediatorPickupStrategy.Implicit`. Implicit is **push-only** — per
credo's own doc comment it "consists simply on initiating a long-lived session to a
mediator and wait for the messages to arrive automatically", and it issues no
pickup requests at all. Our mediator queues rather than pushes (it has run
`MESSAGE_PICKUP__FORWARDING_STRATEGY=QueueOnly` since the 2026-08-24 fix in
`docs/plans/openvtc-integration-plan/2026-08-24-bam.md`, which was applied to make
the *wallet-to-wallet* run pass). A push-only recipient against a queue-only
mediator receives nothing, permanently.

The wallet was moved off exactly this failure on 2026-08-18 (second layer, above)
and now calls `initiateMessagePickup(undefined, PickUpV2)` at runtime in
`useBCAgentSetup.ts`. The witness-server was never given the equivalent, so the
08-24 mediator fix that made the wallet reliable is the same change that made the
witness deaf.

Evidence, from the witness's own verbose log across the whole failing run
(13,194 lines): exactly **one** inbound message, a `keylist-update-response`
returned on the HTTP response body of the witness's own POST — i.e. return-route,
not mediator delivery — and **zero** message-pickup protocol messages of any kind.

### Confirmed by A/B, one phone, unattended (`e2e/debug-witness-connect.js`)

| Witness wallet | Transport | Strategy observed at runtime | pickup msgs | Result |
|---|---|---|---|---|
| persistent | MEDIATOR | `implicit` | 0 | FAIL 0/2 |
| persistent | DIRECT | n/a | — | **PASS** |
| persistent (mutated, see below) | MEDIATOR | `explicit v2` | 175 | **PASS** |
| **fresh** | MEDIATOR | `implicit` | 0 | **FAIL 0/1** |

The last row reproduces the original failure deterministically in ~5 minutes with
one phone. The third row matters just as much: through the *same* mediator, with
PickUpV2, `messagepickup/2.0/delivery` carried the phone's `didexchange/1.1/request`
and `/complete`, the connection completed, and the announcement went out. **The
mediator was never the problem** — it queues and delivers on request. The witness
simply never asked.

### The part that made this look machine-specific

Setting `mediatorPickupStrategy` in module config is **not sufficient**. credo
resolves it as `mediationRecord.pickupStrategy ?? moduleConfig.mediatorPickupStrategy`
(`DidCommMediationRecipientApi.getPickupStrategyForMediator`): a value persisted on
the MediationRecord **in the agent's wallet outranks the config**, and credo writes
one there itself whenever the config leaves the strategy unset — which is what
happens in DIRECT mode, where `mediationRecipient` is `undefined` but a leftover
default-mediator record is still found and triggers feature discovery.

So the effective strategy depends on hidden per-wallet state. A witness whose
wallet ever got `PickUpV2` pinned works forever after and looks fine; a fresh
wallet is dead on arrival. This is why the failure appeared to be
environment-specific rather than a deterministic bug, and why it survived: the
witness-server's own wallet is persistent (`.wallets/<name>-wallet/`, *not* the
e2e's temp dir despite the harness comment), and `yarn fresh` cleans
`${WITNESS_NAME}-wallet` — the wrong wallet unless `WITNESS_NAME` is exported to
match the run.

Observed live: running the DIRECT-mode probe silently pinned `PickUpV2` onto the
e2e wallet's record, after which the very next MEDIATOR-mode run passed. Any
"it works now" result on a reused witness wallet should be treated as suspect
until confirmed on a fresh one.

### Superseded position

An earlier reading of this session's evidence was "the witness is silently in
MEDIATOR mode when the harness assumes DIRECT, and mediator mode is broken". The
mode confusion is real and worth fixing (below), but it is not the defect: mediator
mode works fine with a pull strategy. Recording this because the narrower true
cause — push-only pickup, plus a config value that loses to persisted wallet state —
is not reachable from the mode observation alone.

### Remedies

**Applied, everywhere the codebase talks to a mediator:**
- `startMediatorMessagePickup` / `assertSupportedMediatorPickupStrategy` in
  `@bifold/vrc-shared` (`src/mediation.ts`) — passes the pickup strategy
  explicitly, which bypasses both the module config and any value pinned on
  the MediationRecord, and logs the effective strategy plus any pinned value
  it overrode. Called by the witness-server (`WitnessService.ts`, after
  `agent.initialize()`) and `vrc-reference/src/BaseAgent.ts`.
  `bifold/packages/core/src/utils/agent.ts`'s module config now declares
  `PickUpV2` directly (it has no runtime override of its own, unlike the app,
  so the declared config is what consumers of `@bifold/core` actually get).
  `core/src/contexts/activity.tsx`'s foreground-resume path now stops the
  running pickup loop before restarting it with an explicit strategy — it had
  been leaking a duplicate polling loop on every resume, doubling the wallet's
  request rate against shared infrastructure for the life of the process; see
  the `startMediatorMessagePickup` doc comment for where the same shape of bug
  was caught a second time.
- A repo-wide static-analysis guard,
  `witness-server/__tests__/unit/mediatorPickupStrategy.guard.test.ts` and its
  app-side twin `app/src/utils/mediatorPickupStrategy.guard.test.ts` — fails
  the build if any file declares an unreceivable strategy, or calls
  `initiateMessagePickup()` without one. A shared constant doesn't prevent the
  next agent from typing `Implicit` in a new file (that's exactly how this
  happened); the guard reads the source tree so it can't be bypassed by not
  importing the helper.
- The `WitnessService.test.ts` test that used to *document* `Implicit` as
  intended behaviour with an `expect(true).toBe(true)` body now asserts the
  actual contract (a pull strategy is required; push-only strategies throw
  with an explanation) — prose enshrining the bug is gone.
- `e2e/lib/witness.js` no longer lets a developer's `bifold/packages/witness-server/.env`
  decide this run's transport: `MEDIATOR_INVITATION_URL` is passed explicitly
  (forced empty → DIRECT, unless `WITNESS_MEDIATOR_INVITATION_URL` is set to
  deliberately test mediator mode), and the witness's own startup banner is
  read back and asserted against what was requested — a mismatch fails in
  seconds with a clear message instead of as a mysterious participant-connect
  timeout. The wallet is now genuinely temporary too: `VRC_WALLET_PATH` points
  it into the same per-run temp dir as the invitation file (previously only
  the invitation file was temporary; the wallet was a persistent, named
  directory reused across every run — see "the part that made this look
  machine-specific," above), so `stop()`'s existing cleanup removes it
  automatically and no run can inherit another run's persisted mediation
  state. `yarn fresh` is no longer relevant to the e2e path at all.
- **The mediator-mode fallback now has its own confirmable test, and it's been
  run and passed** (see below): `yarn e2e:vrc:witnessed:android-only:mediator`
  (2026-09-01) runs the same witnessed exchange with the witness deliberately
  put into MEDIATOR mode, reusing `app/.env`'s own `MEDIATOR_URL` so it's a
  real test against actual infrastructure rather than a stand-in. This is the
  direct answer to how this bug survived: mediator mode was never exercised by
  anything, deterministic or otherwise. See `e2e/README.md`, "Confirming the
  mediator-mode fallback." No periodic/CI job runs it automatically yet —
  manual, on demand, for now.

**Open tuning question:** the witness sets no `mediatorPollingInterval`, so it
polls at credo's 5 s default — previously it polled not at all, so this is new
behaviour rather than a regression, but each inbound hop of the witness ceremony
now costs up to 5 s. The wallet deliberately runs 1 s (`bc-agent-modules.ts`, with
the measured justification). Matching that would cut ceremony latency at the cost
of load on shared infrastructure; it wants the same kind of measurement the wallet
value got, not a guess. Left open deliberately.

### Confirmed fixed on device (2026-09-01)

Same two physical Android phones (SM_G986U1 / Android 13, SM_S936U / Android
16) for both runs below, against the same production mediator, with the
applied fix and harness hardening above.

**DIRECT mode** (`yarn e2e:vrc:witnessed:android-only`) — first run after the
fix: **passed**. Witness banner read `DIRECT (HTTP)` as requested (transport
guard confirmed the override took effect); both phones got `🤝 NEW PARTICIPANT
CONNECTED` / `✓ Sent witness-announcement` from the witness — the exact signal
that was silent across all four pre-fix failures; both landed the **Witnessed**
badge; one landed **Secure Exchange** too, the other tolerated a hardware
verification warning (a pre-existing, documented tolerance for an aging
attestation root — see `assertSecureExchangeBadge` in `e2e/lib/flows.js` —
unrelated to this bug). This closes the fourth failure layer.

**MEDIATOR mode** (`yarn e2e:vrc:witnessed:android-only:mediator`, the new
confirmable-fallback variant) — first run: also **passed**. Witness banner
read `MEDIATOR (WebSocket)` as requested; both phones again got `🤝 NEW
PARTICIPANT CONNECTED` / `✓ Sent witness-announcement`, this time actually
delivered through the shared production mediator instead of direct HTTP; same
badge outcome as the DIRECT run (one full `Witnessed` + `Secure Exchange`, one
`Witnessed` with the same pre-existing hardware-verification tolerance). This
is the first time mediator-mode witnessing has been confirmed working end to
end on real devices — it was silently, completely broken from 2026-08-24
until this fix, and nothing had exercised it before this run.

Both transport modes the witness supports are now proven working on real
hardware, not just by unit test or code inspection.

## Environment gotchas that cost debugging time but are not code bugs

Two more things burned real time this session, worth naming so a future
session recognizes them immediately instead of re-diagnosing from scratch.

**A phantom, root-owned listener can occupy the witness's default web port
(9003) on some machines**, invisible to `lsof -tiTCP:9003` (returns nothing)
but real per `ss -ltn` (shows `LISTEN`) and per an actual bind attempt (fails
`EADDRINUSE`). Observed present even immediately after a full machine reboot,
before any e2e process had run — so it is some other persistent
service/listener on that particular machine, not anything this repo's tooling
starts or can identify. Root cause not identified; out of scope to chase
further here. Symptom if hit: the witness's full startup banner prints, then
`Error: listen EADDRINUSE ... port: 9003` right at the end, ~15s in.
**Fix:** `e2e/lib/witness.js`'s `assertPortFree` now bind-tests the port
directly (not via `lsof`) before starting anything, and fails in under a
second with a message naming the port and the `WITNESS_PORT`/`WITNESS_WEB_PORT`
override — see the "Witness fails immediately with 'port N is already in
use...'" entry in `e2e/README.md`'s Troubleshooting section. If you hit this,
just pick different ports; don't spend time trying to find the offending
process.

**`e2e/debug-witness-connect.js` has no lock-screen preflight**, unlike the
maintained witnessed runners (which got one in `90a7b62` — see
`ensureLockScreenEnabled` in `e2e/lib/driver.js`). If the single phone it
drives falls asleep mid-run (e.g. left unattended — it's meant to be
unattended, that's the point of the script, but the phone still needs to stay
awake), the app never receives the paste-invitation input at all and the
script times out at `completeOnboarding` with a screen dump containing just
the lock-screen clock (`mWakefulness=Dozing`, `isKeyguardShowing=true` via
`adb shell dumpsys power` / `dumpsys activity activities`) — which reads
exactly like a genuine onboarding-flow hang if you don't check the screen
state first. It is a throwaway diagnostic script (README: "not part of the
maintained suite"), so this wasn't fixed; just know to check `adb shell
dumpsys power | grep mWakefulness` before assuming a `debug-witness-connect.js`
timeout is a real bug.

## BLE co-presence: a mid-exchange GATT failure with no retry, and a false "already fixed" claim (2026-09-02, bam)

Session context: `yarn e2e:vrc:witnessed:locality:android-only` on
`feat/locality-android-ble`, same two physical Android phones, this machine's
own Bluetooth adapter as the witness's BLE sensor (`BleLocalityProvider`,
BlueZ via `node-ble`). Not a mediator/transport issue like the rest of this
document — a different radio leg entirely — but the same shape of bug: a
real hardware failure the harness surfaced, with no retry to absorb it.

### Symptom

A locality-required run failed asymmetrically: one phone's contact showed a
confirmed-locality VWC (Witnessed + In-Person + a "Locality Verification:
Confirmed" record); the other showed no witness record at all, just the
base Secure Exchange badge. The witness ceremony assertion timed out
waiting for that phone's `VWC stored, outcome evidence self-check` markers.

### Diagnosis

The failing phone's own logcat showed the real cause, well before either
phone had any manual interaction:

```
[TrustTasks:Witness] locality radio phase did not complete (session a9abe903...)
witness/session/submit:localityRequired — trust-task-error
```

A genuine mid-ceremony BLE GATT failure — `required` policy correctly
refused to issue a VWC rather than issuing a false one, so nothing here was
a *correctness* bug. But reading `BleLocalityProvider.observeSession`
found it had **no retry at all**: a single mid-exchange GATT exception
resolved the session `null` immediately, and the failed `Device` object
stayed cached in `deviceByAddress` forever, un-evicted.

That combination — exactly this failure mode — was already found and fixed
once before, in the reference rung `ref-06p4` (`docs/plans/locality-plan/2026-08-21-bam.md`),
which states the fix was "folded into" `BleLocalityProvider`'s own
acceptance text (`locality-plan.md` item 2). It was not. The claim went
unverified for eleven days and only surfaced because a live e2e run hit the
exact failure the reference rung had already characterized. `locality-plan.md`
item 2 has been corrected in place.

### Remedy

`BleLocalityProvider.observeSession` now retries a mid-exchange failure up
to `MAX_TRANSCRIPT_ATTEMPTS` (3) within the same `windowSeconds` budget —
the security parameter stays the outer bound, this is a reliability cap on
top of it — evicting the cached `Device` on every failure so a retry
reconnects fresh rather than repeating the same failure against the same
stale BlueZ proxy. A longer window alone would not have helped: the
provider was giving up on the first exception regardless of how much window
time remained, so extending the window just gives more time to not retry.

Two new unit tests against a fake adapter/device (`BleLocalityProvider.test.ts`):
one that fails once then succeeds (asserts the device is refetched, proving
eviction rather than merely that a retry happened), and one that fails every
attempt with a long window (asserts the attempt cap, not the window, is what
stops it).

### Confirmed on device (2026-09-02)

Same two physical Android phones. First run after the fix: **passed**, both
legs' BLE round trips succeeding on their first attempt — no retry actually
fired this run, so this confirms no regression, not the retry path itself
firing against a real flake (BLE failures are inherently non-deterministic;
the unit tests are what prove the retry logic itself). Both phones landed a
confirmed-locality VWC, both showed the Witnessed badge and the new
locality-confirmed Contacts indicator (see below), fully symmetric this
time.

### Also landed this session: a locality-confirmed indicator on Contacts, and a dead-code bug it exposed

Neither the Contacts list nor the contact detail screen surfaced BLE
co-presence confirmation at a glance. Added a third badge
(`map-marker-check`, green, "In-Person" on the detail screen) to both,
following the existing `hasWitnessCredential`/`hasHardwareAttestation`
pattern in `ListContacts.tsx`/`ContactDetails.tsx` exactly.

Building it found that both the new badges and the pre-existing per-record
"Locality Verification" line were reading `witnessContext.localityVerification`
— the legacy nested shape `extractWitnessInfo` only populates for VWCs
issued before this plan's flat `locality*` members existed. Every current
VWC leaves that field `undefined`, so the existing line had been silently
dead code since the flat shape shipped: never wrong on screen, invisible.
Both now read the always-populated three-state `locality.outcome` instead.

Full detail, plan-status updates, and test counts: `docs/plans/locality-plan/2026-09-01-bam.md`
and `docs/plans/locality-plan.md` items 2, 8, and 12.
