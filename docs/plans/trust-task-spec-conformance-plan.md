# Trust Tasks spec conformance — framework PRs #33 to #51

**Status:** Proposed. No code written by this plan; the read side of W1 steps 1–2 exists separately on bifold `main` (see W1, Overlap). Four decisions are Brendan's (§7); every work item says which of them it waits on.
**Scope:** bringing Keyring's Trust Task producers, consumers and Keyring-authored specifications into line with the framework changes merged as `dtgwg-trust-tasks-spec` #33, #35 and #44–#51 (origin/main `bdf2cdd`). It covers the wallet (`bifold/packages/core/src/modules/trust-tasks`), the shared plumbing (`bifold/packages/trust-tasks`), the witness-server (`bifold/packages/witness-server`), the specs Keyring authors in the registry, and the findings and issues we owe upstream.
**Precondition:** branch `chore/trust-tasks-0.28` (root `10cc5065`, bifold `099777ce4`) — `@openvtc/trust-tasks` 0.28.1 — lands on `main` first. Every file and line reference below is to that branch, and every item assumes the 0.28 library: its `rejectWith` emits `trust-task-error/0.6`, and it ships the `EXTENDS` and `DEPRECATION` constants this plan reads.
**Parent and siblings:** independent of, but constrained by, [`openvtc-integration-plan.md`](./openvtc-integration-plan.md) and its [`trust_tasks_subtask.md`](./openvtc-integration-plan/trust_tasks_subtask.md), which owns the design of `vrc/relationships/propose` and the witness legs. W5 changes the propose decline that subtask states; until W5 lands the subtask's rule stands for `propose/0.1`. Findings raised against VTI go in [`../VTI_UPSTREAM_FINDINGS.md`](../VTI_UPSTREAM_FINDINGS.md) under the `vti-lab-and-field` process.
**Reasoning:** [`trust-task-spec-conformance-plan/2026-10-28-bam.md`](./trust-task-spec-conformance-plan/2026-10-28-bam.md) holds the per-PR spec quotes, the verification of the source review against the code, the alternatives considered and the caveats. This document states current design only; see [`CLAUDE.md`](./CLAUDE.md).
**Input:** the read-only conformance review `/srv/dev/scratch/2026-10-28-cc-trust-task-spec-conformance.md` (not in the repository; its findings, corrected where stale, are carried in the companion).

**Reviews that shaped it:**

| Rev | Review |
|---|---|
| 1 (10-28) | [`2026-10-28-bam.md`](./trust-task-spec-conformance-plan/2026-10-28-bam.md) — the conformance review checked against `chore/trust-tasks-0.28`, and the design positions below |
| 2 (10-29) | [`2026-10-29-bam.md`](./trust-task-spec-conformance-plan/2026-10-29-bam.md) — PR review correction: importing a version module does not register `extends` at 0.28.1; W1 step 1 revised |

---

## 1. Goal and boundary

**Goal.** Every Trust Task document Keyring emits or reads conforms to the framework at `bdf2cdd` on every MUST, and on every SHOULD unless this plan names the reason it does not. The one functional break — a vetter's refusal that the applicant silently ignores — is fixed first.

**Not in scope.** #51 (carried protocols): Keyring uses no spec that declares `carries` and authors none; if Keyring adopts TRQP lookups it uses the `registry/*/0.2` family and reads negative answers from the success response. #49 itself conforms (each consumer chooses its own acceptance window, and Keyring's 5-minute skew is stated as its own choice); only the pre-existing duplicate-execution gap it exposed is in scope (W8).

## 2. Normative constraints

Quoted from `dtgwg-trust-tasks-spec` `spec/body.md` at `bdf2cdd`, cited by section name. The companion carries the longer quotations.

