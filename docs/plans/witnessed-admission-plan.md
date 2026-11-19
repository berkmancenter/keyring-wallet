# Witnessed admission — joining a community on witnessed relationships, without naming them

**Scope.** A community can require that an applicant has formed one, two or three
relationships in a live, witnessed exchange, and admit them automatically when they can
show it. The applicant proves "I hold *k* attestations from *k* distinct people the
witness saw me meet" without revealing who those people are, which witness session
produced each, or where and when it happened. Each requirement can ask for Bluetooth
proximity and for a hardware-backed, biometric-gated device signature, and the witness
(not the community) checks both at the moment of the exchange.

The design reuses hidden vetting — the Predicate Credential System (PCS) engine the VTA
already runs and the wallet already drives — and changes **who plays which role**: the
witness takes the community's part as helper and token issuer; the person the applicant
met becomes the attester. No new cryptography is proposed.

**Status.** Proposed. No product code is written. A Phase 0 spike (a test in the VTI
repository, no source change) proved the central claim; see §9 and the companion
[`2026-11-04-bam.md`](./witnessed-admission-plan/2026-11-04-bam.md), which holds the
evidence, the rejected alternatives' full reasoning and the complete threat table.

**Companions.** [`2026-11-04-bam.md`](./witnessed-admission-plan/2026-11-04-bam.md) —
findings, decisions and the spike (cited as "BAM-04" below).

**What this plan does not do, and why.**

- **It does not present a VRC and its VWC to the community.** The witnessed VRC path
  cannot satisfy a join criterion today, and fixing it exposes the people involved;
  the reasons are standing rationale in §3.1.
- **It makes no claim a third party can audit.** The community sees that a witness it
  trusts issued tokens, not the sessions behind them (§4.5). That is the price of not
  naming counterparties.
- **It does not make proximity a cryptographic claim.** The witness enforces its
  proximity standards in code and the community trusts that enforcement (§4.4). No
  distance bounding is attempted.
- **It does not prove statements about existing Ed25519/JCS credentials in zero
  knowledge.** No such prover exists in VTI and the measured routes are far too slow for
  a phone (§3.4).

---

## 1. Today, and what changes

### 1.1 What exists

| Piece | Where | State |
|---|---|---|
| Witnessed VRC exchange: session, BLE locality leg, VWC, witness-share | `bifold/packages/core/src/modules/trust-tasks/{ceremony,witnessCeremony}.ts`; `bifold/packages/witness-server` | Shipped. Failure is soft: "continuing unwitnessed" |
| BLE locality, hardware attestation evidence | [`locality-plan.md`](./locality-plan.md); [`docs/HARDWARE_ATTESTATION_FLOW.md`](../HARDWARE_ATTESTATION_FLOW.md) | Shipped; the iOS leg's remaining limits are in §10 |
| Hidden vetting, applicant and vetter sides, as VTA `vta/pcs/*` tasks driven by the wallet | `core/.../module/{hiddenVettingAdapter,hiddenVetterAdapter,hiddenVetterRounds,hiddenVetting}.ts`; [`keyring-on-the-vta-farm/community_vetting_subtask.md`](./keyring-on-the-vta-farm/community_vetting_subtask.md) | Implemented, unit-tested, with a device e2e leg (`e2e/gate/legs/hv.sh`). No recorded green run on current `main`; aimed at a Farm community, not the local lab |
| The community's side of hidden vetting | VTI `vtc-service/src/vetting/{pcs,pcs_issue}.rs`, feature `vetting-pcs` (off by default) | The community is both helper and token issuer; its keys are **derived from its own signer** (§5) |

### 1.2 What changes

1. The witness issues the root credentials and the tokens, under the community's
   published parameters, instead of the community.
2. The person the applicant met is the attester: they spend a token the witness gave
   them, bound to the applicant, in an attestation for the applicant.
3. The community verifies against the **witness's** helper and token keys, published on
   the criterion.
4. BLE and hardware/biometric evidence are checked by the witness and recorded only as
   token labels (`/ble`, `/hw`); the community never sees certificates, locations or
   exact times.

