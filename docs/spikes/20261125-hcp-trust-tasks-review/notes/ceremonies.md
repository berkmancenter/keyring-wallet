# Track: do `hcp/*` tasks work like ceremonies, and could they later?

Review of trustoverip/dtgwg-trust-tasks-tf PR #1380 (+ #1381, #1382), read at the local
checkout `tt` (branch `pr1382`, head e163cac1d; `pr1381` read with `git show`). Framework read
on the same branch (SPEC.md, generated from canonical 26597aabe, "Working Draft 0.7.0"; identical
to `main` there). HCP at b790561. VTI design at the `vti2823` checkout; VTI source at the pinned
f7b78e29d clone only. Keyring at `d3-fast-send`. Our plan at `d3-plan-canvas`.

Read-only. Nothing was posted, pushed or installed. The only thing run was a copy of the
registry's own `scripts/validate-ceremonies.mjs`, from my scratchpad, against draft definitions
kept in the scratchpad (section 6). Status words: **CONFIRMED** = read in source or spec;
**UNVERIFIED** = inferred, not read.

---

## 1. What a ceremony is in this framework

### 1.1 Three separate layers (design note §2)

`docs/design-notes/trust-ceremonies.md:74-84` splits "orchestration" into three concerns that are
meant to be adoptable on their own:

| Concern | What it is | Where it lives today |
|---|---|---|
| Definition | which tasks, which roles, what order, what counts as done | `ceremonies/<slug>/<ver>/ceremony.json`, shape in `ceremonies/ceremony.meta.schema.json` |
| Coordination | who drives, how a party learns what is next | `threadId`, `trust-task-next-step/0.1` |
| Evidence | what proves the whole flow happened | `ceremony` envelope member (SPEC §4.11), `trust-ceremony-receipt/0.1`, crate `trust-tasks-ceremony` |

### 1.2 The envelope member (normative, SPEC §4.11)

`SPEC.md:628-637`: `ceremony` = `{ enactment (MUST), step (MUST), definition, definitionDigest
(MUST with definition), parentEnactment, round, terminal, prev[{id, digestMultibase}] }`.

- **Optional in every sense.** SPEC.md:644: "any existing specification may be used as a ceremony
  step with no change to its schema and no new version", and a specification "MUST NOT make a
  document's conformance depend on whether it is a ceremony step, and MUST NOT define or constrain
  the `ceremony` member". CONFIRMED.
- **Orthogonal to threads.** SPEC.md:650: "`threadId` scopes one step's request/response exchange
  ... `enactment` scopes the flow across all of its steps; a producer sets both." Steps are
  siblings, not nested, so `parentThreadId` is not the ceremony link. CONFIRMED.
- **Signed.** SPEC.md:657: the proof covers `ceremony`, so a step cannot be lifted into another
  enactment. CONFIRMED.
- **A claim, not a permission.** SPEC.md:667 and §7.2 item 9 (SPEC.md:1138). CONFIRMED.
- **Linkability.** SPEC.md:1892 (§13.1 item 4): a shared `enactment` "hands each of those
  counterparties a handle that joins it to all the others"; a flow that must not be linkable
  declares `enactmentPrivacy: blinded`. CONFIRMED.
- The 0.6 envelope schema that every `hcp/*` task targets already carries both members:
  `specs/_framework/0.6/trust-task.schema.json:24` (`parentThreadId`), `:29` (`ceremony`).
  CONFIRMED.

### 1.3 The definition format (`ceremony.meta.schema.json`)

Required: `slug, version, title, summary, status, targetFrameworkVersion, authors, roles, steps,
completion, evidence, exposure` (`:8-21`).

- **Roles** are names bound to VIDs per enactment; `cardinality: one|many`; `evidentiary` for a
  party that exchanges no document (`:72-121`).
