# Formal verification plan

**Status:** Proposed. No code written. Step 0 is unblocked.
**Companion:** [`formal-verification-plan/2026-11-07-bam.md`](./formal-verification-plan/2026-11-07-bam.md) — the survey behind this plan, the evidence for each claim, what was verified and what was not, and the options rejected.
**Related:** [`test-acceleration-plan.md`](./test-acceleration-plan.md) (the Node protocol tier this plan's model-based tests would run in), [`witnessed-admission-plan.md`](./witnessed-admission-plan.md) (Step 4's subject), [`locality-plan.md`](./locality-plan.md) (the policy Step 2 checks).

## 1. Purpose

Keyring's protocol logic is tested only by examples. Nothing in the repository
states a property such as "at most one witness credential is issued per session"
and then checks it over every input or every interleaving. This plan adds that,
in the order that buys the most per unit of effort, and stops at the point where
the next tool would prove less than it costs.

It covers three kinds of check, in increasing cost:

1. **Property-based tests** over pure functions, in the existing jest suites.
2. **Model checking** of the witness session and the proposer tie-break, with the model's traces replayed against the real code.
3. **Symbolic protocol analysis** of witnessed admission, while it is still a plan.

## 2. What is in scope, and what is not

| Target | Where | Check |
|---|---|---|
| Task digest, JCS canonicalisation, proof sign/verify, `digestBytesEqual`, `wireTimestamp`, `checkV2ThreadCorrelation` | `bifold/packages/trust-tasks/src/{documentProof,v2Binding}.ts` | Properties (Step 0) |
| Locality transcript verification | `bifold/packages/witness-server/src/trustTasks/locality.ts` (`verifyTranscript`) | Properties (Step 0) |
| Witness session lifecycle, locality policy grid, TTL, redelivery | `bifold/packages/witness-server/src/trustTasks/WitnessTaskSessions.ts`; app side `core/src/modules/trust-tasks/{ceremony,witnessCeremony}.ts` | Model (Steps 1–2) |
| Proposer tie-break under DID rotation and resume | `ceremony.ts` `isDeterministicProposer` | Model (Step 1) |
| Witnessed admission | `witnessed-admission-plan.md` | Symbolic model (Step 4) |

**Not covered, and no tool here changes that.** Native attestation (Secure
Enclave, StrongBox, App Attest in `appAttest.ts`), BLE radio behaviour, React
Native UI and navigation, and Credo-TS internals. These stay with
`yarn e2e:vrc:devices`. Proximity is policy rather than cryptography (locality
plan §2.1); a model can show only that the code enforces the policy.

## 3. Current design

### 3.1 Properties are written once, in one place

Each check states its property in a comment as a sentence, then as code. A
property that a reader cannot restate in a sentence is not ready to be written.

### 3.2 Property tests run in `@bifold/core`'s jest

`@bifold/trust-tasks` has no package-local tests; its `test` script is a no-op
because its suites live in `@bifold/core` (about 270 test files under
`core/src/modules/trust-tasks/__tests__`, which includes UI tests). Core's jest
config already transforms the `@credo-ts` ESM builds. Property tests therefore
go there, with `fast-check` as a devDependency of core only, and need no new CI
job. Witness-server property tests go in `witness-server/__tests__/unit`, which
has its own jest.

Each property is capped at 100 runs by default so it fits the existing Testing
job, with the seed printed on failure so a failure reproduces.

### 3.3 The witness model is Quint, replayed against the code

The witness session is concurrent: its defects are interleavings across `await`
points, which example tests do not reach. The model is written in Quint
(TypeScript-like syntax, Apalache and TLC backends, and trace generation), because
the team writes TypeScript and a model it can read is a model it will maintain.
TLA+ is the fallback if Quint's checker proves inadequate. P and Stateright are
not chosen: neither generates TypeScript-replayable traces as directly.

A model that nothing connects to the code is documentation that can rot. So the
model is **replayed**: its generated traces drive `WitnessTaskSessions` through a
fake `WitnessTaskHost`, and the test asserts the code reaches the model's
state. This closes the spec-to-code gap only for the paths the traces exercise,
and the plan says so wherever it claims a result.

### 3.4 Symbolic analysis is design-time only

