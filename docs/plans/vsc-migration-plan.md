# From the WD02 witness credential to the VSC — Keyring on `dtg:witnessed`

**Status:** Proposal for review. Not a commitment to implement. No code written yet.
**Scope:** moving every witness credential Keyring issues, carries, verifies and displays from the deprecated WD02 `WitnessCredential` *type* to the Working Draft 0.4.0 **Verifiable Statement Credential (VSC)** under the `dtg:witnessed` **predicate profile** — and standing up, inside this repository, the predicate vocabulary the specification now depends on and **which does not yet exist upstream**. The VRC itself is out of scope: it is an edge credential and WD 0.4.0 leaves its shape alone.
**Siblings:** [`openvtc-integration-plan.md`](./openvtc-integration-plan.md) owns the transport and the Trust Task operation layer this credential rides on, and its [`trust_tasks_subtask.md`](./openvtc-integration-plan/trust_tasks_subtask.md) owns the witness ceremony that mints the credential. [`locality-plan.md`](./locality-plan.md) owns the `locality*` members this plan has to find a conforming home for. Neither is blocked by this plan; this plan is blocked by neither.
**Constraints:** [`vsc-migration-plan/cred-spec-constraints.md`](./vsc-migration-plan/cred-spec-constraints.md) — every normative requirement quoted with its citation, C1…C16, read at a stated commit. **The design below cites those, not the specification directly**, so that a spec advance is one file's worth of re-reading.
**Reasoning:** [`vsc-migration-plan/2026-09-16-bm.md`](./vsc-migration-plan/2026-09-16-bm.md) — the measurements behind §3 and §4, the positions adopted, and what they supersede. This document states current design only; see [`CLAUDE.md`](./CLAUDE.md).
**Baseline:** DTG Core Credentials **Working Draft 0.4.0** at `dtgwg-cred-spec` **`994a3d63`** (2026-09-15) — **28 commits ahead of `external/`'s pin `b89f389`**, read via `git show` without advancing the pin (§10 owns the advance). Codebase facts measured on `plan/vsc-migration`, forked from `feat/credo-0.7` at `17b6330`, on 2026-09-16.

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

### 2.2 The bridge: mirror the registry, isolate the IRI

We build, inside this repository, a **spec-shaped mirror** of the registry that does not exist, in the exact artifact format #52 specifies (C13), and we put every IRI that #48 can move behind **one exported constant**.

The bridge has two halves with **different fates**, and keeping them apart is the design:

- **The mirror** — `predicates/*.jsonld` source files and the generated `accept-list.json`, `vocab.jsonld` and `context/v1.jsonld`. This is a **stand-in for someone else's repository** and is **deleted** the day `dtgwg-predicate-vocab` publishes a release. It is generated, never hand-edited, and marked as such.
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

Step 4's window is short because **both VRCs and VWCs carry a seven-day `validUntil`** (§7). This is the single largest reason this migration is cheap, and it is a property of our deployment, not of the specification.

### 2.4 Why our own namespace is not the answer

The tempting shortcut is to skip the placeholder and issue `dtg:witnessed` under a namespace we definitely control — `https://keyring.berkmancenter.org/vocab#witnessed`. #52 explicitly permits this: *"a community that publishes a predicate under a namespace it controls can issue under it, and verifiers can accept it, without waiting on or ever seeking admission"* (C13).

**It is still wrong for this predicate**, for a reason that does not apply to the extension members of §3.5. `dtg:witnessed` is a **core profile defined by the specification itself** — *"Predicates defined by this specification live in the DTG namespace"* (C2). A Keyring-namespaced `witnessed` would be a second identifier for a concept that already has one, which #52's admission criterion 5 (*"has no existing term with the same meaning — one identifier per concept"*) exists to prevent. We would be forking the core vocabulary to avoid a rename we have already made cheap.

Issue under the spec's placeholder, verbatim. Accept the migration; §2.3 is the mechanism.

### 2.5 The `@context` question is separate, and smaller than it looks

