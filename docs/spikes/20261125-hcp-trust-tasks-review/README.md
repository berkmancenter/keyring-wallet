# Review: HCP carried as Trust Tasks (trust-tasks-tf #1380–#1382, VTI #2823)

Alberto's review, 2026-11-25. The evidence for each statement is in this folder and in [`tsp-reference/ref-21-hcp-over-trust-tasks/`](../../../tsp-reference/ref-21-hcp-over-trust-tasks/).

## The short version

The proposal is sound and Keyring can work with it. Signing, canonical form, the document envelope and the error format all match what Keyring and the VTA do today, byte for byte where we could test it. Every HCP operation has a task. The 28 task schemas agree with HCP's own schemas except where the PR says they differ.

Nothing found blocks the idea. Six things should be settled before the specs are released at 0.1, because they are cheap now and expensive later:

1. **Governance tasks require an access token that Keyring will not have.** The specs make `accessToken` required on every governance request; Brendan's VTI design has Keyring send none until V1. Run as designed, Keyring's request is refused as malformed.
2. **The specs require an HCP discovery document a carriage-only provider cannot publish.** A client that follows the specs to the letter cannot send a token to the V0 or V1 VTA.
3. **A "no" from the person looks like any other refusal**, and a hold the provider gives up on is silently reopened on the same thread. The framework's own text on the PR branch says a decision should not be reported as `permissionDenied`.
4. **Nothing ties the approval on the phone to the held request.** The consent request has no member for the held request's thread, so Keyring cannot check "this is the connection I scanned" in a standard way.
5. **The token must stay out of the model, and nothing says so.** HCP's MCP binding forbids the token entering the model's context. The task family never cites that rule, and vta-mcp's generic call tool would pass the token through the model in both directions.
6. **The PR's TypeScript TSP library speaks an older TSP than the VTA.** An agent built on it could not reach today's VTA over TSP.