- **Steps** are keyed by a step *name* (the name, not the Type URI, is the identity, so one Type
  URI can be two steps, `:125`). Each has `kind task|ceremony`, `type` (Type URI including any
  `#request`/`#response`), `issuer`/`recipient` roles, `optional`, `prev` (a set),
  `terminal`, `compensatable`, `multiplicity single|perRole`, `maxRounds` (`:129-264`).
- **Branching** only by `optional` + `prev`, never by payload (`:182`, design note §6.2).
- **Repetition** only bounded: `maxRounds` constant, "Unbounded repetition is deliberately not
  expressible" (`:196`). Discriminated by signed `ceremony.round`.
- **Fan-out** only on the issuer side: `perRole` "emits one instance per VID bound to the `issuer`
  role ... Instances are discriminated on the wire by the document's `issuer`" (`:190`). The
  verifier crate keys instances on `(step, round, issuer-if-perRole)`
  (`trust-tasks-ceremony/src/lib.rs:592-597`). CONFIRMED.
- **Terminal states:** at least one step `terminal` (`:206-209`); a receipt without a signed
  terminal step is a prefix. Several terminal steps are allowed (vtc onboarding has two).
- **Time:** `maxDuration` bounds the issuance window measured over the steps' `issuedAt`, never
  the verifier's clock (`:344-348`). There is no per-step timeout.
- **Completion:** closed predicate (`allOf`, `anyOf`, `threshold of|ofStep`) over step names
  (`:314-317`, `:420-507`).
- **Evidence levels:** `collected`, `chained` (need no definition), `receipt` (recorders),
  `countersigned` (`:318-343`).
- **Privacy / risk:** `enactmentPrivacy shared|blinded` (`:349-356`); aggregate `exposure` must be
  at least max() over steps, `sideEffects` is max() (`:357-400`).

### 1.4 Abort, error and compensation

- **Abort:** only proposed. Design note §9 (`:1051-1067`) proposes `trust-ceremony-abort`; no such
  spec exists in `specs/` (only `trust-ceremony-receipt`). CONFIRMED.
- **Compensation:** descriptive flag only, "No compensation engine is implied"
  (`ceremony.meta.schema.json:211-215`). CONFIRMED.
- **An error ends the exchange.** The vetting definition says a refused request "ends the exchange
  with an error and never completes the enactment"
  (`ceremonies/vetting/identity-vetting/0.1/ceremony.json`, step `request`). So in the shipped
  definitions an error is not used as a terminal step; refusal outcomes are typed documents
  (`vetting/decline`, `vtc/join-requests/decide`). CONFIRMED.

### 1.5 Coordination and verdict rules the steps must follow (SPEC §8.6, §4.13.3)

- **A hold is a next step** (SPEC.md:1533-1538). Third-party act: `expects` names a task to learn
  the outcome, or the originating Type URI with `continuation: resubmit`; a decline is reported
  "when the producer next asks"; an abandoned hold ends `cancelled`; a later resubmission "as a new
  document, is evaluated as a new request". CONFIRMED.
- **Verdict table** (SPEC.md:768-774, normative): refer → `trust-task-next-step`; deny "may not
  ask" → `permissionDenied`; deny "asked, answer is no" → the task's own success response.
- **Rule 2** (SPEC.md:779): a decision is accepted as the answer to a referral only if "the
  decision identifies the held exchange and its verified issuer is a party the referral named".
- **Rule 3** (SPEC.md:780): evidence identifies the held exchange "by carrying that exchange's
  `threadId`, or, where the evidence is supplied through a nested exchange, by that exchange
  carrying `parentThreadId` naming the held one", and SHOULD carry the same `ceremony.enactment`.
- **Rule 5** (SPEC.md:782): a hold the consumer abandons ends `cancelled`; "Where it can reply, it
  reports `cancelled` with an `effects` value of `[]`".

These verdict rules (§4.13) are on the PR branch's SPEC.md (from `main`), but **not** in our
pinned framework clone 2a66a0351 (`grep 'stage gate|Verdicts and the Replies'` → 0 there).
CONFIRMED.

### 1.6 Answer to "declarative, or must tasks be written a certain way?"