*Base Structure* REQUIRES `https://firstperson.network/credentials/dtg/v1` in `@context` (C3), and it is unpublished. Two facts make this tractable:

- **The predicate check needs no context at all.** *"Because the value is matched as written, this procedure needs neither the credential's `@context` nor a JSON-LD processor"* (C4). Predicate Handling is pure string work.
- **We already resolve DTG contexts locally.** `@bifold/vrc-contexts` bundles context documents and the document loaders intercept their URLs — the mechanism that makes an in-person exchange verifiable with no network at all, which is the argument the parent plan makes for `eddsa-jcs-2022` in the first place.

So the unpublished context costs us a **bundled document under a URL we do not control**, exactly as `WITNESSED_EXCHANGE_CONTEXT_URL` is today. What it does *not* let us do is claim interoperability with a third party that resolves the URL for real. §10 names that as a thing to close upstream, not here.

**Open, and material:** our existing `DTG_CONTEXT_URL` is `https://www.firstperson.network/dtg/v1` — a *different IRI* from the spec's `https://firstperson.network/credentials/dtg/v1` (different host, different path). They are not the same context and never were. §9 Q3.

---

## 3. The wire deltas

Eight changes between what `buildWitnessCredentialJson` emits today and what C2/C5 require. Each is independently checkable; each has a rung in §5.

| # | Member | Today | WD 0.4.0 | Cite | Severity |
|---|---|---|---|---|---|
| **D1** | `type` | `[…, "DTGCredential", "WitnessCredential"]` | `[…, "DTGCredential", "StatementCredential"]`, and MUST NOT carry another concrete subtype | C1, C2 | breaking, trivial |
| **D2** | `credentialSubject.predicate` | *absent* | REQUIRED, absolute IRI, no CURIEs on the wire | C2 | breaking, needs §2 |
| **D3** | the digest | `credentialSubject.digest` = `"sha256:"+hex`, over the **proofed** VRC | `credentialSubject.object.digestMultibase` = multibase base58btc multihash, over the VRC **excluding top-level `proof`** | C5, C6 | breaking ×3 |
| **D4** | `taskContext` | inside `credentialSubject` | **top level**, sibling of `credentialSubject` | C2 | breaking, trivial |
| **D5** | extension members | `hardwareAttestationIncluded`, `locality*`, `localityVerification` inside `witnessContext`; `parties`, `taskDigestMultibase` inside `credentialSubject` | not defined by the profile; a verifier MUST ignore them; they need a stated home | C5, C10 | design, §3.5 |
| **D6** | subject binding | `credentialSubject.id` = the observed VRC's issuer — **emitted correctly, never checked** | a verifier holding the referenced credential **MUST check** it, unconditionally | C5 | **new verifier obligation** |
| **D7** | `@context` | `[credentials/v2, trustoverip.org/credentials/witnessed-exchange/v1]` | MUST include `https://firstperson.network/credentials/dtg/v1` | C3 | breaking, §2.5 |
| **D8** | predicate rejection | *nothing rejects an unknown predicate — there are no predicates* | rejection is the **only** conforming outcome for an unaccepted predicate | C4 | **new verifier obligation** |

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

We attach members no DTG profile defines: `hardwareAttestationIncluded`, the fourteen `locality*` terms from [`locality-plan.md`](./locality-plan.md), the deprecated nested `localityVerification`, plus `parties` and `taskDigestMultibase` from the Trust Task ceremony.

The specification's position is permissive and explicit: *"A verifier MUST ignore additional members a profile does not define, so that a profile can add optional members without invalidating credentials for older verifiers; strictness lives in the predicate, not in the payload"* (C10). **So carrying them is conforming.** The design question is only where they sit and under whose namespace.

**Adopted: hoist the extension members to `credentialSubject`, siblings of `witnessContext`, under a Keyring-controlled JSON-LD namespace.** `witnessContext` keeps exactly the three members the profile defines — `event`, `sessionId`, `method` — and nothing else.

Three reasons, in order of weight:

1. **`witnessContext` is now a profile-owned object with a published schema.** #52's `witnessed.jsonld` points `additionalMembers.witnessContext.schema` at `witness-context.schema.json` (C13). Members we invent inside a container the registry will schema-constrain are a collision waiting for the registry's first release. Members we add *beside* it are exactly the ignorable extras C10 sanctions.
2. **It is what `locality-plan.md` wanted anyway.** That plan requires flat `locality*` members because *"bbs-2023 discloses at the RDF-quad level, and a nested object is a blank node whose path must be revealed before disclosing anything under it"*. Today they are flat **inside** `witnessContext` — which is itself a nested object, so the blank-node problem is only pushed up one level and never solved. Hoisting to `credentialSubject` is the first arrangement that actually delivers what the locality plan asks for. **This is a locality-plan improvement the VSC migration makes free**, not a cost of it.
3. **A community namespace is correct here, where it was wrong in §2.4.** These are *our* terms with no DTG equivalent, which is the case #52's tier C — *"terms a VTC or VTN defines under a namespace it controls"* — was written for.

**Not adopted: a second VSC under a Keyring `coPresent` predicate.** It is the cleaner model on paper — locality is a distinct statement with a distinct evidentiary weight — but it doubles the artifacts in every witnessed exchange, needs its own taskContext binding and its own outcome evidence, and changes the ceremony's reply shape that [`trust_tasks_subtask.md`](./openvtc-integration-plan/trust_tasks_subtask.md) and four `ref-06p*` rungs are built around. The constraint that rules it out is not aesthetic: locality qualifies *the conditions under which the witnessing occurred*, and C5 makes those conditions part of what `dtg:witnessed` means (*"the meaning of a witness attestation depends on the conditions under which the witnessing occurred"*). A separate credential a verifier could drop would let a party present the witnessing without its conditions. Revisit only if a second consumer of locality evidence appears that has no witness in it.

### 3.6 Correlation scope is named and deferred

C5 requires the VWC's issuer to declare `directed` scope at minimum. **This does not bind at WD 0.4.0**: the property that carries a declaration has no name yet, and the spec says the section's requirements *"bind a declaration that has been made and do not require one"* (C14). Our witness declares nothing, which is conforming.

It is named here rather than omitted because it is a **standing liability with a trap in it**: the rule is that *"all credentials issued under one identifier MUST declare the same scope"* (C14). When the property is named, the declaration attaches to the **witness's identifier across every credential it ever issues**, not to the VWC. That is a witness-deployment decision, not a credential-builder decision, and finding it out at implementation time would be expensive. Out of scope for this plan; §9 Q5.

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

**Fixtures and tests carrying the shape** (updated in lockstep, §6 V5):

- `tsp-reference/ref-07-dtg-edge-semantics/fixtures/edge-witnessed-captured.json` — a real captured witnessed exchange, and the highest-value fixture in the repository
- `tsp-reference/ref-06p3-third-party-verify/fixtures/genuine-bundle.json`
- `bifold/packages/witness-server/__tests__/unit/WitnessService.test.ts` — the largest single consumer
- `bifold/packages/core/__tests__/modules/vrc/display/credentialDisplayMatrix.test.ts`, `.../screens/ListContacts.test.tsx`, `.../screens/ContactDetails.test.tsx`, `__tests__/screens/listCredentialsFilter.test.ts`
- `bifold/packages/vrc-reference/__tests__/unit/witnessedExchangeContext.test.ts`, `__tests__/integration/witnessedFlow.test.ts`

---

## 5. The reference rungs

Prove the bytes before touching the product, which is what the ladder is for. Three new rungs, then the migration.

**Numbering: `ref-21`, `ref-22`, `ref-23`.** The low numbers are exhausted and contested — `openvtc-integration-plan.md` reserves `ref-07…09`; `pnm_cnm_subtask.md` §6 takes `ref-10…15`; the DIDComm v2 line uses `ref-15…19` (local, unlanded, which is why nothing named `ref-14`…`ref-19` is on disk); `keyring-on-the-vta-farm.md` claims `ref-16-farm-membership` and collides; `community_vetting_subtask.md` takes `ref-20` and records the collision. **`ref-21` is the next genuinely free number.** Do not renumber anything to make room.