---

## 2. Roles and protocol

| Role | Who | What they do |
|---|---|---|
| Helper and token issuer | The witness | Holds one PCS issuer per community it serves. Issues a root credential to an attester once per device and epoch, and blind-signs tokens only at the end of a witnessed exchange that passed its checks |
| Attester | The person the applicant met (B) | Enrols with the witness, receives a token, and spends it in an attestation for the applicant |
| Applicant | A | Opens an application for the community **before** the exchange, obtains a token bound to their identity in the live session, hands it to B, receives and checks B's attestation, and later proves *k* of them to the community |
| Verifier | The community's VTC | Verifies against the witness's published keys; spends token serials; counts distinct attesters; applies the criterion |

The community string is the community's DID, and the witness's issuer is derived under
`"<community DID>#vetting-pcs"` and `"<community DID>#vetting-token"`
(`vti-vetting-pcs/src/scheme.rs`), so **the community must be chosen before the
exchange**. The applicant's proof audience is the same string.

### 2.1 Flow

0. **Setup.** The witness publishes `{helper key, token key, live root labels, live
   token labels}` per community. The community lists the witness's keys on a criterion
   (§5) and, separately, may list the witness among its trusted witnesses.
1. **Enrolment, once per device per epoch.** B's VTA sends a root request to the
   witness. The witness checks the hardware attestation and biometric flag, enforces
   one root per hardware key per label, and returns a root credential
   `vetter/<epoch>[/hw]`.
2. **Witnessed exchange.** As today: pairwise DIDs, BLE leg, hardware signatures. A also
   sends, inside the live session, a blinded commitment to their identity (§4.3). On
   terminal success, and only then, the witness blind-signs a token labelled
   `token/<day>[/ble][/hw]` for that commitment.
3. **Hand-off and attestation.** A unblinds the token and passes it to B over the
   pairwise channel (a new pairwise Trust Task, not BLE: the wallet has no phone-to-phone
   BLE data channel). B's VTA attests for A, spending the token, in the same session.
   A's VTA verifies B's attestation on receipt.
4. **Admission.** A's VTA proves "*n* attestations from *n* distinct attesters" and the
   wallet submits it in `extensions.witnessedRelationships` of the join request,
   beside where `hiddenVetting` sits. The community verifies, spends the serials in its
   ledger (namespaced per witness), counts distinct tags and emits ordinary vetting
   facts, so the Rego policy is unchanged.

### 2.2 What each party learns

| Party | Learns |
|---|---|
| The witness | Relationship DIDs, session times, locality observations, the attester's device (`id_B`) and the blinded commitments. It never sees token serials, the applicant's identity, or the final re-randomised signature |
| The community | Which witness; the epoch and day labels; the BLE/hardware flags; *k*; the applicant's identity (from the join); fresh per-applicant tags. Not who the attesters are, nor which session |
| The attester | The applicant's relationship DID, and the token they hold |
| A colluding witness and community | Only counts, label values and timing. There is no cryptographic link between the issuance record and the later serial, nonce and identity |

---

## 3. Why this shape — standing rationale for the rejected options

### 3.1 Presenting the witnessed VRC and VWC to the community

A VWC counts at the community only if three things hold, and none holds today for a join:

- **The join evaluator has no outcome evidence.** Both join paths pass an empty evidence
  list into `witness::assess` (VTI `vtc-service/src/join/criteria.rs:739`,
  `routes/join_requests/present.rs:~372`), so a trusted witness's VWC is
  `noOutcomeEvidence`. Only `vtc/members/personhood/assert/0.2` carries evidence. The
  community's own documentation says "the join paths carry no outcome evidence yet"
  (`docs/05-design-notes/witness-host-service.md:325`).
- **The VRC edge must already be in the community's graph.** `resolve_binding` scans
  stored relationships (`witness.rs:241-268`), and publishing is member-only by default
  policy (`policies/default/relationships.rego:60-80`). An applicant is not yet a member.