Two things are ours to fix in Keyring regardless (the consent check's exact type match, and how `sendTask` reads a held reply), and our plugin plan needs three additions before it can carry HCP through vta-mcp.

## How this was checked

- **The proposal, as is.** trust-tasks-tf #1380 at `94ed4200c` (28 `hcp/*` specs and the regenerated libraries), #1381 at `1b3ae9ed6` (declared unchecked rules), #1382 at `e163cac1d` (demos). HCP 2.0-draft-3 at `b790561`, the commit the PR cites. VTI design #2823 at `419d827`. VTI source at our pin `f7b78e29d`. Keyring at current `main`.
- **Brendan's own checks, re-run.** His TypeScript demo: 14 of 14 tests pass. His drift check: 38 differences, all 38 allowlisted.
- **A test program** that runs the proposal the way Keyring would, through a real mediator (section 2).
- **Six review tracks**, then verification: 110 findings, each checked by a separate reviewer who opened every cited line; the 43 findings we might raise were also checked by a second reviewer looking for counter-evidence. 2 findings were refuted and dropped, 1 was disputed and downgraded, and most of the rest were tightened; this document uses the corrected forms. A completeness pass then named 6 gaps and filled them (44 more findings, not separately re-verified; marked "gap pass" below).

Where a statement was read from source and not run, it says so.

## 1. Your eight questions

### (a) Does it cover HCP's core, profiles and bindings? Does it account for our MCP plugin?

**Core: yes, at the operation level.** Every context operation (HCP 5.2) and every governance operation (5.4) has a task, plus the delegation endpoints and the revocation notice. A few HCP acts have no task (keeping both entries in a conflict, declining a proposal); two of those have no HTTP endpoint in HCP either, and the PR lists them as not carried.

**Bindings: deliberately not carried.** HCP's HTTP Binding and MCP Binding are separate from this carriage. HCP, the specs and the VTI design agree that the Trust Task carriage cannot be claimed in `conformsTo`; a conformance claim needs a full HCP binding and a valid discovery document. Two consequences:

- **Raise (the most serious finding):** 27 of the 28 specs tell a client to check the provider's identity against the provider's HCP discovery document and its key set before sending a token. HCP's discovery schema requires at least one `conformsTo` entry and one binding. The VTI design publishes no discovery document in V0, and one with no `conformsTo` in V1. So a client following the specs cannot talk to the V0 or V1 VTA; the demo skips the check. Ask: define how a carriage-only provider proves its identity (for example, the notice key in its DID document).
- **Raise:** HCP Core itself (5.4) says governance operations travel only over HTTP. Whether a provider that carries governance over Trust Tasks can claim even Core depends on the editors' answer to question 37.

**Profiles: carried in the schemas, but the rules that come with them are thin** (gap pass). General Context is in the shared schema. Memory Manager (HCP 15) is reachable from `entries/create` but missing from `revise` and `import`. Two Health Context rules (16.2) are not stated: an issuer-attested health entry needs a credential, and an unconfirmed model-inferred health entry must not be disclosed. Nothing says that serving these tasks can still force a profile claim under HCP 18.1. None of this affects the demo, which accepts neither trigger.

**Our MCP plugin: not accounted for, and it is not an "HCP MCP binding".** HCP's MCP Binding is something a provider exposes (six `hcp_*` tools, a discovery extension). Our plugin running vta-mcp is an HCP *client* that tunnels Trust Tasks. That is allowed, but:

- HCP 10.5 says the access token must never enter the model's context or come back as tool content. The task family puts the token in the payload and never cites 10.5. Ask: restate 10.5 for any agent runtime that carries `hcp/*`.
- Questions 44, 45 and 47 (a local bridge over a non-HTTP carriage, who the Client Operator of a plugin is, MCP under First-Party) are exactly ours. They appear in no spec: only their titles are in #1380's description, and their wording is in the VTI design. Thirteen numbered questions in all are in no spec. Ask: publish the full question list in the repository.
- Question 46 (is sending disclosed context to a model API run by another company "onward disclosure"?) decides whether any plugin in a commercial host can be a Context Client at all. It should be asked first, with 37.

### (b) Signing, formats and canonical form, against Keyring and the VTA

**Compatible.** This is the best-tested part of the review.

- We took the demo's revoke request, put back the token its printout hides, and verified it with Keyring's own recipe. It verifies, and signing the same document with the same key and time gives the PR's signature byte for byte. Two controls fail as they should.
- Every verifier involved (the PR's TypeScript, Rust, Go and Dart libraries, and the VTA at our pin) accepts `authentication` or `assertionMethod`. Keyring already signs `hcp/*` requests with `authentication`, and already signs every document it sends its VTA.
- The envelope is the one Keyring sends today. Framework 0.6.0, which the specs target, is older than the text at our pin, and no envelope or proof rule changed in between. The `vnd.trusttasks.hcp-carriage` extension passes Keyring's checks.
- The token digest uses base64url where Keyring's digests use base58btc, but it is a record the provider keeps for itself and never goes on the wire. No conflict; Keyring needs no helper for it.
- Keyring's validator gives the reference verdict on 158 of 160 review vectors (gap pass). The 2 differences are purpose strings the PR's `format: uri` rejects, which Keyring's validator ignores.

To raise:

- **All 47 example proofs in the specs use `assertionMethod`.** The framework says a Trust Task proof should use `authentication`, and the PR's own libraries, its demo and the VTA all do. Ask: change the examples, or say which purpose each task expects.
- **The regenerated Go and Dart libraries drop a required `null`**, so they produce documents the PR's own schemas refuse (a persistent grant's `expiresAt`, for instance). The fixes exist as #1374–#1379 but are not in #1380. Ask: regenerate after they land and add a test per language. TypeScript is not affected.
- **The PR's TypeScript TSP library reads only pre-1.0 TSP** (gap pass, and we ran it: a frame marked 1.0 is not recognised). Keyring and the VTA at our pin speak TSP 1.0 to each other. Keyring is not affected, since it does not use that library, but an agent CLI built on it could not reach the VTA. It also means the test program's frames were the older format.
- **Size bounds are not delivery guarantees** (gap pass, computed not measured). A default mediator refuses any message over 1 MiB; most `hcp/*` bounds are 2 to 16 MiB. An export near its 14 MiB bound will not cross a mediator. Ask: say so in the binding or the shared conventions.

Keyring's own gaps, none caused by the PR: it uses VTA reply payloads without checking them against a schema and only logs the proof result; its reply verifier does not check the key is authorised for the proof's stated purpose; its validator ignores `date-time` and `uri` formats, so no HCP timestamp is actually checked.

### (c) JSON to JSON, and vectors

**Brendan's drift check holds, and it checks less than its name suggests.** Our own comparison reproduced all 38 of his allowlisted differences. It also found 301 more, because his tool by design does not compare bounds, patterns, formats, closed payloads or conditionals, and it does not run in CI.

| | Count |
|---|---|
| Schema pairings compared | 59 (his 55, plus 4) |
| Differences found | 339 |
| In his allowlist | 38 of 38 |
| Outside it | 301: 12 redundant, about 178 intentional size caps (about half documented), 111 that change meaning |
| Meaning-changing and undocumented | 64: 56 "must not be empty" rules, 4 merged unions, 2 dropped formats, 2 closed request roots |

Vectors:

- **HCP's examples against the proposed schemas:** 22 cases, 19 pass. The 3 failures are explained (two are open questions 42 and 11; one HCP placeholder fails HCP's own schema).
- **The proposal's documents against HCP's schemas:** 72 documents, all valid as Trust Tasks. Against HCP: 38 pass, 1 fails (the hard-delete result, question 11), 33 have no HCP schema.
- **Edge cases:** 40 cases and 26 string probes. The two schema sets disagree on 27; 11 of those are undocumented.
- **Live, in the test program:** the grant, entry, create request, query result, audit events and disclosure summary all validated against HCP's own schemas.