Authentication, replay and unlinkability of witnessed admission are
properties of a protocol, not of code, and the plan is still a proposal, so
this is the cheapest moment to check it. ProVerif is chosen over Tamarin for
unlinkability because that property is observational equivalence, which ProVerif
expresses directly with `diff`-equivalence. Both tools treat ed25519, SHA-256
and JCS as ideal primitives and say nothing about the implementations.

### 3.5 Resource and CI limits

Per `/srv/dev/CLAUDE.md`: check memory and load before any run; run under
`nice -n 10`; set `TMPDIR=/var/tmp/<name>`; use `umask 002`. The model checker is
JVM-based (Java 17 is installed; Quint, ProVerif and Tamarin are not), so it runs
in its own path-filtered CI job with a bounded depth and an explicit timeout,
never in the per-PR Testing job.

## 4. Steps

Each step lists what makes it done.

### Step 0 — Property pilot (about 1–2 days). Unblocked.

Add `fast-check` to `bifold/packages/core` and write
`core/src/modules/trust-tasks/__tests__/documentProof.property.test.ts`.

Properties:

- **Digest invariance.** `taskDigestMultibase(doc)` is the same with and without `doc.proof`.
- **Key order.** `jcsCanonicalize` and `digestMultibase` are independent of object key order.
- **Idempotence.** Canonicalising a canonical form changes nothing.
- **Encoding equality.** `digestBytesEqual` is true for the `z` and `u` encodings of one digest, and never throws on any string input.
- **Tamper means reject.** `signDocumentProof` then `verifyDocumentProof` succeeds; altering any field outside `proof` makes it fail (in-memory Ed25519 key).
- **Timestamp.** `wireTimestamp` truncates to whole seconds.
- **Thread correlation.** `checkV2ThreadCorrelation` is checked exhaustively over its three-valued inputs (absent, equal, differs).
- **Transcript mutation.** In `witness-server/__tests__/unit`, mutating any one field `verifyTranscript` matches (digest, challenge, sensor nonce, sensor DID) yields the matching reject reason and no other.

Also in this step: state, in the test file, the documented differences between
`verifyDocumentProof` (boolean; purpose defaults to `assertionMethod`) and
`verifyTrustTaskProof` (a port of the `vta-sdk` verifier, with
`TRUST_TASK_PROOF_CLOCK_SKEW_MS`), and add a differential property that the two
agree on every input outside those differences.

*Acceptance:* the new files pass in core's and witness-server's `yarn test` with
no new CI job; each property has its sentence in a comment; the suite adds under
30 seconds on the shared host; a deliberately broken `taskDigestMultibase` (strip
the `proof` exclusion) makes the invariance property fail with a printed seed,
demonstrating the test can fail.

### Step 1 — Quint model of the witness session (about 1 week). Blocked on Step 0 only for the dependency decision, not for the work.

Model: session creation, submit from each of two parties, locality resolution
(`off` / `offered` / `required` × `declinedByHolder` / `windowLost` / `confirmed` /
transcript-invalid), issue or reject, TTL expiry, redelivery. Model the proposer
tie-break separately, with DID rotation on first contact and with
`resumeInterruptedExchanges` / `restorePendingProposals`.

**First, settle the double-issuance question, because the model cannot be
written until it is answered.** In `handleSubmit` the session is read at
`WitnessTaskSessions.ts:520` and deleted at `:682`, with awaits between
(`verifyPresentation`, `session.localityObservation`, `signCredential`) and no
in-flight marker. Two submits on one thread whose handlers interleave can both
read the session and both reach `signCredential`. Whether that is a defect
depends on a decision the plan does not make: **is the invariant at most one
credential per session, or at most one per party?** That is an open question
(Q1) for the witness-server owners. Until it is answered the model carries both
variants and the invariant is stated conditionally.

Invariants:

- Under policy `required`, no credential is issued unless locality is `confirmed`.
- Credentials per session are bounded as Q1 decides.
- A session that has expired is never issued against.
- Redelivery is idempotent: `delivered`, `already-issued`, `skipped` and `duplicate` outcomes never produce a second credential.
- Exactly one side proposes, eventually, under any DID-rotation interleaving the model admits. (`isDeterministicProposer` is `myDid < theirDid`, so equal DIDs produce no proposer; the model decides whether equality is reachable.)

