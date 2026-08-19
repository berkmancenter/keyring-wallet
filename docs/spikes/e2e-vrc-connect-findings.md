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