To raise: `entries/create` and `revise` refuse top-level custom entry members that HCP says a provider must preserve; #1381 misses one unchecked rule on query results; four URI members lose `format: uri`. For Keyring: a document that passes the Trust Task schema is not automatically valid HCP (15 HCP conditionals are prose-only, all listed in #1381), and `directives` can be `null`.

### (d) Do these work like ceremonies, and could they later?

**Not today, and yes later, without changing the task schemas.** A ceremony in this framework is a published description laid over existing tasks plus an optional `ceremony` member on each document. The `hcp/*` documents can carry that member now. We drafted four ceremonies (connect, revoke, end a delegation, move context between providers); all four pass the registry's own checker, and a run with the member on real documents changed no check (gap pass).

- **Revoke** and **export → import** work as written.
- **Onward sharing** is a single step and needs nothing.
- **Connect** works only by borrowing task-consent for the person's approval, which the specs leave to "the provider's own modality". Three things would make it clean, all cheap now:
  - link the approval exchange to the held request (`parentThreadId` set to the held thread; the framework already has the rule);
  - give every hold exactly one visible end: today an abandoned hold is reopened by the next resubmission, and the phone is asked again;
  - give the hold's `retryAfter` hint a schema. It is seconds in the hint and a timestamp in errors, and the four demo ports read it differently.
- **Ending a delegation** hits a limit of the ceremony format itself: one provider notifying many clients cannot be described, and those clients must not share an identifier.
- Open-ended polling conflicts with ceremonies' bounded rounds: the demo resubmits every second, so a 60-round limit covers about a minute.

One library gap: the PR's TypeScript reply builders drop the `ceremony` member where the Rust ones copy it.

### (e) Is the error handling compatible?

**Yes.** Every spec uses `trust-task-error/0.6`, which is identical at our pin and which Keyring and the VTA already speak. The specs use five standard codes and four of their own (`hcp:invalidToken`, `hcp:versionConflict`, `hcp:credentialInvalid`, `hcp:exportTooLarge`), mapped the same way in all 28. None breaks Keyring's code matching, none triggers its version step-down, and the "one fixed text for every refusal" rule fits how Keyring words failures. In the test program Keyring's reply reading turned `hcp:invalidToken` into a refusal with the code intact.

To raise:

- **The VTI design and the specs give different codes for a revoked grant.** The design says `scope-denied`, which is HCP's name and not a valid code on this wire; the specs send `hcp:invalidToken`. A client following the specs would not recognise the VTA's answer as a revocation.
- **A decline is reported as `permissionDenied`.** The framework text on the PR's own branch says a decision "MUST NOT" be reported that way. The neutral denial has a privacy reason (not revealing whether an account exists), but then the spec should say so, or report the decline in the response.
- **A 1-hour token under a 4-hour grant.** When the token expires the agent gets `hcp:invalidToken`, the same code as a revocation, and 0.1 has no refresh.
- `hcp:exportTooLarge` uses the family namespace for a code only one task uses.

Keyring work, not needed for the demo: `VtiRefusal` drops `retryable` and `retryAfter`; `sendTask` would read a held reply as a success. Keyring already answers task-consent requests and decisions, with one exception found by the test program (section 2, T5).

### (f) Is the MCP flow like how we connect to agent memory?

**No. They share the transport and the signing, and differ in everything that carries authority.**