| PR | Section | Operative text |
|---|---|---|
| #33 | Compatibility Rules, *Declared extension* | "A *consumer* implementing a version **SHOULD** accept a document of any later version whose `extends` chain reaches it, by ignoring the payload members it does not recognize." |
| #33 | Behaviour at Each Status | "Producers **SHOULD NOT** emit documents against a `retired` specification. Producers **MUST NOT** emit documents against a `withdrawn` specification." "Consumers **SHOULD** surface a deprecation signal … when a received document's `type` resolves to a `retired` or superseded specification." |
| #33 | Superseded and Withdrawn Versions | "*producers* **SHOULD** emit documents against its successor instead." |
| #35 | Extension by Individual Trust Task Specifications, rule 1 | "A party interpreting an extended `code` **MUST** resolve it against the specification identified by the *Type URI* of the document the *error response* reports on: `inResponseTo.typeUri` where present …, and otherwise the document it correlates the response with through `threadId`. It **MUST NOT** resolve the code by its string alone" |
| #35 | same, rule 3 | an implementation that keeps codes beyond the exchange "**SHOULD** keep each code together with the *Type URI* it was resolved against" |
| #44 | Proof, *What a consumer verifies* | "A *consumer* **MUST** verify a `proof` over the document **as received** … It **MUST NOT** verify over a re-serialization of a typed representation of the document" |
| #45 | Reserved Response-Type Slugs, *A hold is a next step* | "A *consumer* holding a task **MUST** answer with a *next step*, and **MUST NOT** answer with `taskFailed`, `permissionDenied` or any other *error response* whose extended code or `details` says the task is held" |
| #46 | Error Responses, *A decision is not a failure* | "a *Trust Task specification* whose task produces a decision **SHOULD** define every decision it can produce in its success-response schema, and **SHOULD NOT** declare a task-specific error code … whose meaning is one of those decisions." |
| #47 | Consumer Requirements, *A target already in the requested state* | creating something that already exists "**SHOULD** refuse … with a task-specific error code"; "A *producer* that wants only the end state reads the code that way for itself." |
| #48 | Shared Schema Components, rule 5 | "A shared schema component **MUST NOT** supply a `default` for a governance value … A *Trust Task specification* **SHOULD NOT** supply such a default in its own payload schema either" |
| #49 | Consumer Requirements, *Bounding the record* | "A *consumer* that can establish neither an `expiresAt` nor an age for a document has no window in which to place it, and **MUST NOT** execute a *consequential Trust Task* on it." |
| #50 | Standard Error Codes, `indeterminate` | "A *recipient party* returning it **SHOULD** say in `details` which kind of reference could not be obtained … and **MUST NOT** return `proofInvalid` or `permissionDenied` in its place." |

## 3. Design positions

1. **Read by `extends`, not by exact version.** A hand-rolled reader of a Type URI accepts the version it implements and any later version whose `extends` chain reaches it, using the library's `extendsChain` (`@openvtc/trust-tasks` `_runtime/extends.ts`) over an index the application has registered. Importing a version's module does not register its `extends`: at 0.28.1 the generated `EXTENDS_BY_TYPE_URI` is empty and only the application's `declareExtends` (or an explicit index passed to `extendsChain`) populates it. A version list such as `['0.5', '0.6']` is not used: it silently stops being true at the next extension.
2. **One emitted `trust-task-error` version: 0.6.** The library's `rejectWith` already emits 0.6 (`TRUST_TASK_ERROR_TYPE_URI`), 0.6 declares `extends: 0.5`, and 0.5 carries `DEPRECATION: "superseded by trust-task-error/0.6"`. `vtiVetting.ts`'s hard-coded `TASK_ERROR_TYPE = …/0.5` moves to the library constant. **Conditional** on W10 step 3 showing that VTI's and openvtc's readers accept 0.6; if either does not, Q1 decides (§7).
3. **An error code is read against the Type URI it answers.** Every reader compares `code` exactly against `extendedCode(<Type URI of the document the error reports on>, '<local>')`, taking that Type URI from `inResponseTo.typeUri`, or from the retained document the `threadId` names. Suffix matches, regexes over `code`, and any reading of `message` are not used, except a reading of `message` gated to one named generic code from one named peer and recorded as a workaround for that peer.
4. **An unresolvable reference is `indeterminate`.** Proof verification has three results: verified, invalid (the proof was checked and did not hold — wrong suite, purpose, controller or signature), and indeterminate (the DID document, verification method or other published reference could not be obtained). Only the second goes out as `proofInvalid`.
5. **A consent hold answers with a next step.** A recipient wallet holding `vrc/relationships/propose` for its person's consent sends `trust-task-next-step/0.1` on the exchange as soon as it starts holding. The consent belongs to someone other than the producer and the wallet offers no task for learning it, so `expects` names `vrc/relationships/propose/<version>` with `continuation: 'resubmit'` (spec, *A hold is a next step*, third-party case). The wallet still pushes the outcome when the person answers; a resubmission on the same thread is answered with the outcome if decided, else with a further next step, and never raises a second prompt.
6. **A decision is an outcome.** In the specs Keyring authors, a decline is a value in the success response, not an error code. `vrc/relationships/propose/0.2` reports `decision: 'accepted' | 'declined'` in `#response`; it does not declare `propose:declined`. Because the decline moves, 0.2 does not declare `extends: 0.1`. `propose/0.1` is unchanged and keeps its own decline form (`propose:declined`) for peers that negotiate only 0.1 — "A *recipient party* reports a decision in the form its specification defines." **Conditional** on Q2 (§7).
7. **Emit successors; surface deprecation.** Keyring emits the current version of every spec it owns, and the successor of every peer-owned spec as soon as the pinned peer serves it. A peer-owned version kept for a deployed peer is named in §5 with its reason. On receipt, a document whose module's `DEPRECATION` is non-null is logged once per Type URI per process.
8. **The witness submit is consequential.** `witness/session/submit` issues a VWC, an externally visible effect, so the witness-server consumes it with a bounded acceptance window and a duplicate record keyed on document `id` for that window, not with `notConsequentialChecks`. **Conditional** on Q3 (§7).

## 4. Work items

Severity is the source review's, re-checked in the companion. "Repo" names where the change lands; a bifold change also needs a root PR that advances the `bifold` submodule pointer.

### W1 — Vetting refusals in `trust-task-error/0.6` are read, and one error version is emitted