- **The VRC's issuer is the wrong DID.** The wallet issues VRCs under a per-peer
  `did:peer:0` (`vrc/vrc-manager.ts:535-585`; `ceremony.ts:1283-1335`), the VWC's subject
  is that DID, and the join applicant is the community persona. The community requires
  them to be equal (`witness.rs:241-268`, `check_pair` `:624-634`).

Making them equal means issuing witnessed VRCs under the persona, which shows the
community who vouched for the applicant and the witness a stable identifier for every
exchange. The privacy cost, not the plumbing, is why this plan does not take that path.
It also needs a new carrier for the VRC (the join's credential check rejects a credential
whose subject is not the applicant, `criteria.rs:825-836`).

### 3.2 The witness as a PCS "vetter"

A PCS tag is deterministic per (attester key, applicant): `T = Tag(usk, H0(id))`
(`predicate-credential-system`, `types.rs:293-305`). "Distinct attesters" therefore means
distinct keys. With the witness as attester, every exchange it witnessed for the same
applicant produces the same tag and is rejected as a duplicate: *k* would count
witnesses, not people. A sub-key per counterparty makes it count, but then the witness
must see the applicant's identity, so a colluding witness and community link the
persona to the relationships.

### 3.3 A witness-enforced "the attestation was made live" receipt

Rejected: the token must exist before the attestation (it is bound into the attestation
context, `vetter.rs:410-422`, `meta.rs:34-36`), and every receipt variant is either
unverifiable (a hash the witness cannot check), linkable (anything over the serial or
metadata) or redundant (a blind receipt proves no more than the token). The attester
also chooses the attestation's validity dates (`verifier.rs:224`), so neither party can
bound when it was made. A hard gate before the session closes adds round trips through
the mediator to B's VTA mid-BLE-session and wastes the exchange if that VTA is slow.
Binding the token to the applicant (§4.3) removes the attacks a receipt was meant to stop.

### 3.4 Zero knowledge over the existing credentials

VTI contains no prover over Ed25519/JCS credentials (the only zero knowledge in VTI is
PCS: sigma protocols over Pointcheval–Sanders signatures on BLS12-381, no circuit). The
measured routes are not phone-feasible: a zkVM proof of one Ed25519 verify took 259–808 s
and about 9 GiB (RISC Zero) and ran out of memory at 20 GB (SP1); Longfellow's circuits
target ECDSA P-256. The measurements are in `zk-ed25519-bench` and `longfellow-bench`.
BBS+ (`bbs-2023`) has no pseudonyms or holder binding in VTI, so distinct counterparties
cannot be counted without linkable disclosures.

### 3.5 Other options ruled out

- **Deferred attestation.** An attestation days after the meeting is not a live record
  of it. Attestation happens in the exchange's session; a missed window means meeting
  again.
- **The witness holds the community's issuer secret, or the community runs an event.**
  The first breaks key custody; the second (`token/event/<id>`) makes the community the
  issuer, which defeats the witness's blindness.

---

## 4. Design

### 4.1 Counting and thresholds

- A requirement names one or more acceptable witnesses, a count (1–3 in practice), and
  optional `proximity` and `deviceAuth` flags. A criterion holds one or more
  requirements, met **all-of** or **k-of-n**.
- Distinctness is by attester tag within one witness's proof. Across witnesses it relies
  on each attester deriving one PCS key per community; a person enrolled with two
  witnesses with different keys counts twice. This is accepted (§8).
- Flags are carried in labels. Token labels are opaque strings, so
  `token/<day>/ble` and `token/<day>/ble/hw` need no library change; root-class flags
  ride the period (`vetter/2026-11/hw`). The verifier only checks that a label is live,
  so "at least *k* of these must be hardware" is a **count over the statements' token
  labels** in a wrapper, not an allow-list (an allow-list rejects the whole proof if one
  label is missing).

### 4.2 Coarse time