| | Agent memory today (vta-mcp) | HCP as proposed |
|---|---|---|
| Who the agent is | A DID with an entry in the VTA's access list | A VID with **no** access-list entry |
| What authorises it | The access-list entry (role, contexts) | A grant, approved by the person each time |
| Token | None: every task is signed | An opaque access token in every payload, plus a signature |
| Purposes | Not carried at our pin | Required on every read |
| Store | `vta/memory/*` | A new, separate entry store |
| Revoke | Remove the access-list entry | Revoke the grant; the agent is sent a notice it must acknowledge |
| Held requests | None | The grant request is held and resubmitted on its thread |

What already fits: vta-mcp's signing, reply check and transport meet the specs' rules. What does not, read from source at our pin:

- `vta_call` takes only an operation and a payload, and every document gets a fresh id and no thread. **A held grant request cannot be resubmitted**; each retry would be a new request and a new prompt on the phone.
- A held reply comes back to the agent as if it were the answer.
- **The token would pass through the model** in both directions, which HCP 10.5 forbids.
- vta-mcp has no path for inbound messages, so it cannot acknowledge the revocation notice. (Downgraded on review: both designs put that receive loop in the agent client, not in vta-mcp.)
- Its guard would class `hcp/shares/report` and `hcp/entries/query` as read-only.

None of this stops the one-week demo, which sends the grant request over TSP from its own CLI. It does mean "the plugin reuses vta-mcp for everything on the VTA" (D40) does not extend to HCP unchanged.

Three identity questions follow (gap pass), and no document answers them:

- **One identity or two?** The VTI design says a Context Client must not hold an access-list entry. Our agent holds one, because rooms and memory need it. In the code at our pin a sender with an entry is admitted on that standing before any HCP hook would run.
- **A key swap strands the grant.** `acl/swap-key` moves only the access-list entry. The grant, token, hold and notice address stay with the old identity, and whoever holds the old key keeps the grant.
- **Disconnect must revoke both**, the access-list entry and the grant, and Keyring's agent record stores no grant id.

### (g) The five points our summary said we would raise

| Point | Verdict |
|---|---|
| The demo skips the person | **Holds.** In all four ports the approval is a function call that always approves; there is no decline state or test. This matches the specs, which deliberately have no task for the person's decision. The VTI design does require a decline test. |
| Question 37 matters most | **Holds, with a correction.** HCP puts governance on HTTP only, and 18 specs carry question 37. But adding a memory is a context operation, not governance: 37 does not cover it. Our summary page grouped it wrongly. |
| Every Keyring request must be signed | **Holds, and is not new:** Keyring already signs everything it sends its VTA. Checking it turned up the token conflict (short version, item 1). |
| The library fixes do not touch TypeScript | **Holds.** #1374–#1379 contain no TypeScript files. |
| HCP memories are a separate store | **Holds.** No document says whether `vta/memory/*` stays beside HCP entries, gets a bridge, or is migrated. |

### (h) Is the TypeScript a separate PR?

**No.** The generated TypeScript library is inside #1380 (under `trust-tasks-ts/`), and the TypeScript demo is inside #1382 (`examples/hcp-demo-ts`). Two things to know:

- The prebuilt modules in #1380 are marked deprecated: the supported way to get the types is to pin the `hcp/*` bundles and generate them, as the demo does.
- The HCP types are not on npm yet. Keyring pins `@openvtc/trust-tasks` 0.27.8, which is enough to generate them, but discovery 0.4 (which the specs use) needs a newer package.

Issue #1377's TypeScript row (a missing required field that allows `null` reads as `undefined`) matters to Keyring only where it does not validate replies.

## 2. The test program

[`tsp-reference/ref-21-hcp-over-trust-tasks/`](../../../tsp-reference/ref-21-hcp-over-trust-tasks/). Three throwaway `did:key` parties, each with its own socket on the ecosystem dev mediator, every document sealed as a TSP message in the PR's binding:

- a toy **VTA** following the specs and #2823's design, receiving through the PR's own TSP consumer (proof, freshness, replay, schema and size checks);
- the **agent**, using the PR's TypeScript libraries;
- **Keyring**, signing and verifying with Keyring's own `documentProof.ts` and `proofPurpose.ts`, and reading the consent request and replies the way `consentCheck.ts` and `VtaClient.sendTask` do.