- **Severity:** High (#33, #35). A vetter on library 0.28 refuses in 0.6; `refused()` drops it and the applicant's request stays `accepted`.
- **Repo:** bifold (`packages/core`), then root pointer.
- **Files:** `packages/core/src/modules/trust-tasks/module/vtiVetting.ts` (`TASK_ERROR_TYPE` :117, `LEGACY_ERROR_03_UNTIL` :123, `refused()` :2346–2370, `refusalCode` :243); a new `packages/core/src/modules/trust-tasks/__tests__/vettingRefusal.test.ts`.
- **Steps:**
  1. At start-up, register the link the library does not: `declareExtends({ 'https://trusttasks.org/spec/trust-task-error/0.6': '0.5' })` (or pass the same map as an explicit local index to `extendsChain`). In `refused()`, accept the document when its version is 0.5 or `extendsChain(type)` reaches 0.5 (position 1). Importing the 0.6 `payload` module is not enough: it exports `EXTENDS = "0.5"` but registers nothing. The 0.3 legacy branch is unchanged: it stops reading 0.3 at `2026-11-01T00:00:00Z` as designed.
  2. Apply the same check to every other exact-version reader of a Type URI found by `git grep -n "slice(TASK_ERROR.length)\|=== '0\.[0-9]'"` under `modules/trust-tasks`. Readers that already use `startsWith(TASK_ERROR)` (`VtaClient.ts`, `vtiAgent.ts`, `hiddenVetterRounds.ts`) read by prefix and do not consult `extends`, so registration does not affect them. `TASK_ERROR` is the version-free prefix `https://trusttasks.org/spec/trust-task-error/` in each (also `vtaReplyProof.ts`, which exempts error documents the same way), so they stay unchanged.
  3. After W10 step 3: set `TASK_ERROR_TYPE` to the library's `TRUST_TASK_ERROR_TYPE_URI` and update the doc comment at :111–116 to say why (position 2). If Q1 keeps 0.5 for VTI peers, the comment says so and names Q1 instead.
- **Acceptance:** `vettingRefusal.test.ts` delivers a refusal as `trust-task-error/0.5`, `/0.6`, and a synthetic `/0.7` whose module declares `extends: 0.6`, each threaded on the request; all three set `status: 'refused'`. The `/0.7` case declares its link in the test (`declareExtends` or an explicit index). A separate assertion states `extendsChain('https://trusttasks.org/spec/trust-task-error/0.6')` is non-empty after start-up registration, so a registration that is dropped fails the test rather than silently refusing 0.6. A `/0.3` refusal before 2026-11-01 is read and one after is dropped (fake clock). A refusal threaded on another request is ignored. After step 3, a test asserts every error document Keyring emits from `vtiVetting.ts` and through `rejectWith` carries the same Type URI. `cd bifold/packages/core && yarn test` passes.
- **Overlap:** the read side of steps 1–2 is already done on bifold `main` by the Keyring team's collaborator (albertoleon7794) for an over-the-air update to 276, ahead of 277 emitting 0.6, using the explicit-index approach above. Steps 1–2 are to be reconciled with that work, not redone: compare it against the acceptance below and keep whichever of the two is already on `main`. Step 3 is not part of it.
- **Depends on:** the precondition only for steps 1–2 (ship first). Step 3 waits on W10 step 3 and Q1.
- **Wire-compat:** steps 1–2 only widen what is read. Step 3 changes what VTI vetters receive from a Keyring applicant or vetter; safe for any reader that implements forward processing over `extends`, which W10 step 3 establishes.

### W2 — Unresolvable verification material answers `indeterminate`

- **Severity:** Medium-High (#50, a MUST NOT).
- **Repo:** bifold (`packages/trust-tasks`, `packages/core`, `packages/witness-server`); root (`app/src/demo-profiles/approver/ceremony.ts`); upstream (`trustoverip/dtgwg-trust-tasks-tf`, which publishes `@openvtc/trust-tasks`).
- **Files:** `packages/trust-tasks/src/documentProof.ts` (`verifyDocumentProof` :348, the catch at :443; `packages/core/.../documentProof.ts` only re-exports it); `packages/core/src/modules/trust-tasks/ceremony.ts` (`issueProofPolicy` :1424–1437, used at :1468, :1583, :1697, :1819); `packages/witness-server/src/trustTasks/WitnessTaskSessions.ts` (submit verifier, ~:490–510); `app/src/demo-profiles/approver/ceremony.ts`.
- **Steps:**
  1. Add `checkDocumentProof(...)` to `@bifold/trust-tasks` returning `{ result: 'verified' } | { result: 'invalid', reason } | { result: 'indeterminate', reference: 'verificationMethod' | 'didDocument' }`. DID resolution failure, resolver unreachable, or a fetch error is indeterminate; a wrong suite, purpose, controller, missing method or failed signature is invalid. `verifyDocumentProof` stays as the boolean wrapper (`verified` → true) so its other callers do not change.
  2. In `issueProofPolicy` and the witness submit verifier, call `checkDocumentProof` first. On `indeterminate`, do not call `consumeInbound`; answer with `rejectWith(doc, id, { code: 'indeterminate', retryable: true, message: 'a verification method could not be resolved', details: { reference } })` and retain nothing as verified. The `message` and `details` name the kind of reference only — never the DID or the resolver's error text (the library's `PROOF_INVALID_WIRE_MESSAGE` rationale applies equally).
  3. Upstream: open an issue on `trustoverip/dtgwg-trust-tasks-tf` citing #50 — `consumeInbound` maps a verifier's `false` or throw to `proofInvalid` (`_runtime/consume.ts` ~:440–458) and `ProofVerifier.verify` can return only a boolean — and offer a PR: `verify` may return `'indeterminate'` (or throw a typed `IndeterminateProofError`), which `consumeInbound` maps to `indeterminate`; the same for an unobtainable schema during payload validation. Draft text is in the companion.
  4. When the upstream change ships, remove the pre-check of step 2 and return the tri-state through the library's policy.
- **Acceptance:** `documentProof.test.ts` covers each of the three results, including a resolver that throws and one that returns no document (indeterminate) and a tampered signature (invalid). `ceremonyIssue.test.ts` asserts an issue leg from an unresolvable DID gets a `trust-task-error` with `code: 'indeterminate'`, `retryable: true`, and no DID in `message` or `details`, and that nothing is stored. A witness-server test asserts the same for a submit. The upstream issue URL is recorded in the companion. Package suites and root `yarn typecheck` pass.
- **Depends on:** none for steps 1–3; step 4 on an upstream release and a library bump.
- **Wire-compat:** a peer that receives `indeterminate` and does not know it reads it as an unknown standard code — a failure, which it already was. No peer is known to branch on `proofInvalid` from Keyring.

### W3 — Error codes are read against the Type URI they answer

- **Severity:** Medium (#35, a MUST NOT).
- **Repo:** bifold (`packages/core`).
- **Files and current readers:**

  | File | Line | Reader |
  |---|---|---|
  | `ceremony.ts` | 753–762 | any inbound `trust-task-error` is a decline when `/declined$/.test(code)` |
  | `module/vtaDevices.ts` | 221–223 | `/alreadyRegistered/` over `` `${e.code} ${e.message}` `` |
  | `module/vtaOwner.ts` | 180, 206 | `/already exists/i` over `message` |
  | `module/hiddenVetterRounds.ts` | 257, 387, 392 | `endsWith(':notFound')`, `':alreadyServed'`, `':tickNotYet'` |
  | `module/hiddenVetting.ts` | 346 | `endsWith(':notFound')` |
  | `module/VtaClient.ts` | 2421–2422 | `endsWith(':notFound')`, `endsWith(':unsupportedType')` |
  | `module/vtiVetting.ts` | 243, 2369 | `refusalCode` stored without its Type URI |

- **Steps:**
  1. Add one helper, `errorCodeFor(errorDocument, retained?)`, in `packages/core/src/modules/trust-tasks/` that returns `{ code, typeUri }` with `typeUri` from `inResponseTo.typeUri`, else from the retained document whose `id` is the error's `threadId`, else `undefined`.
  2. `ceremony.ts`: a decline is `typeUri === propose.TYPE_URI && code === extendedCode(propose.TYPE_URI, 'declined')`. Every other error clears the flow as `'error'`.
  3. Replace each suffix fallback with an exact comparison against `extendedCode(<the Type URI asked>, '<local>')`. Where a deployed peer is known to send the bare standard form (`notFound`), keep the exact bare comparison with a comment naming the peer.
  4. `vtaDevices.ts`: compare `e.code` exactly against `extendedCode(<device register Type URI>, 'alreadyRegistered')`. `vtaOwner.ts`: keep the `message` reading only behind `details.reason === 'conflict'` and the generic code the VTA is known to send, with a comment naming the VTA version measured; record the VTA's missing task-specific code as an upstream finding (W10 step 4).
  5. `vtiVetting.ts`: store `refusalTypeUri` next to `refusalCode` (rule 3).
- **Acceptance:** for each reader, a test sends a code with the right local name under a **different** Type URI (e.g. `vault/credentials/get:notFound` in reply to a `hiddenVetting` request) and asserts it is not read as the local code; and the matching code under the asked Type URI is. `ceremony.test.ts` asserts a `witness/session/submit:declined`-shaped error does not mark a VRC flow `declined`. `vtaDevices.test.ts` asserts a `message` containing "alreadyRegistered" with an unrelated code is not read as registered. The vetting refusal test of W1 asserts `refusalTypeUri`. `yarn test` in core passes.
- **Depends on:** W1 (same file; land after it).
- **Wire-compat:** none on the wire. Behavioural risk: a deployed peer that sends a code under a slug other than the one asked is no longer matched; step 3's named exceptions cover the peers known today, and the VTI e2e (`vti-lab-and-field`) is the check.

### W4 — The VRC propose consent hold sends a next step

- **Severity:** Medium (#45, a MUST).
- **Repo:** bifold (`packages/core`).
- **Files:** `ceremony.ts` (`askForConsent` call :959, definition :966; `restorePendingProposals` :1028; `respondToRelationshipProposal` :1094; inbound dispatch :745–768); `__tests__/ceremony.test.ts`, `__tests__/ceremonyRestoreProposals.test.ts`.
- **Steps:**
  1. Where the wallet first holds a propose for consent (the `askForConsent` call at :959), send `trust-task-next-step/0.1` on the exchange thread: `expects: [{ typeUri: propose.TYPE_URI, continuation: 'resubmit', message: 'awaiting the person’s consent' }]`, `inResponseTo: { typeUri: propose.TYPE_URI, id: document.id }`, signed like the other legs. `restorePendingProposals` does not re-send it.
  2. A propose arriving on a thread that already has a pending consent is a resubmission: answer with the retained outcome if the person has answered, else with a further next step; do not open a second prompt.
  3. On the proposer side, add a dispatch branch for `trust-task-next-step` whose `inResponseTo.typeUri` is the open propose: retain it, keep the flow open, and log it. It does not trigger an automatic resubmission.
  4. The person's decline is answered in the form the negotiated propose version defines (W5); W4 does not change it.
- **Acceptance:** `ceremony.test.ts`: receiving a propose that needs consent emits exactly one next step with the fields above, before any answer; a resubmission on the same thread emits another next step and no second consent request; after accept, a resubmission gets the retained `#response`. The proposer, given a next step, keeps the flow open (not `error`, not `declined`). `ceremonyRestoreProposals.test.ts`: restoring a pending proposal sends no next step. The unattended `yarn e2e:vrc` run passes on emulators (memory permitting, per the shared-machine rule).
- **Depends on:** W3 step 2 (the proposer's dispatch is rewritten there).
- **Wire-compat:** an older Keyring proposer has no branch for a next step and falls through to "unhandled trust-task type … — retained" (`ceremony.ts:767`): it retains the document under role `request` and the flow continues. A test pins that behaviour against the pre-W4 handler. No negotiation gate is needed.

### W5 — Decisions are outcomes in the specs Keyring authors

- **Severity:** Medium (#46, SHOULD on the spec author — us).
- **Repo:** upstream registry first (`trustoverip/dtgwg-trust-tasks-tf`: `specs/vrc/relationships/propose/0.2`), then a library release, then bifold (`packages/core`), then root pointer. `witness-share` is local staging in bifold.
- **Files:** registry `specs/vrc/relationships/propose/0.2/`; `ceremony.ts` (decline emission :1091–1121, the discovery gate on `supportedTypes`); `witnessShareSpec.ts` (:76 description and the receipt schema); `docs/plans/openvtc-integration-plan/trust_tasks_subtask.md` (the propose decline rule) with a dated companion under that plan.
- **Steps:**
  1. Author `vrc/relationships/propose/0.2`: request payload as 0.1; `#response` gains a required `decision: 'accepted' | 'declined'`, with the relationship DID and the members 0.1 requires on accept required only when `decision` is `accepted`; no `propose:declined` code; no `extends`. Open it as a registry PR with the #46 citation.
  2. After the library ships 0.2: the proposer lists both versions in its discovery query and opens 0.2 when the peer's `supportedTypes` lists it, else 0.1. The recipient answers in the version it was asked in: 0.2 → `#response` with `decision`; 0.1 → `trust-task-error` `propose:declined` as today.
  3. The proposer reads a 0.2 decline from `#response` and keeps reading 0.1 declines through W3's Type-URI-bound check.
  4. `witness-share/0.1` (staging, not yet upstream): the receipt reports `verified: true | false` with a `reason` on false; an error is reserved for "not performed" (malformed, not permitted, could not complete). Change the description at :76 to match. Because the spec is unpublished, change it in place only if no deployed build emits it; otherwise stage it as 0.2.
  5. Update `trust_tasks_subtask.md`'s propose decline rule to state the per-version forms, and write the dated companion that plan's rules require.
- **Acceptance:** the registry PR's schemas validate against the meta-schema in that repository's CI. `ceremony.test.ts` covers four pairings — 0.2↔0.2 decline (a `#response` with `decision: 'declined'`, flow cleared as `declined`, document retained as outcome evidence), 0.2 proposer↔0.1-only peer (0.1 opened, error decline read), 0.1 proposer↔0.2 recipient (answered with the 0.1 error), and 0.2 accept. `witnessShare.test.ts` covers a failed pairing as a receipt with `verified: false`. The two-device `yarn e2e:vrc` passes with one side on a pre-W5 build (mixed-version run) and both sides on the W5 build.
- **Depends on:** Q2; W3; W4 (same handlers); upstream review and a library release for steps 2–3.
- **Wire-compat:** the risk this item exists to manage. Deployed Keyring builds speak only 0.1 and do not list 0.2, so a new build talking to an old one stays on 0.1 in both directions. A new build never sends 0.2 unannounced. Retained 0.1 decline errors stay readable as outcome evidence.

### W6 — Superseded and retired versions; deprecation surfacing

- **Severity:** Low-Medium (#33, SHOULD / SHOULD NOT).
- **Repo:** bifold (`packages/core`, `packages/witness-server`), root pointer; deployment of the witness-server.
- **Files:** `module/vtiCardVault.ts` (`VAULT_GET` :52, call :288), `module/approvalRules.ts` (:78); `ceremony.ts` (:33–34), `witnessCeremony.ts` (:33–34), `witness-server/src/trustTasks/runtime.ts` (:20–21, :40–41), `witness-server/src/trustTasks/WitnessTaskSessions.ts` (`SESSION_TYPE`/`SUBMIT_TYPE` :128–129); `services/TrustTasksService.ts` (consume, ~:105–113).
- **Steps:**
  1. Inventory: generate the list of every Type URI Keyring emits and its module's `DEPRECATION`, and commit it as a test fixture (step 6) rather than a hand list.
  2. `vault/credentials/get`: move `VAULT_GET` to `/0.2` once W10 step 3 shows the pinned VTA serves it; until then log a deprecation note at the call site naming the VTA version. Update `approvalRules.ts` to name both while the VTA serves both.
  3. Witness legs to `witness/session/0.2` + `witness/session/submit/0.2`. 0.2 does not extend 0.1 and the versions pair one to one (library CHANGELOG, witness 0.2 entry), so: (a) the witness-server consumes both pairs, answering each session in the pair it was opened with, and is deployed; (b) the wallet then opens sessions in 0.2 when the witness's discovery lists it, else 0.1; (c) 0.1 is dropped from the witness-server only after no supported wallet build opens 0.1.
  4. VTA-facing successors (`acl/*/0.1`, `auth/step-up/approve-response/0.2`, `device/*/0.2`, `policy/upsert/0.2`, `task-consent/decision/0.1`, `trust-task-discovery/0.1`, `vta/contexts/delete/1.0`, `vta/webvh/dids/create/1.0`, `vta/webvh/dids/rotate-keys/1.0`, `vtc/join-requests/manifest/0.2`, `vtc/join-requests/submit/0.2`, `vtc/relationships/request/0.1`): for each, W10 step 3 records whether the pinned VTA/VTC accepts the successor; move those that are accepted, and list the rest in §5 with the peer version that holds them.
  5. Deprecation signal: in `TrustTasksService.consume` and in each hand-rolled reader's entry point, look up the received Type URI's module `DEPRECATION` and log it once per Type URI per process at `warn`. A `withdrawn` status is not yet used by any module we import; when one appears, consumers MAY reject it with `unsupportedVersion`, and producers MUST NOT emit it — the fixture test of step 6 fails on it.
- **Acceptance:** a test (`trustTaskVersions.test.ts` in core) fails if any emitted Type URI's module has a `DEPRECATION` starting `retired` or `withdrawn`, or starting `superseded` without an entry in an allow-list that names the holding peer — the allow-list mirrors §5. A consume test asserts the deprecation log fires once for two documents of the same superseded type. Witness-server tests cover a 0.1 pair and a 0.2 pair on one server. `yarn e2e:vrc` witnessed runs pass against a witness-server with both pairs and a wallet on 0.2.
- **Depends on:** W10 step 3 for steps 2 and 4; a witness-server deploy between 3a and 3b.
- **Wire-compat:** step 3's ordering is the guard: the server reads both before any wallet writes 0.2. Steps 2 and 4 move only to versions the pinned peer is shown to accept.

### W7 — #44 residuals: a carriage test, and the vta-sdk finding recorded

- **Severity:** Low (#44 conforms; residual risk and an upstream non-conformance).
- **Repo:** bifold (`packages/core` tests); root (`docs/VTI_UPSTREAM_FINDINGS.md`).
- **Files:** a new `packages/core/src/modules/trust-tasks/__tests__/carriageAsReceived.test.ts`; `packages/trust-tasks/src/documentProof.ts` (`withWireTimestamps` :181, used :232); `ceremony.ts` (digest comparisons over `JsonTransformer.toJSON(record.firstCredential)`).
- **Steps:**
  1. The test signs a document whose `issuedAt` is `…:00.000Z`, which has an explicit `null` optional member and an unknown member, wraps it in the DIDComm v1 `TrustTaskMessage` attachment, round-trips it through `JsonTransformer.toJSON`/`fromJSON`, and asserts the attachment JSON deep-equals and JCS-canonicalizes byte-identically to the original, then that `verifyDocumentProof` and `TrustTasksService.consume` accept it. A second case does the same through the retained-record path that `outcomeEvidence.ts` re-verifies.
  2. Record the vta-sdk behaviour — it verifies over a re-serialization (cited in `documentProof.ts` near :160–175, upstream `trust_task_proof/verify.rs:144-161`) — as a `VTI-NN` finding citing #44, after confirming it in the pinned VTI clone and reproducing it on the local stack as `vti-lab-and-field` requires. Until VTI fixes it, `withWireTimestamps` stays and its comment names the finding.
  3. Optional: compare the credential digests in `ceremony.ts` against the delivered credential JSON retained as received, not against the re-serialized typed record.
- **Acceptance:** the test passes (or, if it fails, the failure is the finding and W7 grows a fix). The findings entry carries the command, the observation and the upstream source location, per that document's format. `yarn test` in core passes.
- **Depends on:** W10 step 1 (pinned VTI clone current) for step 2.
- **Wire-compat:** none.

### W8 — Witness submit: bounded acceptance window and duplicate record; "already issued"

- **Severity:** Low (#49's *Bounding the record*, pre-existing; #47 minor).
- **Repo:** bifold (`packages/witness-server`); the `alreadyIssued` code needs a registry change (upstream).
- **Files:** `witness-server/src/trustTasks/runtime.ts` (`witnessConsumeChecks` :57–58); `WitnessTaskSessions.ts` (submit consume ~:490, session delete :682, TTL `SESSION_TTL_MS` :189, expiry :699); `packages/core/.../services/TrustTasksService.ts` (`KEYRING_CONSUME_CHECKS` :81–83) for the classification only.
- **Steps:**
  1. Classify each task Keyring consumes as consequential or not, in a table in this plan (§5); the default is not consequential unless it has an irreversible or externally visible effect. `witness/session/submit` is consequential (position 8).
  2. For the submit, use the library's `consequentialChecks` with a maximum age over `issuedAt` equal to `SESSION_TTL_MS` plus the stated skew, and a duplicate record keyed on document `id` retained for that window (`_runtime/replay.ts`). A submit without `issuedAt` is refused (`malformedRequest`).
  3. Keep a tombstone of completed session ids until the session's TTL would have expired, and answer a submit on a completed session with a distinct code. Propose `alreadyIssued` for `witness/session/submit` in the registry; until it is published, answer `challengeMismatch` as today.
- **Acceptance:** witness-server tests: the same submit document delivered twice issues one VWC and answers the second without a second issuance; a submit older than the window is refused; a submit with no `issuedAt` is refused; a resubmit after completion gets the tombstone answer. The witnessed `yarn e2e:vrc` passes.
- **Depends on:** Q3; W6 step 3 (land on the 0.2 pair to avoid doing it twice).
- **Wire-compat:** a deployed wallet whose submit lacks `issuedAt` would be refused. Step 2 is preceded by a check that every supported wallet build's submit carries `issuedAt` (it is built by the library's document builder); if any does not, the refusal is gated on the 0.2 pair only.

### W9 — #48 governance defaults

- **Severity:** Not applicable to the letter; spirit of #48.
- **Repo:** upstream (VTI, `vta-sdk` `approvals/mod.rs`); bifold (`packages/core`).
- **Files:** `module/approvalsPolicy.ts` (`effectiveMinApprovals` :47, `effectiveExcludeRequester` :48) — a byte-exact port of vta-sdk, which the VTA refuses to differ from; `module/approvalRules.ts`, where Keyring builds the rules it upserts; `__tests__/approvalRules.test.ts`.
- **Steps:**
  1. Every `consent` rule Keyring builds in `approvalRules.ts` (and any UI that feeds it) sets `minApprovals` and `excludeRequester` explicitly, so the `??` defaults are never reached from Keyring. `approvalsPolicy.ts` is not changed while it must match vta-sdk byte for byte.
  2. File an upstream issue on VTI citing #48 and the library's `policy/_shared/0.4` change (library CHANGELOG 0.28.0, #960): vta-sdk's Rego synthesis defaults `minApprovals` to 1 and `excludeRequester` to false. Record it in `VTI_UPSTREAM_FINDINGS.md` per `vti-lab-and-field`.
  3. Check whether `policy/upsert/0.3` (the successor of the `policy/upsert/0.2` we emit) is the change that removes the defaults; fold the answer into W6 step 4.
- **Acceptance:** `approvalRules.test.ts` asserts every consent rule Keyring builds carries both values explicitly, and that building one without them is a type or runtime error; `approvalsPolicy.test.ts` is unchanged and passes; the issue URL and finding number are recorded in the companion.
- **Depends on:** none.
- **Wire-compat:** none.

### W10 — Verify what the review could not, and bring the upstream clones current

- **Severity:** gating — W1 step 3, W6 steps 2–4 and W7 step 2 wait on it.
- **Repo:** root (`scripts/openvtc/PINS.json`, `external/`), local lab.
- **Steps:**
  1. Run `node scripts/openvtc/setup-external.mjs`. `external/dtgwg-trust-tasks-tf` is at `bdae1cf9` (2026-09-21), behind its own pin `7b6bb488` (2026-10-05), and both predate library 0.28.1. Then `node scripts/openvtc/sync-external.mjs` and advance the `dtgwg-trust-tasks-tf` pin (`--advance`) to the commit that released 0.28.1, recording why in `PINS.json` and `SYNC_LOG.md`. Read upstream only from `external/` (root `CLAUDE.md`).
  2. Do the same for `verifiable-trust-infrastructure` and `openvtc` if the pinned versions are older than what the Farm and the openvtc peers run.
  3. Establish, from the pinned clones and the local VTI stack: (a) whether VTI's trust-tasks-rs and openvtc read `trust-task-error/0.6` (forward processing over `extends`, or an explicit 0.6 model); (b) whether the pinned VTA serves `vault/credentials/get/0.2` and each successor in W6 step 4; (c) whether VTC uses `…:tickNotYet` to mean "held until the next tick" (if so it is a #45 upstream note, not ours). Record each answer, with the command and the source location, in the companion of the session that runs it.
  4. Audit how each VTA approval and step-up hold reaches the wallet in `VtaClient.ts` and `approvalRules.ts`: a next step (conforming; check `inResponseTo` and `expects` are read as `vtaClaim.ts:294–307` already does) or an error that says "held" (an upstream finding against the VTA, and a reader we keep tolerant). Add a test per hold path that pins the shape the pinned VTA sends.
- **Acceptance:** `PINS.json` names a `dtgwg-trust-tasks-tf` commit at or after the 0.28.1 release; `external/` matches the pins; the three questions in step 3 have recorded answers with evidence; each VTA hold path has a test or a finding.
- **Depends on:** nothing. First in the sequence.

## 5. Standing tables

**Peer-owned versions Keyring keeps emitting after W6.** Empty until W10 step 3; each row then names the Type URI, the successor, the peer and peer version that holds it, and the date measured. W6's allow-list test mirrors this table.

**Consequential tasks Keyring consumes.** Filled by W8 step 1. `witness/session/submit` is consequential (position 8).

## 6. PR sequence

Each bifold PR is followed by a root PR advancing the submodule pointer; they can share a review.

| # | PR | Repo | Items | Notes |
|---|---|---|---|---|
| 0 | `chore/trust-tasks-0.28` | root + bifold | precondition | already open |
| 1 | vetting refusals read by `extends` | bifold | W1 steps 1–2 | small; ship first — peers on 0.28 already emit 0.6 |
| 2 | pins and verification | root | W10 steps 1–3 | in parallel with 1 |
| 3 | error codes bound to their Type URI | bifold | W3 | after 1 |
| 4 | `indeterminate` | bifold + root (demo profile) | W2 steps 1–2 | in parallel with 3; upstream issue (W2 step 3) filed the same day |
| 5 | carriage as received + findings | bifold + root docs | W7, W9 step 2, W10 step 4 | in parallel |
| 6 | one emitted error version | bifold | W1 step 3 | after 2 and Q1 |
| 7 | consent hold next step | bifold | W4 | after 3 |
| 8 | deprecation surfacing, vault get, VTA successors | bifold | W6 steps 1, 2, 4, 5 | after 2 |
| 9 | witness-server reads both witness pairs | bifold, then deploy | W6 step 3a, W8 | after Q3; deploy before 10 |
| 10 | wallet opens witness 0.2 | bifold | W6 step 3b | after 9 is deployed |
| 11 | `propose/0.2` spec | upstream registry | W5 step 1 | after Q2; review time is upstream's |
| 12 | `propose/0.2` in the wallet, witness-share receipt, subtask update | bifold + root docs | W5 steps 2–5 | after 11 ships in a library release, and after 7 |
| 13 | consent rules carry explicit governance values | bifold | W9 step 1 | any time |

**Generator.** Upstream proposes `@openvtc/trust-tasks-gen` (framework issue #940): generate the tasks Keyring pins from a `trust-tasks.lock`, family by family starting with vault and auth step-up, and use generated payload types in place of hand-written ones, for compile-time safety rather than bundle size. It is a proposal, to follow once `chore/trust-tasks-0.28` is pushed, and is not adopted here. If adopted it overlaps W6 (generated `DEPRECATION` and Type URI inventory) and W10 (what is pinned), and its generated `declareExtends()` would replace the hand registration in W1 step 1. Until then this plan's items stand as written.

## 7. Decisions (agreed 2026-10-28)

| # | Question | Decision (the recommendation, agreed) | Blocks |
|---|---|---|---|
| Q1 | Emit `trust-task-error/0.6` everywhere, or keep 0.5 for VTI vetting peers? | 0.6 everywhere if W10 step 3a shows VTI and openvtc read it; otherwise keep 0.5 in `vtiVetting.ts` only, with the reason in the doc comment, and revisit at the next VTI pin advance | W1 step 3 |
| Q2 | Author `vrc/relationships/propose/0.2` with the decision in `#response`, superseding the subtask's "a decline is a `trust-task-error`" rule for 0.2? | Yes. It is our spec and the SHOULD lands on us; negotiation keeps deployed peers on 0.1 | W5 |
| Q3 | Treat `witness/session/submit` as a consequential task (bounded window, duplicate record)? | Yes. It issues a VWC; the single-use challenge already limits replay, so the cost is small and the MUST becomes checkable | W8 |
| Q4 | File the #50 issue and PR against `dtgwg-trust-tasks-tf` under your name, and the #48 issue against VTI? | Yes, both; drafts are in the companion | W2 step 3, W9 step 2 |