Three moments exist: the exchange (fine-grained, seconds, kept by the witness), the
attestation (B's VTA), and the presentation (the join). The community sees only the
epoch label (about 30 days), the day label on the token, and the join time it observes
itself. Token validity bounds when tokens are *issued*, not when attestations are made;
that is acceptable once tokens are bound to the applicant (§4.3). A finer timestamp would
shrink the anonymity set and help a colluding witness and community match a join to a
session log, so none is offered.

### 4.3 Binding the token to the applicant

A picks a random `r` and sets the token's serial `s = H("tok-bind", community, id_A, r)`
reduced to the field. A sends the witness a commitment `C = g^ρ · Y1^s` and an opening
proof; the witness blind-signs it through the unchanged issuer; A unblinds and
re-randomises. The community recomputes `s` from the applicant's identity and `r` and
rejects a mismatch (`token-binding-mismatch`). The commitment is perfectly hiding, so the
witness learns neither `s`, `r` nor `id_A`.

This closes a counterparty spending a token for a stranger. It does not stop the
applicant binding tokens to a sybil identity (the witness cannot know which identity is
real), and it moves issuance accounting from per attester to per (applicant, session).
The spike showed it works **in the wrapper crate, with no change to PCS** (BAM-04 Part D).

### 4.4 Proximity and device checks

The witness observes proximity over BLE and checks hardware attestation and the biometric
flag exactly as it does for the witnessed VRC (`WitnessTaskSessions.ts` `handleSubmit`:
party-holder check, locality `observation`/`confirmed`, `requiredExt`). It issues a
flagged token only after the corresponding check passes. The certificate chain never
leaves the witness. **Decision:** the witness's in-code proximity standards are trusted;
no distance bounding is attempted, and a relay attacker who passes them passes this
design too.

### 4.5 What the community can and cannot audit

The community cannot see whether an exchange occurred. It trusts the witness, which is
the authority decision VTI separates from verification ("verification is not authority",
VTI considerations, VTI-CMP-030). Operators who need an audit trail keep the plaintext
VWC path for the relationship graph after admission; the two can coexist.

---

## 5. What changes outside keyring-wallet and bifold

This cannot be done in keyring-wallet and its bifold submodule alone.

| Component | Change | Needed for |
|---|---|---|
| **VTC** (VTI `vtc-service`) | **Required.** Let a hidden-vetting criterion carry externally supplied helper and token keys. Today the keys are *derived from the community's own signer* and published by `pcs_issue::publish` (`pcs_issue.rs:420-445`, "an operator publishes what this returns, and never types a key in"); `pcs_issue::issuer` (`:464-475`) and `routes/vetting_hidden.rs:215-250` refuse a criterion whose keys differ from the derived ones. Verification already reads the stored keys (`vetting/pcs.rs:538`), so only the publish path and the derived-key checks change, plus turning off community-side issuance for such a criterion. Namespace the spent-serial ledger per witness (`spent_key`, `vetting/pcs.rs:368`). Add the missing check that the submission's `join_did` equals the authenticated applicant (`join_did` is never compared today). The VTC must be built with feature `vetting-pcs` | Every phase from 2. Estimate ~1 week (inferred; the rest of `vetting_hidden.rs` is not read) |
| **VTA** (VTI `vta-service`) | The VTA is **not** hard-wired to the community (helper keys, labels and community arrive as the `parameters` of each `vta/pcs/*` payload; `operations/pcs.rs:381-413`) and has no outbound path to the helper (the wallet relays). **Not needed** for the MVP in which the attester draws tokens as a vetter with the witness as helper. **Needed** for applicant-bound tokens: an applicant-side token wallet (today wallets exist only inside the vetter engine, `operations/pcs.rs:588-607`, and `tokens_request` returns `NotFound` without a vetter record, `:688-691`), plus single-use token export and import tasks, with spec bundles | Phase 4. Estimate 1–1.5 weeks (inferred) |
| **`vti-vetting-pcs`** (VTI crate) | The bound-token helpers (`TokenWallet::prepare_with_serials`), a flag-aware count wrapper, a multi-helper verify wrapper with cross-proof tag dedupe, and a persistent `SpentLedger`. **Conditional:** dropping `requirements_digest` from `StatementMeta` (`meta.rs:20`) so a criteria edit does not void collected attestations; this changes existing hidden vetting and needs the VTI maintainers' agreement (§9, Phase 0) | Phases 1, 4, 5 |
| **PCS core** (`predicate-credential-system` 0.1.0, crates.io, single individual owner) | None | — |
| **Spec** (Trust Tasks, VTI) | None for the MVP: the join carries the proof in `extensions`, and the new witness tasks are staged locally like `witnessShareSpec.ts`. A typed member for the proof in submit/supplement 0.4 and a `witness/pcs/*` profile follow | Phase 8 |

---

## 6. Where the change lands in this repository

- **Witness** (`bifold/packages/witness-server/src/trustTasks/WitnessTaskSessions.ts`):
  a `witness/pcs/root` and `witness/pcs/token` pair registered beside `witness/session`
  (`register()` ~207-277; `handleDocument` switch ~292-299; `handleDiscovery`
  `supportedTypes` ~373-379). The token is issued from the `submit` handler after the
  locality check and before `buildVwcJson`. Per-session, per-pair and per-epoch counters
  need persistence (`sessions` is an in-memory map).
- **Witness PCS issuer:** a small **Rust sidecar** called through the `WitnessTaskHost`
  interface (`:159-196`). Native speed, the issuer secret stays out of the Node process,
  and blind signing is serialised by one process. WASM or a Rust `vti-witness` can
  replace it later.
- **Wallet ceremony** (`core/.../trust-tasks/{ceremony,witnessCeremony}.ts`): a token
  request beside `runWitnessSession`, reusing `awaitWitnessResponse` /
  `resolveWitnessResponse` and extending the inbound branch (`ceremony.ts:741-752`); a
  pairwise hand-off task (A to B) and an attestation-return task, registered with
  `registerTrustTask` and advertised in `SUPPORTED_TASK_TYPES` (`ceremony.ts:~167-173`).
  These steps are **mandatory**, so they cannot reuse the existing soft-fail.
- **Attestation in the session:** a direct `pcsAttest` from the inbound hand-off handler
  on B's side, not the vetter desk and ticket path (`hiddenVetterAdapter.attest`), inside
  a bounded window.
- **Join:** `extensions.witnessedRelationships` beside `hiddenVetting` in `vtiAgent.ts`
  (`apply`/`supplement` ~1768, 1921-1985), and a new criterion kind in `joinManifest.ts`
  (`HIDDEN_VETTING_EXT` :191), `screens/joinWays.ts` and `joinSubmission.ts` (:91).
- **VTA client:** `VtaClient.ts` `pcsRootRequest` (2508), `pcsTokensRequest` (2540) and
  `pcsAttest` (2566) carry the new inputs in Phase 4.

---

## 7. Phases

Effort figures are estimates from reading the code, not measurements. Sizes marked
"inferred" rest on files not read in full.

### Phase 0 — Baselines and agreements (no product code) — ~1 week

1. Record a green `hv` leg (`e2e/gate/legs/hv.sh`) against a Farm community on current
   `main`, or script a PCS-enabled community in `scripts/openvtc/local-vti-stack`
   (build with `vetting-pcs`, publish a hidden criterion, set a vetter grant). Unconfigured,
   every `hv` row reports SKIP.
2. Agree the VTC change (§5) and the conditional `StatementMeta` change with the VTI
   maintainers, and tell the PCS crate's owner: the README says "not on crates.io"
   although it is published; ask for an organisation-level owner and a versioning policy.
3. Push the spike (`vti-vetting-pcs/tests/witness_helper_spike.rs`) to a branch where it
   survives, and re-verify the citations in this plan at the pins.

*Acceptance.* A dated result (pass or the exact failure) for the `hv` leg on `main`;
written agreement or an explicit "no" from the VTI maintainers on the VTC change; the
spike is on a pushed branch and its 15 tests pass from a clean checkout.

### Phase 1 — The witness issues roots and tokens — ~2–3 weeks

Sidecar issuer per community; `witness/pcs/root` and `witness/pcs/token`; the hardware and
BLE checks gating issuance; a **durable, idempotent** drip record: a fresh session
pseudonym as `member` with `tick = 0`, a stored `(member, label, tick)` row written
atomically with signing, and the original answer returned on a retry (the library's
in-memory served set is lost on restart, and a lost response otherwise burns the tick
permanently, `token.rs:319-325`); one root per hardware key per label; caps per
(applicant, session), per pair and per epoch; published parameters; deletion of device
records at epoch end.

*Acceptance.* Tokens are issued only after a passing session; a replayed session issues
none; a restart mid-issuance returns the same answer; a second root for the same hardware
key and label is refused; the published parameters verify an issued token in a Rust test
against the community's verifier type.

### Phase 2 — The VTC accepts the witness's keys — ~1 week (inferred), external

The change in §5, plus the `join_did` check.

*Acceptance.* A criterion published with a witness's keys admits an applicant with *n*
distinct attesters in a VTC integration test; a derived-key criterion behaves exactly as
before; a criterion naming the wrong witness's keys rejects.

### Phase 3 — The wallet: attester draws tokens (MVP, no applicant binding) — ~3–4 weeks

Enrolment with the witness; the token returned in the live session; B's in-session
attestation; A's verification; the join criterion kind and `extensions` submission. The
applicant's VTA grant must be `admin` or `initiator` to derive the `pcs-applicant`
capability (VTA 0.60).

*Acceptance.* A two-phone run in which two attesters admit an applicant to a community
configured in Phase 2; the community's record shows only tags; the unit tests of §6 pass;
a failed witnessed step stops the exchange rather than continuing unwitnessed.
Token redirection remains possible in this phase and is recorded as a residual (§8).

### Phase 4 — Tokens bound to the applicant — ~2.5–3 weeks, external (VTA)

The applicant's token wallet in the VTA, single-use export and import, the crate helpers,
the community's binding check, and the wallet request in the live session.

*Conditional design.* This phase depends on the VTA maintainers accepting the new tasks.
The alternative, proving on the phone (`@bifold/react-native-pcs`, parked), keeps the work
here but needs native arkworks in React Native and is the heaviest option.

*Acceptance.* A bound token spent for another applicant is rejected without being spent;
an honest three-attester run counts three; both are tests in the VTI repository and a
two-phone run.

### Phase 5 — BLE and hardware/biometric flags — ~1–2 weeks

Flag-bearing labels, the flag-aware count, criterion fields, and the wallet's disclosure
of what each flag asks the witness to check.

*Acceptance.* A requirement for BLE counts only `/ble` tokens; "at least 2 of 3 hardware"
counts by label; an iOS and an Android run both obtain flagged tokens.

### Phase 6 — Several witnesses and thresholds — ~1–2 weeks

A criterion with several requirements, each naming witnesses, met all-of or k-of-n, one
proof per witness key and cross-proof tag dedupe.

*Acceptance.* A 2-of-3 requirement across two witnesses admits and denies in the cases the
criterion states; an attester who holds roots with two witnesses and the same key counts
once.

### Phase 7 — Review and production gate — external

An external cryptographic review of PCS and of this plan's wrappers. Until then the feature
stays behind its flag, as a pilot.

*Acceptance.* A written review with no unresolved high findings, owned by Brendan (§10 Q7).

### Phase 8 — Specification

A witness-PCS Trust Task profile and a typed member in submit/supplement 0.4, with a
composition note that the helper is the party that evaluated completion (VTI-CMP-022) and
that VTI-CMP-023 does not apply because no `taskContext` credential is presented.

*Acceptance.* The profile is published upstream or recorded as declined.

**Order and parallelism.** Phase 0, then Phases 1, 2 in parallel, then 3, 4, then 5, 6.
Phase 3 is the first end-to-end proof. Total for the single-witness MVP (0–3): about
7–10 weeks of engineering; the full scope about 13–20.

---

## 8. Security model: what is not closed

The full table (18 rows) is in BAM-04 Part E. The standing residuals:

- **Attester substitution.** A token is a bearer object and the community counts distinct
  attester *tags*, not people in the room. An attester can hand their token to an enrolled
  colluder who attests for the applicant. Closing it needs the token bound to the
  attester's PCS key, a change in PCS itself (~3–5 weeks plus review, on unaudited
  cryptography). **Decision:** document it. An attacker still needs *k* hardware-enrolled
  devices and *k* real sessions involving the applicant.