The session: the agent asks for a grant; the VTA holds it and sends Keyring a signed consent request with HCP's checklist; Keyring checks it and shows the checklist and match code; the person approves; the agent resubmits and gets the grant; it reads context; Keyring adds a memory, lists grants, reads the audit and the disclosure summary, and revokes; the agent is told (twice, deduplicated) and its next request is refused. Then probes.

**Result: 31 of 37 checks as expected, through the live mediator (48 frames, largest 3,171 bytes).** The in-memory run gives the same result. The six that differ:

| # | What happened | Whose |
|---|---|---|
| T1 | A memory added with no `accessToken`, as the VTI design has Keyring do in V0, is refused `malformedRequest`. | The specs and the VTI design disagree |
| T2 | When the person declines, the agent gets the same `permissionDenied` as any refusal. | The specs |
| T3 | (From source.) Through vta-mcp, a held grant request cannot be resubmitted on its thread. | vta-mcp and our plugin plan |
| T4 | (From source.) vta-mcp reads a held reply as the answer. | vta-mcp and our plugin plan |
| T5 | Keyring refuses a consent request typed `…/request/0.1#request`. The framework says both forms must be accepted; Keyring compares exactly in three places. The VTA sends the bare form today, so nothing breaks yet. | Keyring; fixed on `fix/consent-request-type-forms` |
| T6 | Keyring's `sendTask` returns a held reply as the result. | Keyring; fixed on `fix/vta-held-reply-and-retry-fields` |

What the program does not prove: the real VTA (`vta-hcp` does not exist yet); Keyring's real transport (DIDComm v2 today, and in the VTI design); TSP 1.0 (the PR's library, used for every party, writes the older format); Keyring's real key store, screens or biometric; load or network faults.

It also turned up a fault in our own ladder. The dev mediator was re-created on 2026-09-27 under a new DID, and `ref-04` and `ref-06x` still default to the old one, which no longer resolves. Pointing `ref-04` at the new DID is not enough: it authenticates and sends, but its routed frame is not delivered within 20 seconds, while direct frames are (as `ref-21` shows). Neither older rung is changed by this review.

## 3. Everything to raise, by where it goes

### To Brendan, on trust-tasks-tf #1380 (the specs)

| # | Ask | Kind |
|---|---|---|
| A1 | Resolve the Management Client token with the VTI design: a task that issues one, or a DID-proven form where `accessToken` is optional. | Decision |
| A2 | Say how a carriage-only provider proves its identity without an HCP discovery document. | Decision |
| A3 | In `grants/request`: report a decline in a way the framework allows, or say why not; give an abandoned hold one end and never reopen an ended thread. | Decision |
| A4 | In `grants/request`: the approval exchange carries `parentThreadId` equal to the held thread. | Small text change |
| A5 | Give the hold hint a schema and one unit for `retryAfter`. | Small schema change |
| A6 | Restate HCP 10.5: the token never reaches a model or tool results. | Small text change |
| A7 | Publish the numbered question list with full wording; put 37 and 46 first. | Small addition |
| A8 | Change the 47 example proofs to `authentication`, or name the expected purpose per task. | Mechanical |
| A9 | `tokenExpiresAt` should equal the grant's expiry in 0.1, or allow re-issue. | Small text change |
| A10 | Rename `hcp:exportTooLarge` to a task-local code. | Mechanical |
| A11 | Restore `format: uri` on four members; note that top-level custom entry members cannot be written through create and revise. | Mechanical, plus one sentence |
| A12 | Profile rules: name HCP 15, 16.2 and 18.1 where they bind. | Small text changes |
| A13 | State that declared size bounds are not delivery guarantees across a mediator. | One sentence |
| A14 | State that a new identity is a new client and needs a new grant. | One sentence |
| A15 | Regenerate Go and Dart after #1374–#1379, with a required-`null` test each. | Sequencing |

### On #1381 and #1382

| # | Ask | Kind |
|---|---|---|
| B1 | #1381: add the missing unchecked-rule entry on `entries/query` results. | Mechanical |
| B2 | #1382: add a decline to the scenario and each port. | Test addition |
| B3 | #1382: move the TypeScript TSP library to TSP 1.0, or state which revision it implements. | Decision |
| B4 | TypeScript reply builders: copy the `ceremony` member, as Rust does. | Mechanical |

### To Brendan, on VTI #2823 (the design)

