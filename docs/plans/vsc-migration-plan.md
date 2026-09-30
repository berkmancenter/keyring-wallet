# From the WD02 witness credential to the VSC — Keyring on `dtg:witnessed`

**Status:** V0–V5 and the `issuerScope` follow-up (§3.6) are implemented and independently verified, on eleven stacked `bifold` branches plus one outer `feat/vsc-migration` branch, all pushed to `origin`, **with PRs open on both repos** (`berkmancenter/keyring-bifold` #212–#222, stacked in dependency order; `berkmancenter/keyring-wallet` #259 against `main`) — none merged yet, review pending. V4's `WITNESS_CREDENTIAL_SHAPE` switch defaults to `vsc` (Q1). **`yarn e2e:vrc:witnessed:android-only` is now green on two real Android devices** — a full witnessed VRC exchange, hardware-attested (StrongBox) biometric signing on both sides, a real witness credential issued and self-checked end to end. Five real bugs were found and fixed getting there (see the 2026-09-29 companion, G18–G23). **The literal named variants (`yarn e2e:vrc`, `yarn e2e:vrc:witnessed:didcomm-v2:tsp`) remain unrun** — both need an iOS Simulator half this development machine can't provide (no macOS/Xcode); Brendan will run those himself. **All 5 of the pre-existing `vrc-reference` integration-suite failures are now fixed** (G25, G27) — 0 of 12 suites failing, including the `proofExchange.test.ts` DIF-PE/JSON-LD conflict, which turned out to be live product exposure (reachable from the shipped app's real proof-request screen) and is now genuinely fixed with two coordinated dependency patches, not just documented. Remaining open items: D7 (registry pinned and byte-verified, vocabulary migration scoped but not executed — G26), the legacy basicmessage-dialect's permanent `wd02`-only status (confirmed structural, now documented in code — G27), and Q7 (blocked on upstream `cred-spec#58`).
**Scope:** moving every witness credential Keyring issues, carries, verifies and displays from the deprecated WD02 `WitnessCredential` *type* to the Working Draft 0.4.0 **Verifiable Statement Credential (VSC)** under the `dtg:witnessed` **predicate profile** — and standing up, inside this repository, the predicate vocabulary the specification depends on and **which upstream has not yet deployed** (a real draft registry now exists; §2.1). The VRC itself is out of scope: it is an edge credential and WD 0.4.0 leaves its shape alone.
**Siblings:** [`openvtc-integration-plan.md`](./openvtc-integration-plan.md) owns the transport and the Trust Task operation layer this credential rides on, and its [`trust_tasks_subtask.md`](./openvtc-integration-plan/trust_tasks_subtask.md) owns the witness ceremony that mints the credential. [`locality-plan.md`](./locality-plan.md) owns the `locality*` members this plan has to find a conforming home for. Neither is blocked by this plan; this plan is blocked by neither.
**Constraints:** [`vsc-migration-plan/cred-spec-constraints.md`](./vsc-migration-plan/cred-spec-constraints.md) — every normative requirement quoted with its citation, C1…C16, read at a stated commit. **The design below cites those, not the specification directly**, so that a spec advance is one file's worth of re-reading.
**Reasoning:** [`vsc-migration-plan/2026-09-16-bm.md`](./vsc-migration-plan/2026-09-16-bm.md) — the measurements behind §3 and §4, the positions adopted, and what they supersede. [`vsc-migration-plan/2026-09-17-al.md`](./vsc-migration-plan/2026-09-17-al.md) — review of that draft: prior rungs on this subject that are not yet pushed, and gaps at Credo 0.7, the Trust Task carriages, the test surface and the farm line. [`vsc-migration-plan/2026-09-27-bm.md`](./vsc-migration-plan/2026-09-27-bm.md) — applies the 2026-09-17 review to this text, and checks the ladder and the `verifiable-trust-infrastructure` pin against what actually landed on `main` in the interval. [`vsc-migration-plan/2026-09-28-bm.md`](./vsc-migration-plan/2026-09-28-bm.md) — records V0–V5 and the `issuerScope` follow-up as implemented and independently verified (not merged to `main`; nine stacked `bifold` branches plus one outer branch, all pushed, no PRs opened yet), the `dtgwg-cred-spec` pin's advance to `94af2d8`, and same-day decisions on Q1 and Q8. [`vsc-migration-plan/2026-09-30-bam.md`](./vsc-migration-plan/2026-09-30-bam.md) — the dedicated hardware-evidence context replacing the legacy `@vocab` for new VRCs, its RCE v5 gate, and the byte-exact registry context (§2.6). Part 2 of the same file: the evidence/`@context` investigation, the 2026-09-30 upstream review (vetted/1, presented/1, registry without release tags, #58 to context v2), the open rollout decision, the upstream-contribution strategy, pending phase-2 verification, and gaps G32–G38; Part 3 records G32's implementation (`issuerScope`, Data Integrity on every VC 2.0 VRC). [`vsc-migration-plan/2026-09-29-bm.md`](./vsc-migration-plan/2026-09-29-bm.md) — the first real-device e2e pass (`yarn e2e:vrc:witnessed:android-only`) and the five real bugs found and fixed reaching it (G18–G24), then a real `vsc`-shaped capture fixture and its Check D2 audit (G25), then pinning and byte-verifying the real `dtgwg-vsc-registry` `v1` context and scoping (not executing) the vocabulary migration D7 needs (G26), then documenting the legacy-dialect gap as structural in code and genuinely fixing `proofExchange.test.ts`'s two-dependency DIF-PE context conflict (G27), then auditing every locally-patched bug for upstream-contribution candidacy, correcting an earlier assumption about where the VC2.0 shims belong along the way (G28 — full detail in a machine-local handoff doc, not tracked here). This document states current design only; see [`CLAUDE.md`](./CLAUDE.md). [`vsc-migration-plan/hardware_evidence_binding_subtask.md`](./vsc-migration-plan/hardware_evidence_binding_subtask.md) — subtask: the G33 hardware-evidence content binding (current behaviour cited end to end, options A–E, a two-stage fix, test plan and device acceptance).
**Baseline:** DTG Core Credentials **Working Draft 0.5.0** at `dtgwg-cred-spec` **`94af2d8`** (2026-09-28) — the `external/` pin, **advanced from `b89f389`** the same day (§10; see the 2026-09-28 companion for the advance's rationale and what the +41 commits contain). Codebase facts originally measured on `plan/vsc-migration`, forked from `feat/credo-0.7` at `17b6330`, on 2026-09-16; both that branch and `feat/credo-0.7` are since merged to `main` (PRs #55, #54), so the current baseline is `main` itself — implementation forks from there as `feat/vsc-migration`.

---

## 1. What actually changed, and what did not

The specification did not rename a credential. It **collapsed a family of credential types into one type plus a governed vocabulary**, and the witness credential is one of the two casualties.

Where WD02 had `EndorsementCredential` and `WitnessCredential` as concrete subtypes of `DTGCredential`, WD 0.4.0 has a single `StatementCredential` whose meaning is carried by an absolute-IRI `predicate` inside `credentialSubject`. The VEC and the VWC are now *predicate profiles* — `dtg:endorses` and `dtg:witnessed` — and the reason the type strings are gone is stated plainly: *"a VSC carries exactly one channel of meaning, its `predicate`, so that a type string and a predicate can never disagree"* (C1).

Three consequences frame everything below.

**The name VWC is not deprecated. The type string is.** The glossary still defines VWC, as *"a VSC under the `dtg:witnessed` predicate profile"* (C1). Every comment, file name, identifier and document in this repository that says "VWC" stays correct. The ~2,200 occurrences of `VWC`/`witnessContext`/`WitnessCredential` across ~200 files are **not** a migration surface; §4 shows that the wire shape lives in **sixteen non-test source files**.

**"Is this a witness credential?" stops being a question about `type`.** It becomes a question about `credentialSubject.predicate`, answered against a configured accept-list. `bifold/packages/core/src/modules/vrc/credentialTypes.ts` is the repository's declared single source of truth for credential-kind detection and its entire contract is *"a credential JSON, a `type` array, or a single type string"*. That contract cannot answer the new question: a `type` array alone no longer distinguishes a VWC from a VEC. This is the one place where the migration is a design change rather than a substitution.

**The specification now depends on a repository that does not exist.** *Predicate Handling* makes rejection the only conforming outcome for a predicate a verifier has not been configured to accept, and the configuration is meant to come from the **DTG Predicate Vocabulary** registry (C4, C11). That registry is *planned*: `gh repo list trustoverip` on 2026-09-16 returns sixteen `dtgwg-*` repositories and `dtgwg-predicate-vocab` is not among them (C11). The namespace those predicates will live under is undecided, and the current one is explicitly labelled a placeholder that **will** change (C12). §2 is how we keep moving anyway.

---

## 2. The missing vocabulary, and the bridge

### 2.1 The gap, stated precisely

Three distinct things are missing, and conflating them is the trap:

| Missing | Status | What it blocks |
|---|---|---|
| **The registry repository** — `trustoverip/dtgwg-predicate-vocab`, holding one definition file per predicate and generating `accept-list.json`, `vocab.jsonld` and `context/vN.jsonld` | Proposed in cred-spec [#52](https://github.com/trustoverip/dtgwg-cred-spec/issues/52), OPEN, not created (C11, C13) | A verifier has nothing to import as configuration |
| **The namespace IRI** — where DTG predicates live | Undecided, cred-spec [#48](https://github.com/trustoverip/dtgwg-cred-spec/issues/48), OPEN (C12). The current `https://firstperson.network/credentials/dtg/v1#` is a placeholder and the final form *"carries no version segment"* | The exact bytes we issue |
| **The DTG `@context`** — `https://firstperson.network/credentials/dtg/v1`, REQUIRED by *Base Structure* | Not published; the spec's own editor's note says so (C3) | Any JSON-LD-canonicalizing proof over a conforming credential |

The registry and the namespace move together: #52 says its own IRIs are placeholders pending #48. **The shapes are stable; the identifiers are not.** That asymmetry is the whole basis of the bridge.

**As of 2026-09-27, the registry repository exists in draft form and the namespace is de facto decided, though neither issue is formally closed.** [`trustoverip/dtgwg-vsc-registry`](https://github.com/trustoverip/dtgwg-vsc-registry) (created 2026-09-24) holds real `predicate.jsonld` definitions for `endorses` and `witnessed`, both `status: draft`, under `https://registry.trustoverip.org/dtg/vsc/<name>/<n>` — flat integer per-predicate path-segment versioning, settled on cred-spec #52 and #58's threads, not a fragment on the spec's own placeholder. Its own README states *"until [deployment], the IRIs do not resolve"* — the registry publishes no releases and will not (upstream closed #14 by dropping release tags: *"what implementations bundle and verifiers pin is the commit or the accept-list digest"*, GOVERNANCE §8), so we pin a commit, and #48/#52 remain OPEN. §9's *Settled* namespace decision predates this and needs revisiting against it; see [`vsc-migration-plan/2026-09-27-bm.md`](./vsc-migration-plan/2026-09-27-bm.md) G6.

### 2.2 The bridge: mirror the registry, isolate the IRI

We build, inside this repository, a **spec-shaped mirror** of the registry that does not exist, in the exact artifact format #52 specifies (C13), and we put every IRI that #48 can move behind **one exported constant**.

The bridge has two halves with **different fates**, and keeping them apart is the design:

- **The mirror** — `predicates/*.jsonld` source files and the generated `accept-list.json`, `vocab.jsonld` and `context/v1.jsonld`. This is a **stand-in for someone else's repository** and is **deleted** the day the registry's own definitions are the ones we bundle (the registry has no releases; a verifier pins a commit or the accept-list digest). It is generated, never hand-edited, and marked as such.
- **The consumer** — an implementation of *Predicate Handling*'s three steps (C4) that takes an accept-list and a predicate IRI and returns accept-with-profile or reject. This is **permanent**. When the registry publishes, only its *input* changes: a fetched-and-vendored `accept-list.json` replaces a generated one, and not a line of the consumer moves.

Concretely, a new bifold package:

```
bifold/packages/dtg-vocab/
├── README.md                    what this is; that it is a MIRROR; the deletion trigger
├── vocab/                       ── THE MIRROR — deleted when upstream publishes ──
│   ├── predicates/
│   │   ├── witnessed.jsonld     the nine profile members (C10), verbatim from #52 (C13)
│   │   └── endorses.jsonld      mirrored so the format is exercised against both core profiles
│   ├── meta/predicate.schema.json
│   ├── tools/build.mjs          validates predicates/ against meta/, emits dist/
│   └── dist/                    generated; never hand-edited
│       ├── accept-list.json
│       ├── vocab.jsonld
│       └── context/v1.jsonld
└── src/                         ── PERMANENT ──
    ├── namespace.ts             THE one constant #48 moves
    ├── acceptList.ts            loads an accept-list; no network, no dereference (C4)
    └── predicateHandling.ts     the three steps of C4, plus per-profile constraint checks
```

**Two placeholder namespaces are in play, and `DTG_NS` controls only one of them.** The wallet **issues** under `https://firstperson.network/credentials/dtg/v1#witnessed` (below). `ref-07f`'s mirror, built independently from #52's issue body, generates its accept-list under **`https://trustoverip.org/dtg/vocab#`** — #52's own worked example uses that host, not the spec's placeholder. Both are conforming placeholders; they are not the same string. `DTG_NS` is the *issuer's* constant; the mirror's generator takes its own namespace input separately, and the two are reconciled only by §2.3's rolling cutover, never by assuming they match. State this explicitly wherever the mirror and the issuer are wired together, so the accept-list and the issuance constant are never silently read as the same IRI.

**`namespace.ts` is the load-bearing file.** It exports the namespace and derives every predicate IRI from it, so that #48 resolving is a one-line edit plus a regenerated `dist/`:

```ts
/** Placeholder pending cred-spec #48. The final namespace carries NO version
 *  segment (#52). Every predicate IRI in this package derives from this. */
export const DTG_NS = 'https://firstperson.network/credentials/dtg/v1#'
export const PREDICATE_WITNESSED = `${DTG_NS}witnessed`
export const PREDICATE_ENDORSES  = `${DTG_NS}endorses`
```

### 2.3 Why a namespace change is survivable: the accept-list is configuration

The specification makes the accepted-vocabulary set *"the verifier's configuration"* and says it *"is never derived from the credential"* (C4). It is therefore **conforming for one verifier to accept two IRIs for the same predicate**, and conforming to *issue* under exactly one. That is not a loophole; it is the mechanism the spec hands us, and it turns #48 from a flag day into a rolling cutover:

1. Issue under IRI `A`; accept `{A}`.
2. #48 decides IRI `B`. Ship a verifier accepting `{A, B}`. **Issue nothing new.**
3. Once the accepting build is out, flip issuance to `B`. Accept `{A, B}`.
4. After the fleet's credentials have turned over (§7 — seven days), accept `{B}` and delete `A`.

Step 4's window is short because **both VRCs and VWCs carry a seven-day `validUntil`** (§7). This is the single largest reason this migration is cheap, and it is a property of our deployment, not of the specification. **Step 4 is safe only because of that expiry, not because narrowing an accept-list is generally safe.** #52 keeps deprecated predicate terms in the registry *"forever"* but excludes them from the *generated, active* accept-list — so narrowing a verifier's configuration to `{B}` retroactively rejects any still-valid credential issued under `A` that the seven-day window has not yet cleared. The mirror this repository builds keeps deprecated entries present and clearly marked rather than dropped, both because that is the safer local behavior and because it is the concrete change worth proposing back to #52.

### 2.4 Why our own namespace is not the answer

The tempting shortcut is to skip the placeholder and issue `dtg:witnessed` under a namespace we definitely control — `https://keyring.berkmancenter.org/vocab#witnessed`. #52 explicitly permits this: *"a community that publishes a predicate under a namespace it controls can issue under it, and verifiers can accept it, without waiting on or ever seeking admission"* (C13).

**It is still wrong for this predicate**, for a reason that does not apply to the extension members of §3.5. `dtg:witnessed` is a **core profile defined by the specification itself** — *"Predicates defined by this specification live in the DTG namespace"* (C2). A Keyring-namespaced `witnessed` would be a second identifier for a concept that already has one, which #52's admission criterion 5 (*"has no existing term with the same meaning — one identifier per concept"*) exists to prevent. We would be forking the core vocabulary to avoid a rename we have already made cheap.

Issue under the spec's placeholder, verbatim. Accept the migration; §2.3 is the mechanism.

### 2.5 The `@context` question is separate, and smaller than it looks

*Base Structure* REQUIRES `https://firstperson.network/credentials/dtg/v1` in `@context` (C3), and it is unpublished. Two facts make this tractable:

- **The predicate check needs no context at all.** *"Because the value is matched as written, this procedure needs neither the credential's `@context` nor a JSON-LD processor"* (C4). Predicate Handling is pure string work.
- **We already resolve DTG contexts locally.** `@bifold/vrc-contexts` bundles context documents and the document loaders intercept their URLs — the mechanism that makes an in-person exchange verifiable with no network at all, which is the argument the parent plan makes for `eddsa-jcs-2022` in the first place.

So the unpublished context costs us a **bundled document under a URL we do not control**, exactly as `WITNESSED_EXCHANGE_CONTEXT_URL` is today. What it does *not* let us do is claim interoperability with a third party that resolves the URL for real. §10 names that as a thing to close upstream, not here.

**Our existing `DTG_CONTEXT_URL` is the wrong IRI, and V2 switches it.** `@bifold/vrc-contexts` defines it as `https://www.firstperson.network/dtg/v1` — a *different IRI* from the spec's `https://firstperson.network/credentials/dtg/v1` (different host, different path). They are not the same context and never were. Both are unresolvable placeholders today, so carrying two wrong URLs buys nothing over carrying one; V2 adopts the spec's IRI and accepts that #48 may move it again, which §2.3's cutover already covers.

### 2.6 The VRC's hardware-evidence block has its own context, and the registry context is bundled verbatim

The registry `v1` context the VRC lists second is bundled as the real, byte-frozen document, not a stand-in: `@bifold/vrc-contexts` keeps the source bytes and parses them, and a test asserts their SHA-256 equals the digest cred-spec states for `v1` (*"The `v1` document is byte-frozen. Its SHA-256 digest ... is `zQmSWyCagdx8oPfXn3piSUx6yqVy5MZ7ZG7nW1TC64QvKZh`"*, `spec/body.md`, Context Versions). Every document loader imports the same constant.

The registry context does not define the terms of the hardware-attestation `evidence` block (`authenticationMethod`, `biometricMethod`, `hardwareBinding`, `attestation`, `signature`, `created`). JSON-LD safe-mode signing refuses a VC 2.0 VRC carrying them unless some context does. A new VC 2.0 VRC therefore lists a third entry, `HARDWARE_EVIDENCE_CONTEXT_URL` in `@bifold/vrc-contexts`: a `@protected` context with no `@vocab`, which defines the evidence types, `created` as `dcterms:created`, and the envelope members as `@type: @json` so certificate-chain order is signed and a misspelled member fails in safe mode. A `@vocab` would sign anything; the VCDM advises against `@vocab` in production.

**The IRI and namespace are provisional.** Keyring does not control `firstperson.network`, and nothing upstream publishes a hardware-evidence vocabulary. `HARDWARE_EVIDENCE_CONTEXT_URL` and `HARDWARE_EVIDENCE_NAMESPACE` are the only two places the strings live, so re-pointing them once the DTG editors settle where it is published is a one-place change. Credentials already issued against the provisional IRI need it to keep resolving locally.

**The VRC declares `issuerScope: pairwise` and every VC 2.0 VRC carries a `DataIntegrityProof`.** The VRC section REQUIRES `issuerScope` (exactly one of `pairwise`, `directed`, `public`, declaring the correlation scope of the identifier in `issuer`) and the Base Structure requires `proof.type` `DataIntegrityProof` on VC 2.0. `buildVrcCredential` emits top-level `issuerScope: 'pairwise'` on the VC 2.0 VRC only. The issuer is the per-relationship `did:peer:0` that `getOrCreateRelationshipDid` mints with a fresh key for one counterparty DID and never hands to another, so the identifier is pairwise, which is also the value the specification recommends for a VRC. This is independent of Q8: Q8 decides the scope of the *witness's* identifier, which is shared across everyone it witnesses. The registry `v1` context defines the term, so no context changes; the member is part of the bytes the hardware signs (it is added before signing) and the verifier's `extractSignedContent` reconstructs it in position. A peer that announced RCE v2 only (VC 2.0 but no Data Integrity) is treated as a pre-v2 peer: `counterpartySpeaksVc20` now requires RCE v3, so that peer receives the legacy VCDM 1.1 VRC (contact info in the issuer object, `Ed25519Signature2018`) and no RCard. No VC 2.0 VRC the wallet builds is ever signed with `Ed25519Signature2018`. Verification still dual-reads stored `Ed25519Signature2018` credentials. The `vrc-reference` demo participants (`Participant.ts`) still emit VC 2.0 VRCs with `Ed25519Signature2018` and no `issuerScope`; they are a demonstration CLI, not the wallet, and are not changed. The VP that wraps a VRC for the witness is still signed `Ed25519Signature2018` (the conformance text covers the credential, and the witness verifies both families).

Acceptance: `__tests__/modules/vrc/vrcIssuerScopeAndProofGate.test.ts` (`core/src/modules/vrc/__tests__/unit/`), `hardwareEvidenceVocabulary.test.ts` (`issuerScope` expands to `registry.trustoverip.org/dtg/credentials#issuerScope`, with and without evidence), `__tests__/modules/vrc/vrcSignedContentKeyOrder.test.ts`, `diConformance.test.ts` (sign, verify, tamper, witness VP, dual-read), and the witness-server and `witnessCeremony` digest-edge tests. No real-device run has exercised it.

**Rollout is gated on peer capability.** A wallet that has not bundled the new context cannot resolve its IRI offline, so the context is listed only for a peer that announced RCE v5 (`RCE_PROTOCOL_VERSION`, `modules/vrc/vrc-manager.ts`). Every older VC 2.0 peer still receives the legacy `DTG_CONTEXT_URL`, whose `@vocab` is retained solely for them; every loader keeps resolving it, so existing VRCs verify unchanged (dual-read). A witness that predates the context cannot resolve it either: a witnessed exchange with such a witness needs the witness upgraded first. The gate reads the peer's RCE version only and has no witness-side equivalent.

Acceptance: `core/src/modules/vrc/__tests__/unit/registryContextPin.test.ts` (digest pin), `hardwareEvidenceVocabulary.test.ts` (safe-mode canonicalization of each evidence variant, no quad outside the declared namespaces, a misspelled member throws), `__tests__/modules/vrc/diIssuanceFlip.test.ts` (per-version `@context`), and `vrc-reference` `diConformance.test.ts` (`eddsa-rdfc-2022` sign and verify with evidence on both the new and the legacy context). Hardware signing on a real device is not exercised by any of them.

**What is not yet proven, and what the specification does not say.** The specification has no rule on `evidence`, on extension members outside a predicate profile, or on `@vocab`: its *"A verifier MUST ignore additional members a profile does not define"* (Predicate Profiles, `spec/body.md`) is scoped to `credentialSubject` members of a profile, so the evidence block rests on VCDM 1.3 (5.2 Semantic Interoperability: `@vocab` SHOULD NOT be used in production) and Data Integrity (2.4.3: data loss during canonicalization MUST throw), not on a DTG rule. No salt is emitted under `v1` (cred-spec #38 is scheduled for context v2). The following are open gaps, not design: iOS-origin evidence trusts its embedded `signedContentHash` as the assertion's `clientDataHash`, so the assertion is not bound to the credential bytes the verifier holds (G33; design and staged fix: [`vsc-migration-plan/hardware_evidence_binding_subtask.md`](./vsc-migration-plan/hardware_evidence_binding_subtask.md)); `docs/HARDWARE_ATTESTATION_FLOW.md` is stale (G34). The device-free sign-and-verify, the old-peer and old-witness failure simulation, the RCE v5 gate end to end and a real-hardware `yarn e2e:vrc:devices` run have not been executed (G38); acceptance criteria for each are in the 2026-09-30 companion, Part 2 §5.

Reasoning, the investigation and the alternative gate considered: [`vsc-migration-plan/2026-09-30-bam.md`](./vsc-migration-plan/2026-09-30-bam.md).

---

## 3. The wire deltas

Eight changes between what `buildWitnessCredentialJson` emits today and what C2/C5 require. Each is independently checkable; each has a rung in §5.

| # | Member | Today | WD 0.4.0 | Cite | Severity |
|---|---|---|---|---|---|
| **D1** | `type` | `[…, "DTGCredential", "WitnessCredential"]` | `[…, "DTGCredential", "StatementCredential"]`, and MUST NOT carry another concrete subtype | C1, C2 | breaking, trivial |
| **D2** | `credentialSubject.predicate` | *absent* | REQUIRED, absolute IRI, no CURIEs on the wire | C2 | breaking, needs §2 |
| **D3** | the digest | `credentialSubject.digest` = `"sha256:"+hex`, over the **proofed** VRC | `credentialSubject.object.digestMultibase` = multibase base58btc multihash, over the VRC **excluding top-level `proof`** | C5, C6 | breaking ×3 |
| **D4** | `taskContext` | inside `credentialSubject` | **top level**, sibling of `credentialSubject` | C2 | breaking, four read sites |
| **D5** | extension members | `hardwareAttestationIncluded`, `locality*`, `localityVerification` inside `witnessContext`; `parties`, `taskDigestMultibase` inside `credentialSubject` | not defined by the profile; a verifier MUST ignore them; they need a stated home | C5, C10 | design, §3.5 |
| **D6** | subject binding | `credentialSubject.id` = the observed VRC's issuer — **emitted correctly, never checked** | a verifier holding the referenced credential **MUST check** it, unconditionally | C5 | **new verifier obligation** |
| **D7** | `@context` | `[credentials/v2, trustoverip.org/credentials/witnessed-exchange/v1]` | MUST list `https://registry.trustoverip.org/dtg/context/v1` second, compared as an exact string | C3 | breaking, §2.5 — scoped, not yet executed (below) |
| **D8** | predicate rejection | *nothing rejects an unknown predicate — there are no predicates* | rejection is the **only** conforming outcome for an unaccepted predicate | C4 | **new verifier obligation** |

**D4 is four read sites, and three of them are a debt we owe independently of this plan.** `taskContext` moving to the top level is trivial to *emit*; reading it correctly touches four call sites, and WD02 already puts `taskContext` at the top level today — so three of the four are a standing WD02-conformance gap, not new work this migration introduces:

| Site | Reads | Status |
|---|---|---|
| `bifold/packages/trust-tasks/src/outcomeEvidence.ts:71` | `credentialSubject.taskContext` | pre-existing WD02 conformance gap |
| `bifold/packages/trust-tasks/src/outcomeEvidence.ts:227` | same | same |
| `bifold/packages/core/src/modules/trust-tasks/witnessCeremony.ts:169` | same | same |
| `bifold/packages/witness-server/src/WitnessService.ts:2545` | `credentialSubject.digest` | D3 |

The first three have been reading the wrong location since before this plan existed and have been costing us cross-implementation compatibility the whole time — a second implementation (`dtg-credentials` 0.7.0) placing `taskContext` correctly at the top level already fails two of Keyring's own VWC checks against it, for exactly this reason. V4's scope names all four so they are fixed together rather than discovered piecemeal at fixture-regeneration time.

**D4's target is itself live upstream, and this is a reason to sequence V4 late rather than a reason not to build it.** cred-spec [#58](https://github.com/trustoverip/dtgwg-cred-spec/issues/58) (OPEN, milestone `context/v2` as of 2026-09-30 — assigned to the next context version, not to v1; unresolved at the `94af2d8` pin) proposes removing `taskContext` and `taskDigestMultibase` from the credential entirely, in favor of a detached, issuer-signed citation document, to close a durable-correlator gap the ZKP specification flagged. It is under active discussion, not adopted. If it lands before implementation, D4 as specified here (relocate `taskContext` to the top level) is replaced by removing the member and building the citation document instead — a bigger change than a relocation, and one that also touches the witness ceremony's task-binding check in `witnessCeremony.ts`. **This does not gate V0–V3**: nothing in verification-first work (D6, D8, `credentialTypes.ts`) depends on where `taskContext` sits. It gates only V4's D4 sub-step, and only once #58 resolves one way or the other. Track before V4 starts.

**`taskDigestMultibase` is REQUIRED wherever `taskContext` is required, as of the `94af2d8` pin, and belongs at the same top level as `taskContext` — not nested in `credentialSubject`.** This was not visible at the `b89f389` pin this plan was originally checked against; the advance surfaced it. Built and fixed 2026-09-28 in the Trust Tasks session-ceremony path (`WitnessTaskSessions.ts`'s issuance side, `witnessCeremony.ts`'s read side, which previously had no top-level fallback the way `taskContext` already did) — see the 2026-09-28 companion for the exact fix. **The encoding itself was never the bug**: `@bifold/trust-tasks`'s `taskDigestMultibase`/`digestBytesEqual` (§3.1) already implement the correct base58btc-multihash-over-JCS form independently of this finding; only where the resulting value was placed was wrong. **A separate gap, confirmed structural rather than fixed, and now documented in code (G27)**: the *legacy basicmessage-dialect* witnessed-exchange path (`WitnessService.ts`'s `buildWitnessCredential`, the private wrapper around the shared `buildWitnessCredentialJson`, kept for old wallets that never adopted the Trust Task carriages) emits neither `taskContext` nor `taskDigestMultibase` for `vsc` shape at all, and never passes `shape` to `buildWitnessCredentialJson` at all, so it stays on `wd02` regardless of `WITNESS_CREDENTIAL_SHAPE`. That dialect's session is an in-memory identifier with no real Trust Task document behind it (no `witness/session` artifact, nothing citable), so it has nothing to cite as a task context — this dialect is permanently, structurally incapable of `vsc` shape, not merely unfinished. A doc comment at the call site (`bifold` `e764baa80`) now states this explicitly, so a future contributor doesn't "fix" it into fabricating a task citation that doesn't exist.

**D7's target is now a byte-verified, pinned document; the migration it requires is scoped but not executed.** The real registry `v1` context (`dtgwg-vsc-registry`, pinned under `external/` at `eb29484`) is confirmed byte-identical to the digest `dtgwg-cred-spec` (`94af2d8`) states for it. Reading it directly shows it owns more than just `DTGCredential`/`RelationshipCredential` (the two terms V1/V2's namespace work already targets, §2.3/§2.4): it also mints `taskContext`, `taskDigestMultibase` (typed, which today's emission is not — a second gap D7's first pass hadn't surfaced), `witnessContext` and its `event`/`sessionId`/`method` members, `predicate`, `object`, `issuerScope`, and `StatementCredential` — the last four already byte-identical to what Keyring emits today, the rest not. Placing the registry context at the required position 2 alongside today's `WITNESSED_EXCHANGE_CONTEXT_DOCUMENT` throws a protected-term-redefinition error (confirmed against the real document, not a stand-in) until `WITNESSED_EXCHANGE_CONTEXT_DOCUMENT` is trimmed to keep only genuinely Keyring-only members (`witnessName`, `hardwareAttestationIncluded`, `locality*`, `digest`, the wd02-only legacy type strings). That trim, plus the `@context` reorder and a re-verification pass (the change is canonicalization-affecting, not additive — existing shape tests and the `ref-07`/capture-harness fixtures all need updating to the new term IRIs, not just re-passing by accident), is real implementation work, deliberately left unexecuted here. Full term-by-term table, the empirical JSON-LD ordering tests, and the exact migration steps: [`vsc-migration-plan/2026-09-29-bm.md`](./vsc-migration-plan/2026-09-29-bm.md) G26.

### 3.1 D3 is three breaks, not one, and one of them is new

`ref-07-dtg-edge-semantics` already records this gap, and records it as *"encoding-only"* — quoting its own check: *"the rename is exactly PR #18's `digestMultibase` change, already specified as encoding-only"*. **That was true at the pin and is no longer true.** At `b89f389` the digest was *"the SHA-256 hash of the credential's JSON representation canonicalized with JCS"* — the whole credential. At `994a3d63` it is computed *"excluding its top-level `proof` member"* (C6). So:

1. **Member moves**: `credentialSubject.digest` → `credentialSubject.object.digestMultibase`.
2. **Encoding changes**: `sha256:`+lowercase-hex → multibase-`z`+multihash-`0x12 0x20`+base58btc. Comparison must be on **decoded bytes**, never strings (C6).
3. **Coverage changes**: the hashed document loses its top-level `proof`. **This is not encoding — it is a different digest of a different document**, and it is the one break a naive `sha256:` → `z…` transcoder would silently get wrong.

`ref-07`'s check text must be corrected alongside the migration; §6 V5 owns it.

**The primitive already exists and is already tested.** `bifold/packages/trust-tasks/src/documentProof.ts` exports exactly this algorithm:

```ts
export function taskDigestMultibase(document: Record<string, unknown>): string {
  const { proof: _proof, ...unproofed } = document
  return digestMultibase(unproofed)   // JCS → sha-256 → multihash → base58btc
}
export function digestBytesEqual(a: string, b: string): boolean  // decoded-byte compare
```

Its doc comment already cites *"cred-spec, Trust Task Context Binding"*. `object.digestMultibase` over a VRC **is** `taskDigestMultibase(vrcJson)`; digest equality **is** `digestBytesEqual`. `trust-tasks` is declared platform-neutral by the root `CLAUDE.md` — *"no Node-only or RN-only imports allowed"* — so the witness server and the wallet can both call it, which is precisely the property this delta needs.

### 3.2 D6 and D8 are new work, not substitutions

D1–D5 and D7 are things we *emit*; changing them is editing one builder and its fixtures. D6 and D8 are things a conforming verifier must **do**, and we do neither today:

- **Nothing in the wallet recomputes a VWC's digest.** Searching `bifold/packages/core/src/modules/vrc` and `.../trust-tasks` for digest recomputation against `credentialSubject.digest` returns nothing outside tests. The only implementation is `ref-07`'s, out of band in a reference rung.
- **Nothing checks that `credentialSubject.id` is the referenced credential's issuer.** The witness sets it correctly at issuance; no holder or third party verifies it. WD 0.4.0 makes that check a MUST *"a verifier holding the referenced credential MUST check that it is"* (C5) — and makes it unconditional, where WD02 stated it only for bidirectional exchanges.
- **Nothing rejects an unknown predicate**, for the good reason that nothing has predicates yet.

What the wallet *does* check today, in `witnessCeremony.ts`, is the **Trust Task** layer: `vwcDigestMultibase` against `digestMultibase(vwc)`, and the §4.9.3 task digest against `taskDigestMultibase(sessionDoc)`, both with `digestBytesEqual`. That is the right shape, applied to the wrong artifact for this purpose: it binds the VWC to its session, not to the VRC it attests. **D6 adds the missing edge of the triangle.**

### 3.3 What D6 lets us finally say

The spec's own wording explains why D6 is worth the work rather than a box-tick: a VWC's subject and `taskContext` *"identify only the observed party and the trust task exchange, **not the edge being witnessed**"* (C5). Today a Keyring contact's witness badge is drawn from a VWC whose binding to the VRC on the same screen is **asserted by the witness and verified by nobody**. After D6 the wallet can state that this witness attested *this* credential — a stronger claim than the badge currently makes, from artifacts we already hold.

### 3.4 What carries over unchanged

Worth stating, because it bounds the work: *"one VWC per direction, `taskContext` REQUIRED, `directed` minimum scope, making the referenced credential available, and the outcome-evidence obligation"* are all **carried over unchanged** from WD02 (C5). Our per-direction issuance, our `taskContext` binding, our outcome-evidence retention (`witnessShareSpec.ts`, `outcomeEvidence.ts`) are all already right and are not touched by this plan.

### 3.5 Where the extension members go (D5)

We attach members no DTG profile defines: `hardwareAttestationIncluded`, the fourteen `locality*` terms from [`locality-plan.md`](./locality-plan.md), the deprecated nested `localityVerification`, `parties` and `taskDigestMultibase` from the Trust Task ceremony, and — as of 2026-09-28 — `witnessName`.

**`witnessName` exists because D1's `issuer` fix removed the only home a display name had.** WD02's `issuer` was `{id, name}`; both WD02 and WD 0.4.0 require a bare-string `issuer` (§6 V4), so fixing that string format left the witness's human-readable name with nowhere to go. `witnessName` is termed and attached the same way as every other D5 member — a sibling of `witnessContext`, under the Keyring namespace, ignorable by any verifier that does not define it (C10) — not a special case. It is not `schema:name`: `credentialSubject.id` is the VRC issuer being witnessed, not the witness, so reusing the generic `name` term there would assert the wrong RDF subject's name.

The specification's position is permissive and explicit: *"A verifier MUST ignore additional members a profile does not define, so that a profile can add optional members without invalidating credentials for older verifiers; strictness lives in the predicate, not in the payload"* (C10). **So carrying them is conforming.** The design question is only where they sit and under whose namespace.

**Adopted: hoist the extension members to `credentialSubject`, siblings of `witnessContext`, under a Keyring-controlled JSON-LD namespace.** `witnessContext` keeps exactly the three members the profile defines — `event`, `sessionId`, `method` — and nothing else.

Three reasons, in order of weight:

1. **`witnessContext` is now a profile-owned object with a published schema.** #52's `witnessed.jsonld` points `additionalMembers.witnessContext.schema` at `witness-context.schema.json` (C13). Members we invent inside a container the registry will schema-constrain are a collision waiting for the registry's next published `witnessed/1` schema. Members we add *beside* it are exactly the ignorable extras C10 sanctions.
2. **It is what `locality-plan.md` wanted anyway.** That plan requires flat `locality*` members because *"bbs-2023 discloses at the RDF-quad level, and a nested object is a blank node whose path must be revealed before disclosing anything under it"*. Today they are flat **inside** `witnessContext` — which is itself a nested object, so the blank-node problem is only pushed up one level and never solved. Hoisting to `credentialSubject` is the first arrangement that actually delivers what the locality plan asks for. **This is a locality-plan improvement the VSC migration makes free**, not a cost of it.
3. **A community namespace is correct here, where it was wrong in §2.4.** These are *our* terms with no DTG equivalent, which is the case #52's tier C — *"terms a VTC or VTN defines under a namespace it controls"* — was written for.

**Three constraints on the Keyring namespace itself, none of which changes the decision.** A Keyring-namespaced document is free for *our* wallet — it is bundled — but it is a network dependency inside someone else's trust boundary for any third party verifying a Keyring VWC: an unbundled community context is one outbound request per verification (the vocabulary host learns which verifier reads which credential kind, and when), fails outright offline, and makes Keyring the party able to retroactively change what its own issued credentials signed over by revising the document at that URL.

1. The Keyring namespace document ships **bundled in `@bifold/vrc-contexts`**, in the same phase that first emits a member under it (V2, before V4 first issues one).
2. The namespace document is **immutable once published** — new terms only, never a withdrawal or a redefinition. State this in the file itself, beside the terms.
3. §10 names this as the argument for eventually proposing these members into the registry's `witness-context.schema.json` (§9 Q4) — a third party's offline verification path, not only an editorial preference.

**Not adopted: a second VSC under a Keyring `coPresent` predicate.** It is the cleaner model on paper — locality is a distinct statement with a distinct evidentiary weight — but it doubles the artifacts in every witnessed exchange, needs its own taskContext binding and its own outcome evidence, and changes the ceremony's reply shape that [`trust_tasks_subtask.md`](./openvtc-integration-plan/trust_tasks_subtask.md) and four `ref-06p*` rungs are built around. The constraint that rules it out is not aesthetic: locality qualifies *the conditions under which the witnessing occurred*, and C5 makes those conditions part of what `dtg:witnessed` means (*"the meaning of a witness attestation depends on the conditions under which the witnessing occurred"*). A separate credential a verifier could drop would let a party present the witnessing without its conditions. Revisit only if a second consumer of locality evidence appears that has no witness in it.

### 3.6 Correlation scope: named and REQUIRED as of 2026-09-28, no longer deferred

**This section originally read "named and deferred."** Cred-spec [#68](https://github.com/trustoverip/dtgwg-cred-spec/pull/68) merged 2026-09-28, closing #46: the property is named — `issuerScope`, a top-level string on every DTG credential, REQUIRED, exactly one of `pairwise`/`directed`/`public` — and it now binds. *"Verifiers MUST reject a credential whose `issuerScope` is missing or invalid."* The `dtg:witnessed` profile's own minimum is unchanged from what this section already said: `directed` at minimum, since *"a witness's identifier must be recognizable to both parties to the witnessed edge, and to the community whose witnessing policy the attestation is issued under, so a `pairwise` declaration cannot describe it truthfully."* (The spec's worked examples use `public` for witness services generally, as the broader convention for "a party that must be findable" — that is a deployment fact about a specific witness, not a profile requirement, and this plan does not assert it.)

The trap this section warned about is now live, not hypothetical: *"all credentials issued under one identifier MUST declare the same scope"* — the declaration attaches to the **witness's identifier across every credential it ever issues**, not to the individual VWC/VSC. `directed` is adopted as the value V4 emits (§6 V4, §9 Q8), as the safe, verifiable floor; whether Keyring's witness deployment is in fact broadly findable enough to truthfully declare `public` instead is a deployment question, not resolved here. See [`vsc-migration-plan/2026-09-27-bm.md`](./vsc-migration-plan/2026-09-27-bm.md) G8.


### 3.7 Every shipped proof suite is RDF-canonicalized, so the vocabulary is mandatory

The parent plans discuss `eddsa-jcs-2022`, and JCS-based proofs would make the JSON-LD vocabulary optional — JCS hashes the JSON, so an untermed member is still signed. **That is not what we ship.** `core/src/modules/vrc/vrc-manager.ts:438-446` negotiates exactly two suites by RCE version: `DataIntegrityProof`/**`eddsa-rdfc-2022`** for v3+ peers, and **`Ed25519Signature2018`** for everyone else. Both canonicalize with URDNA2015. `eddsa-jcs-2022` is the *recommendation* of [`docs/CRYPTO_SUITE_FOLLOWUP.md`](../CRYPTO_SUITE_FOLLOWUP.md), not the shipped suite.

The consequence is sharp and it lands on V2: **a VSC member with no JSON-LD term is not merely unsigned, it does not exist in the signed graph.** `predicate`, `object`, `object.digestMultibase` and every hoisted extension member of §3.5 must be termed before they are emitted, or the witness signs a credential that silently omits the very claim it is making.

Three practical rules follow, and V2's ordering is built on them:

1. **Terms land before members.** V2 ships the vocabulary; V4 ships the members. A build where issuance is ahead of the context is the failure mode, not a transient state.
2. **The guard is CI, not review, and it must compare expanded IRIs, not count quads.** `localityVocabulary.test.ts` already counts quads per member and proves the guard guards by deleting a term — necessary, but **not sufficient**: an unresolved CURIE (e.g. a term whose prefix a context does not define) is a syntactically valid absolute IRI and is signed verbatim, at a nonzero quad count, over bytes its author did not mean. Two verifiers holding different contexts can expand the same signed bytes to two different IRIs, both signatures valid. Generalising the guard to every VSC member means asserting, per member, both that it contributes a quad *and* that the quad's predicate IRI is the one intended — a count alone passes this failure mode. Separately: `object.digestMultibase` is already defined and `@protected` by the base `credentials/v2` context; V2 must **not** attempt to redefine it, which is a fatal JSON-LD error, and needs fewer new terms than a first read of §3.5's member list suggests.
3. **Change one thing at a time.** D7 (the `@context` swap) alters canonicalization for *every* member, and D2/D3/D5 add and move members. Landing them in one commit makes a canonicalization break unbisectable. V2 (terms, no wire change) and V4 (wire change, no new terms) are separated for exactly this reason.

This is the `openvtc-integration-plan` companion's *"vocabulary trap closed twice this week"* in its third incarnation. It is the highest-risk part of the migration and the one most likely to present as an inexplicable verification failure rather than a clean error.

---

## 4. Where the wire shape lives in this codebase

The reassuring measurement. `VWC` as a *word* appears ~2,200 times across ~200 files; the **wire shape** lives in sixteen non-test source files, and only four of them build or read the bytes.

```
bifold/packages/vrc-contexts/src/witnessedExchangeContext.ts   ★ the context document
bifold/packages/vrc-contexts/src/index.ts                        re-export surface
bifold/packages/witness-server/src/WitnessService.ts           ★ buildWitnessCredentialJson, computeVrcDigest
bifold/packages/witness-server/src/trustTasks/WitnessTaskSessions.ts  taskContext/parties/taskDigest attachment
bifold/packages/witness-server/src/config.ts                     context wiring
bifold/packages/witness-server/src/LocalityService.ts            locality members
bifold/packages/core/src/modules/vrc/credentialTypes.ts        ★ type detection — §1's design change
bifold/packages/core/src/modules/vrc/utils/witnessCredentialUtils.ts ★ WitnessRecord extraction for display
bifold/packages/core/src/modules/vrc/display/handlers/WitnessCredentialHandler.ts
bifold/packages/core/src/modules/vrc/jsonLdDocumentLoader.ts
bifold/packages/core/src/modules/vrc/createVrcDocumentLoader.ts
bifold/packages/core/src/modules/vrc/index.ts
bifold/packages/core/src/modules/vrc/types/witnessedExchangeContext.ts   (re-export shim)
bifold/packages/vrc-shared/src/documentLoader.ts
bifold/packages/vrc-reference/src/Witness.ts
bifold/packages/vrc-reference/src/documentLoader.ts
bifold/packages/vrc-reference/src/witnessedExchangeContext.ts            ⚠ see below
```

**One thing to fix first.** Three files named `witnessedExchangeContext.ts` exist. `core/src/modules/vrc/types/` is a genuine re-export shim of `@bifold/vrc-contexts` — its header says so. **`vrc-reference/src/witnessedExchangeContext.ts` is a byte-identical copy of that shim** (`96c6aa2e`), which means `vrc-reference` re-exports from `@bifold/vrc-contexts` correctly and the file is harmless — but the name collision makes a reader believe there are three context definitions when there is one. Verify, then leave it; renaming is churn this plan does not need.

**The predicate-awareness tail is two call sites, not thirty.** The type predicates have 30 non-test call sites, but only **two** pass a bare type array rather than a credential object, and both are in `core/src/modules/vrc/vrc-manager.ts` — a file that has the full credential in scope and can simply pass it. Every other site already passes `raw`, `credJson` or `credentialData`. §1 calls the predicate-aware split a design change and it is; it is not a large one.

**Fixtures and tests carrying the shape** (updated in lockstep, §6 V5):

- `tsp-reference/ref-07-dtg-edge-semantics/fixtures/edge-witnessed-captured.json` — a real captured witnessed exchange, and the highest-value fixture in the repository
- `tsp-reference/ref-06p3-third-party-verify/fixtures/genuine-bundle.json`
- `bifold/packages/witness-server/__tests__/unit/WitnessService.test.ts` — the largest single consumer
- `bifold/packages/core/__tests__/modules/vrc/display/credentialDisplayMatrix.test.ts`, `.../screens/ListContacts.test.tsx`, `.../screens/ContactDetails.test.tsx`, `__tests__/screens/listCredentialsFilter.test.ts`
- `bifold/packages/vrc-reference/__tests__/unit/witnessedExchangeContext.test.ts`, `__tests__/integration/witnessedFlow.test.ts`

---

## 5. The reference rungs

Prove the bytes before touching the product, which is what the ladder is for. **Not three new rungs — extensions to a line that already exists.** An earlier draft of this plan reserved `ref-21`/`ref-22`/`ref-23` on the theory that the low numbers were exhausted. That was wrong: five rungs on this exact subject were already built on unpushed branches and an uncommitted worktree at the time, invisible to a `git ls-tree` of `main`. All five have since landed. The work below extends `ref-07b…g`; no new top-of-range number is needed, and none should be minted.

Each rung follows the ladder's contract ([`tsp-reference/README.md`](../../tsp-reference/README.md)): pure TypeScript/JS with **no React Native imports**, frozen fixtures, `npm run -s check`, a README saying what it proves **and what it does not**.

**Current state, checked against `main` on 2026-09-27:**

| Rung | State | What it proves |
|---|---|---|
| `ref-07b-statement-shape` | on `main` | D1/D2/D4 produce a spec-shaped statement credential — four VWC checks give identical verdicts on both shapes, six subject members before and after. Does not cover D3's coverage change or D7 (both post-date this rung's WD02 baseline) |
| `ref-07c-predicate-coverage` | on `main` | The vocabulary-mandatory risk of §3.7 against the **real shipped** `@bifold/vrc-contexts`: an untermed member contributes zero quads (confirmed); `object.digestMultibase` is already `@protected` by `credentials/v2` and fails fatally if redefined; a CURIE that fails to resolve is signed verbatim at a *nonzero* quad count over the wrong IRI — the case a quad-count guard alone does not catch (§3.7) |
| `ref-07d-vocabulary-trust-path` | on `main` | Drives the **real shipped** `createVrcDocumentLoader` and counts network requests: five contexts are bundled and resolve offline; every other context is fetched unauthenticated with no allowlist — the concrete cost §3.5's three constraints on the Keyring namespace are written against |
| `ref-07e-crossimpl-vwc` | on `main` | Cross-implementation against **`dtg-credentials` 0.7.0** (the Rust catalogue the VTC mints from): a byte-identical `digestMultibase` over a real captured VRC (the *excluding-`proof`* coverage change of §3.1 still needs a case here); nine independently-fatal divergences re-adding each Keyring extension member in isolation, confirming §3.5's members are conforming under WD 0.4.0 and rejected outright by this second implementation's `deny_unknown_fields` schema (§10) |
| `ref-07f-predicate-registry` | on `main` | Builds §2.2's mirror and consumer from #52's worked entries and drives *Predicate Handling*'s three steps against Keyring's **real compiled** `credentialTypes.ts`: no dereference at verification time; an unrecognised predicate rejected, not passed through; and — the finding that matters most here — a statement credential without the old type alias is **mis-filed under Contacts** by `isPeerVrcCredential`'s negation, fixed by dispatching on the accept-list instead (§6 V3) |
| `ref-07g-outcome-evidence-pairing` | **not on `main`** — two commits on `origin/feat/ref-07g-outcome-evidence-pairing` (`c3a7f1d2`, `eab68939`, 2026-09-21), **no PR open** | Which outcome-evidence pairing rule generalises across the four cases of `dtgwg-trust-tasks-tf` #17. Touches `outcomeEvidence.ts` and `witnessCeremony.ts`, both files V4 also touches for D4's read-site fix — landing this before V4 avoids two unrelated changes colliding in the same files. Blocked on pushing the branch and opening the PR — not a design gap |
| `ref-07h-vsc-credo-suites` | **does not exist** | Proposed: sign and verify a VSC through **Credo 0.7 with our patch set**, under both suites we actually ship (`Ed25519Signature2018` and `eddsa-rdfc-2022`), and assert the D6 check against a credential Credo verified rather than one a rung signed itself. Needed because every existing rung's cross-implementation work (`ref-07e`) is pure JCS string work, and the first time a VSC would otherwise meet Credo's real sign-and-verify path is V4's `yarn e2e:vrc` — after issuance has already changed |
| `ref-07i-vsc-over-carriages` | **does not exist** | Proposed: a witnessed exchange, with a VSC, run end to end over DIDComm v1, DIDComm v2 and the TSP envelope, with outcome evidence retained and verified. No existing rung runs a witnessed exchange over a carriage at all; both the v2 and TSP carriages landed after every rung this plan otherwise cites |

**One open question this raises, not yet resolved.** `ref-07f`'s mirror was built from cred-spec #52's *issue-body* worked example. A real, if undeployed, registry now exists — [`trustoverip/dtgwg-vsc-registry`](https://github.com/trustoverip/dtgwg-vsc-registry) — with an actual `predicates/witnessed/1/predicate.jsonld`, richer than the issue body (it carries `establishes`/`doesNotEstablish`, `taskContextRequired`, `minimumIssuerScope`) and under a namespace shape (`https://registry.trustoverip.org/dtg/vsc/witnessed/1`) that differs from both the issue body's and this plan's placeholder. Whether `ref-07f` should be rebuilt against that real definition, ahead of the registry's definitions being final, is a question for whoever picks up V0 next — not resolved here. See [`vsc-migration-plan/2026-09-27-bm.md`](./vsc-migration-plan/2026-09-27-bm.md) G6.

---

## 6. The replacement, phase by phase

Each phase has acceptance criteria and is independently revertible. **V1–V3 change no bytes on the wire**; the cutover is V4.

### V0 — Evidence (the rungs)

`ref-07b…f` are **already built and on `main`** (§5). What remains: push `ref-07g` (branch exists, no PR — Alberto's to open); build `ref-07h` and `ref-07i`, neither of which exists yet. No product code.

**Done when:** `ref-07g` merged; `ref-07h` and `ref-07i` green under `npm run -s check`; fixtures frozen; each README states what it does not prove; `for d in tsp-reference/ref-*/; do (cd "$d" && npm run -s check); done` is green across the whole ladder.

### V1 — `@bifold/dtg-vocab`

Promote `ref-07f`'s mirror and consumer into `bifold/packages/dtg-vocab` (§2.2 layout). The app must bundle it — the wallet verifies VWCs, so the accept-list ships on the phone — which per the root `CLAUDE.md` means **four registration entries**: a root `portal:` resolution, an `app/package.json` dependency, a `packageDirs` entry in `app/metro.config.js`, and `BIFOLD_SOURCE_PACKAGES` for dev hot-reload.

*Standing rationale for a separate package rather than folding this into `@bifold/vrc-contexts` (which is already bundled and would cost none of those four entries): the mirror's defining property is that it is **deleted wholesale** when upstream publishes. Inside `vrc-contexts` that seam is invisible and the deletion becomes an archaeology exercise. The four entries are the price of a boundary that a future reader can see.*

**Done when:** `yarn typecheck` and `yarn lint` green at the root; the package's own `yarn test` green (per the root `CLAUDE.md`, the package's own `test` script is the gate — **not** an ad-hoc `tsc --noEmit` in its directory); a Metro build resolves it from both `app/` and `bifold/packages/core`; `README.md` names the deletion trigger and links #52 — and, given that a real (if undeployed) registry now exists at [`dtgwg-vsc-registry`](https://github.com/trustoverip/dtgwg-vsc-registry), states explicitly whether this package mirrors that repository's `predicate.jsonld` files or #52's issue-body example, per §5's open question.

### V2 — The JSON-LD vocabulary

Add the VSC terms to `@bifold/vrc-contexts`: `predicate` (`"@type": "@id"`), `object`, `object.digestMultibase`, `object.value` (`"@type": "@json"`), `object.id`, plus the §3.5 extension members under the Keyring namespace. The spec's editor's note states these expected typings (C3); adopting them now means the published DTG context, when it lands, agrees with what we already signed.

Extend the vocabulary guard. `bifold/packages/core/src/modules/vrc/__tests__/unit/localityVocabulary.test.ts` already enforces that every issued member has a JSON-LD term by **counting quads** and proving the guard guards (deleting a term drops its member to zero quads). Generalise it to every VSC member. This is CI, not discipline — [`locality-plan.md`](./locality-plan.md) item 13 and [`docs/CRYPTO_SUITE_FOLLOWUP.md`](../CRYPTO_SUITE_FOLLOWUP.md) row 13 both already require it.

**Done when:** every member `buildWitnessCredentialJson` can emit has a term; the guard fails when any one term is removed; `bifold/packages/core` and `bifold/packages/vrc-contexts` suites green.

### V3 — Verification first, behind no flag

Implement D6 and D8 in the wallet **before** changing issuance, against both shapes. A verifier that understands VSCs while nothing issues them is inert; the reverse strands the fleet.

- `credentialTypes.ts` grows a predicate-aware path. Its pure type-string predicates stay and stay honest (§1); `isWitnessCredential` becomes a thin wrapper over a new `isWitnessStatement(credentialJson)` that reads `type` **and** `credentialSubject.predicate` through `@bifold/dtg-vocab`. **`isPeerVrcCredential`'s negation (`isDTGCredential(input) && !isWitnessCredential(input)`) becomes an allowlist dispatched on the accept-list**, not a negation — `ref-07f` Act 3 already reproduced the failure mode this fixes: a statement credential without the old type alias is claimed by the negation and filed under Contacts. This fix is owed as soon as any non-witness statement credential can exist, independently of when V4 flips issuance. Call sites holding only a type string keep the old behaviour and are enumerated in the file's header, because that set is now a known limitation rather than an implementation detail.
- `witnessCeremony.ts` gains the D6 check: when the referenced VRC is in hand, `digestBytesEqual(vsc.credentialSubject.object.digestMultibase, taskDigestMultibase(vrc))` **and** `vsc.credentialSubject.id === vrc.issuer`. When it is not in hand, the VWC is *"an opaque hash, not an identified edge"* (C5) and the UI must not claim otherwise. **Verify this against a credential Credo actually signed and verified (`ref-07h`), not only over a fixture** — the wallet's real proof-suite path (§3.7) has its own tripwires (Credo 0.7's `verifyCredentialSubjectAuthentication: false`, the `w3c-di` overlay) that a fixture-only check cannot exercise.
- `witnessCredentialUtils.ts` reads both shapes. The dual-read is a **dated deletion**, not a permanent tolerance: §7.

**Done when:** the wallet verifies a `ref-07b`/`ref-07h` fixture and a legacy captured VWC with the same entry point and the correct verdict for each; an unaccepted predicate is rejected with a distinguishable error; a VWC whose subject is not the referenced VRC's issuer is rejected, checked through Credo's verify path; `bifold/packages/core` suite green; **no witness-server change in this phase**.

### V4 — Issuance: the cutover

`buildWitnessCredentialJson` emits VSC form. `WitnessTaskSessions.ts` moves `taskContext` to the top level (§3, D4 — **conditional on cred-spec #58 not having removed the member first**; re-check before starting this step) and the extension members to their §3.5 home. `computeVrcDigest` is **deleted** and replaced by `taskDigestMultibase` from `@bifold/trust-tasks`. The `issuer` field is fixed from `{id, name}` to a bare string in the same pass — both WD02 and WD 0.4.0 require it, `ref-07e` Act 4 found the divergence, and it is unrelated to the VSC shape change but touches the same builder.

**This is the only phase that changes bytes**, and it has a deployment order the others do not: the witness server is a **deployed service** and wallets are **installed apps** (§7). V3 must be in testers' hands before V4 reaches the witness.

**The witness emits one shape, chosen by configuration, not a compile-time constant.** A single `WITNESS_CREDENTIAL_SHAPE=wd02|vsc` setting — **defaulting to `vsc` as of the pre-production flip (§9 Q1, 2026-09-28)**, no longer gated on §7.1's upstream question formally closing; that caveat remains available as a per-deployment opt-out (`WITNESS_CREDENTIAL_SHAPE=wd02`). This is not gold-plating: §7.1 identifies a shipped upstream policy that matches the WD02 type string, and an operator running a witness against a community on that policy needs the old shape until the community moves. The switch is deleted when §7.1 resolves — with a stated trigger, as V3's dual-read has a stated date.

**Done when:** `ref-07i` green; the witness-server suite green; `yarn e2e:vrc` green **and** `yarn e2e:vrc:witnessed:didcomm-v2:tsp` green — both carriages, not only the v1 baseline; a physical-device run green, exercising hardware attestation, per the root `CLAUDE.md`; a VSC minted by the real witness verifies in the real wallet with the D6 check passing on a real VRC.

**Partially met, 2026-09-29.** `yarn e2e:vrc:witnessed:android-only` (two real Android phones, no iPhone) is green — hardware attestation on both sides (StrongBox), a real VSC minted, delivered, and self-checked end to end; this is not "the only run that exercises hardware attestation" claim's exact named variant, but it is a real-device run and does exercise attestation. **Still not run:** `yarn e2e:vrc` and `yarn e2e:vrc:witnessed:didcomm-v2:tsp` (both need an iOS Simulator half — platform-blocked on this machine) and any variant carrying DIDComm v2/TSP. See the 2026-09-29 companion, G18, for the five real bugs this run found and fixed, none of which are specific to the android-only path — they'd have blocked the named variants identically.

### V5 — Fixtures, ladder, and the record

Regenerate the captured fixtures. **Done, 2026-09-29, both halves.** `ref-07`'s README credits `edge-witnessed-captured.json` to `bifold/packages/vrc-reference/__tests__/integration/captureEdge.local-al.test.ts`, described there as an *"untracked local capture tool"* — and it was indeed absent from that directory and from git history. `captureWitnessedEdge.test.ts` is committed: an in-process capture tool (real Askar-backed Credo agents, no live mediator/witness-server needed) that reproduces the existing frozen fixture's shape as a regression guard.

A fresh `vsc`-shaped capture now exists too: `bifold/packages/vrc-reference/__tests__/integration/captureWitnessedEdgeVsc.test.ts` produces `tsp-reference/ref-07-dtg-edge-semantics/fixtures/edge-witnessed-vsc-captured.json`, minted by the REAL production `buildWitnessCredentialJson(..., { shape: 'vsc' })` — not `vrc-reference`'s own hardcoded legacy builder, and not a hand-constructed JSON mimicking the shape. This needed `buildWitnessCredentialJson` importable as a library, which turned out smaller than either alternative considered: the function's own dependency footprint (`@credo-ts/core`, node `crypto`, and the `@bifold/{vrc-contexts,vrc-shared,trust-tasks,dtg-vocab}` packages already used for the same purpose elsewhere) never touched `witness-server`'s CLI/server-only deps (`langchain`, `node-ble`, `three`, `ws`) — those live in *other* top-level imports in the same file (`LLMService`, `BleLocalityProvider`, `NobleLocalityProvider`, `ReportingGraph`). Extracting the pure VWC-building logic into a new sibling file, `bifold/packages/witness-server/src/credentialBuilder.ts` (re-exported from `WitnessService.ts` for backward compatibility), was a ~300-line move, not the library-export refactor or live-process option originally expected to be needed. `WitnessService.ts`'s auto-issuance (its basic-message handler fires `issueWitnessCredentials` unconditionally, with no window for a test to intercept from outside) is worked around by monkey-patching the `Witness` reference-impl instance's method for the duration of the capture test, not by editing `Witness.ts` — so `captureWitnessedEdge.test.ts`'s wd02 regression guard is untouched. `ref-07-dtg-edge-semantics/run.mjs` gained **Check D2**, auditing the new capture against the same bar Check D holds the wd02 one to (D1/D2 type and predicate conformance, `issuerScope`, D3's `object.digestMultibase` independently recomputed — this rung's own `jcs`+`sha256`+`base58`, not a call into `@bifold/trust-tasks` — and shown to discriminate between the two captured VRCs), and confirms **the same `taskContext`/`taskDigestMultibase` parity-drift gap Check D found for `wd02` persists under `vsc` shape too** — this legacy basicmessage-dialect builder's `vsc` branch was never extended to emit them either; flagged, not fixed, matching how Check D treats its own finding (see §9, cred-spec `#58`'s taskContext question is a separate, still-open matter). Correct `ref-07`'s *"encoding-only"* check text with §3.1's evidence — **the check itself keeps running against the legacy fixture**, which is how the ladder records a superseded claim rather than erasing it. Still open: update `bifold/docs/WITNESSED_EXCHANGE_FLOW.md`, `bifold/packages/witness-server/README.md`, `bifold/packages/vrc-reference/README.md`.

**The test surface is exhaustive, not the seven files originally listed in §4.** Also update, because a credential-shape change reaches them: `bifold/packages/trust-tasks`'s `witnessCeremony` and `outcomeEvidence` suites (two of A5's four D4 read sites live here); the DIDComm v2 and TSP e2e runners (`yarn e2e:vrc:didcomm-v2`, `…:witnessed:didcomm-v2`, `…:didcomm-v2:tsp`, `…:witnessed:didcomm-v2:tsp`, and the iOS-device runners) — all assert badges derived from a VWC; `tsp-reference/ref-15…19`; `localityVocabulary.test.ts`, which V2 already generalises but which also guards the members §3.5 relocates.

**Done when:** the full ladder green; root `yarn lint`, `yarn typecheck`, `yarn test` green; `cd bifold/packages/core && yarn test` green; no document describes `credentialSubject.digest` as current.

**Found 2026-09-28, confirmed genuinely pre-existing, not originally this plan's to fix — all 5 now fixed.** 5 of 12 `bifold/packages/vrc-reference` integration suites failed (`credentialIssuance`, `credentialStructure`, `credentialVerification`, `diConformance`, `proofExchange`) — verified against a pre-session baseline commit, same 5 failed there too. These exercise VRC's own DI-conformance path, not the witness credential this plan owns. **4 of the 5 fixed 2026-09-29** (stale test code against the pinned `@credo-ts/core` pre-release, not product bugs — see `bifold` `f270232aa`). **`proofExchange.test.ts` fixed for real, 2026-09-29 (G27):** the root cause turned out to be two third-party dependencies, not one — `@animo-id/pex`'s `constructPresentations()` unconditionally force-appends the VC1.1 `@context`, and credo's `DifPresentationExchangeService` never offered a v2 alternative, so wrapping a VC2.0-shaped VRC in the resulting VP always hit the "v1 VP around a v2 VC" JSON-LD conflict — live product exposure, not a reference-tool-only gap, since the shipped app's `ProofRequest.tsx` screen reaches this exact path for any DIF-PE proof request. Fixed with two coordinated dependency patches (`bifold` `6aa398d3c`, outer `2c49972c`, both patches independently applied a second time in each of `bifold`'s and the outer app's separate yarn workspaces). `vrc-reference` now shows 0 of 12 integration suites failing.

---

## 7. Compatibility, and why it is cheap

**Both VRCs and VWCs carry a seven-day `validUntil`.** `DEFAULT_CREDENTIAL_EXPIRATION_DAYS = 7` in both `bifold/packages/witness-server/src/WitnessService.ts:111` and `bifold/packages/core/src/modules/vrc/vrc-manager.ts:164`. There is no long-lived fleet of witness credentials to migrate. Seven days after V4 reaches the witness, **every valid VWC in existence is a VSC.**

Three qualifications keep that from being the whole story:

1. **Expiry governs validity, not storage.** Contacts display witness badges from stored `W3cCredentialRecord`s, and nothing prunes expired ones. The **display** path must read both shapes for as long as we keep pre-cutover records, which is longer than seven days. Adopted: V3's dual-read carries a **stated deletion date — one release after V4 ships to the last channel** — recorded in `witnessCredentialUtils.ts` beside the code. A tolerance without a date becomes permanent.
2. **The witness is a service; the wallet is an app.** We control deployment of the first and not the second. Hence V3-before-V4 (§6), and hence the rollout order is: ship V3 to all three channels ([`release-flow-plan.md`](./release-flow-plan.md)), wait for adoption, then deploy V4 to the witness. A wallet without V3 meeting a V4 witness sees a credential whose type it does not recognise and drops the badge — degraded, not broken, which is the correct failure and worth confirming rather than assuming (§9 Q2).
3. **Structural distinguishability is what makes any of this work.** WD02's `WitnessCredential` and WD 0.4.0's `StatementCredential` differ in the `type` array, so a dual-reader never has to guess (C15). Had the working group kept the type string and changed only the subject, there would be no safe dual-read at all.

**The Farm branch line is not a consumer of this shape.** `feat/prague-farm-membership` (merged via PR #76, 2026-09-22) touches the Developer screen, the local VTI stack scripts, the VTI findings document, e2e runners and `ref-20-local-vetting` — no reference to `WitnessCredential`, `witnessContext`, `credentialSubject.digest`, `personhood` or predicate handling. Whether a Farm-hosted community's *custom* policy ever gains a witness-shape dependency is a Farm-side question this branch cannot answer from here.

### 7.1 An upstream verifier still matches the WD02 type string

The ecosystem's own VTC service ships a default personhood policy that matches the literal string this migration removes. `vtc-service/policies/default/personhood.rego:61`, at the current `verifiable-trust-infrastructure` pin `ed672fff` (commit-dated 2026-09-24, matching the Farm's deployed `vta-service-v0.42.0`/`vtc-service 0.11.58`):

```rego
"WitnessCredential" in cred.type
```

It is **shipped policy, not a test fixture** — `policy/default.rs` embeds it with `include_str!`, and the `WitnessCredential` occurrences in that file's own source are all below its `#[cfg(test)]` boundary at line 323. A Keyring-issued VSC presented to a community running the default policy **fails the personhood assert**, because `cred.type` no longer contains the string.

Three things bound how much this matters, and they are the reason this is a §7 note rather than a blocker:

1. **It is the personhood path, not the join path.** `WitnessCredential` appears in exactly one shipped rego across all ten default policies. `join.rego` does not reference witness credentials at all, so the community-join flow that [`keyring-on-the-vta-farm.md`](./keyring-on-the-vta-farm.md) cares about is not on this rule.
2. **The policy is designed to be replaced.** Its own header calls it *"intentionally permissive"* and says *"operators replace it via `POST /v1/policies`"*. A community that cares can accept both shapes today, without waiting on upstream.
3. **The witness can emit either shape** (V4's switch), so a Keyring witness serving such a community is not stranded.

**The precondition this section named is now met.** This finding was first measured at `187ad9cd` (2026-08-17), with `sync-external.mjs` reporting `verifiable-trust-infrastructure: FETCH FAILED` — so it could not be checked against current upstream. The fetch is fixed and the pin has since advanced four times, unrelated to this plan (`scripts/openvtc/SYNC_LOG.md`, 2026-09-20 through 2026-09-25), landing at `ed672fff`. Re-reading `personhood.rego` at that pin, five weeks newer and matching what the Farm itself runs: **the finding is unchanged.** What remains open is not whether the finding is current — it is — but the judgment call §9 Q1 already names: when the V4 switch's default flips.

---

## 8. What this plan does not do

- **Touch the VRC's shape.** It is an edge credential; WD 0.4.0 leaves its shape alone. Its *proof suite* (`Ed25519Signature2018` today, `eddsa-jcs-2022` recommended) is [`docs/CRYPTO_SUITE_FOLLOWUP.md`](../CRYPTO_SUITE_FOLLOWUP.md)'s, and `ref-07` already records the divergence. **A narrower, adjacent thing did happen 2026-09-28, and is not part of this plan's design**: `DTGCredential`/`RelationshipCredential`'s own `@context` namespace (in `relationshipContext.ts`, not this plan's witness-credential context work) was migrated to the same real registry V1/V2 already target, dual-read so already-issued VRCs keep verifying unchanged — a namespace-only change, not a shape change, decided and executed as its own thing rather than a phase of this plan. Noted here only so this exclusion is not read as still meaning "VRC's namespace is untouched." See the 2026-09-28 companion.
- **Implement `dtg:endorses`.** We issue no endorsements. `endorses.jsonld` is mirrored in V1 so the registry format is exercised against both core profiles, and no code consumes it.
- ~~**Implement correlation scope.**~~ Superseded: cred-spec #68 named and required it (`issuerScope`) on 2026-09-28, and it is now implemented — §3.6.
- **Adopt the other WD 0.4.0/0.5.0 additions.** The VDC, the VAC and the promoted VIC arrived in the same 28 commits this plan first read at `994a3d63`; the `94af2d8` pin (2026-09-28) formalizes VDC and VAC further still (the spec's own title moved from "six" to "seven" W3C VC types). They are new credential types we neither issue nor consume, and reading them as part of this migration would triple its surface for no witness-related gain. **Decided and settled** — not deferred pending a look. If a Prague or Farm requirement later needs delegation or authority credentials, that is a new plan with its own constraints companion, not a late addition to this one.
- **Advance the `external/` pin.** §10.

---

## 9. Decisions taken, and what remains open

### Settled

| | Decision | Where it lives |
|---|---|---|
| **Namespace** | **Resolved 2026-09-28, no longer the plan's original placeholder.** Issue and mirror under the real registry: `https://registry.trustoverip.org/dtg/vsc/` (predicates), `.../dtg/credentials#` (vocabulary), `.../dtg/context/v1` (context) — the namespace `dtgwg-vsc-registry` and cred-spec `#64`/`#65` settled, not the `firstperson.network` placeholder §2.2–§2.4 originally named. §2.3's rolling-cutover mechanism is what made adopting the real namespace directly (rather than issuing under the placeholder first) survivable regardless of when #48/#52 formally close | §2.3, §2.4; see the 2026-09-28 companion |
| **DTG `@context`** | Superseded by the Namespace row above: V1/V2 target `https://registry.trustoverip.org/dtg/context/v1` directly, not the intermediate `https://firstperson.network/credentials/dtg/v1` this row originally named | §2.5 |
| **Extension members** | `locality*`, `hardwareAttestationIncluded`, `parties`, `taskDigestMultibase`, and (2026-09-28) `witnessName` become siblings of `witnessContext` under a Keyring-controlled namespace. `witnessContext` keeps the profile's three members and nothing else | §3.5 |
| **Scope** | VDC, VAC and VIC are out, permanently for this plan | §8 |

### Open

**Q1 — RESOLVED 2026-09-28.** §7.1 found a shipped upstream policy matching the WD02 type string, so the plan's original switch defaulted to `wd02` pending an ecosystem-readiness call. Decided: given Keyring is pre-production — demo/test-only witness deployments, no fleet of long-lived credentials to migrate (§7's seven-day expiry applies here too) — the switch now **defaults to `vsc`** (§6 V4), with `WITNESS_CREDENTIAL_SHAPE=wd02` remaining available as a per-deployment opt-out for exactly the community §7.1 names. *Decided by: Brendan.* See the 2026-09-28 companion.

**Q2 — Is "old wallet, new witness" really degraded-not-broken?** §7 asserts the badge silently disappears. Worth an actual test in `ref-07i` rather than an assertion in a plan. *Decided by: whoever builds `ref-07i`.*

**Q3 — Who owns the witness's correlation-scope declaration when the property is named?** §3.6: it attaches to the witness's identifier across every credential it ever issues, so it is a deployment decision, not a credential-builder one. **Blocked on:** the DTGWG naming the property. Not on us.

**Q4 — Do we propose the extension members upstream?** §3.5 puts `locality*` and `hardwareAttestationIncluded` under a Keyring namespace, which is conforming and needs nobody's permission. Whether to also propose them for the registry's `witness-context.schema.json` is a separate, later, optional question. *Decided by: Brendan. Not blocking.*

**Q6 — RESOLVED 2026-09-28.** Cred-spec `#64` (namespace decision, closes `#48`) and `#65` (issue-reference cleanup) both merged 2026-09-28; `dtgwg-vsc-registry#7` pinned the `v1` context the same day. The real registry namespace is no longer a draft to weigh against the placeholder — it is what's merged. V1's mirror and V4's issuance were already built against it directly (on the reasoning that Brendan's own upstream "ship it" made building against a namespace already known to be superseded pure rework) — see the *Settled* table above. *Decided by: Brendan.* See [`vsc-migration-plan/2026-09-27-bm.md`](./vsc-migration-plan/2026-09-27-bm.md) G6 and the 2026-09-28 companion.

**Q7 — Does D4 survive cred-spec #58?** #58 (OPEN, active) proposes removing `taskContext`/`taskDigestMultibase` from the credential entirely, replacing them with a detached issuer-signed citation document — Brendan has commented favorably on the proposal without adopting it. If it lands, V4's D4 sub-step (relocate `taskContext` to the top level) is replaced by a larger change: remove the member, build the citation document, update `witnessCeremony.ts`'s task-binding check accordingly. Does not block V0–V3. **Blocked on:** #58's resolution; it is now scheduled for context v2, so v1 emission keeps D4 as written. *Decided by: the DTGWG, with Brendan as a participant; re-check before V4 starts on D4.* See [`vsc-migration-plan/2026-09-27-bm.md`](./vsc-migration-plan/2026-09-27-bm.md) G7.

**Q8 — DECIDED 2026-09-28: stays `directed`.** §3.6: cred-spec #68 (merged 2026-09-28) makes `issuerScope` REQUIRED; the profile's stated minimum is `directed`, which is what V4 emits. The spec's own worked examples use `public` for witness services generally, on the reasoning that such a party "must be findable" — but `public` is a factual claim that Keyring's witness DID is durably, broadly discoverable, and that is untrue of the current demo/test-only witness deployments. `directed` stays because it is the truthful claim for what exists today, not merely the conservative one. *Decided by: Brendan.* **Revisit when a permanent witness with a durably-published DID (e.g. a stable `did:webvh`) exists** — a one-line change (`WitnessService.ts`) when that day comes, not a redesign. See [`vsc-migration-plan/2026-09-27-bm.md`](./vsc-migration-plan/2026-09-27-bm.md) G8 and the 2026-09-28 companion.

**Q9 — D7's blocking precondition is resolved; the migration itself is not executed.** D7 wants the literal registry `v1` context IRI in `vsc`-shape `@context`. The precondition that made this unactionable — no verifiable copy of the real, byte-frozen context document — is gone: `dtgwg-vsc-registry` is now pinned under `external/` (`eb29484`) and its `contexts/v1.jsonld` is confirmed, byte-for-byte, to match the SHA-256 digest `dtgwg-cred-spec` (`94af2d8`) states for it. What remains is real implementation work, scoped term-by-term but deliberately not executed in the same pass: trimming `WITNESSED_EXCHANGE_CONTEXT_DOCUMENT` to stop redefining terms the real registry context now owns (`DTGCredential`, `taskContext`, `taskDigestMultibase`, `witnessContext`/`event`/`sessionId`/`method`), reordering `vsc`-shape `@context` to place the registry IRI at the required position 2, and re-verifying every shape test and fixture this touches (the change is canonicalization-affecting, not additive). *Decided by: Brendan (pin + verify + scope this session; execution left for its own session).* See [`vsc-migration-plan/2026-09-29-bm.md`](./vsc-migration-plan/2026-09-29-bm.md) G26 for the full term table, the empirical ordering tests, and the exact migration steps.

**Q10 — OPEN: how the hardware-evidence context swap rolls out.** A witness that predates the context cannot canonicalize a VRC carrying it, and an old wallet that meets the provisional IRI attempts a network fetch that returns 404 HTML; the RCE v5 gate covers wallets only (§2.6). Options: hold the swap back until after the next live demo, or deploy witness and wallets together and exercise the result first. **Not decided.** *Decided by: Brendan.* Gap G36 in [`vsc-migration-plan/2026-09-30-bam.md`](./vsc-migration-plan/2026-09-30-bam.md).

---

## 10. Upstream — what we are positioned to move

Two of this plan's three gaps are **ours to close**. `spec/header.md` lists Brendan A. Miller and Alberto Leon among the specification's editors, and the repository already carries a commit titled *"Implementation feedback from Keyring Wallet: VWC digest canonicalization and per-direction witnessing (#7)"*. We are not waiting on strangers.

| Item | Where | What Keyring can contribute |
|---|---|---|
| **The namespace** | cred-spec [#48](https://github.com/trustoverip/dtgwg-cred-spec/issues/48) | Largely overtaken by events: `dtgwg-vsc-registry` now exists in draft form under `registry.trustoverip.org/dtg/vsc/`, with Brendan an active participant. §2.3's four-state rolling cutover, proven by `ref-07f`, remains the evidence that migrating to whatever IRI is finally chosen is survivable — worth contributing regardless of which namespace wins |
| **The registry** | cred-spec [#52](https://github.com/trustoverip/dtgwg-cred-spec/issues/52) | Largely overtaken by events: `dtgwg-vsc-registry` is a real, if undeployed, implementation, not only a proposal. `ref-07f`'s mirror (built from #52's issue-body example) is worth reconciling against the real repository's `predicate.jsonld` format now that it exists (§5's open question, §9 Q6) |
| **The `@context`** | #48's second half | We have shipped a DTG context under an unresolvable URL for months (§2.5). That experience — including what breaks and what does not — is the concrete input the issue asks for |
| **`personhood.rego`** | `verifiable-trust-infrastructure`, `vtc-service/policies/default/` | §7.1: the shipped default policy matches a type string WD 0.4.0 removes. The fix is small and mechanical — match the predicate IRI, or accept both — and it is the kind of second-implementation finding the ecosystem has taken from us before (`dtgwg-cred-spec` #7). **Now confirmed against current upstream** (`ed672fff`, 2026-09-24, §7.1) — ready to propose |
| **`dtg-credentials`'s unknown-member handling** | the Rust catalogue's `deny_unknown_fields` schema | `ref-07e` Act 4: nine independently-fatal divergences on Keyring's conforming extension members. C10 makes carrying them conforming under WD 0.4.0; a closed schema in a second implementation is a real interoperability gap worth naming, pinned to `dtg-credentials` 0.7.0 — confirm against current upstream before proposing, per the same caveat as `personhood.rego` |

**Two further contributions are drafted and not filed**: one cred-spec issue on extension members outside a predicate profile and on what a context listed after the registry IRI must be, and a registry issue (or a comment on #17) proposing a sibling evidence vocabulary under `/dtg/`. Both are non-blocking and deferred to context v2; filing waits on Brendan's review and on the device-free verification in the 2026-09-30 companion. **Pending pin advances** (not yet made): `dtgwg-vsc-registry` `eb29484` to `f828afd` (no context bytes differ) and `dtgwg-cred-spec` `94af2d8` to `4088056`.

**Nothing is pushed to an external repository without review.** Per the [`openvtc-workspace`](../../.claude/skills/openvtc-workspace/SKILL.md) skill: develop on a branch inside the `external/` clone, write a candidate document beside the rung it came from, **show a human and wait for approval**, stage on a personal fork first. Commits need a DCO `Signed-off-by`.

**The pin advance is a decision, taken at a boundary, and its own standing rule is unchanged even though this migration advanced it after V0–V5 rather than before V0** (see the 2026-09-28 companion for why that sequencing happened and why it was still safe). `node scripts/openvtc/sync-external.mjs --advance dtgwg-cred-spec --why "…"` moves `PINS.json`; the same sync reports several other tripwires on unrelated pins (`@openvtc/trust-tasks`, `@openvtc/vti-didcomm-js`, `@openvtc/pnm-core`, each a framework-level breaking-change flag) — **do not advance those in the same motion.** One pin, one reason, one entry in `SYNC_LOG.md`, followed by re-running the ladder bottom-up.