Each rung follows the ladder's contract ([`tsp-reference/README.md`](../../tsp-reference/README.md)): pure TypeScript/JS with **no React Native imports**, frozen fixtures, `npm run -s check`, a README saying what it proves **and what it does not**.

### `ref-21-vsc-shape` — the credential, by hand

Mint a `dtg:witnessed` VSC from a **real captured VRC** (take one from `ref-07`'s `edge-witnessed-captured.json`), sign it `eddsa-jcs-2022` over deterministic test keys as `ref-07`'s `sign-fixtures.mjs` already does, and verify it against C2/C5/C6 with an implementation written from the constraints file, not from our builder.

**Proves:** D1, D2, D3, D4, D7 produce a credential matching the spec's own worked example (C16), member for member.

**Negative cases, each of which must fail:** a compact `dtg:witnessed` predicate (C4 step 1 — *malformed, not unknown*); a digest computed over the **proofed** VRC (§3.1's third break — this is the case a transcoder passes and the spec fails); a digest string-compared rather than byte-compared, shown by re-encoding the same multihash in a second multibase alphabet and asserting the strings differ while the bytes match (C6); `credentialSubject.id` set to the VRC's *subject* rather than its issuer (D6); `taskContext` left inside `credentialSubject`.

**Does not prove:** anything about Credo, signing on device, or the DIDComm path. No agents run.

### `ref-22-predicate-vocabulary` — the registry that does not exist

Build the §2.2 mirror and its consumer. Generate `accept-list.json` from `predicates/witnessed.jsonld`; drive *Predicate Handling*'s three steps from that file alone.

**Proves:** (a) the generated `accept-list.json` is byte-equal to #52's quoted example modulo the namespace constant (C13) — so the day upstream publishes, ours is a drop-in; (b) the consumer dereferences **nothing** at verification time (C4) — asserted by running it with all network egress blocked *and* by asserting no `@context` is read; (c) an unrecognised predicate is **rejected**, not passed through (C4, C8); (d) `owl:sameAs`/`skos:exactMatch` assertions in the input change no outcome (C4); (e) a non-NFC IRI that renders identically to an accepted one is a **different predicate** (C4); (f) **the §2.3 rolling cutover works**: issue under `A`, verify under a config accepting `{A, B}`, flip issuance to `B`, narrow to `{B}` — four states, all green, with exactly one constant edited between them.

**Does not prove:** that upstream will choose either IRI, or that the registry will keep the format of #52. It proves our seam is one constant wide.

### `ref-23-vsc-witnessed-exchange` — the real artifacts, end to end

Take `ref-07`'s captured witnessed exchange, transform both VWCs to VSC form, and re-run **every check `ref-07` Check D makes**, plus D6 and D8.

**Proves:** the migration is lossless over real captured artifacts; the digest still binds each VWC to the correct direction of the edge after the coverage change of §3.1; `ref-07`'s stale *"encoding-only"* claim is corrected with evidence.

**Does not prove:** hardware attestation or locality on real radios — those stay `e2e:vrc:devices` and the `ref-06p*` line, per the root `CLAUDE.md`'s standing note that emulators cannot do attestation.

---

## 6. The replacement, phase by phase

Each phase has acceptance criteria and is independently revertible. **V1–V3 change no bytes on the wire**; the cutover is V4.

### V0 — Evidence (the rungs)

Build `ref-21` and `ref-22`. No product code.

**Done when:** both rungs green under `npm run -s check`; fixtures frozen; each README states what it does not prove; `for d in tsp-reference/ref-*/; do (cd "$d" && npm run -s check); done` is green across the whole ladder.

### V1 — `@bifold/dtg-vocab`

Promote `ref-22`'s mirror and consumer into `bifold/packages/dtg-vocab` (§2.2 layout). The app must bundle it — the wallet verifies VWCs, so the accept-list ships on the phone — which per the root `CLAUDE.md` means **four registration entries**: a root `portal:` resolution, an `app/package.json` dependency, a `packageDirs` entry in `app/metro.config.js`, and `BIFOLD_SOURCE_PACKAGES` for dev hot-reload.

*Standing rationale for a separate package rather than folding this into `@bifold/vrc-contexts` (which is already bundled and would cost none of those four entries): the mirror's defining property is that it is **deleted wholesale** when upstream publishes. Inside `vrc-contexts` that seam is invisible and the deletion becomes an archaeology exercise. The four entries are the price of a boundary that a future reader can see.*

**Done when:** `yarn typecheck` and `yarn lint` green at the root; the package's own `yarn test` green (per the root `CLAUDE.md`, the package's own `test` script is the gate — **not** an ad-hoc `tsc --noEmit` in its directory); a Metro build resolves it from both `app/` and `bifold/packages/core`; `README.md` names the deletion trigger and links #52.

### V2 — The JSON-LD vocabulary

Add the VSC terms to `@bifold/vrc-contexts`: `predicate` (`"@type": "@id"`), `object`, `object.digestMultibase`, `object.value` (`"@type": "@json"`), `object.id`, plus the §3.5 extension members under the Keyring namespace. The spec's editor's note states these expected typings (C3); adopting them now means the published DTG context, when it lands, agrees with what we already signed.

Extend the vocabulary guard. `bifold/packages/core/src/modules/vrc/__tests__/unit/localityVocabulary.test.ts` already enforces that every issued member has a JSON-LD term by **counting quads** and proving the guard guards (deleting a term drops its member to zero quads). Generalise it to every VSC member. This is CI, not discipline — [`locality-plan.md`](./locality-plan.md) item 13 and [`docs/CRYPTO_SUITE_FOLLOWUP.md`](../CRYPTO_SUITE_FOLLOWUP.md) row 13 both already require it.

**Done when:** every member `buildWitnessCredentialJson` can emit has a term; the guard fails when any one term is removed; `bifold/packages/core` and `bifold/packages/vrc-contexts` suites green.

### V3 — Verification first, behind no flag

Implement D6 and D8 in the wallet **before** changing issuance, against both shapes. A verifier that understands VSCs while nothing issues them is inert; the reverse strands the fleet.

- `credentialTypes.ts` grows a predicate-aware path. Its pure type-string predicates stay and stay honest (§1); `isWitnessCredential` becomes a thin wrapper over a new `isWitnessStatement(credentialJson)` that reads `type` **and** `credentialSubject.predicate` through `@bifold/dtg-vocab`. Call sites holding only a type string keep the old behaviour and are enumerated in the file's header, because that set is now a known limitation rather than an implementation detail.
- `witnessCeremony.ts` gains the D6 check: when the referenced VRC is in hand, `digestBytesEqual(vsc.credentialSubject.object.digestMultibase, taskDigestMultibase(vrc))` **and** `vsc.credentialSubject.id === vrc.issuer`. When it is not in hand, the VWC is *"an opaque hash, not an identified edge"* (C5) and the UI must not claim otherwise.
- `witnessCredentialUtils.ts` reads both shapes. The dual-read is a **dated deletion**, not a permanent tolerance: §7.

**Done when:** the wallet verifies a `ref-21` fixture and a legacy captured VWC with the same entry point and the correct verdict for each; an unaccepted predicate is rejected with a distinguishable error; a VWC whose subject is not the referenced VRC's issuer is rejected; `bifold/packages/core` suite green; **no witness-server change in this phase**.

### V4 — Issuance: the cutover

`buildWitnessCredentialJson` emits VSC form. `WitnessTaskSessions.ts` moves `taskContext` to the top level and the extension members to their §3.5 home. `computeVrcDigest` is **deleted** and replaced by `taskDigestMultibase` from `@bifold/trust-tasks`.

**This is the only phase that changes bytes**, and it has a deployment order the others do not: the witness server is a **deployed service** and wallets are **installed apps** (§7). V3 must be in testers' hands before V4 reaches the witness.

**Done when:** `ref-23` green; the witness-server suite green; `yarn e2e:vrc` green; `yarn e2e:vrc:devices` green on physical phones — the only run that exercises hardware attestation, per the root `CLAUDE.md`; a VSC minted by the real witness verifies in the real wallet with the D6 check passing on a real VRC.

### V5 — Fixtures, ladder, and the record

Regenerate the captured fixtures. Correct `ref-07`'s *"encoding-only"* check text with §3.1's evidence — **the check itself keeps running against the legacy fixture**, which is how the ladder records a superseded claim rather than erasing it. Update `bifold/docs/WITNESSED_EXCHANGE_FLOW.md`, `bifold/packages/witness-server/README.md`, `bifold/packages/vrc-reference/README.md`, and the VWC rows of `tsp-reference/README.md`.

**Done when:** the full ladder green; root `yarn lint`, `yarn typecheck`, `yarn test` green; `cd bifold/packages/core && yarn test` green; no document describes `credentialSubject.digest` as current.

---

## 7. Compatibility, and why it is cheap

**Both VRCs and VWCs carry a seven-day `validUntil`.** `DEFAULT_CREDENTIAL_EXPIRATION_DAYS = 7` in both `bifold/packages/witness-server/src/WitnessService.ts:111` and `bifold/packages/core/src/modules/vrc/vrc-manager.ts:164`. There is no long-lived fleet of witness credentials to migrate. Seven days after V4 reaches the witness, **every valid VWC in existence is a VSC.**

Three qualifications keep that from being the whole story:

1. **Expiry governs validity, not storage.** Contacts display witness badges from stored `W3cCredentialRecord`s, and nothing prunes expired ones. The **display** path must read both shapes for as long as we keep pre-cutover records, which is longer than seven days. Adopted: V3's dual-read carries a **stated deletion date — one release after V4 ships to the last channel** — recorded in `witnessCredentialUtils.ts` beside the code. A tolerance without a date becomes permanent.
2. **The witness is a service; the wallet is an app.** We control deployment of the first and not the second. Hence V3-before-V4 (§6), and hence the rollout order is: ship V3 to all three channels ([`release-flow-plan.md`](./release-flow-plan.md)), wait for adoption, then deploy V4 to the witness. A wallet without V3 meeting a V4 witness sees a credential whose type it does not recognise and drops the badge — degraded, not broken, which is the correct failure and worth confirming rather than assuming (§9 Q2).
3. **Structural distinguishability is what makes any of this work.** WD02's `WitnessCredential` and WD 0.4.0's `StatementCredential` differ in the `type` array, so a dual-reader never has to guess (C15). Had the working group kept the type string and changed only the subject, there would be no safe dual-read at all.

---

## 8. What this plan does not do

- **Touch the VRC.** It is an edge credential; WD 0.4.0 leaves its shape alone. Its *proof suite* (`Ed25519Signature2018` today, `eddsa-jcs-2022` recommended) is [`docs/CRYPTO_SUITE_FOLLOWUP.md`](../CRYPTO_SUITE_FOLLOWUP.md)'s, and `ref-07` already records the divergence.
- **Implement `dtg:endorses`.** We issue no endorsements. `endorses.jsonld` is mirrored in V1 so the registry format is exercised against both core profiles, and no code consumes it.
- **Implement correlation scope.** §3.6 — does not bind at WD 0.4.0, and the property has no name.
- **Adopt the other WD 0.4.0 additions.** The VDC, the VAC and the promoted VIC arrived in the same 28 commits. They are new credential types we neither issue nor consume, and reading them as part of this migration would triple its surface for no witness-related gain. Named so the next reader knows the gap is deliberate: §9 Q4.
- **Advance the `external/` pin.** §10.

---

## 9. Open questions

**Q1 — Do we issue under the placeholder namespace, or wait for #48?** §2.4 recommends issuing under `https://firstperson.network/credentials/dtg/v1#witnessed` and treating the rename as a rolling cutover (§2.3). The alternative is to hold V4 until #48 resolves. *Decided by: Brendan. Blocked on: nothing — the recommendation is actionable today.*

**Q2 — Is "old wallet, new witness" really degraded-not-broken?** §7 asserts the badge silently disappears. Worth an actual test in `ref-23` rather than an assertion in a plan; cheap to add if we want it. *Decided by: whoever builds `ref-23`.*

**Q3 — `https://www.firstperson.network/dtg/v1` vs `https://firstperson.network/credentials/dtg/v1`.** Our long-standing `DTG_CONTEXT_URL` is a different IRI from the one *Base Structure* requires (§2.5). Do we switch to the spec's IRI now — knowing #48 may move it again — or carry both until #48 resolves? Leaning: switch, since both are unresolvable placeholders and having *one* wrong URL beats two. *Decided by: Brendan.*

**Q4 — Should the VDC/VAC/VIC read be a separate piece of work?** §8 excludes them. They may matter for the Prague path, where community membership is in play. *Decided by: Brendan, against the [`keyring-on-the-vta-farm.md`](./keyring-on-the-vta-farm.md) schedule.*

**Q5 — Who owns the witness's correlation-scope declaration when the property is named?** §3.6: it attaches to the witness's identifier across every credential it ever issues, so it is a deployment decision. *Blocked on: the DTGWG naming the property. Not on us.*

**Q6 — Do we propose the extension members upstream?** §3.5 puts `locality*` and `hardwareAttestationIncluded` under a Keyring namespace, which is conforming and needs nobody's permission. Whether to also propose them for the registry's `witness-context.schema.json` is a separate, later, optional question. *Decided by: Brendan. Not blocking.*

---

## 10. Upstream — what we are positioned to move

Two of this plan's three gaps are **ours to close**. `spec/header.md` lists Brendan A. Miller and Alberto Leon among the specification's editors, and the repository already carries a commit titled *"Implementation feedback from Keyring Wallet: VWC digest canonicalization and per-direction witnessing (#7)"*. We are not waiting on strangers.

| Item | Where | What Keyring can contribute |
|---|---|---|
| **The namespace** | cred-spec [#48](https://github.com/trustoverip/dtgwg-cred-spec/issues/48) | The measured cost of each option from a second implementation. §2.3's four-state rolling cutover, proven by `ref-22`, is evidence that the migration is survivable — which is exactly what the issue is weighing |
| **The registry** | cred-spec [#52](https://github.com/trustoverip/dtgwg-cred-spec/issues/52) | `ref-22`'s mirror is a working implementation of the proposed format. If ours generates a byte-equal `accept-list.json`, that is a validated format rather than a proposed one, and `dtgwg-predicate-vocab` can be seeded from it |
| **The `@context`** | #48's second half | We have shipped a DTG context under an unresolvable URL for months (§2.5, Q3). That experience — including what breaks and what does not — is the concrete input the issue asks for |

**Nothing is pushed to an external repository without review.** Per the [`openvtc-workspace`](../../.claude/skills/openvtc-workspace/SKILL.md) skill: develop on a branch inside the `external/` clone, write a candidate document beside the rung it came from, **show a human and wait for approval**, stage on a personal fork first. Commits need a DCO `Signed-off-by`.

**The pin advance is a decision, taken at a boundary.** This plan reads `994a3d63` via `git show` and does not move `PINS.json`. The advance — `node scripts/openvtc/sync-external.mjs --advance dtgwg-cred-spec --why "…"` — belongs at the **start of V0**, not in the middle of it, and is followed by re-running the ladder bottom-up. Note that the same sync reports six other tripwires (`@openvtc/trust-tasks` 0.9.0 → 0.19.8 among them); **do not advance those in the same motion.** One pin, one reason, one entry in `SYNC_LOG.md`.