| # | Ask |
|---|---|
| C1 | What does Keyring put in `accessToken` in V0? (Same decision as A1.) |
| C2 | Use the specs' error codes on the wire: `hcp:invalidToken` and `permissionDenied`, not `scope-denied`. |
| C3 | Where the held request's thread goes in the consent request (`parentThreadId` is the framework's answer). |
| C4 | Publish the effect kinds and detail shapes for the HCP checklist; how a narrower approval reaches the VTA. |
| C5 | May one identity hold both an access-list entry and an HCP grant? State that a key swap never moves a grant. |
| C6 | Does `vta/memory/*` stay beside HCP entries, get a bridge, or migrate? |
| C7 | List held-reply support in vta-sdk and vta-mcp as work, or say the plugin does it alone. |
| C8 | Is vta-mcp a client bridge or a provider front end for HCP's MCP binding? |
| C9 | Can Keyring's own governance tasks be held, and as an error or as a next step? |

### Keyring's own work

| # | Change | When |
|---|---|---|
| K1 | Accept the `#request` form of the consent request in all three compares. | Done on `fix/consent-request-type-forms` |
| K2 | `sendTask`: recognise a held reply; keep `retryable` and `retryAfter` on `VtiRefusal`. | Done on `fix/vta-held-reply-and-retry-fields` |
| K3 | Validate VTA reply payloads against their schema and act on the proof result for `hcp/*` replies. | With the HCP client work |
| K4 | Bind the proof's key to its stated purpose in `verifyTrustTaskProof`. | With K3 |
| K5 | Store the grant id on the agent record; disconnect revokes the grant, then the access-list entry. | With the HCP client work |
| K6 | `ref-04` and `ref-06x`: the dead dev-mediator DID, and `ref-04`'s routed frame not arriving on the current mediator. | Needs its own look; not a one-line change |

### Our agent-connect plan

| # | Change |
|---|---|
| P1 | D40 ("the plugin reuses vta-mcp for every operation on the VTA") does not extend to HCP as vta-mcp stands: no thread, no held-reply handling, token through the model. Record it, with the three vta-mcp changes needed. |
| P2 | Record the identity question (one identity or two), the key-swap effect, and disconnect revoking both. |
| P3 | Refresh the companion's citations of the specs (stale commits; one line moved). |

### Corrections to our own summary page

- Adding a memory is not covered by question 37.
- "52 assumptions" should read "53 numbered questions, 13 of which appear in no spec".
- The point about the token digest is withdrawn.

## 4. What the review led to

| Where | What | State on 2026-11-25 |
|---|---|---|
| This repository | K1: the `#request` form of a consent request, branch `fix/consent-request-type-forms` | Prepared, with tests and a control |
| This repository | K2: a held reply is not a result, and refusals keep their retry members, branch `fix/vta-held-reply-and-retry-fields` | Prepared, with tests and a control |
| The agent connect plan (PR #1030) | The HCP specification pinned; the requirements the HCP companion leans on quoted; §11 Q11 and Q12 (P1, P2) | Prepared as commits on that branch, in the companion `docs/plans/agent-connect-plan/2026-11-25-al.md` |
| trust-tasks-tf #1380, #1381, #1382 | The mechanical corrections (A5's schema, A8, A10, A11, B1, B4), each its own commit on the pull requests' branches | Being prepared; the record is added to `notes/` when done |
| trust-tasks-tf #1380, #1382 and VTI #2823 | The decisions and questions of section 3, as one comment per pull request | Drafted |

## Where everything is

- The test program: [`tsp-reference/ref-21-hcp-over-trust-tasks/`](../../../tsp-reference/ref-21-hcp-over-trust-tasks/), with its frozen report in `fixtures/`.
- The review notes, one per track, and the gap pass: [`notes/`](./notes/).
- Every finding with its evidence and its reviewers' verdicts: [`notes/findings.json`](./notes/findings.json) (154 findings: 110 verified, 44 from the gap pass).
- The schema comparison and the vector tests: [`vectors/`](./vectors/) (scripts, and their outputs in `vectors/out/`). `HCP_REVIEW_ROOT` points the scripts at a folder holding the proposal as `tt/` and `tt-drift/` and HCP's spec as `hcp-spec/`.
- The four draft ceremonies and the copy of the registry's checker they were run through: [`ceremonies/`](./ceremonies/).
- In the notes, `<review>` is that working folder, `<keyring>` a checkout of this repository at `main` `c65701c91`, and `external/` the pinned upstream clones.