Declarative, plus an envelope member. No task schema changes (SPEC.md:644). **But** a definition
can only describe what is on the wire, so for a task family to be usable in a ceremony that proves
anything:

1. every act that matters must be a Trust Task document, or it cannot be a step (design note §6.4
   projection, `:520-525`: each step's issuer must learn its turn "from a document it received");
2. every non-terminal state needs a defined exit step: design note §13.5 (`:1441-1452`) calls
   authoring a definition "a reachability check over the registry" — `vtc/join-requests` failed it
   ("`deferred` is a reachable state with no defined way out");
3. each outcome that should end the flow must be a document its issuer can sign `terminal` on;
4. repetition must have a constant bound and the window a constant duration, written in the
   definition;
5. fan-out is only expressible on the issuer side;
6. correlation across steps is the envelope `enactment`, never a payload field.

The `hcp/*` tasks are checked against these in sections 3-4.

---

## 2. Is any `hcp/*` spec part of a ceremony in this PR?

No, in either direction. CONFIRMED.

- `grep -rni ceremon specs/hcp` → 0 lines on `pr1382`; `git grep -i ceremon pr1381 -- specs/hcp` → 0.
- `ceremonies/` holds only `mutual-attestation`, `vetting/identity-vetting`,
  `vtc/member-onboarding`; none names an `hcp/*` Type URI.
- No `hcp/*` spec or the demo uses `parentThreadId` (`grep` → 0) or the `ceremony` member: the
  golden transcript has neither (`examples/hcp-demo-ts/transcript.golden.txt`, 0 matches) and uses
  six independent threads (#1 discovery, #3 grant request with 4 documents, #8 query, #b revoke,
  #d query, #10 notice).
- `hcp/*` targets framework **0.6.0** (e.g. `specs/hcp/grants/request/0.1/spec.md:7`). The 0.7.0
  changelog (SPEC.md B.1, "A specification may mention ceremonies") says 0.7.0 relaxed "MUST NOT
  declare anything about ceremonies" to "MAY refer to them in prose". In practice
  `trust-task-next-step/0.1` (target 0.5.0) already has a "Relationship to ceremonies" section, so
  a prose mention is tolerated; strictly, naming a ceremony in `hcp/*` prose is cleaner at 0.7.0.

---

## 3. The five HCP flows, as they stand in the PR

### 3(a) Connect: `grants/request` → hold → the person decides → resubmit → grant

**Parties.** Context Client (agent), Provider (VTA as Provider + Authorization Service), and the
person through their Management Client (Keyring). The suite names only the first two:
`hcp/grants/request` parties are Context Client (`issuer`) and Provider (`recipient`)
(`spec.md:10-16`, `:113-118`). The string "Management Client" does not occur in
`grants/request/0.1/spec.md`. CONFIRMED.

**Steps on the wire (PR).**
1. CC → P `hcp/grants/request#request` (threadId = its own id in the example, `spec.md:140`).
2. P → CC `trust-task-next-step`, `expects` = the request Type URI, `continuation: resubmit`,
   `hint.retryAfter` (`spec.md:171-178`, example `:184-215`).
3. *The person decides* — **not a Trust Task in the PR**: "The person reaches the decision through
   the provider's own modality, never through the client: a management app, a web page, a message"
   (`spec.md:87`); "The person's decision never travels through the client" (`:180`). In the demo
   it is one printed line, `[person] approves the grant request on thread <#3> in the provider's
   app` (`SCENARIO.md:195`, `transcript.golden.txt:123`). CONFIRMED.
4. CC → P resubmission: new `id`, same `threadId`, same `issuer`, same payload (`spec.md:174`).
5. P → CC `#response` with `accessToken` and `grant` (`:217-277`); or `permissionDenied` on a
   decline (`:288`, `:293`).

**Correlation today.** Client leg: (`threadId`, `issuer`) (`spec.md:175`). Approval leg: undefined
in the PR. In the VTI design, the approval leg is `task-consent/request` (VTA → Keyring) and
`task-consent/decision` (Keyring → VTA), "bound to the request's digest"
(`vti2823/docs/05-design-notes/hcp-tasks.md:111-118`), and Keyring "accepts it only for the VID and
`threadId` it scanned" (`hcp.md:159`). But at the pinned VTA, the `task-consent/request` document
carries no `threadId`, no `parentThreadId` and no `ceremony` — only `id, type, issuer, recipient,
issuedAt, payload` (`external/verifiable-trust-infrastructure/vta-service/src/trust_tasks/consent_request.rs:111-118`),
and the consent flow mints a correlator of its own, "not the digest"
(`policy_gate.rs:815-819`). Our plan leaves the carrier open: "the `threadId` in an effect or
`ext`" (`d3-plan-canvas/docs/plans/agent-connect-plan/2026-11-25-bam.md:186`). CONFIRMED.

**State.** Provider: the hold table keyed by `threadId` (`SCENARIO.md:99-101`; VTI `hcp.md:529`
`hcp_holds` "by (`threadId`, `issuer`)"); the pending consent keyed by digest (VTA). Client: the
thread and, after the grant, a wallet keyed by `grantId`.

**End states of a hold, as written** (`spec.md:171-178`, `:293`, `:299-301`, `:303-314`):

| What happened | What the client sees on its next resubmission | Thread afterwards |
|---|---|---|
| Person approved | the grant (for 1 hour; same grant) | after 1 h: `permissionDenied` |
| Person declined | `permissionDenied` | not stated |
| Unknown or unreachable person | next steps, then "the same `permissionDenied` a decline gets" | not stated |
| Provider abandoned the hold (VTA: 300 s, `hcp.md:304-306`) | a next step again: "a later resubmission is a new request, put to the person again" (`:178`) | re-opened as a new hold on the same `threadId` |

### 3(b) Revoke: `grants/revoke` → `grants/revoked` notice → acknowledgement → refusal of the next request

**Parties.** Management Client, Provider, Context Client. Three party pairs, two Trust Task
exchanges, plus an error on the client's own query thread.

- MC → P `hcp/grants/revoke` (request + empty `#response`); `threadId` "SHOULD be fresh per
  revocation" (`revoke/0.1/spec.md:233`).
- P → CC `hcp/grants/revoked#request`, only "if the client holds disclosed entries and has
  registered a notification endpoint" (`revoke:184`, `revoked:246`). Each delivery attempt is a
  fresh document with the same `threadId` and payload, so the same `noticeId`; at least 5 attempts
  over at least 1 hour; none later than 24 h after the first (`revoked:91`, `:247`).
- CC → P empty `#response` acknowledgement (`revoked:209-227`).
- CC → P next `hcp/entries/query` → `trust-task-error` `hcp:invalidToken` (SCENARIO step 5).

**Correlation today.** Only `grantId` in the payloads: "The `grantId` is known to the provider,
the Management Client and the affected Context Client, and appears in the revocation notice; it
joins the three documents by design" (`revoke:233`). Notice attempts are joined by `threadId` +
`noticeId` (`revoked:280`). The revoke and the notice are on different threads with no envelope
link. The refusal is joined to the grant only through the token, at the provider. CONFIRMED.

**State.** Provider: grant status, `grant.revoked` and `revocation.notified` audit events,
retry schedule. Client: processed `noticeId`s for ≥ 25 h (`revoked:248`). The person learns the
notice outcome only by pulling `hcp/disclosures/summary` (`notification: delivered|abandoned|none`,
`disclosures/summary/0.1/spec.md:173`); HCP 6.2.4 requires telling them when delivery is abandoned.

### 3(c) Onward sharing (`shares/report`)

**Parties.** Context Client and Provider only; "The organization told is named in the payload, not
as a party: it takes no part in the exchange" (`shares/report/0.1/spec.md:115`). The share itself
is off-protocol. The person's approval of `onwardSharing` happens at grant time (a separate
affirmative act, HCP 6.1.4).

**Correlation.** The report carries `recipient`, `refs`, `purpose`, `sharedAt`, `accessToken`
(`:119`); `refs` are grant-scoped (`:219`), the token names the grant. No `retrievalId`, no link
to the query thread. HCP's own report has the same fields and no `retrievalId` either (HCP 5.2.8,
`specification.md:1275-1290`), so the carriage is faithful. CONFIRMED.