- **Late or backdated attestation.** Only the day label's liveness at submission bounds
  it.
- **Sybil rings.** *k*+1 phones defeat any *k*. Caps and one-root-per-hardware-key raise
  the cost; a reinstall resets a hardware key.
- **Compromised or dishonest witness.** It can mint tokens for non-events and the
  community cannot audit it. Mitigation is the choice of trusted witness and key custody
  (see [`encrypted-key-custody-plan.md`](./encrypted-key-custody-plan.md), whose first
  candidate is the witness's VWC issuer key): rotating the issuer secret invalidates every
  root it issued.
- **Borrowed identity.** A holder of a PCS key can prove under another persona's
  challenge. Inherent to anonymous credentials; mitigated by hardware-key uniqueness.
- **The witness sees mint-time records.** A fresh pseudonym per exchange keeps them
  unlinkable to each other; the witness can still link its own records. BLS12-381 is not
  post-quantum, so drop device-to-identity records each epoch.
- **Small anonymity sets.** Labels are limited to the epoch, the day and the two flags.
- **Operator separation** (VTI-Q26 / upstream findings): hiding fails if the attester's
  VTA operator is the community's operator.

---

## 9. What the spike proved

In the VTI repository at `098be289`, on branch `spike/pcs-witness-helper`
(`vti-vetting-pcs/tests/witness_helper_spike.rs`; 15 tests, all pass offline; no source
change): a witness-derived issuer under a community's parameters issues roots and tokens;
three attesters give a verifier built with **the witness's** keys, not the community's, a
proof of three distinct attesters; a repeated attester, another witness's keys, a replayed
serial and a closed label are rejected; token redirection was possible and is closed for
bound tokens; a backdated attestation still counts; a closed day label gives `no-token`.
Re-run: `cargo test --offline -p vti-vetting-pcs --features harness --test
witness_helper_spike` (first build about 3 minutes).

The spike did **not** prove anything about the wallet, the VTA hand-off, the sidecar, the
VTC publish path (§5), or the network behaviour of a live session.

---

## 10. Open questions

1. **VTC change.** Will the VTI maintainers accept externally supplied keys on a
   hidden-vetting criterion, and the `StatementMeta` change? (Brendan with the VTI
   maintainers; blocks Phase 2.)
2. **Hidden-vetting baseline.** Is `hv` green on `main`? (Phase 0; the Farm.)
3. **Applicant role.** The applicant's VTA grant must be `admin` or `initiator` for
   `pcs-applicant`; is that acceptable for ordinary applicants?
4. **Epoch and caps.** An epoch of about 30 days, day-labelled tokens, and the caps in
   Phase 1 are starting points. Set them with the first community.
5. **Sidecar hosting and custody.** Where the sidecar runs and how its issuer secret is
   held, and how this meets the key custody plan.
6. **iOS foreground limits.** A backgrounded iPhone hides the BLE UUID from the witness; the
   RTT bound is provisional (`locality-plan.md`, companion `2026-09-13-al.md`). Review
   the iOS peripheral README, which still says "type-checked only".
7. **Cryptographic review.** Who commissions it, and what blocks production without it.
8. **Reviewer.** Keyring-wallet changes and this plan are reviewed by Alberto (AL) before
   merge.

---

## 11. Review index

| Companion | Concerns |
|---|---|
| [`2026-11-04-bam.md`](./witnessed-admission-plan/2026-11-04-bam.md) | Decisions D1–D10; findings by round; positions superseded in the investigation; the spike; the full threat table; what is still unverified |
