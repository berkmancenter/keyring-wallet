# DIDComm v2 in Keyring — subtask plan

*Owned by [`../openvtc-integration-plan.md`](../openvtc-integration-plan.md)
(§5.4 stage 3, §1.6 coexistence, §4.2 envelope selection). Reasoning and the
evidence behind every position here:
[`2026-09-13-al.md`](./2026-09-13-al.md). Sibling subtasks:
[`trust_tasks_subtask.md`](./trust_tasks_subtask.md) (the documents this
carries), [`pnm_cnm_subtask.md`](./pnm_cnm_subtask.md) (P1 stands up the VTA
leg this plan's V3 replaces or adopts), [`vta-carriage_subtask.md`](./vta-carriage_subtask.md)
(names no mediator; §7 here supplies one per mode).*

**Status:** draft for review. Direction given 2026-09-13: DIDComm v2
capability is wanted, an unmerged upstream source is acceptable, rungs come
first, and the Prague date is not a constraint on this plan.

---

## 1. What this adds

The parent plan requires Keyring to run **DIDComm v1, DIDComm v2 and TSP side
by side behind one transport abstraction** (§1.6) and names Trust Tasks over
DIDComm v2 as stage 3 of the delivery ladder (§5.4), "the only Trust-Task
carriage with a live peer today". The abstraction already exists and has two
implementors; this plan adds the third and the selection logic between them.

What "DIDComm v2" has to reach decides everything else, and there are two
counterparties with different requirements:

| Counterparty | What it needs | Who serves it |
|---|---|---|
| **Another Keyring wallet** (VRC/witness exchange, Trust Task documents) | a v2 envelope, a v2 connection, a mediator that routes v2 | entirely ours — no ecosystem party involved |
| **A VTA through the VTI mediator** (PNM, the VTA-carriage path, TSP as a sibling frame) | envelope byte-compat with `affinidi-messaging-didcomm`, `did:peer:2`, Affinidi's ATM mediator authentication, one WebSocket per DID carrying DIDComm and TSP frames | upstream's shape; we conform |

The first is reachable with a Credo-native v2 and our own mediator. The second
is reachable today only with `@openvtc/vti-didcomm-js`, and whether a
Credo-native v2 can also serve it is the single measured question this plan
turns on (§6, ref-18).

## 2. Current state (verified 2026-09-13)

**The seam is designed and has two implementors.**

- `Carriage` port — `bifold/packages/trust-tasks/src/carriage.ts`:
  `send(document, peer)` / `onDocument(handler)`. Its header says a later
  carriage "(TSP, DIDComm v2) implements the same interface without touching
  the task model".
- `DidCommV1Carriage` —
  `bifold/packages/core/src/modules/trust-tasks/module/DidCommV1Carriage.ts:22`.
  Binding `didcomm-v1/0.2`: a dedicated `TrustTaskMessage` `@type`
  (`bifold/packages/trust-tasks/src/TrustTaskMessage.ts:25`) with the document
  as a `trust-task` JSON attachment, sent through Credo's `DidCommMessageSender`
  on the existing connection.
- `TspCarriage` —
  `bifold/packages/core/src/modules/trust-tasks/module/TspCarriage.ts:52`.
  Packs the document into a real HPKE-Auth TSP envelope (`tsp.pack`, Askar
  identity via `@bifold/credo-tsp-adapter`) and carries the bytes as a
  `TspEnvelopeMessage` (Keyring-internal `@type`,
  `bifold/packages/trust-tasks/src/TspEnvelopeMessage.ts:24`) over the same
  v1 connection. Its header names it "deliberately double-wrapped crypto".
- **Selection** — `bifold/packages/core/src/modules/trust-tasks/ceremony.ts:451`
  (`tspCarriageEnabled ? createTspCarriage : createDidCommV1Carriage`) and
  inbound registration at `:541-544`. One boolean, set from the Developer
  screen (`app/src/hooks/useBCAgentSetup.ts:276`). The header at `:78-85`
  records "no auto-negotiation yet".
- **Witness** — `bifold/packages/witness-server/src/trustTasks/WitnessTaskSessions.ts`
  accepts both carriages and replies on the one the request arrived on.
- **Mediator** — `bifold/packages/mediator-server/src/MediatorService.ts`:
  Credo 0.6.3, `DidCommModule` only, HTTP inbound only, `QueueOnly`
  forwarding, pickup v2 polling. No v2 anywhere.
- **Credo** — `0.6.3` everywhere, with three yarn patches
  (`.yarn/patches/@credo-ts-{core,didcomm,react-native}-npm-0.6.3-*`). Agent
  config in `app/src/utils/bc-agent-modules.ts:96` (`DidCommModule`, peer DID
  resolver registered, mediation recipient `PickUpV2` at 1 s).
- **Rungs that touch v2** — `tsp-reference/ref-04-mediator` (one socket per
  DID, TSP/DIDComm demux by first byte), `ref-06x-cypress-stack` (the VTI
  mediator is v2-only, measured 404 for v1), `ref-08-credential-exchange`
  (a VTA reached over v2 via `vti-didcomm-js`). All Node, none in the wallet.

**What is absent:** any v2 envelope, v2 connection, v2 mediation or v2
message type in `app/`, `bifold/packages/*/src` or `e2e/`. Zero hits for
`application/didcomm-encrypted+json`, `DidCommV2`, `anoncrypt`.

## 3. The upstream landscape (verified 2026-09-13)

### 3.1 Credo has DIDComm v2 — unreleased, in PR #2704

[openwallet-foundation/credo-ts#2704](https://github.com/openwallet-foundation/credo-ts/pull/2704),
"feat: initial DIDComm V2 support", by genaris (a Credo maintainer). Measured
via the GitHub API on 2026-09-13:

- Open since 2026-03-18, last commit 2026-09-09, 91 commits, 282 files,
  +17,999 / −572, base `main` (= 0.7.0), one commit behind main.
  `mergeable_state: blocked`; CI on the head: Conformance Tests and one
  unit-test shard failing, DCO action required. Reviews stalled since June.
- Published as PR snapshots on npm under the `pr-2704` dist-tag:
  `@credo-ts/{core,didcomm,askar,anoncreds,node}@0.7.1-pr-2704-20260909134930`
  (five snapshots since 2026-08-27). Older `0.6.4-pr-2704-*` snapshots exist
  (last 2026-04-01) but predate 57 of the 91 commits.
- **Scope**, from the branch: `didcommVersions: ['v1' | 'v2']` on
  `DidCommModuleConfig` (default `['v1']`); `peerDidNumAlgoForV2OOB` (default
  `did:peer:4`, `did:peer:2` selectable); v2 envelope service using
  `ECDH-1PU+A256KW` authcrypt and `ECDH-ES+A256KW` anoncrypt with
  `A256CBC-HS512` default (`A256GCM`, `XC20P` accepted), X25519 / P-256 /
  P-384; sign-then-encrypt; `did:peer:2` and `:4` resolution; Out-of-Band
  2.0; DID rotation; Coordinate Mediation 2.0 + Message Pickup 3.0 / 4.0
  (`PickUpV4`, `PickUpV4LiveMode`); Routing 2.0 `forward`; BasicMessage 2.0;
  Discover Features 2.0; v1/v2 envelope conversion for shared protocols.
- **Custody:** the v2 envelope runs through `kms.encrypt`/`kms.decrypt` with
  `ECDH-1PU+A256KW` (`packages/didcomm/src/v2/DidCommV2EnvelopeService.ts:99-126`),
  so on React Native it is Askar all the way down — no WebCrypto, no raw
  key export. The PR touches `packages/askar/src/kms/*` to add the
  derivation.
- **Interop evidence inside the PR:** fixtures from the SICPA `didcomm-rust`
  implementation (`packages/didcomm/src/v2/__tests__/__fixtures__/sicpa/*`,
  authcrypt X25519/P-256, anoncrypt XC20P, signed EdDSA/ES256/ES256K).
  `affinidi-messaging-didcomm`, which the VTI stack uses, is that lineage.
- **A v2 mediator is in the box:** `samples/mediator.ts` gains
  `DIDCOMM_VERSION=v2` (`mediationProtocolVersions: ['v2']` plus a
  `mediatorRoutingDid` `did:peer:2`).
- **The PR body asks for exactly the evidence we can supply:** "Added here
  to allow releasing pr-versions and test behaviour on different platforms
  before the initial merge to main."

### 3.2 Who consumes it: Verana Labs

`verana-labs/vs-agent` pins `@credo-ts/{core,didcomm,anoncreds}@0.7.1-pr-2704-20260909134930`
with pnpm patches. **The patches are not DIDComm v2 fixes** — read on
2026-09-13, they add a Data Integrity credential-format service and link-secret
binding to the issue-credential protocol (`DataIntegrityDidCommCredentialFormatService`,
`W3cDataIntegrityApi`). Verana runs the PR's v2 unmodified, on a server. That
is evidence the snapshot is usable; it is not evidence it runs on Hermes or
against the VTI mediator, which nobody has measured.

### 3.3 The version hop the PR implies

npm `latest` for `@credo-ts/core` is **0.7.0**; the PR snapshots are 0.7.1-pr.
Keyring and upstream bifold (3.0.22) are both on **0.6.3**. Consuming the PR
means the 0.6 → 0.7 migration first ([guide](https://credo.js.org/guides/updating/versions/0.6-to-0.7)):
`Buffer` gone from `@credo-ts/core` (`Uint8Array` only), `TypedArrayEncoder`
renames (`fromString` → `fromUtf8String`, `toBase64URL` → `toBase64Url`),
**DIDComm attachments switch to base64url**, `LogLevel` keys PascalCase,
`ffi-napi`/`ref-napi` gone, and **Node 20 dropped (22 and 24 supported)**.
Askar 0.6, anoncreds 0.4, indy-vdr 0.3 are already where 0.7 wants them.

### 3.4 What the VTI side requires of a v2 client

From the pinned clones (`external/`, all verified at their pins):

- **Envelope:** `alg ECDH-1PU+A256KW`, `enc A256CBC-HS512` only —
  `vti-didcomm-js/src/pack.js:19-22` refuses A256GCM because the workspace
  mediator does not round-trip it. Anoncrypt inbound is rejected.
- **DIDs:** `did:peer` numalgo **2 only** (`src/did-peer.js:35-36`), `did:key`,
  `did:webvh`. No `:4`, no `did:web`.
- **Mediator:** Affinidi ATM — `POST /challenge` then an authcrypt'd
  `https://affinidi.com/atm/1.0/authenticate`, JWT smuggled as a WebSocket
  subprotocol, **one socket per client DID**, Message Pickup 3.0 live-delivery
  only, Routing 2.0 forward, TSP frames demuxed on the same socket by leading
  `-E` / `0xF8` (`src/mediator-transport.js:533-556`). The client DID must be
  in the mediator's ACL.
- **VTA service entry:** `{ type: "DIDCommMessaging", serviceEndpoint: [{ accept: ["didcomm/v2"], uri: "<mediator DID>" }] }`
  — `uri` is the mediator's DID, not a URL
  (`verifiable-trust-infrastructure/vta-service/src/operations/protocol/document.rs:205-213`).
- **Trust Tasks:** message `type` `https://trusttasks.org/binding/didcomm/0.1/envelope`,
  body = the document verbatim, reply correlated by `thid ?? id`
  (`vta-browser-plugin/packages/core/src/vta/protocol.ts:16-18`,
  `didcomm.ts:118-165`). The VTA's authcrypt sender is the authenticated
  caller (`vta-service/src/messaging/handlers.rs`).
- **Known historical break:** `vti-didcomm-js` ≤ 0.4 used a non-length-prefixed
  ConcatKDF `SuppPrivInfo` that "only interoperated with other equally-buggy
  peers, not credo-ts / didcomm-python"; 0.6.2 is spec-correct
  (`src/concat-kdf.js:29-34`). Credo ↔ Affinidi envelope compatibility is
  therefore plausible and **unmeasured**.

## 4. Design

**Keyring's DIDComm v2 envelope and connection layer is Credo's own, from PR
#2704, consumed as a pinned npm snapshot, on both legs: wallet-to-wallet
through our own mediator, and wallet-to-VTA through the VTI mediator via one
custom Credo transport (ref-18 proved it; `@openvtc/vti-didcomm-js` supplies
only `did:webvh` resolution and three plaintext builders, inlined or
depended on for exactly that).** The `Carriage` port gains a
`DidCommV2Carriage`, and the boolean flag in `ceremony.ts` becomes a
per-connection selection.

Why this and not the alternatives — the standing constraints, not the history:

- **One custody boundary.** The parent's §4.3 position is that private keys
  stay in Askar. Credo's v2 envelope is `kms.encrypt` over Askar (§3.1);
  `vti-didcomm-js` holds a raw private JWK in a `WeakMap`
  (`vta-browser-plugin/packages/core/src/didcomm/index.ts:66-76`) and has no
  injectable key-agreement port — the same wall `ref-09` had to build ports
  around for TSP. A wallet-wide v2 on `vti-didcomm-js` would either hold a
  second, software-only identity or repeat the port extraction for a library
  that is a VTA client, not a peer-to-peer stack.
- **One connection model.** The VRC exchange, the witness ceremony and Trust
  Task dispatch all key on Credo connection records (`theirDid` is the
  transport-authenticated sender in the v1 binding and in
  `TspCarriage.ts:89-93`). A second stack has no connection records; the
  identity mapping would have to be rebuilt.
- **Wallet-to-wallet needs no ecosystem counterparty** — the same argument
  `2026-09-02-bam.md` made for `TspCarriage`. Credo's v2 mediator mode gives
  our own `mediator-server` v2 routing; two Keyring wallets exchange real
  v2 envelopes with nothing upstream involved.
- **Hermes.** `vti-didcomm-js` needs `crypto.subtle` for AES-KW, AES-CBC,
  HMAC-SHA-512 and SHA-256 (`src/aes.js`, `src/a256cbc-hs512.js`); Keyring
  polyfills `subtle.digest` only (`app/index.js`). Porting it is a noble
  rewrite of its symmetric layer — real work with an upstream review cycle,
  the same play as the HPKE contribution. Credo's path needs none of it.
- **Coexistence is a config line, not an architecture.** `didcommVersions:
  ['v1','v2']` in one agent is the parent's §1.6 requirement met by the
  framework rather than by us.

**Rejected as the wallet's v2 stack — `@openvtc/vti-didcomm-js`.** For the
reasons above. It stays the *reference implementation* of the VTI dialect and
the measuring stick every rung diffs against, and it stays the VTA leg while
ref-18 is unanswered.

**Rejected — the `0.6.4-pr-2704` snapshots (the "no upgrade" route).** They
exist for every package we use (`core`, `didcomm`, `askar`, `anoncreds`,
`node`, `react-native`, last cut 2026-04-01) and would slot under 0.6.3
without the 0.7 hop. They predate 57 of the PR's 91 commits, and the missing
ones are disqualifying, not cosmetic: `A256CBC-HS512` content encryption
landed 2026-05-26 (#2808) and is the **only** `enc` the VTI mediator accepts
(§3.4); the v2 mediation and pickup fixes (#2733, #2749, #2766), Pickup 4.0
(#2839), the `_oob` invitation parameter (#2787), signed messages (#2812),
P-256 (#2811), DID rotation (#2845) and the September envelope-interface
refactor (#2924) all came later. A wallet on that snapshot could talk v2 only
to another copy of itself.

**Rejected — patch DIDComm v2 onto 0.6.3 ourselves.** The PR is +17,999
lines across 282 files (a new envelope service, a `v2/` crypto layer, KMS
derivation in Askar, peer DID numalgo 2/4, OOB 2.0, Mediation 2.0, Pickup
3.0/4.0, Routing 2.0). That is a subsystem, not a `.yarn/patches` overlay,
and it would be a fork of the PR that diverges from it the day it is cut.

**Rejected — fork Credo and rebase the PR onto 0.6.3.** The parent's §4.3
posture is "no credo-ts fork by default"; the PR's snapshots are the
maintainers' own no-fork route, and Verana proves it works.

**Rejected — wait for the merge.** No timeline exists (CI red, reviews stalled
since June). The PR body invites platform testing before merge; our RN and
mediator evidence shortens that wait rather than lengthening it (§8).

**Condition resolved (ref-15b + ref-18, 2026-09-13):** Credo's v2 envelopes
cross the Affinidi mediator in both directions with a Credo-packed ATM login.
V3 is therefore the Credo transport described in §6; the `vti-didcomm-js`
fallback `pnm_cnm_subtask.md` P1 specifies is no longer needed for this
plan, and P1 can consume the same transport.

## 5. Constraints this design inherits

Quoted, cited, pinned:

- **Binding `didcomm/0.2`** (`dtgwg-trust-tasks-tf` pin `7e0d755`,
  `bindings/didcomm/0.2/spec.md`): the message "MUST be encrypted using
  DIDComm's *authcrypt* algorithm (anoncrypt is not sufficient)"; the
  "verified `sender_kid` of the authcrypt envelope, normalised to its bare DID"
  is the transport-authenticated sender; producers "SHOULD set `thid` from the
  document's `threadId`" and fall back to the document `id`; where both
  `thid`/`threadId` are present "they MUST be equal" and a mismatch is
  `malformedRequest`, "not `identityMismatch`"; a consumer "MUST NOT populate
  a missing `threadId` or `parentThreadId` from the transport headers"; on
  `identityMismatch` the error "MUST" go to the transport-authenticated sender
  and "MUST NOT" go to the contested in-band `issuer`. The envelope type
  stays `…/binding/didcomm/0.1/envelope` across 0.2 by design.
- **Two thread rules, two bindings.** The v1 binding *omits* an
  unrepresentable correlator; the v2 binding *maps* it and errors on
  disagreement. `pnm_cnm_subtask.md` §2.2 already warns that "one
  thread-correlation helper serving both bindings is a trap". The
  `DidCommV2Carriage` gets its own `~thread` logic; it does not reuse
  `TrustTaskMessage.isTransportRepresentable`.
- **Task-version tolerance** (parent §4.2a): consumers accept N and N−1; the
  v2 carriage must accept envelope 0.1 producers (no `thid`) as the binding
  itself requires.
- **Credo 0.7 base64url attachments** (§3.3): `TspEnvelopeMessage` encodes
  the envelope with `TypedArrayEncoder.toBase64`; after the hop a 0.7 wallet
  and a 0.6.3 wallet may disagree on attachment encoding. V1 measures this
  before any fleet mixes.
- **Node.** The 0.7 migration guide says Node 20 is no longer supported, but
  `@credo-ts/core@0.7.0` publishes **no `engines` field** — nothing enforces
  it. Root `package.json` pins `>=20.19.2 <21`. V1 measures whether Node 20
  works before touching the toolchain; a bump to 22 is the fallback, not the
  plan.
- **Selection policy** is the parent's §4.2 verbatim: prefer by DID-document
  capability (`TSPTransport` > `DIDCommMessaging` with `accept: didcomm/v2` >
  v1), TTL cache, loud connect-time fallback, documents byte-identical across
  carriages.

## 6. Phases

Numbering follows `tsp-reference/README.md` at creation time (ref-14 is the
last tracked rung; ref-07b–e are claimed locally by the cred-spec #45 work).
Every rung: pure TS core, no RN imports, frozen fixtures, README stating what
it proves and does not.

### V0 — Feasibility on Node, zero app change

| Rung | Does | Done when |
|---|---|---|
| **ref-15-credo-didcomm-v2-hello** ✅ | Two `@credo-ts/node` agents on `0.7.1-pr-2704-20260909134930`, `didcommVersions: ['v1','v2']`, OOB 2.0 with `peerDidNumAlgoForV2OOB = did:peer:2`; BasicMessage 2.0 both ways; a v1 connection and a v2 connection alive in the same agent | **Met, 20/20 (2026-09-13, Node 20).** JWE header frozen: `ECDH-1PU+A256KW` / `A256CBC-HS512` / `application/didcomm-encrypted+json`, `skid` on `did:peer:2`; v1 and v2 deliver interleaved on one agent. Findings for V2: (1) the inviter gets **no** connection from the invitee's first v2 message *with the default config* — corrected 2026-09-14: `connections.autoCreateConnectionOnFirstMessage: true` makes `DidCommMessageReceiver` create it (role Responder, DID rotated on reusable invitations); the rung ran with the default `false`, which is what forces the PR's **return invitation** pattern. Every Keyring party sets the option (§6 V2 status); (2) BasicMessage 2.0 emits a separate `DidCommBasicMessageV2StateChanged` event; (3) `json-canonicalize@2.0.1` is a broken publish under npm — pin 2.0.0 (V1 step 1 must carry this) |
| **ref-15b-crossimpl-envelope** ✅ | Credo's v2 authcrypt JWE unpacked by `@openvtc/vti-didcomm-js@0.6.2` `unpack`, and its JWE unpacked by Credo; ConcatKDF `SuppPrivInfo` framing checked explicitly | **Met, 11/11 (2026-09-13).** Both directions on the first attempt, `legacyKekUsed: false` (spec-correct KDF), kids agree (`#key-N`), both reject tampering. **§4's envelope condition is closed**: what ref-18 still has to show is the Affinidi mediator's login and socket, not crypto |
| **ref-16-trust-task-over-v2** ✅ | The binding-0.2 envelope as a Credo v2 message class (pattern: `DidCommBasicMessageV2`), body = document, `thid`/`pthid` mapped per §5; the `ref-06v1c` task-layer checks rerun over it | **Met, 16/16.** Document canonical bytes identical over v1 and v2; pipeline handles request and `#response` with real ajv payload validation; thread rule and `identityMismatch` routing as §5 states; anoncrypt refused before the pipeline. **Finding for C10**: Credo's v2→v1 normaliser spreads `body` beside `@id`/`@type` — a document's `id`/`type` overwrite the envelope's and `threadId` hits a getter-only accessor and throws; the carriage's message class must expose renamed properties for those four keys (done in the rung, inherited by `DidCommV2Carriage`). Candidate #2704 issue |
| **ref-17-v2-mediated** ✅ | A Credo mediator on the snapshot in v2 mode — real localhost HTTP/WS, `QueueOnly` like production, routing DID self-derived — two outbound-only recipients, pickup 4.0 polling, the ref-16 document through store-and-forward; and one agent holding **v1 mediation to a v1-only mediator and v2 mediation to the v2 one** at once | **Met, 14/14.** First end-to-end run of Credo v2 mediation anywhere (upstream's own e2e is `it.skip`). Send→receive ≈ 300 ms at a 300 ms poll. **Q3 answered yes**: two mediation records coexist, `getRouting({ mediatorId })` selects the route per invitation, two pickup loops deliver. Findings for C12/C13: (1) a wallet whose default mediator is v1 **cannot accept a v2 invitation** without explicit `routing: getRouting({ useDefaultMediator: false })` — every existing install is in that state; (2) the newest provision **silently becomes the default mediator** — reset it deliberately; (3) the mediator side of a v2 pairing needs the return invitation (ref-15 finding 1) — resolved by the same option: `mediator-server` in v2 mode sets `autoCreateConnectionOnFirstMessage` and mints a reusable out-of-band/2.0 invitation, so a wallet provisions with one invitation |
| **ref-18-vti-mediator-credo-v2** ✅ | A Credo-v2 agent through the real Affinidi mediator (ref-04's public dev instance): ATM login with a Credo-packed authenticate, the `bearer.<jwt>` live-delivery socket feeding `DidCommMessageReceiver`, Credo packages wrapped in a Credo-packed Routing 2.0 forward; a `vti-didcomm-js` peer on the other side | **Met, 6/6 — decides V3 for Credo.** Both directions live in ≈100 ms; keys never leave Askar (`resolveCreatedDidDocumentWithKeys` maps the connection DID's keyAgreement to its `kmsKeyId`). `vti-didcomm-js` contributed only `did:webvh` resolution and three plaintext builders. Findings for D15: the transport must open the mediator's own Pickup 3.0 frames (Credo has no webvh resolver and no Pickup 3.0 handler) and send the queue-id ack itself. Not shown: a VTA reply in the same run (ref-08 + ref-15b cover it by composition), the TSP `0xF8` demux with a Credo identity |

**Gate passed 2026-09-13: all five green.** §4's condition is closed in
favour of Credo-native v2 on both legs; §4 and D15 below are worded
accordingly. Not exercised in Stage A and carried into V3's acceptance: a
VTA reply and a TSP frame on the Credo-held socket in one run.

### V1 — The version hop (a branch in Keyring + the bifold fork)

The hop itself is small. 0.7.0's breaking changes are three mechanical ones
(`Buffer` → `Uint8Array` with the `TypedArrayEncoder` renames, DIDComm
attachments base64url, `LogLevel` keys PascalCase); everything else in its
changelog is X509/RSA patches. The cost is in re-proving, not in rewriting.
One runtime requirement the changelog does not list, found only on a
simulator (B7): `TypedArrayEncoder.toUtf8String` now decodes with
`new TextDecoder('utf-8', { fatal: true })`, which the app's
`fast-text-encoding` polyfill rejects at construction — every Askar KMS key
creation fails and the agent never initializes ("Error during call to
'onInitializeContext' method in module 'didcomm'"). The app wraps the
polyfill in `app/index.js` to accept the option and enforce it (round-trip
through the encoder; invalid input throws `TypeError` as the spec says).
Jest never sees it (Node has a native `TextDecoder`), which is why every
unit gate was green while no device could start an agent. A second
runtime change, found on the witnessed simulator run: `verifyPresentation`
now requires the presentation's holder to authenticate every included
credential's subject. A VRC is presented by its issuer, so the check can
never pass; the core patch adds an opt-out
(`verifyCredentialSubjectAuthentication: false`, upstream default kept)
that the witness's two verification paths and the wallet's outcome-evidence
self-check pass, since they verify party membership themselves.

1. Credo 0.6.3 → 0.7.0 on a branch in both repos. Re-derive the three yarn
   patches (check first whether the `DcqlService` `ldp_vc` filter bug and the
   VCDM 2.0 `issuanceDate` requirement are fixed upstream in 0.7; drop patches
   that are). Measure Node 20 first; bump to 22 only if something breaks.
   **Done 2026-09-14** on `feat/credo-0.7` (worktree `../keyring-credo-0.7`,
   bifold branch of the same name): `yarn typecheck` 0 errors, `yarn lint`
   clean, app jest 117/117, bifold core 1,757 passing (three RN screen tests
   time out only under machine load and pass in isolation), trust-tasks,
   credo-tsp-adapter 4/4 and witness-server 713 green — all on Node 20.19.2.
   What the hop actually required, for the record (reasoning in
   [`2026-09-13-al.md`](./2026-09-13-al.md)):
   - none of the six patched fixes is upstream in 0.7.0; all three patches
     re-applied with `yarn patch` without a single rejected hunk;
   - **native libraries move with Credo**: `@credo-ts/anoncreds` 0.7 peers on
     `@hyperledger/anoncreds-shared ^0.4.0` and `@credo-ts/indy-vdr` on
     `indy-vdr-shared ^0.3.0`, so `anoncreds-react-native` 0.3.4 → 0.4.0 and
     `indy-vdr-react-native` 0.2.4 → 0.3.0; our indy-vdr JSI patch is
     upstream in 0.3.0 (deleted), the anoncreds gradle `namespace` patch
     still applies (renamed);
   - `LogLevel` PascalCase (11 files), `toBase64URL` → `toBase64Url` (2),
     `fromBase64` → `fromBase64Url` for JWK members (2 — the adapter's only
     real 0.7 failure);
   - jest: Credo 0.7 pulls ESM-only `@scure/base`, `@owf/mdoc`,
     `@verifiables/request-converter` and `ky` — added to every jest
     transform allowlist; `@owf/mdoc` uses static class blocks, so
     `@babel/plugin-transform-class-static-block` is in both babel configs
     (Metro shares them, so the app bundle needs it too);
     `@verifiables/request-converter` exposes only `import` and `types`
     conditions and needs a `moduleNameMapper` entry;
   - `json-canonicalize@2.0.1` pinned to 2.0.0 (ref-15 finding);
   - a pre-existing local build defect fixed on the way: `rxjs` was nested
     twice under `react-hooks` (the root portal install resolved its loose
     `^7.2.0` to 7.8.1), which is what the "react-hooks cannot build locally"
     note was really about — `rxjs: 7.8.2` in both projects' resolutions,
     and react-hooks' `rimraf`/`typescript` devDeps aligned to hoistable
     versions because the root linker strips a portal's nested
     devDependencies on every install.
   Not yet done from this step: the gradle lockfile for the native bumps
   and the merge into the rung branch. B7's simulator half is recorded in
   the companion (the `TextDecoder` finding above came out of it).
   *Done when:* `yarn typecheck`, `yarn test`, `bifold/packages/core` tests
   and `e2e:vrc:devices` are green with v1 unchanged.
2. **Mixed-fleet rung**: a 0.7 wallet against a 0.6.3 build for the v1
   Trust Task attachment and the TSP envelope attachment (base64url change).
   *Done when:* both directions decode, or the encoding shim is in place and
   fixture-proven.
3. Swap to the exact `pr-2704` snapshot, recorded like an external pin (the
   version string, the date, the `--why`), with any patch overlay in
   `.yarn/patches`, never the moving `pr-2704` dist-tag. Tripwire: the PR
   merging, or a `0.8.0` line appearing on npm.
   *Done when:* step 1's gates are green again on the snapshot, and the
   `mediator-server` and `witness-server` build on it.
   **Done 2026-09-14**, same worktree: every `@credo-ts/*` we use pinned to
   `0.7.1-pr-2704-20260909134930` (all ten exist at that version;
   `push-notifications` stays 0.7.1, it only peers on core); the three
   patches re-derived against the snapshot with `yarn patch`, zero rejected
   hunks; all gates green again (typecheck 0, lint 0, app 117/117, core
   191/191 suites, trust-tasks, adapter 4/4, witness 713).
   **One overlay hunk the snapshot needed that 0.7.0 did not, and it is a
   tripwire in its own right:** the snapshot is the PR *plus Credo `main` as
   of 2026-09-09*, and `main` is mid-way through moving generic Data
   Integrity credentials into a new `w3c-di` module. Its legacy JSON-LD
   credential, presentation and proof-transformer classes now accept a
   `DataIntegrityProof` only with the `anoncreds-2023` cryptosuite and throw
   for ours (`eddsa-jcs-2022`, `eddsa-rdfc-2022`), which broke the VWC
   bundle, witness-share and ceremony-issue suites. The core patch now maps
   any other cryptosuite to the generic proof class as 0.7.0 did. Every
   `pr-2704` snapshot carries this restructure (the Aug 27 one already has
   `w3c-di`), so there is no older snapshot to hide behind. Consequence for
   the parent plan's Data Integrity work: **whatever Credo release ships
   DIDComm v2 will also ship `w3c-di`**, and Keyring's DI signing and
   verification should move onto that module rather than rely on this
   overlay — a scoped item for the DI thread
   ([`CRYPTO_SUITE_FOLLOWUP.md`](../../CRYPTO_SUITE_FOLLOWUP.md)), not for
   this plan.
   Also found on the way: bifold's tree hoisted `@peculiar/asn1-schema`
   2.6.0 (via `@animo-id/pex`'s old mdoc dependency) while Credo's x509 2.x
   needs 2.9.4 nested, splitting the ASN.1 schema registry and failing every
   suite that loads core; pinned to 2.9.4 in bifold's resolutions.

### V2 — Wallet integration on the existing seams

1. `DidCommV2Carriage` beside the two existing carriages, implementing the
   `Carriage` port with the ref-16 message class; inbound registered in
   `setupTrustTasksInbound`.
2. `selectCarriage(connection)` replaces the boolean at `ceremony.ts:451`:
   the §4.2 ladder over the connection's DID document (`TSPTransport` >
   `DIDCommMessaging accept didcomm/v2` > v1), a TTL cache, one logged
   fallback per session. Developer screen: `enableDidCommV2` beside
   `enableTspCarriage`.
3. Agent config: `didcommVersions: ['v1','v2']`, `peerDidNumAlgoForV2OOB =
   did:peer:2`; v2 invitations in the connect/QR flow behind the flag.
4. `mediator-server` v2 mode (from ref-17); `WitnessTaskSessions` accepts the
   v2 carriage and replies on it.
5. `yarn e2e:vrc:didcomm-v2` and a witnessed variant, marker-gated like the
   TSP suites.
   *Done when:* the legacy flow is untouched (`e2e:vrc:devices` green); the
   same Trust Task document is fixture-identical over v1, v2 and TSP; the
   witnessed ceremony completes over v2 on two devices; a sub-v4 peer never
   sees a v2 invitation.

**V2 status (2026-09-14, same worktree, uncommitted):** steps 1–5 are
built and step 5's simulator run is **green** (two Android emulators, the
local mediator in v2 mode — `2026-09-13-al.md`, "C14 simulator runs"); the
witnessed variant of 5 is not built. What landed, and what it taught:

- `@bifold/trust-tasks` gains `TrustTaskEnvelopeV2Message` (the binding-0.2
  envelope: `toV2Plaintext` puts the document in `body` with `thid`/`pthid`
  per §3.1; inbound reassembly with the four `Expose`-renamed properties
  ref-16 measured) and `v2Binding.ts` (`checkV2ThreadCorrelation`, the pure
  §3.1 rule, and `ensureV2ConnectionForFirstContact`, the fallback for a
  party that has not enabled Credo's own first-contact creation — through
  the public `DidCommConnectionService`, the same Responder/Completed record
  Credo writes). Both platform-neutral, so the witness-server runs the same
  code.
- `@bifold/core` gains `DidCommV2Carriage` (the third `Carriage`
  implementor: authcrypt only, thread rule, first contact, then the same
  handler as v1) and `selectCarriage(agent, connectionId)` replacing the
  boolean at `ceremony.ts`: a v2 connection always takes the v2 binding, a
  v1 connection takes TSP when the developer flag is on, else v1. The v2
  inbound handler is always registered (it fires only for its own type);
  the `enableDidCommV2` developer flag decides only the agent's
  `didcommVersions` and whether a relationship invitation is Out-of-Band
  2.0 on `did:peer:2`. The scan/paste path stops rewriting `_oob` when the
  payload is a 2.0 invitation.
- **First contact is a Credo option, not a gap.** ref-15 finding 1 and
  ref-17 finding 3 measured the default: `connections.
  autoCreateConnectionOnFirstMessage` is `false` unless set, and with it
  `true` `DidCommMessageReceiver` creates the inviter's connection on the
  first authenticated message (matching `to` against our sender-role OOB
  records, role Responder, DID rotated for reusable invitations). The app
  sets it with the flag, `mediator-server` sets it in v2 mode; the helper
  above stays as the fallback and the two rung READMEs carry the correction.
  The "runbook blocker" the earlier status named is gone; §7.1 item 5 is
  now only the ordinary deployment runbook.
- **The v2 mediator is a second mediation record, never the default.**
  `mediator-server --didcomm-v2` (`yarn mediator --didcomm-v2`) serves v1
  and v2 and mints a reusable out-of-band/2.0 invitation beside the v1 one,
  written to `app/.env` as `MEDIATOR_V2_URL` (blank when v2 is off, so a
  stale value cannot survive a restart). With the flag on, the app after
  agent start runs `provisionV2Mediation` (`@bifold/core`
  `trust-tasks/v2Routing.ts`): accept the invitation with
  `getRouting({ useDefaultMediator: false })` (ref-17 finding 1),
  `provision()`, then put the v1 default back (ref-17 finding 2 — the
  newest grant becomes default otherwise), then a second pickup loop,
  Pickup 4.0 against the v2 record, started after the v1 loop because the
  patched v1 start stops every loop and the v4 start does not. v2
  invitations (created in `createRelationshipInvitation`, accepted in
  `connectFromInvitation`) route via `getRoutingForV2`: the v2 record by id
  when granted, unmediated otherwise — never the v1 default. Idempotent on
  every start; a provisioning failure is logged and the wallet stays on v1.
  Tested in `v2Routing.test.ts` (8 cases).
- Step 5's runner exists: `yarn e2e:vrc:didcomm-v2` (`e2e/
  run-vrc-exchange-didcomm-v2.js`, Android+Android like the TSP suite):
  onboarding, `enableDidCommV2` on both, the Mediation 2.0 grant marker on
  both **before** the invitation is minted, an `_oob=` invitation, the
  relationship proposal, both VRCs, then the Trust Task markers plus the
  `[TrustTasks:DidCommV2Carriage]` sent/received markers. **Passed on the
  fifth attempt**; the four failures were all wallet configuration, none
  protocol: (a) the persisted flag was not rehydrated by `container-imp.ts`'s
  `LOAD_STATE` loader (the TSP flag was; the v2 one was missing); (b)
  `mediationRecipient.mediationProtocolVersions` must list `'v2'` or the
  Coordinate Mediation 2.0 handlers are never registered and the mediator's
  grant is answered "message type is not supported" — Credo's default is
  `['v1']`, and every option ref-17 set on its recipient
  (`didcommVersions`, `peerDidNumAlgoForV2OOB`, `mediationProtocolVersions`,
  `autoCreateConnectionOnFirstMessage`) now has its line in
  `bc-agent-modules.ts`; (c) a harness flake in the auto-lock helper (one
  retry added); (d) the VRC connection handler and the chat notifier
  listened only to the BasicMessage 1.0 event, and the relationship-DID
  exchange that precedes every Trust Task rides BasicMessage — over a v2
  connection Credo emits `DidCommBasicMessageV2StateChanged` instead
  (ref-15 finding 2, now applied: one handler subscribed to both events).
  Measured on the passing run: OOB 2.0 invitation on `did:peer:2` whose
  service is the v2 mediator's routing DID (so the exchange was mediated,
  not direct); inviter-side connection created by Credo on the invitee's
  first message; Trust Task discovery, propose, issue and issue-receipt all
  as `[TrustTasks:DidCommV2Carriage]` envelopes; **and the R-Card leg —
  issue-credential 2.0 offer/request/issue/ack — completed over the v2
  connection too**, carried by Credo's v2 normaliser, so the "last legacy
  leg" is not a v2 blocker.
- **Finding for C10, and for the app bundle:** class-transformer's `Expose`
  metadata store is module-local (0.5.1), and bifold's test tree carries
  nested copies under every `@credo-ts` package — so the renames registered
  by `@bifold/trust-tasks` were invisible to Credo's `JsonTransformer` and
  every threaded document crashed the transform, exactly ref-16's naive
  case. Fixed the way the repo already fixes Askar: `class-transformer` is
  mapped to one copy in the app and core jest configs, and added to Metro's
  singleton list so the bundle has one copy too. Anything else that
  registers class-transformer metadata from a portal package has the same
  need.
- Tests: `didCommV2Carriage.test.ts` (12 cases: packing shape, reassembly,
  thread rule, refusal without an authenticated sender, first contact on our
  invitation, refusal on a foreign DID) beside the existing ceremony and TSP
  suites. Gates after the change: typecheck, lint and prettier clean in the
  app; app jest 117/117 (the Developer screen snapshot updated for the new
  row); bifold core 192 suites green (two invitation expectations updated
  for the new `didCommVersion` member; two screen suites time out only
  under load and pass alone); trust-tasks, credo-tsp-adapter 4/4,
  witness-server 713.
- The witness serves v2 behind `WITNESS_DIDCOMM_VERSIONS=v1,v2`: the agent
  gets `didcommVersions`, `did:peer:2` for its v2 invitation and
  `autoCreateConnectionOnFirstMessage` (a wallet's first message — its
  relationship DID, sent right after accepting — creates the witness-side
  connection and fires the completed event the witness announcement listens
  for); both existing `createInvitation` calls pin `didCommVersion: 'v1'`
  (with v2 on, Credo infers v2 for a bare call, which would have flipped the
  v1 invitation under every existing wallet); a second reusable
  out-of-band/2.0 invitation is minted, persisted beside the v1 one and
  exposed as `getInvitationV2Url()`. The e2e harness's `startWitness({
  didcommV2: true })` returns it, and `yarn e2e:vrc:witnessed:didcomm-v2`
  (Android emulator + iOS simulator) drives the witnessed exchange over
  v2 — with the iOS markers read from a live `log stream` capture (the
  unified log does not persist the app's info lines), so iOS is asserted,
  not assumed. **Green on 2026-09-14** (companion, "Witnessed v2 on Android
  + iOS"): both wallets mediated on v2, the witness leg on v2 (a trust ping
  is the first contact on any accepted non-VRC v2 invitation, since v2 has
  no handshake and the inviter learns of us only from our first message),
  the ceremony and the witness share over v2 envelopes, Witnessed shields on
  both. Wallet-side fixes on the way: the Developer row toggles its switch
  on tap (iOS hid the Switch from automation), and `verifyPresentation`
  opts out of Credo 0.7's holder-binding rule at the three call sites.
- Device runs are done (2026-09-15, iPhone 16 + iPad A16): v1, TSP over v2,
  and TSP over v2 with locality, all green with the badge assertions made
  strict. See the V2T status below and `2026-09-13-al.md`, "Real devices"
  and "The attestation bug the strict badge check found".
- Still open in V2: from V1, B8's mixed-fleet check (a 0.7 wallet against a
  0.6.3 build over v1) and the gradle lockfile for the native bumps.
  Nothing is committed in either repo of the worktree yet.

### V2T — The TSP envelope over a DIDComm v2 connection

**What it is.** The TSP envelope carriage that already rides DIDComm v1
connections (`TspCarriage`, behind the developer flag) rides DIDComm v2
connections too. The Trust Task document is unchanged and stays
byte-identical across carriages (ref-16); only the connection that delivers
the envelope changes. Selection stays flag-driven: with "Enable TSP envelope
carriage" on, every connection — v1 or v2 — takes the TSP carriage; with it
off, each connection takes its own DIDComm binding. This is wallet-to-wallet
and wallet-to-witness only. It is **not** an interop claim and does **not**
build the parent plan's §4.2 envelope-format resolver (`TSPTransport`
service discovery, TTL cache, loud fallback), which remains unbuilt; TSP
without DIDComm underneath is V3.

**Why it is small.** The `Carriage` port (bifold `c3311a37`) keeps documents
out of the transport, and `TspCarriage` implements it (bifold `908a7805`),
so the seam exists. What does not yet work is three v1 assumptions inside the
TSP implementation, each verified against the pinned snapshot on 2026-09-14:

1. **Key agreement keys.** `identityFromDid` (`credo-tsp-adapter/src/identity.ts`)
   derives our X25519 key by converting the DID's Ed25519 signing key, while
   `createCredoVidResolver` encrypts to the *peer's* `keyAgreement`
   verification method. On v1 peer DIDs those are the same key. On a v2
   connection they are not: when `didcommVersions` includes v2,
   `DidCommRoutingService.getRouting` creates a separate X25519 key and
   `createPeerDidForV2OOB` publishes it as `#key-2` with its own KMS key id.
   A receiver on a v2 connection would therefore derive a key the sender
   never encrypted to. **Change:** `identityFromDid` uses the `keyAgreement`
   method's own KMS key when the DID record holds one, with no conversion,
   and keeps the Ed25519→X25519 derivation as the fallback, so v1 DIDs behave
   exactly as today. The same change covers the witness, whose DID is rotated
   through `getRouting` on reusable v2 invitations.
2. **The delivery message.** `TspEnvelopeMessage` is a v1 message carrying
   the envelope as a base64 appended attachment. Credo's v1→v2 normaliser
   carried attachment-bearing v1 messages over v2 in the C14 run
   (issue-credential 2.0), but an appended attachment's byte-exact round trip
   is unmeasured, and 0.7 moved attachment encoding to base64url (§3.3).
   *Conditional design, decided by T2:* keep the existing class if the
   envelope bytes survive unchanged; otherwise add a v2-native sibling
   (`supportedDidCommVersions: ['v2']`, envelope as base64url in `body`)
   registered beside it, the pattern `TrustTaskEnvelopeV2Message` already
   follows.
3. **Sender binding under DID rotation.** The inbound check requires
   `unpacked.sender === connection.theirDid`. A reusable v2 invitation (the
   witness's) rotates the inviter's DID with `from_prior`, so an envelope
   packed for or by the pre-rotation DID fails that check — the
   `wrongRecipient` refusal seen on the witness leg of C14 is the same
   class. **Change:** the sender check accepts `theirDid` or any entry of
   `previousTheirDids`, and our receiving identity is chosen by the
   envelope's receiver VID among `did` and `previousDids`. The check still
   authenticates a DID this connection has actually held. Wallet-to-wallet
   VRC invitations are single-use and do not rotate.

**Selection and markers.** `selectCarriage` applies the TSP flag to v2
connections as well as v1. `TspCarriage` logs the delivering connection's
version (`envelope sent on v2 connection …`), so an e2e run can prove the
envelope rode v2 and not v1. The inbound TSP handler is already registered
whenever the flag is on, independent of connection version. The witness
replies on the carriage a document arrived on, so it needs changes 1–3 and
no selection change.

**Cost, stated.** Two sign-and-encrypt layers: TSP HPKE-Auth inside DIDComm
v2 authcrypt, the same double wrap TSP has over v1 today. Acceptable for a
developer-flagged prototype; removing it is V3's job.

**V2T status (2026-09-14, worktree, uncommitted):** T1–T4 done. T1: the
TSP suite passes on the snapshot unchanged. T2: `ref-19` measured change 1
as predicted (8/15 against the unfixed adapter, every failure an HPKE
`invalid tag` from the key mismatch) and answered both open questions —
the existing `TspEnvelopeMessage` delivers envelopes byte-exact over v2
(Q7: no new message class), and accepting previous DIDs handles rotation
(Q8). T3: `identityFromDid` uses the document's own `keyAgreement` key
(converting only Ed25519) with a `did:peer:2` unit test; ref-19 15/15.
T4: the receive rule is one adapter helper, `unpackForConnection`, used by
`TspCarriage` and the witness; `selectCarriage` returns TSP whenever the
flag is on; the carriage logs the delivering version; tests cover the
four-way selection table and a rotated-DID envelope (core Trust Task and
VRC suites 800/800, witness 713, adapter 5/5). The Developer screen's TSP
row now toggles on tap, the same iOS automation fix the v2 row needed.
**T5 and T6 green (2026-09-14/15)**, and both T6 regression checks green
on the same build: `yarn e2e:vrc:tsp` (every envelope logged "on v1
connection") and `yarn e2e:vrc:witnessed:didcomm-v2` (Android + iOS).
**Devices green (2026-09-15, iPhone 16 + iPad A16, both physical.)** Three
runs on the new two-iOS-device runner, every badge assertion strict:
`vrc-exchange:witnessed:ios-devices` (v1), `…:didcomm-v2:tsp`, and
`…:didcomm-v2:tsp:locality`. Coordinate Mediation 2.0 on both wallets, the
witness leg on v2, every Trust Task document a TSP envelope over v2 (no
plain-v2 binding), and the contact screens carrying **Secure Exchange +
Verified**, plus **In-Person** on the locality run — the full shield set on
hardware, which no simulator suite can produce.

The strict badges paid for themselves immediately: they caught an iOS
attestation bug the lenient assertions had been passing over. Building
evidence *after* a signature could regenerate the App Attest key that had
just signed, so the evidence carried a different key's certificate chain and
every verifier rejected it. Evidence assembly now reuses the chain the
device already holds for the signing key — no Apple call, no key mutation —
and never pairs a chain with a public key it does not certify
(`2026-09-13-al.md` has the log trace, the fix and its regression tests).

V2T is done on simulators and on devices. What it does not cover: the
`TSPTransport` resolver of parent §4.2 (selection stays flag-driven), and
TSP without DIDComm underneath (V3).

*Done when:* T1–T6 in §6.1 are green — in particular a relationship exchange
and a witnessed exchange (Android emulator + iOS simulator) complete with
every Trust Task document carried as a TSP envelope over a v2 connection,
and `yarn e2e:vrc:tsp` over v1 still passes on the same build. **Met, and
carried onto two physical iOS devices (2026-09-15).**

### V3 — The VTI leg (conditional on ref-18)

One Credo transport pair (`DidCommInboundTransport` / `DidCommOutboundTransport`)
implementing the ATM handshake, one socket per DID, Pickup 3.0 live delivery,
and `onTspFrame` → `TspCarriage` **without** the DIDComm double-wrap — TSP as a
sibling frame, the end state ref-04 measured. This is the transport half of
`vti-client` (parent §5.2) and what `pnm_cnm_subtask.md` P1 consumes.
*Done when:* ref-08's `credential-exchange/query` reaches a local VTA from a
Credo agent over the Affinidi mediator, and a TSP ping crosses the same socket.
If ref-18 is red: this phase is `vti-didcomm-js` as P1 already specifies, and
§4's condition is closed the other way.

### 6.1 The same phases as a numbered step list, in plain words

Stage A proves it works, in Node, without touching the app. Stage B moves
Credo. Stage C puts v2 in the wallet on the seam that already exists. Stage T
carries the TSP envelope over those v2 connections (phase V2T). Stage D is the
VTA side and depends on step 5's answer.

| # | Step | Where | Done when |
|---|---|---|---|
| **A1** | Two Node agents on the `pr-2704` snapshot, v2 turned on, connect with a `did:peer:2` invitation, send a message each way; keep a v1 connection alive in the same agent | `tsp-reference/ref-15` (its own `package.json`; the app stays on 0.6.3) | both messages arrive; envelope header frozen as a fixture |
| **A2** | Encrypt with Credo, decrypt with `vti-didcomm-js`; then the reverse | `ref-15b` | both directions round-trip |
| **A3** | Write the v2 Trust Task message class (a copy of `TrustTaskMessage` with the v2 type, body = document, `thid` from `threadId`); send one document over v1 and over v2 | `ref-16` | the document bytes are identical on both; the four binding rules in §5 pass |
| **A4** | Run our mediator's module config on the snapshot in v2 mode; two agents through it; also one agent with v1 mediation to the production mediator and v2 to the local one | `ref-17` | the document crosses; pickup latency recorded; "dual mediation works: yes/no" recorded |
| **A5** | A Credo agent through the Affinidi mediator to a local VTA, using `vti-didcomm-js` only for the socket and its login | `ref-18` (ref-04/05 infrastructure) | the VTA answers a ping — or the exact failure is named. **Decides Stage D** |
| **B6** | Branch both repos; bump every `@credo-ts/*` to 0.7.0; fix the three mechanical breaks; re-derive the three yarn patches; try Node 20 first | root resolutions, `app/`, `bifold/packages/{core,trust-tasks,credo-tsp-adapter,mediator-server,witness-server,react-hooks}` | `yarn typecheck`, `yarn test`, core tests green |
| **B7** ✅ | Re-prove v1 unchanged | simulators, then a device pair | green; **devices 2026-09-15**: `yarn e2e:vrc:witnessed:ios-devices` (iPhone 16 + iPad A16) green with strict badges |
| **B8** | A 0.7 build against a 0.6.3 build: the Trust Task attachment and the TSP envelope attachment (base64url change) | a device pair | both decode, or a shim is in and fixture-proven |
| **B9** | Swap 0.7.0 for the exact `pr-2704` snapshot; run B6–B7 again; record version, date and why; set the tripwire (PR merged, or a 0.8 line on npm) | same files | green again |
| **C10** | `DidCommV2Carriage` beside the other two, using A3's message class (moved into `@bifold/trust-tasks`); register inbound | `bifold/packages/core/src/modules/trust-tasks/module/` | unit tests mirror the v1 carriage's |
| **C11** | Replace the boolean at `ceremony.ts:451` with `selectCarriage(connection)`: `TSPTransport` → TSP, `DIDCommMessaging accept didcomm/v2` → v2, else v1; TTL cache; one logged fallback; Developer toggle `enableDidCommV2` | `ceremony.ts`, `Developer.tsx`, `store.tsx` | selection covered by unit tests per DID-document shape |
| **C12** | Agent config `didcommVersions: ['v1','v2']`, `peerDidNumAlgoForV2OOB = did:peer:2`; v2 invitation at `vrc-manager.ts:2518` behind the flag; QR/paste path parses `_oob` | `bc-agent-modules.ts`, `vrc-manager.ts`, invitation helpers | a v2 invitation fits the QR and is accepted on a device |
| **C13** | A **second** mediator deployment in v2 mode beside the untouched v1 one, per §7.1 (runbook reviewed first; rollback is the v1 URL); witness gains a `didcomm-v2` carriage and replies on it | `mediator-server` locally; the `credo-mediator` deployment for production; `WitnessTaskSessions.ts` | ref-17's checks pass against the new host; a v1 wallet on the old host is unaffected |
| **C14** | `yarn e2e:vrc:didcomm-v2` and a witnessed variant, marker-gated like the TSP suites; then, once the regular unit and e2e gates are green on the branch, a **simulator run** of the ordinary VRC exchange with v2 enabled (iOS simulator + Android emulator, the same pair `yarn e2e:vrc` drives) as the integration milestone before any device work. **Status 2026-09-14:** legacy `yarn e2e:vrc` green on the snapshot (Android emulator + iOS simulator, production mediator); `yarn e2e:vrc:didcomm-v2` green (two Android emulators, local mediator in v2 mode); `yarn e2e:vrc:witnessed:didcomm-v2` green (Android emulator + iOS simulator, tunnel mediator in v2 mode, witness on v1+v2) | `e2e/` | legacy suites still green; document identical over v1/v2/TSP; witnessed ceremony over v2 on two devices; the simulator run recorded in the companion |
| **T1** ✅ | Baseline first: run the existing TSP suite on the `pr-2704` snapshot. It has not run since the Credo hop, and the hop changed attachment encoding and UTF-8 decoding | `yarn e2e:vrc:tsp` (two Android emulators) | green, or each fix recorded in the companion |
| **T2** ✅ | A Node rung: two Credo agents on the snapshot with a v2 connection (single-use and reusable invitation), TSP pack/unpack through `credo-tsp-adapter` both directions, delivered in `TspEnvelopeMessage` over v2; the rotation case before and after the inviter's first message; a v1 connection on the same agent still carrying TSP | `tsp-reference/ref-19-tsp-over-didcomm-v2` | all checks green; whether the envelope bytes survive v2 unchanged is recorded, deciding V2T change 2 |
| **T3** ✅ | Adapter: `identityFromDid` uses the `keyAgreement` method's own key when present, derivation as fallback | `bifold/packages/credo-tsp-adapter` | unit tests cover a Credo-minted `did:peer:2` (distinct `#key-2`) and a v1 peer DID; ref-19 passes against the package, not a copy |
| **T4** ✅ | Carriage: sender check over `theirDid` + `previousTheirDids`, receiver identity chosen by the envelope's receiver VID, delivery version in the log line, TSP flag honoured on v2 connections; the v2 message class only if T2 requires it; the witness gets the same changes | `TspCarriage.ts`, `ceremony.ts` `selectCarriage`, `WitnessTaskSessions.ts` | core, trust-tasks, credo-tsp-adapter and witness-server suites green; a selection test covers all four combinations of connection version × TSP flag |
| **T5** ✅ | e2e: relationship exchange with both the DIDComm v2 and TSP developer settings on | `yarn e2e:vrc:didcomm-v2:tsp` (two Android emulators, local mediator in v2 mode) | Mediation 2.0 granted on both; `[TrustTasks:TspCarriage] envelope sent/received on v2 connection` on both; no `[TrustTasks:DidCommV2Carriage]` envelope markers for the exchange; both VRCs |
| **T6** ✅ | e2e: the witnessed exchange, same settings, Android emulator + iOS simulator | `yarn e2e:vrc:witnessed:didcomm-v2:tsp` (tunnel mediator in v2 mode, witness on v1+v2) | VWC issued for both sessions; TSP-over-v2 markers on both platforms (iOS via its live log capture); Witnessed shields on both; on the same build, `yarn e2e:vrc:tsp` (v1) and `yarn e2e:vrc:witnessed:didcomm-v2` (plain v2, Android + iOS) still green |
| **T7** ✅ | The same witnessed exchange on **physical** devices, badges asserted rather than logged | `yarn e2e:vrc:witnessed:ios-devices:didcomm-v2:tsp` and `…:tsp:locality` (iPhone 16 + iPad A16, tunnel mediator in v2 mode, witness on v1+v2) | Mediation 2.0 on both; TSP-over-v2 markers on both; **Secure Exchange + Verified** on both contacts, plus **In-Person** on the locality run; `yarn e2e:vrc:witnessed:ios-devices` (v1) green on the same build. Found and fixed the iOS App Attest evidence/key bug (`2026-09-13-al.md`) |
| **D15** | A5 passed, so: one Credo transport pair, productionised from ref-18's 150 lines — ATM login packed by Credo, one socket per DID, live pickup with the queue-id ack, the mediator's own Pickup 3.0 frames opened by the transport, reconnect and token refresh, and TSP frames (`-E`/`0xF8`) handed to `TspCarriage` without the double wrap | `vti-client` (parent §5.2) | ref-08's query reaches a local VTA from a Credo agent in one run; a TSP ping crosses the same socket; a dropped socket reconnects and re-enables live delivery |

## 7. Which mediator, per mode

Answering `2026-09-07-al.md` Finding 1 for the modes this plan owns:

| Mode | Mediator | Why |
|---|---|---|
| Wallet ↔ wallet, v1 (today) | Keyring's Credo mediator | unchanged |
| Wallet ↔ wallet, v2 (V2) | Keyring's Credo mediator in v2 mode | v2 routing without an ACL or ATM; ref-17 |
| Wallet ↔ VTA (V3 / P1) | the VTI stack's Affinidi mediator | the VTA's `DIDCommMessaging` entry names it; ATM auth; TSP on the same socket |

`vta-carriage_subtask.md`'s VTA-mediated `propose` is the third row.

### 7.1 Two codebases, and the production one is never upgraded in place

"Keyring's Credo mediator" is two deployments of two codebases:

| | Code | Runs where | Store |
|---|---|---|---|
| **Development** | `bifold/packages/mediator-server` (`yarn mediator`) | a developer's machine, cloudflared tunnel | sqlite |
| **Production** | the `credo-mediator` docker image, built from the `didcomm-mediator-credo` deployment Brendan operates (`2026-08-24-bam.md` Part I) | `credo-mediator.asml.berkmancenter.org` | postgres pickup queue (`2026-09-08-al.md`) |

ref-17 and C13's local half run on the **development** one. The production
one carries every existing wallet's routing: each v1 connection's DID
document names it as the endpoint, and the parent's §8 makes the legacy v1
stack non-negotiable. So the rules are:

1. **Never upgrade `credo-mediator` in place.** A v2-capable mediator is a
   **second deployment** — its own hostname, its own Askar store and wallet
   key, its own invitation URL, its own postgres queue — built from the
   snapshot. The v1 mediator's image, config and data are not touched.
2. **Wallets opt in, one at a time, and keep their v1 mediator.** The app's
   v1 mediator stays `store.preferences.selectedMediator`
   (`app/src/hooks/useBCAgentSetup.ts`), seeded from `MEDIATOR_URL`
   (`app/.env`). The v2 mediator is a **second** value, `MEDIATOR_V2_URL`,
   read only when the developer flag is on: the wallet provisions
   Coordinate Mediation 2.0 as a second mediation record and the v1 record
   remains the default. A build without the value, or with the flag off,
   never contacts the v2 host. No fleet-wide flip.
3. **Rollback is a URL.** Point `selectedMediator` / `MEDIATOR_URL` back at
   the v1 invitation and rebuild or reprovision; the v1 mediator has been
   serving the whole time, so nothing is lost and nothing has to be restored.
   If the v2 deployment misbehaves it is stopped, and no v1 wallet notices.
4. **Existing connections stay on the v1 mediator.** A wallet's established
   v1 connections route through whichever mediator their DID documents name.
   The v2 mediator is for **new v2 connections** only. ref-17's "one agent,
   two mediators" check answered yes (two records, two pickup loops), which
   is the design the wallet implements: v2 invitations name the v2 record
   explicitly (`getRouting({ mediatorId })`), everything else keeps the
   default. No production wallet is migrated.
5. **The production change is Brendan's to make, and needs a runbook first:**
   image tag, env (`DIDCOMM_VERSION`-equivalent switch, routing DID,
   `MESSAGE_PICKUP__FORWARDING_STRATEGY=QueueOnly` carried over), the
   postgres precondition the 1 s polling depends on, a smoke test
   (`verifyMediation.ts`'s pattern against the new host), and the stop
   command. Nothing is deployed until that runbook is reviewed.

A merged v1+v2 mediator (`didcommVersions: ['v1','v2']` on one deployment)
is a later consolidation, considered only after the v2 deployment has run
beside the v1 one for a release cycle with no rollback.

## 8. Contributions this generates

1. **RN/Hermes and mediator evidence for credo-ts #2704** — the PR body asks
   for platform testing before merge; ref-15/17 fixtures plus a device run are
   that evidence, filed as a PR comment or issue after review (parent §7
   workflow: staged, shown to a human first).
2. **A v2 mediator mode for `mediator-server`** — reusable by any Credo
   deployment once the PR merges.
3. **Interop vectors between Credo v2 and `affinidi-messaging-didcomm`**
   (ref-15b) — for both upstreams; the ecosystem currently defines
   "conformant" by interop.
4. **The bifold 0.7 bump**, upstream to `bifold-wallet` when ours is proven
   (upstream is on 0.6.3 at 3.0.22).

## 9. Open questions and what they block

| # | Question | Blocks | Decided by |
|---|---|---|---|
| Q1 | ~~Do we accept an unmerged-PR snapshot as a dependency?~~ **Decided 2026-09-13: yes**, pinned by exact version with any overlay in `.yarn/patches`; Verana is the precedent | — | Alberto |
| Q2 | Does Credo 0.7 run on our Node 20 toolchain, or does the hop force Node 22? | V1 | measured in V1 step 1 (0.7.0 publishes no `engines`) |
| Q3 | ~~Does the PR support one agent holding v1 mediation to one mediator and v2 to another?~~ **Answered yes by ref-17 (2026-09-13)**, with two conditions: explicit routing when accepting the v2 mediator's invitation, and resetting the default mediator afterwards | — | ref-17 |
| Q4 | ~~Does Credo's v2 envelope cross the Affinidi mediator and the VTA?~~ **Mediator: yes, both directions (ref-18). VTA: by composition (ref-08 over vti envelopes + ref-15b byte-compat); a single-run proof is V3 acceptance** | — | ref-18 |
| Q5 | ~~Do `did:peer:2` v2 invitations survive Keyring's QR/deep-link flow (URL length, `oob` parameter shape)?~~ **Paste/deep-link: yes (devices, 2026-09-15)** — a 1145-character `_oob` invitation was accepted on both an iPhone and an iPad. The camera/QR leg is still unmeasured: the device runners paste | V2 step 3 | device runs; QR outstanding |
| Q6 | Mixed-fleet attachment encoding after 0.7 (base64 vs base64url) | V1 step 2 | measured |
| Q7 | ~~Does a v1 appended attachment survive Credo's v1→v2→v1 normalisation byte-exact?~~ **Yes (ref-19, 2026-09-14):** a 4 KiB envelope arrives byte-exact both ways, on the wire as a v2 JWE; no v2-native message class | — | ref-19 |
| Q8 | ~~Is accepting the connection's previous DIDs enough on a reusable v2 invitation?~~ **Yes (ref-19):** Credo keeps the invitation DID in the inviter's `previousDids`; an envelope sealed to it opens, and the inviter's reply lands the rotation on the invitee before the handler runs | — | ref-19 |

Nothing in V0 waits on any of these.

## 10. Sources

- credo-ts PR #2704 — <https://github.com/openwallet-foundation/credo-ts/pull/2704>;
  branch `feat/didcomm-v2`: `packages/didcomm/src/DidCommModuleConfig.ts`,
  `packages/didcomm/src/v2/DidCommV2EnvelopeService.ts`,
  `packages/didcomm/src/modules/routing/DidCommMediationRecipientModuleConfig.ts`,
  `samples/mediator.ts`, `packages/core/tests/DidCommV2Modules.e2e.test.ts`
- npm registry, `@credo-ts/core` and `@credo-ts/didcomm` dist-tags, read 2026-09-13
- Credo 0.6 → 0.7 migration guide — <https://credo.js.org/guides/updating/versions/0.6-to-0.7>
- `verana-labs/vs-agent` — `package.json` `pnpm.patchedDependencies`, `patches/*.patch`
- Pinned clones in `external/` (`scripts/openvtc/PINS.json`): `vti-didcomm-js@2365c86`,
  `vta-browser-plugin@89d70c4`, `verifiable-trust-infrastructure@187ad9cd`,
  `dtgwg-trust-tasks-tf@7e0d755` (`bindings/didcomm/0.2/spec.md`)
- Keyring code named in §2, all at `main` `fc0a440`