*Acceptance:* the model checks to a stated bound (parties, sessions, depth) in
under 10 minutes; each invariant has a counter-example run against a mutated
model proving the invariant can fail; the double-issuance question has a
recorded answer and either a model trace that reproduces it against the code
(Step 2) or a model proof that it is unreachable; the model file cites the
`WitnessTaskSessions.ts` lines it abstracts.

### Step 2 — Replay traces against the code. Depends on Step 1.

Generate traces from the model and drive `WitnessTaskSessions` through a fake
`WitnessTaskHost` in `witness-server/__tests__`. Run in the Node protocol tier
once [`test-acceleration-plan.md`](./test-acceleration-plan.md) T1.2 lands; until
then in witness-server's own jest.

*Acceptance:* every generated trace within the bound passes or is a recorded,
reasoned divergence; if Q1 found a real race, a trace reproduces it as a failing
test before the fix and passes after; the CI job is path-filtered to the model
and the witness-server sources and has a timeout.

### Step 3 — Differential digest and proof check against upstream. Depends on Step 0.

Add a differential test of digest and proof output against the **pinned**
`external/` clone of the upstream VTI/`vta-sdk` implementation, run from
`bifold/.github/workflows/vti-conformance.yaml`. Read the pinned clone, not a
sibling checkout (see the root `CLAUDE.md`, "OpenVTC/TSP upstream clones").

*Acceptance:* a digest or proof that differs from upstream's by one byte fails
the job; the job runs against the pin that `scripts/openvtc/setup-external.mjs`
produced.

### Step 4 — Symbolic model of witnessed admission. Conditional.

**Conditional design:** this step is only worth doing while the
[witnessed-admission plan](./witnessed-admission-plan.md) is still a proposal,
and it is blocked on that plan's own open questions (Q1 the VTC change, Q2 the
`hv` baseline). If that plan is adopted and built first, this step's value falls
to checking the built protocol and its estimate rises.

Properties: one root per hardware key per epoch; a token is spent once per
serial; *k* tokens imply *k* distinct attesters; a token cannot be linked to its
session by the community; a token is bound to the community DID chosen before the
exchange.

*Acceptance:* a ProVerif model whose queries are each reported proved or
falsified; unlinkability stated as an equivalence query; the results recorded in
the admission plan's companion folder, with the primitives-are-ideal limit
stated beside them.

## 5. Rejected alternatives (standing rationale)

- **Dafny or Lean for JCS canonicalisation.** `jcsCanonicalize` delegates to a library; proving our wrapper correct proves little the Step 0 properties do not, and the proof would not cover the library.
- **Tamarin as the first symbolic tool.** Workable, but unlinkability is an observational-equivalence property and ProVerif's `diff` handles it with less effort. Revisit if a stateful property needs Tamarin's multiset rewriting.
- **TLA+ as the first model language.** Equivalent power; Quint is chosen for the team's TypeScript fluency and trace generation. TLA+ stays the fallback.
- **A new CI job for property tests.** Unnecessary: they run in suites that already run.
- **Verifying the React Native UI, native attestation or BLE.** Outside what these tools can see; see §2.

## 6. Open questions

| # | Question | Blocked on |
|---|---|---|
| Q1 | Is the witness invariant at most one credential per session, or one per party? | Decision by the witness-server owners. **Not decided.** |
| Q2 | Is Quint's checker adequate for the Step 1 model, or does it need TLA+? | Decided by the first model attempt; not a person. |
| Q3 | Who owns the model after the author: is it maintained with `WitnessTaskSessions.ts` changes? | Decision; proposed answer is that a PR touching the session logic updates the model or says why not. **Not decided.** |
| Q4 | Does Step 4 proceed before the admission plan is adopted? | Admission plan Q1 and Q2 (decided elsewhere, waiting on the VTI maintainers). |

## 7. Review index

| Document | What it carries |
|---|---|
| [`2026-11-07-bam.md`](./formal-verification-plan/2026-11-07-bam.md) | The survey, the evidence per claim, what was checked against source and what was not, tool-selection reasoning |
