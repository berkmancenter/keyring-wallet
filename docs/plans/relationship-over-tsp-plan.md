# Keyring relationship path over TSP via VTI trigger links — Plan

**Status:** Draft - for review by Alberto Leon; do not merge before his review. The scanner side is built behind a developer flag on the `feat/relationship-over-tsp` branches (draft pull request 854; the bifold branch has no pull request yet) and verified offline; no live run has happened. §4.1 says what is built, what is verified and what remains.
**Scope:** Moving Keyring's peer-to-peer relationship ceremony (`vrc/relationships/propose/0.1` and `issue/0.1`) onto the design discussed with RLTP and Consensual: a shared-connect trigger link carries the inviter's peer DID, the scanner proposes, five documents follow, every one with a proof, over the Trust Spanning Protocol (TSP) binding with DIDComm v2 as an allowed carriage. Deadline for a first demonstration: the Interop Builder Weekend, 7 to 10 November 2026.
**Companion:** [`relationship-over-tsp-plan/2026-11-05-bam.md`](./relationship-over-tsp-plan/2026-11-05-bam.md) — the evidence behind this plan, what was checked and what was not, the registry binding facts, the decision log and the questions for the counterparts.
**Related plans:** [`openvtc-integration-plan.md`](./openvtc-integration-plan.md) (TSP as the envelope, Trust Tasks as the operation layer), [`keyring-on-the-vta-farm/tsp_rev3_subtask.md`](./keyring-on-the-vta-farm/tsp_rev3_subtask.md) (the TSP revision cutover, and the 12,285-byte ingress limit in its §3.3), [`nearby-vrc-exchange-plan.md`](./nearby-vrc-exchange-plan.md) (the same ceremony over Bluetooth instead of a code).
**Baseline:** keyring-wallet `origin/main` `16843a53`, bifold pinned at `91be9af6`. Paths below are under `bifold/packages/core/src/modules/` unless stated. Line numbers are at that pin and move; function names are the durable reference. Upstream facts were read from the pinned clones under `external/` (`affinidi-tdk-rs` `ea5af502`, `dtgwg-trust-tasks-tf` `origin/main` `7b6bb488`); the two upstream threads this design comes from (trustoverip/dtgwg-trust-tasks-tf#1034 and trustoverip/dtgwg-vti-spec#86) and the VTI links specification (`spec/07a-links.md`) were read online and are cited from that reading, not from a pinned clone. Anything marked **UNVERIFIED** was inferred from reading code or threads and has not been executed.

---

## 1. Summary

A person scans, pastes or taps a shared-connect link from someone they meet. The link carries the inviter's fresh peer DID (`_from`), a challenge (`_id`), an expiry (`_exp`) and, optionally, a display label (`_label`). The scanner decides whether to connect, then proposes. Five documents follow, each with a proof, and each side ends up holding a relationship credential (VRC) from the other.

Keyring's ceremony today needs a DIDComm connection first. That is the central gap: the code, the UI stores and the credential shape are all keyed by Credo connection records, and the credential shape depends on a legacy announcement that RLTP and Consensual never send.

| Question | Answer |
|---|---|
| Full scope (both roles, both carriages, merged) by 10 November | **Not realistic.** About 13 to 16 developer-days; about 2.5 working days remain, and nothing merges before Alberto's review |
| Minimum demo (Keyring scans a reference inviter's code; one way; TSP; branch build behind a developer flag) | **About 9 developer-days**, with two developers through the weekend, and only if three things arrive from the counterparts by Friday 6 November (§6) |
| DIDComm v2 fallback | **Not materially cheaper** (about 1 to 1.5 days less). Its value is risk: cross-operator DIDComm v2 has been measured working, cross-operator TSP has not |
| Recommendation | Build the transport-neutral 80% once behind one `sendDocument(peer, doc)` seam, try TSP on the inviter's own relay first, keep DIDComm v2 as a switch. Cut Keyring-as-inviter, witnessing, hardware-attestation evidence toward RLTP, R-Card exchange and push wake-up |

---

## 2. Target design

1. **Trigger link.** A VTI trigger link with flow `shared-connect/0.1` (proposed in dtgwg-vti-spec#86; **not in the VTI links specification yet**). Reserved names: `_from` is the inviter's peer DID (`did:peer:2` or long-form `did:peer:4`, resolved offline because it is self-certifying), `_id` is a 16-byte challenge, `_exp` is the expiry (10 minutes for a code, 7 days for a link, per the thread), `_label` is an optional unverified display name (a proposed fifth reserved name, not yet in VTI-LNK-011).
2. **The scanner proposes.** Whoever reads the link sends the first document. No discovery step and no deterministic-proposer rule by DID order: the role comes from the link.
3. **Confirmation before network.** The scanner sees who is asking (an unverified label, the DID prefix, the relay host, the expiry) and nothing is sent until Connect (VTI-LNK-052).
4. **A fresh peer DID per encounter** on the scanner's side, with the services the chosen carriage needs: `TSPTransport` and `DIDCommMessaging`.
5. **Five documents** (the sequence in §5, WP7): `propose`, `propose#response`, `issue` from the inviter, `issue` from the responder, and the receipts `issue/0.1` requires, tied together by `threadId` equal to `propose.id` and a `ceremony` member carrying the enactment (`_id`).
6. **Proofs on every step**, receipts included. Which key signs is an open decision (§8, decision 3).
7. **TSP primary, DIDComm v2 allowed.** The carriage is chosen from the services in the peer's DID document, preference `tsp`, then `didcomm`. Over TSP, a relationship is formed (`XRFI`/`XRFA`) before the first application message, because the reference TSP implementation drops messages from a sender with no relationship (§3.3).
8. **Standing for an unsolicited `propose`** (when Keyring is the inviter): accepted only if its `recipient` is a live encounter VID Keyring minted, its enactment equals the link's `_id`, the code has not expired and nothing has been accepted on it before. Everything else is dropped without reply (the TSP binding §6 owes no reply path).

---

## 3. Current state

### 3.1 The ceremony needs a connection

- It starts only after a DIDComm connection exists, driven by the legacy basic-message announcement `vrc:relationshipDid:… vrc:rceVersion:N` (`vrc/vrc-manager.ts` `setupVrcConnectionHandler` at 1432, calling `maybeOpenRelationshipExchange` at 1738).
- The peer with the lexicographically lower connection DID proposes: `isDeterministicProposer` (`trust-tasks/ceremony.ts:160`), used at `:212` and `:868`. Before proposing, the proposer runs `trust-task-discovery` and requires `propose` in the peer's `supportedTypes`. One exchange per connection.
- `openRelationshipExchange` (`ceremony.ts:427`) builds `propose` with `issuer = connection.did`, `recipient = connection.theirDid`, `id = threadId = uuid`, payload `{relationshipDid, witnessed}`. **It carries no proof.**
- Inbound `propose` is validated, held in memory per connectionId (`pendingProposals`, `:891`), and shown for consent using `connection.theirLabel`. `acceptRelationshipProposal` (`:1139`) sends an unsigned `propose#response`, then its own `issue`.
- `issue` is signed with a **document proof by the relationship DID's key** (`signDocumentProof(…, record.myRelationshipDid)`, `:1405`). The receiver verifies the VC **through Credo's JSON-LD verifier** (`agent.w3cCredentials.verifyCredential`, `:1505`), stores it, and returns an unsigned receipt `{vrcDigestMultibase}`, checked against its own delivery.
- The inbound handler **does not process a document that has no connectionId**: it is "retained, not processed" (`ceremony.ts:696-702`).
- Dispatch goes through the open registry (`trustTaskRegistry`, `ceremony.ts:712`, registration at `:1943`).

### 3.2 Carriage today

- TSP carriage is a **developer flag only**: `tspCarriageEnabled` defaults to false (`ceremony.ts:93`), set from `app/src/screens/Developer.tsx:355` and, at start-up, `app/src/hooks/useBCAgentSetup.ts:405`. `selectCarriage` (`ceremony.ts:138`) returns TSP when the flag is on, otherwise the connection's DIDComm version.
- This ceremony never reads the peer's DID document to choose a transport (`ceremony.ts:136`: the "§4.2 DID-document resolver (`TSPTransport`) is not built"). `TspCarriage` (`trust-tasks/module/TspCarriage.ts`) seals a TSP envelope (`:66`) and sends it **inside a DIDComm v1 message on the existing connection** (`TspEnvelopeMessage`), using the connection DIDs as VIDs. It is wallet-to-wallet only. Nothing in it is reusable for the target design except the identity-check pattern of `unpackForConnection` (`packages/credo-tsp-adapter/src/connection.ts:38`).
- A DID-document-driven chooser exists in the VTI module: `chooseCarriage` (`trust-tasks/module/tspCapability.ts:174`) reads `TSPTransport` (`:25`, `peerTspService` `:112`). A stopgap, on by default, disables it for upstream peers: `preferDidcommForUpstream = true` (`:146`, comment dated 2026-10-22, "until the 1.0 codec ships"). The codec now has 1.0 packers and readers (`packages/trust-tasks/src/tsp/rev3.ts:754-816`), but nothing turns the stopgap off. **TSP 1.0 interop with any upstream peer is UNVERIFIED.**

### 3.3 What the VTI legs already do without a connection (reusable)

- **Session.** `VtiMediatorSession` (`trust-tasks/module/VtiMediatorTransport.ts:499`) authenticates to an Affinidi mediator as one DID and sends raw TSP frames (`sendTspFrame`, `:1235`; inbound via `onTspFrame`). The mediator binds the cleartext sender VID to the session's DID, so **one session per encounter DID** is required. It also sends connectionless DIDComm v2 with `sendTo` (authcrypt plus forward).
- **Fresh peer DID.** `createVtiClientDid` (`VtiMediatorTransport.ts:339`) mints a `did:peer:2` with one Ed25519 key and a `DIDCommMessaging` service naming the mediator. **It publishes no `TSPTransport` service.** The only `TSPTransport` handling in core is the reader in `tspCapability.ts` and `VtiMediatorTransport.ts:250`.
- **TSP identity and resolver.** `tspSessionForManager` (`trust-tasks/module/vtiTsp.ts:132`) and `createVtiVidResolver` (`:57`).
- **Relationship forming.** `greetPeerOverTsp` (`vtiTsp.ts:193`) packs an `XRFI`, routed. `vtiAgent.ensureGreeted` (`trust-tasks/module/vtiAgent.ts:620`) sends it once per pair before the first application message (`send`, `:1414`). The codec sends invites and accepts but **does not consume inbound control frames**: it reports `CONTROL_FRAME_RECEIVED` (`rev3.ts:456`) and `unpackTrustTaskFromPeer` (`vtiTsp.ts:244`) treats that as "no Trust Task" (`:295`).
- **Binding envelope.** `{type: "https://trusttasks.org/binding/tsp/0.1/envelope", document}` (`packages/trust-tasks/src/tsp/binding.ts:21-22`) matches the registry binding. The issuer/recipient-versus-VID check is in `unpackTrustTaskFromPeer` (`vtiTsp.ts:331`).
- **Wire versions.** The codec reads Rev 2, Rev 3 and 1.0 and packs Rev 3 by default (`packages/trust-tasks/src/tsp/direct.ts`, `createTspCodec`). The registry binding still cites **TSP Implementers Draft Rev 2** (`bindings/tsp/0.1/spec.md:22,235` in dtgwg-trust-tasks-tf), while TSP's specification is at Release 1.0. The binding text is stale against 1.0.
- **Relationship gate on the far side.** `affinidi-tsp` drops application messages from a VID with no relationship by default (`RelationshipPolicy::Gated`, `crates/messaging/affinidi-tsp/src/relationship.rs:38`, enforced at `lib.rs:367`). The binding leaves relationship forming to TSP (§5.4, "Relationship prerequisite"). **`XRFI` before `propose` is mandatory** against any affinidi-based reference.
- **Known limits.** TSP across two operators' mediators has not completed: the invite is stored and no accept returns (VTI-41, `docs/VTI_UPSTREAM_FINDINGS.md`, measured 2026-09-22, same-mediator control accepted in 1.15 s). Rev 3 long-form frames above 12,285 bytes were misrouted by older ingress classifiers (`keyring-on-the-vta-farm/tsp_rev3_subtask.md` §3.3), which matters for `issue` documents that carry attestation evidence.
- **Keyring's own relay.** `deploy/keyring-messaging` runs an Affinidi mediator with `protocols = ["didcomm","tsp"]` (`deploy/keyring-messaging/mediator/mediator-build.toml:9`). Whether it accepts sessions from arbitrary `did:peer:2` clients is **UNVERIFIED**. A patch in `deploy/keyring-messaging/gateway/patches/0002-…` adds an optional DID-host allowlist; its effect on this path is UNVERIFIED.

### 3.4 State is keyed by connection

- `ceremony.ts` makes 15 `connections.getById/findById` calls and about 180 `connectionId` references (counted on the branch this plan was written on; **UNVERIFIED at the current pin**).
- `TrustTaskDocumentRepository` queries filter by `connectionId` (`ceremony.ts:217`), and `TrustTasksService.retain` (`trust-tasks/services/TrustTasksService.ts:131`) tags documents with it.
- `vrcFlowStore` maps are keyed by string, in practice the connectionId (`vrc/witnessStatusStore.ts:136-139`).
- `RelationshipDidRepository` is keyed by the counterparty **connection DID** and accepts a missing connectionId (`vrc/repositories/RelationshipDidRepository.ts:14-20, 50-60`).
- The Contacts list is built from stored VRCs, not from connections (`vrc/screens/ListContacts.tsx:147`, `isPeerVrcCredential` `vrc/credentialTypes.ts:251`). A connectionless VRC therefore appears as a contact. Chat and the R-Card do not work for it, since both need a connection.

### 3.5 The relationship DID and the credential

- The relationship DID is a `did:peer:0` (Ed25519), minted once per counterparty connection DID (`vrc/vrc-manager.ts:535`, creation `:567-574`). It is the VC issuer and subject.
- `buildVrcCredential` (`vrc-manager.ts:305`): VCDM 2.0, DTG `RelationshipCredential`, `issuerScope: 'pairwise'` (`:368`), `validUntil` = now + 7 days (`DEFAULT_CREDENTIAL_EXPIRATION_DAYS`, `:154`, used `:370`), optional hardware-attestation `evidence`.
- Proof: `DataIntegrityProof` / `eddsa-rdfc-2022` through Credo's JSON-LD signer (`getVrcJsonLdProofOptions`, `:497`).
- **The credential shape is gated on the RCE version the peer announced.** `counterpartyRceVersionAtLeast` (`:437`) defaults to 1. A peer that never announces, as RLTP and Consensual will not, would get VCDM 1.1, `Ed25519Signature2018` and the legacy issuer object. That is wrong for the target.
- `prepareVrcCredentialWithEvidence` (`:623`) takes a DIDComm connection record and uses `theirLabel` in the biometric prompt.
- JCS precedent: the community membership credential is signed `eddsa-jcs-2022` through `signDocumentProof` (`trust-tasks/module/vtiMemberVmc.ts:135`; `packages/trust-tasks/src/documentProof.ts`, whose header describes the suite). No Credo-registered `eddsa-jcs-2022` credential suite exists, so inbound JCS VRCs would very likely fail `verifyCredential` at `ceremony.ts:1505` (**UNVERIFIED**).

### 3.6 Trigger links today

- `readTrigger` / `triggerAction` (`trust-tasks/module/triggerLink.ts:308, 424`) know only the `sign-in` and `vta-claim` flows (`:99-123`), both with `allowedVidTypes: ['did:webvh','did:web']`. A `did:peer` `_from` is refused `from-not-allowed` (`:399-400`).
- `selectService` (`:488`) maps only `TrustTaskHTTPS → https` (`:447`), and `endpointText` (`:477`) does not handle an array-valued `serviceEndpoint`, which is the common `did:peer:2` form.
- Scan, paste and deep-link routing is in `trust-tasks/module/vtiLinks.ts` (`keyringAgentLinkKind` `:102`, destination map `MY_AGENT_SCREEN` `:363`). The confirm-screen pattern is `trust-tasks/screens/SignIn.tsx` (the "unverified" marker, `:501-503`).
- The VTI links specification (VTI-LNK-050/052/053) requires the transport to come from the verified document; VTI-LNK-118 refuses `did:peer` "by either route". dtgwg-vti-spec#86 proposes scoping that rule to service flows and adding `shared-connect/0.1`. These rule numbers are cited from the online reading and **not re-verified here**.

---

## 4. Work packages

Sizes assume one developer who knows the codebase. S = 0.5 to 1 day, M = 1 to 2 days, L = 2 to 3 days. "Demo" marks what the minimum one-way demo needs (§7).

| # | Work package | Size | Depends on | Demo |
|---|---|---|---|---|
| WP1 | Trigger-link reader: `shared-connect` flow, `did:peer:2/4` `_from` | S (0.5) | #86 text; vectors | yes |
| WP2 | Resolve `_from`, choose a TSP or DIDComm service | S (0.5–1) | a `_from` vector | yes |
| WP3 | Confirm screen before sending | S–M (1) | WP1, WP2 | yes (minimal 0.5) |
| WP4 | Scanner's fresh per-encounter peer DID with services, and a relay session | M (1–1.5) | relay accepts an unknown `did:peer:2` | yes |
| WP5 | Connectionless TSP send/receive with relationship forming | M (1.5–2) | WP4; counterpart revision and policy | yes (TSP only) |
| WP6 | Ceremony keyed by encounter instead of connection; role inversion | L (2–3) | none (fake carriage) | yes (thin, 1.5) |
| WP7 | The five-document sequence, receipts, `threadId`/`ceremony` member, proofs | M (1–1.5) | WP6; decision 3 | yes |
| WP8 | Credential changes: no `validUntil`, JCS option, VC 2.0 without RCE, JCS verify | M (1–1.5) | decisions 4; challenge-binding answer | yes (minimal 1) |
| WP9 | Keyring as inviter: show code, handle unsolicited `propose` | L (2–3) | WP4–WP7 | **cut** |
| WP10 | Errors, expiry, timeouts, retries | S–M (1) | WP6 | minimal 0.5 |
| WP11 | Localization (en, fr, pt-br) | S (0.5) | WP3 | en only |
| WP12 | Logging of untrusted text | S (0.25–0.5) | none | yes |
| WP13 | Interop rung, vectors, two-party live run | M (1–2) | counterpart relay | yes |
| WP14 | DIDComm v2 connectionless carriage (fallback) | S–M (0.75–1) | WP4 | fallback |

The critical path is WP6, WP7, then WP5 or WP14, then WP13. WP13's Node rung can start on the first day, because it answers the questions that block WP5. WP1 to WP4 and WP8 are independent of WP6 and can run in parallel with it.

### 4.1 Built, verified, remaining

Built, scanner side, behind the shared-connect developer flag (code under `trust-tasks/module/sharedConnect*.ts` and `screens/SharedConnect.tsx`):

| WP | State |
|---|---|
| WP1, WP2, WP3, WP4 | Built. Reader, inviter resolution and service choice, confirm screen, encounter DID and persisted `EncounterRecord`. |
| WP5, WP6, WP7 | Built as the parallel module: `SharedConnectSession` (scanner proposes first, six documents, receipts, idempotent by document id, keyed by `encounterKey(enactment)`), with TSP and DIDComm v2 carriages on a `VtiMediatorSession` as the encounter DID. |
| WP8 | Built. `VrcProfile` on `buildVrcCredential` (no `validUntil`, no evidence context, `eddsa-jcs-2022`); JCS verification by the suite the proof names, on the shared-connect path and on the connection-based inbound `issue` handler in `ceremony.ts` (only a JCS proof takes the new branch; every other suite takes the Credo path as before). |
| WP10 | Built. Two minutes per attempt, two attempts, then `unanswered` (never `failed`); expiry is `_exp` plus a five-minute grace; the screen shows waiting, unanswered (Ask again or Stop), expired, declined, refused, connected and stopped, from the live session. |
| WP11, WP12 | Built. en, fr and pt-br; the logging test asserts no label, reason or link text. |
| WP14 | Built as a carriage, tested against fakes only. |
| WP9 | Cut (see §7). |
| WP13 | Offline only: `sharedConnectInterop` runs real TSP Rev 3 frames and real keys against a fake inviter. The Node rung `tsp-reference/ref-2x-shared-connect` and the live run do not exist. |

Verified by tests, with what the test runs:

- **Framework consume accepts the `ceremony` member.** `TrustTasksService.consume` takes a document carrying `ceremony` (`sharedConnectConsume`). This closes the UNVERIFIED in WP7.
- **Credo's real numalgo-2 resolver keeps `TSPTransport`.** `didToNumAlgo2DidDocument` leaves the `TSPTransport` type and its mediator-DID endpoint, and the reference spelling `tsp` with a `{uri}` endpoint, intact; only `DIDCommMessaging` is abbreviated (`sharedConnectRealResolver`). This closes the UNVERIFIED in WP2.
- **Real KMS.** On an in-memory Askar agent and a `did:peer:0` relationship DID made as `getOrCreateRelationshipDid` makes it, `signDocumentProof` and `verifyDocumentProof` round-trip, fail under another DID and fail on a tampered document; the profiled VRC carries an `eddsa-jcs-2022` proof, no `validUntil` and no `evidence`, and verifies by suite; stored as a `W3cCredentialRecord` it reads back with the same digest and a redelivery stores nothing (`__tests__/modules/trust-tasks/sharedConnectRealKms`). Two conditions apply. Storing needs the app's `createVrcDocumentLoader` on the `w3cCredentials` module, because Credo expands every JSON-LD credential when it stores one and the DTG context is not fetchable; the app configures it already. And under jest the tree holds two copies of `@credo-ts/core`, which fails the KMS lookup in `documentProof` ("TypeInfo not known"), so that suite maps one copy onto the other; the app bundle has one copy.
- **Inbound JCS on the connection ceremony.** A JCS-proofed `issue` is verified under the bound issuer, stored and receipted; a failing JCS proof is refused `notAccepted` and nothing is stored (`ceremonyIssue`).
- **Screen states.** Each session state maps to its text, Ask again calls `retry`, Stop calls `cancel`, and the screen stops listening when it closes (`SharedConnectScreen`, `sharedConnectSession`).

Remaining:

- **Live run and Node rung** (WP13). They need a counterpart inviter's real link (§9, Q3) and a relay that accepts a login from an unknown `did:peer:2` (§9, Q1). No such relay or link is known to this repository.
- **Restart recovery.** A live session is held in memory and is gone if the app is killed; the `EncounterRecord` survives but nothing resumes it.
- **Keyring as inviter** (WP9), cut.
- **Review.** The decisions in §8 stand as assumptions (the pull request body lists them); the bifold pull request is not opened.

### WP1: trigger-link reader
- **Gap.** No `shared-connect` flow; `did:peer` refused; no expiry caps for this flow; `_label` not read.
- **Change.** Add a flow to `triggerLink.ts:99-123`: `typeBase` `https://link.trustoverip.org/vti/flow/shared-connect`, `status: 'draft'`, expiry required, `allowedVidTypes: ['did:peer']` restricted to numalgo 2 and long-form 4, behind a developer flag. Check length against the proposed 1,000-character flow budget while keeping the 1,536 reader cap (`:101`). Route it in `vtiLinks.ts` and `MY_AGENT_SCREEN`. Read `_label` only behind a flag and show it as unverified.
- **Files.** `trust-tasks/module/triggerLink.ts`, `vtiLinks.ts`, `screens/Scan.tsx` and `PasteUrl.tsx` (routing only), navigator types.
- **Done when.** `triggerLink.test.ts` (vector-table style) and `vtiLinks.test.ts` cover accepted and refused links: numalgo 0/1 refused, over-budget refused, expired refused, `did:web` refused for this flow.
- **Risk.** Spec churn on `_label` and the budget. Reading `_label` before the VTI links specification adopts it contradicts VTI-LNK-011.

### WP2: resolution and service choice
- **Gap.** `selectService` knows only `TrustTaskHTTPS` and does not read array endpoints.
- **Change.** A selection map `{TSPTransport: 'tsp', DIDCommMessaging: 'didcomm'}` with preference `['tsp','didcomm']` (flippable); fix `endpointText` for arrays of `{uri}`; resolve the endpoint's mediator with `resolveVtiMediator` (`VtiMediatorTransport.ts:266`); record the relay host for WP3.
- **Done when.** Unit tests on `selectService` with captured documents, and a resolver test on real `did:peer:2` and `did:peer:4` strings (pattern: `packages/credo-tsp-adapter/__tests__/identityFromDid.test.ts`).
- **Risk.** Credo's numalgo-2 expansion leaves the `TSPTransport` type intact (verified, §4.1); its abbreviation table abbreviates only `DIDCommMessaging`. The `TSP` service spelling is not agreed across stacks (the companion's §2.1): the TSP reference reads type `tsp` with a `{uri}` endpoint, the VTA and Keyring read `TSPTransport` with a mediator DID, so a counterpart vector decides the form. An endpoint naming a mediator that is itself a `did:peer` has no host, so the host rules cannot apply; decide whether to show "none".

### WP3: confirm screen
- **Shows.** "Connect with …"; the `_label` marked **unverified**, or "No name given"; the inviter DID as a short prefix; the relay host; the expiry countdown; Connect and Cancel. **Nothing is sent before Connect.**
- **Files.** A new `trust-tasks/screens/SharedConnect.tsx` modelled on `SignIn.tsx`, with test ids, a navigator entry and localization keys.
- **Done when.** A screen test copied from the `SignIn` tests passes, and a test asserts no network call occurs before Connect.

### WP4: scanner's fresh peer DID and relay session
- **Gap.** `createVtiClientDid` lists only `DIDCommMessaging`.
- **Change.** `createEncounterDid(agent, mediator, {tsp: true})`: a `did:peer:2` with Ed25519 and X25519 keys and `#didcomm` and `#tsp` (`TSPTransport`, endpoint the mediator DID) services. A dedicated `VtiMediatorSession` as that DID, kept while the encounter is live and closed on completion or expiry. A persisted `EncounterRecord {enactment, myVid, theirVid, relay, exp, state}` in generic records.
- **Relay for the demo.** The inviter's own TSP mediator (the one `_from` names), which avoids the cross-operator TSP failure (§3.3). Fall back to Keyring's `keyring-messaging` mediator.
- **Done when.** A fake-session test (pattern: `vtiAgentLegs.test.ts`) passes, and a live login to a real mediator as the new DID succeeds (WP13).
- **Risk.** Relay access control; background or killed app (no push wake for encounter DIDs in the demo).

### WP5: connectionless TSP and relationship forming
- **Change.** A `TspEncounterCarriage` whose `send(doc)` calls `greetPeerOverTsp(session, myVid, theirVid, [relayDid, myVid], revision)` once, then `packTrustTaskForPeer(…, revision)`, then `sendTspFrame`. Inbound: `unpackTrustTaskFromPeer` (identity checks included), then registry dispatch with an encounter context. The revision (1.0 or Rev 3) is chosen by peer evidence or configuration; the default needs the counterparts' answer (§9, Q2). Leave `preferDidcommForUpstream` alone: this path does not go through `chooseCarriage`. Answering an inbound `XRFI` with `XRFA` is needed only for WP9.
- **Done when.** A fake-peer test (patterns: `vtiTsp.test.ts`, `tspInvite.test.ts`) packs an invite then a document and unpacks both; the live rung against the reference inviter returns a `propose#response`.
- **Risk.** Silent drops (no relationship, wrong revision, crossing mediators); no accept returned; long-form frames above 12,285 bytes. Leave `evidence` out toward RLTP to stay small.

### WP6: ceremony keyed by encounter, and role inversion
- **Gap.** Every handler resolves a Credo connection (§3.4) and the inbound handler drops connectionless documents (§3.1).
- **Change, recommended for the deadline: a parallel module, not a refactor.** A new `trust-tasks/sharedConnect.ts` reuses the payload builders, `TrustTasksService.consume/retain`, `signDocumentProof`/`verifyDocumentProof`, `digestMultibase` and the issue-receipt logic, but passes an `EncounterPeer {key: 'enc:'+enactment, myVid, theirVid, label?, send}` instead of a connectionId. The `key` goes wherever a string key is needed, so the existing UI stores work unchanged. The responder proposes unconditionally. The encounter dispatch is registered beside the connection dispatch, keyed by the receiving VID, leaving `ceremony.ts`'s connection path untouched. The relationship is stored in `RelationshipDidRepository` with `counterpartyConnectionDid = theirVid`. Folding both paths behind one peer interface is later work.
- **Files.** The new module; small exports from `ceremony.ts` (builders and handlers that are private today); `vrc/vrc-manager.ts` (WP8).
- **Done when.** A test (pattern: `ceremonyIssue.test.ts`, `ceremony.test.ts`) asserts the order responder `propose`, inviter `#response` and `issue`, responder receipt and `issue`, inviter receipt, all keyed by enactment, and the existing connection tests still pass.
- **Risk.** Regressions in the production DIDComm VRC path if the change goes deeper than the parallel module. The duplication is temporary debt.

### WP7: five documents, receipts, `threadId`, `ceremony`, proofs
- **Gap.** `propose` and the receipts are unsigned. Nothing carries a `ceremony` member. `propose.id` is a uuid where the ceremony wants a 16-byte base64url challenge. The document `issuer` is the connection DID while the proof is made by the relationship DID (`ceremony.ts:1400, 1405`).
- **Sequence.** Six documents travel; the brief's "five" are the four ceremony steps plus the receipts, and `issue/0.1` requires a receipt for each `issue`.

  | # | Document | From | To |
  |---|---|---|---|
  | 1 | `propose` | responder | inviter |
  | 2 | `propose#response` | inviter | responder |
  | 3 | `issue` | inviter | responder |
  | 4 | `issue#response` (receipt) | responder | inviter |
  | 5 | `issue` | responder | inviter |
  | 6 | `issue#response` (receipt) | inviter | responder |

- **Change.** `propose.id` is a 22-character base64url value and `threadId` equals it on every document. `ceremony: {enactment: _id, step, definition: https://trusttasks.org/ceremony/shared-connect/0.1}`; `definitionDigest` is left out until the definition is published, because the specification makes it a MUST when `definition` is present. `issuer` and `recipient` are the encounter VIDs, in band on every document. Every document gets a proof. For the demo, sign with the issuer VID (it matches the TSP sender) and accept either key inbound.
- **Done when.** A schema test feeds a document with `ceremony` through `TrustTasksService.consume`. The pinned `@openvtc/trust-tasks` framework accepts the member (verified, §4.1).
- **Risk.** Validator strictness; a proof-key mismatch yielding `proofInvalid` on either side.

### WP8: credential changes
- **Gap.** `validUntil` is fixed at 7 days; the proof is rdfc only; the shape depends on the RCE announcement (§3.5); inbound JCS is not verified. dtgwg-trust-tasks-tf#1034 mentions a binding "computed over `{ceremony, challenges: [_id, propose.id]}`" that each side writes into its credential. Keyring has nothing like it.
- **Change.** An explicit `VrcProfile` parameter for `buildVrcCredential` and `getVrcJsonLdProofOptions`: `{vc20, di, validUntil, suite: 'eddsa-jcs-2022' | 'eddsa-rdfc-2022', evidence}`, selected by path rather than by RCE. JCS signing through `signDocumentProof` (the membership-credential precedent); rdfc stays for Keyring to Keyring. Inbound: if the proof is `eddsa-jcs-2022`, verify with `verifyDocumentProof` under the credential's issuer, otherwise Credo; the `ceremony.ts` handler takes this branch only for a JCS proof. Call `buildVrcCredential` directly rather than `prepareVrcCredentialWithEvidence`. Hold the challenge-binding field until the counterparts answer (§9, Q5).
- **Files.** `vrc/vrc-manager.ts`, the new module, the inbound verify branch in `ceremony.ts` (`:1449-1560`).
- **Done when.** The profile matrix passes (pattern: `__tests__/modules/vrc/vc20IssuanceFlip.test.ts`, `diIssuanceFlip.test.ts`), a JCS round trip passes (`documentProof.test.ts`), and a counterpart-produced VRC fixture verifies once one exists.
- **Risk.** RLTP rejecting Keyring's contexts or the `evidence` block; JCS signing and verification of a VRC round-trip on a real KMS (§4.1); byte compatibility with a counterpart's implementation is **UNVERIFIED** until a counterpart-produced VRC exists.

### WP9: Keyring as inviter (cut for the deadline)
Mint the encounter DID and session (WP4), build `#_from=…&_id=<16B>&_exp=<≤10 min>&_type=…/shared-connect/0.1`, show a QR, apply the standing rule of §2.8, answer `XRFI` with `XRFA`, and ask consent with `RelationshipProposalModal`. **Done when** the unsolicited-`propose` rule is tested (patterns: `ceremonyRestoreProposals.test.ts`, `RelationshipProposalModal.test.tsx`). **Risk:** spam and denial of service on the relay queue; app lifetime while the code is shown.

### WP10: errors and expiry
Enforce `_exp` again at Connect. Bounded waits: 2 minutes for `#response`, then "no answer yet", keeping the encounter open until `_exp` plus a grace period. Map `propose:declined` and `issue:notAccepted` to `vrcFlowStore` states; TSP silence maps to "unknown", never "failed" (binding §4). Idempotent resend by document `id`; session teardown. **Done when** fake-timer tests (`__tests__/helpers/oneClock.ts`, pattern `tspReplyBreaker.test.ts`) cover timeout, expiry and resend.

### WP11: localization
New keys for the confirm screen, progress, errors and expiry in `bifold/packages/core/src/localization/{en,fr,pt-br}`, beside the existing `Scan.TriggerLink*` keys. The demo needs English only; French and Brazilian Portuguese need a reviewer.

### WP12: logging of untrusted text
Never log the link text, `_label`, `propose.payload.reason` or any counterpart-supplied string; log DID prefixes, lengths and outcome codes only (as `triggerLink.ts` does). **Done when** a test captures logger output and asserts a `_label` sentinel is absent.

### WP13: interop rung and live run
A rung `tsp-reference/ref-2x-shared-connect/run.mjs` that parses a counterpart's link, mints a `did:peer:2`, logs into the named relay, sends `XRFI` and `propose`, and prints what comes back. It settles §9 Q1 to Q3 before phone builds. Then a two-party live run: phone to reference inviter, and an exchange of vectors (`_from` strings, documents, credentials). Phone builds are heavy: check memory and load first, run under `nice -n 10` with `umask 002`, and repair Gradle output modes afterwards (`/srv/dev/CLAUDE.md`).

### WP14: DIDComm v2 connectionless carriage (fallback)
`DidCommEncounterCarriage.send(doc)` is `session.sendTo(theirVid, {type, from, to, thid, body: doc})`, matching the VTI community leg (`vtiAgent.ts:1467`). Inbound through `onMessage`. No `XRFI` and no revision question. It uses the `didcomm/0.2` Trust Task framing that VTI already speaks; whether RLTP and Consensual read it is **UNVERIFIED**.

---

## 5. Scenarios against 7 to 10 November

Thursday 5 November (half a day) and Friday 6 November are working days before the event. Saturday 7 to Tuesday 10 November is the event, where building continues.

### Scenario A: TSP binding as the primary path

- **Full scope** (both roles, both carriages, three languages, tests, merged): WP1 to WP13, about 13 to 16 developer-days. Not achievable, and merging waits on review.
- **Minimum demo** (Keyring as responder, reference inviter, TSP, branch build behind a developer flag, not merged):

  | WP | Days |
  |---|---|
  | WP1 | 0.5 |
  | WP2 | 0.5 |
  | WP3, minimal | 0.5 |
  | WP4 | 1 |
  | WP5 | 1.5 |
  | WP6, thin | 1.5 |
  | WP7 | 1 |
  | WP8, minimal | 1 |
  | WP10, minimal | 0.5 |
  | WP12 | 0.25 |
  | WP13 | 1 |
  | **Total** | **about 9** |

  With two developers from Thursday afternoon through Sunday, a first live attempt lands on Sunday 8 or Monday 9 November, leaving one day for silent-drop debugging. The preconditions are §9 Q1 to Q3 answered by Friday and WP13's rung green against the counterpart's relay. Without them, stop at Saturday noon and switch to Scenario B.
- **Cut for the deadline:** WP9, witnessing, hardware-attestation `evidence` toward RLTP, R-Card and profile exchange, push wake-up and background continuation, restart recovery, French and Brazilian Portuguese, merging, and the offline path (the responder showing `propose` as a code).

### Scenario B: DIDComm fallback for the same documents

- **Not materially cheaper:** about 8 developer-days against 9. Existing Keyring DIDComm connections and out-of-band invitations do not help: the code is a trigger link with a `did:peer` `_from`, not an out-of-band invitation, the counterparts would have to run DID Exchange (which they do not), and the ceremony code is bound to Credo connection records whichever carriage is used.
- **Still changes:** WP1, WP2 (selecting `DIDCommMessaging`), WP3, WP4 (about 0.5 day less, since `createVtiClientDid` already makes `#didcomm`), WP6, WP7, WP8, WP10, WP12, WP13, with WP14 (about 1 day) replacing WP5 (about 1.5 days).
- **Removes:** `XRFI`, the TSP revision question, the cross-operator TSP failure (cross-operator DIDComm v2 round trips were measured at about 1 second, `docs/VTI_UPSTREAM_FINDINGS.md`, 2026-09-22) and the long-frame classifier issue.
- **Requires:** RLTP or Consensual reading DIDComm v2 with Trust Task plaintexts at the event (**UNVERIFIED**; both describe TSP over a mediator as their primary path).

### The minimal one-way demo

A phone scans a reference inviter's code; four ceremony documents and two receipts travel; VRCs are stored on both sides. This is realistic only with two developers and early answers to Q1 to Q3. Build the transport-neutral parts once, attempt TSP on the inviter's own relay, and keep WP14 as the Saturday-noon fallback. A Keyring to Keyring run over the new path follows once this works, if one side may be the reference. Full interop in both roles, merged by 10 November, is not realistic: present a developer-flag branch build, then open pull requests after review (bifold first, then the root bump).

---

## 6. Preconditions from the counterparts

Needed by Friday 6 November for the TSP demo to be more than a coin toss, because TSP failures are silent:

1. A relay we can log into as an arbitrary `did:peer:2`.
2. Their TSP wire version (Rev 3 or 1.0) and relationship policy.
3. A test vector of their `did:peer:2` with its `TSPTransport` service.

---

## 7. Cuts and what they cost

| Cut | Cost of cutting |
|---|---|
| Keyring as inviter (WP9) | Only a reference or another wallet can show the code at the event |
| Witnessing | No co-presence claim on this path |
| Hardware-attestation `evidence` toward RLTP | Smaller frames, less evidence in the VRC |
| R-Card and profile exchange | The name arrives only as `_label` or in the acceptance |
| Push wake-up, background continuation, restart recovery | The app must stay in the foreground until the exchange completes |
| French and Brazilian Portuguese | English demo only |
| Merging | Branch build behind a developer flag; follow-up pull requests after review |

---

## 8. Decisions that belong to Alberto

Alberto is the author of `vrc/relationships/propose/0.1` and `issue/0.1` and the Keyring reviewer. None of these is taken.

1. Whether `shared-connect` uses `propose/0.1` and `issue/0.1` unchanged (the #1034 revision), with proofs required by the ceremony definition while the task says optional for `propose`, and with the `ceremony` member on every step.
2. The binding: TSP primary with DIDComm v2 fallback. Which TSP revision Keyring packs toward ecosystem peers (Rev 3 or 1.0), and whether `bindings/tsp/0.1` should move from Implementers Draft Rev 2 to TSP 1.0 (a change in the trust-tasks task force's repository).
3. The document-proof key: the issuer VID, or the relationship DID as the ceremony signs today (`ceremony.ts:1405`).
4. The credential profile toward non-Keyring peers: no `validUntil`, `eddsa-jcs-2022`, `evidence` dropped or kept. Per counterpart, or a new default?
5. Ownership of the flow on Keyring's reader side (VTI-LNK-046 needs an owner per reader), and whether `shared-connect` handling lives in core or in a demo profile registered through `registerTrustTask`.

---

## 9. Open questions

Those marked "counterparts" go to RLTP and Consensual by Friday 6 November.

1. **Relay** (counterparts). Which mediator does each `did:peer:2` name in `TSPTransport`, with which software and version? Does it accept a login from an unknown `did:peer:2`? Can Keyring use the same relay?
2. **TSP version and policy** (counterparts). Rev 3 (`YTSP-AAC`) or 1.0 (`YTSP-BAA`)? Do they gate on relationship, and do they send `XRFA`? Routed or direct?
3. **Vectors** (counterparts). A real `shared-connect` link, its `did:peer:2` or `did:peer:4`, and how `TSPTransport` is encoded (type abbreviation, endpoint shape).
4. **Proofs** (counterparts). Which key signs each document, whether receipts carry proofs, and what they verify on our `propose`.
5. **Credential** (counterparts). Contexts and `evidence` acceptance; whether Keyring's VRC must carry the `{ceremony, challenges}` binding from #1034; JCS required or rdfc acceptable.
6. **Role at the event** (counterparts). Is Keyring expected to show codes (WP9) or only scan?
7. **Fallback** (counterparts). Does either read DIDComm v2 Trust Task plaintexts at the event?
8. **Display name.** Will `_label` be adopted? Otherwise the name arrives in `propose.reason` or the acceptance, and the R-Card is not exchanged on this path.

---

## 10. Risks

1. **Silent TSP failure.** A missing `XRFI`, a version mismatch or crossing mediators all produce silence. Mitigations: the Node rung first, the same relay, the DIDComm v2 fallback.
2. **Version skew.** The registry binding cites Rev 2; Keyring packs Rev 3 by default, with 1.0 present but unproven upstream and the `preferDidcommForUpstream` stopgap still on; the TSP specification is at Release 1.0.
3. **Regressing the production VRC path.** The ceremony is wired through Credo connection records. Mitigation: the parallel module of WP6 and no deep refactor before the event.
4. **Credential and proof interop at the last step.** RCE gating defaults to VCDM 1.1 for unknown peers on the connection path (the shared-connect path selects its profile by path instead), and the `evidence` contexts and the proof-key choice are unsettled. Any of these ends in `notAccepted` after everything else works.
5. **Schedule and process.** About 2.5 days remain. Merges wait on review. Phone builds are heavy on a shared machine. The app lives in the foreground only (no push wake for encounter DIDs). Frames with attestation evidence can exceed 12,285 bytes.

---

## 11. Test approach

- **Unit, per work package,** in the existing suites named above; no new harness. Fake agents and sessions (`vtiAgentLegs.test.ts`, `ceremonyIssue.test.ts`) keep the suites off the network.
- **Regression guard.** The existing connection-based ceremony tests (`ceremony.test.ts`, `ceremonyIssue.test.ts`, `ceremonyRestoreProposals.test.ts`) must pass unchanged, since WP6 adds a parallel path.
- **Node rung first.** `tsp-reference/ref-2x-shared-connect` runs the responder side against the counterpart's relay before any phone build.
- **Live two-party run** phone to reference inviter, with vectors exchanged in both directions.
- **Logging test** for untrusted text (WP12).
- **Heavy runs** (typecheck, full suites, phone builds) only after the memory and load check in `/srv/dev/CLAUDE.md`, under `nice -n 10`.

## 12. Process constraints

- No merge before Alberto's review: keyring-wallet pull requests, and this plan.
- Commits are signed off and cryptographically signed. In the bifold submodule, `Signed-off-by` must be the last line (commitlint); conventional commit types.
- Upstream facts are read from the pinned clones under `external/` (repository `CLAUDE.md`).