**State.** Provider: `context.shared` audit event per report.

### 3(d) Export → import between two providers

**Parties.** Management Client, source provider, destination provider. The two providers never talk.

- MC → A `hcp/export` (response carries the whole export, ≤ 14 MiB; larger is `hcp:exportTooLarge`
  and goes over HCP's HTTP binding instead, `export/0.1/spec.md:67-78`).
- MC → B `hcp/import` (optionally `dryRun: true` first, `import:138`).

**Correlation.** None on the wire. "The exporting provider's signature does not travel with the
export ... this task carries only the inner `export`, under the importing Management Client's own
`proof`" (`import/0.1/spec.md:473`). A Management Client that wants evidence keeps the signed
export response itself. CONFIRMED.

**State.** A: `context.exported` event. B: `context.imported` event with per-entry outcomes.

### 3(e) Delegation lifecycle

- **Created** by the Authorization Service, not by any `hcp/*` task (HCP 17.2:
  "The Authorization Service establishes it"; a sub-delegation is appointed "at the Authorization
  Service, through a Management Client", HCP 17.10). There is no `hcp/delegations/create`.
  CONFIRMED.
- **Read** with `hcp/delegations/list`.
- **Ended** by `hcp/delegations/end` (MC → P) for relinquish / ended-by-subject / ended-by-delegate;
  by time or basis (expiry, majority, basis-ended) with **no document at all** (HCP 17.6).
- **Fan-out on end:** every grant under it ends; each client holding one gets `hcp/grants/revoked`
  with `reason: "delegation-ended"`; sub-delegations end (`delegations/end/0.1/spec.md:199-200`).
- **Correlation must not exist toward clients:** "A `delegationId` is the same in every grant made
  under the delegation, which is why HCP never shows it to a Context Client (HCP 17.4)"
  (`delegations/end:251`). CONFIRMED.

---

## 4. Could each be a ceremony later, with the `hcp/*` tasks exactly as proposed?

Short answer: **revoke** and **export → import** can, today, with no `hcp/*` change. **Connect**
can only by borrowing `task-consent/*` for the person's act, and then has three gaps the `hcp/*`
text could close cheaply now. **Delegation end** hits a framework format gap (one-to-many fan-out)
and a privacy constraint. **Onward sharing** is not ceremony-shaped and needs nothing.

### 4(a) Connect — obstacles

| # | Obstacle | Evidence | Fix now or later |
|---|---|---|---|
| C1 | The person's act is not a Trust Task in the suite. With `hcp/*` alone the definition has `ask` → `grant` and no step for the one event HCP cares most about (HCP 6.1.6). The definition must borrow `task-consent/request/0.1` + `decision/0.2`. | `grants/request:87`, `:180`; `SCENARIO.md:195` | Cheap now: one prose paragraph naming an exchange such as `task-consent` as one way, without requiring it |
| C2 | No link from the approval leg to the held thread. SPEC rule 3 names `threadId` or `parentThreadId`; the pinned VTA puts neither on `task-consent/request`, and our plan says "effect or `ext`". A verifier cannot tell from envelopes which hold a decision answered. | SPEC.md:779-780; `consent_request.rs:111-118`; `bam.md:186`; `hcp.md:159` | Cheap now: a SHOULD in `grants/request` that the approval exchange carries `parentThreadId` = the held `threadId` |
| C3 | No typed end for an abandoned hold; it is silently re-opened on the same `threadId`. The client cannot tell a continuing hold from a new one, so any `ceremony.enactment` it carries on resubmissions goes stale (an enactment is "never reused", SPEC.md:630). SPEC rule 5 says report `cancelled` where one can reply. | `grants/request:178`; SPEC.md:782, :1538 | Cheap now (see 4(a)-privacy below) |
| C4 | Decline reaches the client as `permissionDenied`, an error. In the shipped definitions an error never completes an enactment, so a declined connect can only be shown complete from the approval leg's `decision: deny` document, which the client never sees. This is consistent with SPEC's "command" deny form (SPEC.md:772, :807 "The grant is a command"), and needed for probe resistance. | `grants/request:288`, `:293`; vetting ceremony `request` step | No change; one sentence stating the deny form would help readers |
| C5 | `task-consent/decision` is `approve|deny` over the exact payload digest. HCP lets the person approve less than asked (`grant.access` "may be narrower than asked"), choose purposes when none were named, and elect persistence or onward sharing as separate acts. None of that fits `task-consent`. | `task-consent/_shared/0.1/task-consent.schema.json:82-83`; `grants/request:126-127`, `:222`, `:279` | Later (P1 approval task, or `task-consent` extension); V0 approves "as asked" (`SCENARIO.md:134`) |
| C6 | Resubmissions are unbounded (provider policy × `retryAfter`); `maxRounds` needs a constant. My draft had to pick 60. | `grants/request:177-178`; meta `:196` | Later (definition time); or say polls are not steps |
| C7 | The window is provider policy (hold length) plus the 1-hour collection window; `maxDuration` needs a constant. | `grants/request:178`, `:311-314` | Later |
| C8 | `hint.retryAfter` has no schema. `trust-task-next-step` says a producer "MUST validate it against the schema of the specification named in `typeUri` before use"; `grants/request`'s schema has no hint definition and is closed (`additionalProperties: false`, requires `access`). The demo reads it unvalidated (`demo.ts:559-561`). A typed hint is also where a hold deadline would go. | `trust-task-next-step/0.1/spec.md:126`; `grants/request/0.1/payload.schema.json` | Cheap now: a `$defs` entry for the hint |

**4(a)-privacy (from C3), read from the text.** As written, an unknown or unreachable person is
held and then refused with `permissionDenied` (`:301`), while a real person who was reached and
did not act is abandoned and **re-asked** on the next resubmission (`:178`), indefinitely. A client
that keeps polling can therefore tell "a real account whose person is not answering" (next steps
forever) from "unknown" (eventually refused). That is the probe `:301` sets out to prevent. It
also re-prompts the person each time the provider's hold lapses (300 s at the VTA). The same change
fixes C3, the probe, and the ceremony gap: answer the first resubmission after an abandoned hold
with the same `permissionDenied` a decline gets, and never re-open a thread that has ended.
The text is CONFIRMED; the probe is my inference from it, and I have not run it.

**What works already (CONFIRMED):** the hold is a next step with `continuation: resubmit` and the
decline is answered on the next resubmission, never as a further next step — exactly SPEC §8.6
and the §4.13.3 refer row. The resubmission match compares only `issuer` and payload, so a
`ceremony` member on the envelope (with a changing `round`) does not disturb it.

### 4(b) Revoke — workable now

All three steps are `hcp/*` tasks; the publication checks accept the draft (section 6).
Remaining points, none needing a change before 0.1:

- **R1. Delivery attempts:** each is a fresh document (new `id`), "at least 5" with no upper count,
  24 h cap. A definition must decide whether attempts are one step instance re-sent (same
  `round`) or rounds (needs a constant `maxRounds`). The verifier crate rejects two enumerated
  entries for one single-multiplicity step at one round (`lib.rs:597-607`), so a recorder would
  enumerate only the acknowledged attempt. Can wait; one sentence in `revoked` would settle it.
- **R2. Abandonment** after 24 h produces no document; only the `revocation.notified` audit event
  and the `disclosures/summary` state. So "revoke" is the safe completion, notify/acknowledge
  optional. Matches HCP's independence rule (`revoke:185`). Note only.
- **R3. The refusal of the next query** is an error on the client's own thread; not a step. Note.
- **R4. Linking:** a shared `enactment` would hand the Context Client a handle common with the
  Management Client's revoke; use `blinded`. Note.

### 4(c) Onward sharing — nothing to ask

A single bilateral report after an off-protocol act, correlated by grant-scoped `refs`, faithful to
HCP. Design note §13.6's reasoning applies: a definition "would add ceremony and subtract nothing".

### 4(d) Export → import — workable now as `chained`

Draft validates with steps `export`, `preview` (optional dry run), `load`; same Type URI for the last
two, told apart by step name (allowed, meta `:125`). Obstacles, none blocking:

- `ceremony.prev` on the import can name the export response by digest, which is the only wire
  link between the two exchanges; the destination can check it only if the Management Client
  hands it the signed export response, which `hcp/import` does not carry (`import:473`).
- An export over 14 MiB leaves Trust Tasks (`hcp:exportTooLarge` → HTTP binding), so that step
  could not be enumerated.
- The Management Client needs a token at each provider; no `hcp/*` task issues a Management
  Client its token (the demo issues it "at setup", `SCENARIO.md:79-80`).

### 4(e) Delegation — only the end is ceremony-shaped, and the format cannot express its fan-out

- **D1. One provider → N clients cannot be enumerated.** `perRole` varies the *issuer*; the notices
  all have the provider as issuer. Setting `perRole` on the notify step is rejected by the
  registry checker ("issuer role "provider" has cardinality one", section 6), and the verifier
  treats N notices at one step/round as one instance counted N times (`lib.rs:592-607`). Only the
  acknowledgements (issuer = each client) can be `perRole`. A framework format gap, not the PR's.
- **D2. No opening document** for creation (Authorization Service) or for time/basis endings.
- **D3. Linkability:** HCP 17.4 hides `delegationId` from clients because it links their grants.
  A shared `enactment` across the notices would recreate that link, so `blinded` is required. If
  per-grant child enactments were used instead, their common `parentEnactment` would link them; the
  `blinded` text covers `enactment` only (meta `:349-356`; SPEC.md:1892). Note for the framework.

---

## 5. Recommendation: what to ask of the PR now so ceremonies stay possible

Ask for four small, prose- or schema-only changes while `hcp/*` is still draft 0.1; none adds a
wire member and none touches the libraries. (1) In `hcp/grants/request`, add that where the
provider asks the person through a Trust Task exchange (for example `task-consent/request` and
`task-consent/decision`), the documents of that exchange SHOULD carry `parentThreadId` equal to the
held request's `threadId`, as SPEC §4.13.3 rule 3 and §4.9.2 describe, so the decision is tied to
the hold on the envelope and not only by a payload digest. (2) Give every hold exactly one end the
client sees: answer the first resubmission after an abandoned hold with the same `permissionDenied`
as a decline, and never re-open a thread that has ended (approved past the hour, declined,
abandoned). This closes the account probe the spec already tries to prevent, stops re-prompting
the person, and gives a ceremony a terminal document for every path. (3) Define the next step's
`hint` (at least `retryAfter`, optionally a hold deadline) as a schema in `hcp/grants/request`, so
timing is typed rather than prose and a client can validate it as `trust-task-next-step` requires.
(4) In `hcp/grants/revoked`, say delivery attempts are one step re-sent (not new rounds), and in
`hcp/grants/revoked` / `hcp/delegations/end` privacy text, say that no correlator may be shared
across the notices of different clients (HCP 17.4). Everything else can wait for whoever writes
the definitions: constants for `maxRounds` and `maxDuration`, an approval task that can carry
HCP's narrowing and separate acts, abort, and the framework's one-to-many fan-out gap. For
Keyring and VTI #2823 (not the PR): carry `parentThreadId` on `task-consent/request` and
`decision` rather than "an effect or `ext`", and decide what Keyring shows when the VTA's 300 s
hold lapses.

---

## 6. Experiment: draft definitions through the registry's own checks

Setup (scratchpad only; nothing installed into any repo):

```
S=<scratch>/ceremony-check
cp tt/scripts/validate-ceremonies.mjs $S/tool/validate.mjs   # SPECS pointed at tt/specs
cp tt/ceremonies/ceremony.meta.schema.json $S/root/ceremonies/
ln -s vectors/node_modules $S/tool/node_modules              # ajv, ajv-formats (read-only use)
```

Controls first: against the real `tt/ceremonies` it validates the 3 shipped definitions and
rejects 21/21 invalid fixtures (`--test`), so the copy behaves like the original.

Drafts (in `$S/root/ceremonies/hcp-draft/`): `connect` (7 steps: ask, hold, consult, approve,
decline, collect, grant; receipt; blinded; PT2H; `maxRounds` 60 picked arbitrarily), `revoke`
(revoke terminal, notify and acknowledge optional; receipt; blinded; P2D), `end-delegation`
(end, notify, acknowledge perRole; `context-client` cardinality many), `move-context` (export,
preview, load; chained). Result: **all four pass** ("Validated 4 ceremony definition(s)").

Negative controls (each must fail, and did):

- connect with `exposure.discloses: none` → `understates max() over steps ("secret")` — the floor
  comes from `hcp/grants/request`'s front matter;
- revoke with `sideEffects.level: mutating` → `understates ... ("destructive")` — from
  `hcp/grants/revoke`;
- end-delegation with `notify.multiplicity: perRole` → `issuer role "provider" has cardinality one`.

What this proves: the `hcp/*` front matter is readable by the ceremony tooling and the Type URIs
resolve. What it does not prove: the checker does not test projection or reachability
(design note §6.4 is not implemented in `validate-ceremonies.mjs`), and nothing here exercised a
wire, a receipt or the verifier crate.

Draft `connect` steps, for reference:

```json
"ask":     { "type": ".../hcp/grants/request/0.1#request",  "issuer": "context-client",   "recipient": "provider",          "prev": [] },
"hold":    { "type": ".../trust-task-next-step/0.1",        "issuer": "provider",         "recipient": "context-client",    "prev": ["ask"], "optional": true, "maxRounds": 60 },
"consult": { "type": ".../task-consent/request/0.1",        "issuer": "provider",         "recipient": "management-client", "prev": ["ask"] },
"approve": { "type": ".../task-consent/decision/0.2",       "issuer": "management-client","recipient": "provider",          "prev": ["consult"], "optional": true },
"decline": { "type": ".../task-consent/decision/0.2",       "issuer": "management-client","recipient": "provider",          "prev": ["consult"], "optional": true, "terminal": true },
"collect": { "type": ".../hcp/grants/request/0.1#request",  "issuer": "context-client",   "recipient": "provider",          "prev": ["ask"], "optional": true, "maxRounds": 60 },
"grant":   { "type": ".../hcp/grants/request/0.1#response", "issuer": "provider",         "recipient": "context-client",    "prev": ["collect", "approve"], "optional": true, "terminal": true }
completion: allOf[ask, consult, anyOf[allOf[approve, grant], decline]]
```

Three of the seven steps (`consult`, `approve`, `decline`) are not `hcp/*` tasks; that is
obstacle C1.

---

## 7. Keyring-side facts used above

- Keyring already emits and checks `ceremony.enactment` on its shared-connect flow
  (`d3-fast-send/packages/core/src/modules/trust-tasks/module/sharedConnectInvite.ts:211-216`,
  `sharedConnect.ts:474`), and already sends `parentThreadId` where a VTC requires it
  (`oobSignIn.ts:376-385`). So carrying either on the HCP approval leg is not new machinery.
  CONFIRMED.
- Keyring correlates consent today by `payloadDigest` (`consentCheck.ts:26`). CONFIRMED.
