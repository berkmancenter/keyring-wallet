# The five points we said we would raise, and the TypeScript question

Track: verify the summary's five points (P1 to P5) against source, and answer "is the TypeScript a separate PR?".
Read-only review. Sources read: the PR checkout at `tt` (branch pr1382, head e163cac1d; pr1380 at 94ed4200c and
pr1381 at 1b3ae9ed6, all three equal to the GitHub heads today), HCP at b790561 (`hcp-spec`), VTI #2823 docs
(`vti2823`), the VTI pinned clone at f7b78e29d, our framework pin 2a66a0351, Keyring at `d3-fast-send`
(5daeba0d0), and our plan at `d3-plan-canvas`. GitHub was read with `gh pr view`, `gh api …/pulls/<n>/files`
(paginated) and `gh issue view` only.

Paths below are relative to: `tt/` = `<review>/tt`,
`hcp/` = `…/d3-hcp-review/hcp-spec/spec/2.0-draft-3`, `vti2823/` = `…/d3-hcp-review/vti2823`,
`vti/` = `<keyring-main-checkout>/external/verifiable-trust-infrastructure`,
`fw/` = `<keyring-main-checkout>/external/dtgwg-trust-tasks-tf`,
`kr/` = `<keyring>`, `plan/` = `…/d3-plan-canvas/docs/plans`.

## Verdict per point

| Point | Verdict |
|---|---|
| P1 "The demo skips the person" | **Confirmed.** No Management Client approves or declines; the person's approval is an in-memory function call that always approves; no test or state for a decline in any of the four ports. Add: this is faithful to the suite, which by design has no task for the person's decision; VTI #2823 fills the gap with `task-consent`, and its own work package A3 does require a decline test. |
| P2 "Question 37 carries the most weight" | **Confirmed, with one correction.** HCP says governance goes over HTTP only (quotes below). Revoke, audit and the disclosure summary Keyring polls are governance and carry question 37. **Add-memory (`hcp/entries/create`) is not governance.** It is a context-plane operation and does not carry question 37. |
| P3 "Every Keyring request must now be signed" | **True but not new for Keyring.** All 28 `hcp/*` requests require a proof; Keyring already signs every document it sends to its VTA (`authentication` purpose). The real new burden is that **every governance request also requires `accessToken`**, and VTI #2823 V0 gives Keyring no token. That conflict is the thing to raise. |
| P4 "The library fixes don't touch TypeScript" | **Confirmed.** #1374, #1375, #1376, #1378, #1379: 0 TypeScript paths across 184 files (full paginated lists). Issue #1377's TS row is real but harmless for Keyring as long as Keyring checks `=== null` or validates replies. |
| P5 "The HCP entry store is separate from VTA memory" | **Confirmed.** `hcp_entries` is a new keyspace; `vta/memory/*` lives in the `memory` keyspace under ACL `act`. Neither #2823 nor our companion says how or whether they merge. |
| TypeScript question | **No separate TypeScript PR.** The TS is inside #1380 (41 generated files under `trust-tasks-ts/`) and #1382 (`examples/hcp-demo-ts`, the first port and the source of the shared golden transcript). |

---

## P1. The demo skips the person

Claim checked: in #1382 the provider holds the grant request and grants it on resubmission; no Management Client
approves or declines it.

What the code does:

- The decision is a direct state change inside the provider, "in the provider's app":
  `tt/examples/hcp-demo-ts/src/demo.ts:435-439`
  `/** The person decides, in the provider's own modality (here: approves at once). */ personApproves(threadId) { this.held.get(threadId)!.state = "approved"; …`
- The hold has three states only, no declined state: `demo.ts:145` `state: "pending" | "approved" | "granted";`.
  Same in every port: Go `hcp-demo-go/demo.go:165-169` (`pending`, `approved`, `granted`), Rust
  `hcp-demo/src/lib.rs:204-211` (`Pending`, `Approved`, `Granted {…}`), Dart `hcp-demo-dart/lib/demo.dart:207`
  `String state = 'pending'; // 'pending' → 'approved' → 'granted'`.
- The README says it outright: `tt/examples/hcp-demo-ts/README.md:100` "There is no consent UI. The person's decision
  is one function call, and it always approves what was asked." (Same line in the Rust, Go and Dart READMEs.)
- The Management Client party appears only for revoke (step 4, `demo.ts:582-587`) and, in tests 7, 8 and 14, as a
  wrong or unregistered issuer. It never sees or answers the grant request.
- Tests: SCENARIO.md "Tests every port has" (`SCENARIO.md:236-274`) lists 14 tests. All four ports have exactly
  those 14 (`hcp-demo-ts/test/demo.test.ts`, `hcp-demo/tests/demo.rs` t01-t14, `hcp-demo-go/demo_test.go`
  Test01-Test14, `hcp-demo-dart/test/demo_test.dart` 1-14). **None declines.** None covers "unknown `subjectHint`
  held then refused" or "hold abandoned" either.
- No typed declined outcome exists, and by design there should not be one: `specs/hcp/grants/request/0.1/spec.md:288`
  "| The person declined (HCP 6.1.7) | `permissionDenied` |" and `:293` "Every `permissionDenied` carries the same fixed
  `message`, whatever the reason …, so a client cannot tell a decline from an unknown person." The response schema
  description repeats it: "a decline is trust-task-error permissionDenied — never this shape."

Disproof attempt (is the skip a defect of the demo, or of the suite?):

- The suite has **no task by which a Management Client approves or declines** a held request, on purpose:
  `grants/request/0.1/spec.md:171` "The act belongs to a third party, the person, and the provider offers no task by
  which the client could learn the outcome" and `:180` "The person's decision never travels through the client."
  None of the 28 slugs is an approve or decide task (listed: `find specs/hcp -name spec.md`).
- HCP itself has no approval operation either: the request is left to the authorization profile (HCP 6.1.7,
  `hcp/specification.md:1604-1610`), and a decline "is not itself a security-relevant event"
  (`specification.md:1610`).
- So the demo is faithful to the suite. What it leaves out is exactly Keyring's role.

Where Keyring's role is designed: VTI #2823 uses the existing task-consent path.
`vti2823/docs/05-design-notes/hcp.md:112` "Management Client (HCP Client, 3.2.3), and the consent surface | **Keyring** …
Governance tasks, and every approval"; `:289-292` "V->>K: task-consent/request, VTA-signed … P->>K: approves with a
biometric … K->>V: task-consent/decision, signed by the admin DID"; `:306` "a decline answers `permissionDenied`".
`task-consent/decision` 0.2 has a deny value: `fw/specs/task-consent/_shared/0.1/task-consent.schema.json:82`
`"enum": ["approve", "deny"]`. VTI work package A3 requires a decline test: `hcp-tasks.md:117-118` "a decline answers
`permissionDenied`".

Ask (raise): add a decline to the shared scenario (the person declines; the next resubmission gets the same fixed
`permissionDenied`; no grant, no `grant.issued`), and ideally the "unknown person held then refused" case, since the
spec requires the two to look identical. Showing the Management Client as consent surface is optional (the suite
leaves the modality to the provider); saying in the README that a real provider puts the request to the person's
Management Client (in VTI: task-consent to Keyring) would stop readers taking the demo as the whole flow.

## P2. Question 37 carries the most weight for us

What HCP says (CONFIRMED, quoted):

- `hcp/specification.md:90` (1.6 table, Governance row) "… | A Management Client acting for the Authorizing Principal
  … | HTTP only |".
- `:92` "Core restricts governance operations to a Management Client acting for the Authorizing Principal …, and the
  MCP Binding carries none of them".
- `:1296` (5.4) "Governance operations are performed only by a Management Client acting for the Authorizing
  Principal …, and are carried only by the HTTP Binding".
- `:2054` (9.1) "The HTTP Binding is also the only binding that carries governance operations".
- `:2493` (10.1) "grant management, the audit log, export, hard deletion, confirmation, and category changes are
  reached through the HTTP Binding … or the person-facing capabilities required by 18."
- `:96` (1.6) "Where that interface is an HCP Client, it reaches governance operations as a Management Client over
  the HTTP Binding. A provider whose only binding is MCP … offers those capabilities through its own person-facing
  interface rather than through an HCP binding."

What the PR says for question 37 (CONFIRMED): `specs/hcp/grants/revoke/0.1/spec.md:207` "**Question 37 — governance
over a carriage other than the HTTP Binding.** HCP carries governance operations only over its HTTP Binding (HCP 1.6,
5.4, 9.1, 10.1). This specification takes it that another carriage, here a Trust Task, may carry them where the caller
is a Management Client acting for the Authorizing Principal (HCP 6.1.9), and applies every rule HCP places on the
operation unchanged". The same text is in `audit/read/0.1/spec.md:318`. The PR body lists it as family-wide: "a carriage
other than the HTTP Binding carrying governance operations (37)".

Which specs carry question 37: exactly 18, the PR's "Governance plane (18)": `grants/{list,revoke}`, `audit/read`,
`disclosures/summary`, `export`, `import`, `entries/{hard-delete,confirm,set-categories,restrict-purposes}`,
`rules/{list,set,remove}`, `directives/{list,set,remove}`, `delegations/{list,end}`.

Correction: **add-memory is not on that list.** `hcp/entries/create` is a context operation (HCP 1.6 Context row,
`specification.md:89`, "Bindings: HTTP and MCP"; and `:92` "A Management Client can also perform context
operations."). It carries no question 37. So for Keyring in V0, question 37 decides revoke, the audit read, the
disclosure summary Keyring polls for the notice state (`hcp.md:387-390`), and the agent list (grants/list). It does
not decide "add a memory".

Nuance worth knowing (note): HCP 10.1 and 18.4 give a second door: the person-facing capabilities "MUST be available
through at least one modality the implementation supports" (`specification.md:3493`), and "An implementation exposing
the HTTP Binding MAY provide these capabilities through a Management Client over that binding" (`:3507`). If the
editors answer 37 "no", Keyring as the VTA's own admin app might still be read as the provider's person-facing
interface rather than an HCP Client. But `:96` says an interface that *is* an HCP Client goes over HTTP, and #2823
casts Keyring as an HCP Client (`hcp.md:112`). Which reading the editors take is UNVERIFIED. The other fallback is the
VTA's HTTP Binding (V1, `hcp-plan.md:71`).

Is "most weight" right? Reasonable. 37 covers every Keyring governance call. Questions 22 (issuer VID is the client id)
and 53 (proof on every token request) also bind Keyring, but they are carriage rules Keyring already meets.

## P3. Every Keyring request must now be signed

Specs (CONFIRMED): every one of the 28 `hcp/*` specs declares `proofRequirement.request: REQUIRED` (front matter of
each `specs/hcp/**/0.1/spec.md`; tabulated with a script). 26 of them also require `accessToken` in the request
schema's top-level `required` (all except `grants/request`, which has no token yet, and `grants/revoked`, the
provider's notice). PR body: "Every `hcp/*` request that carries `accessToken` (26 specs) REQUIRES a request proof".
The rule's text: `grants/revoke/0.1/spec.md:208` "**Question 53 — a request proof on every request that carries a
token.** A request `proof` is **REQUIRED** on every `hcp/*` request that carries `accessToken` … stricter than HCP's
bearer model". So the summary's wording is right, and it is in fact all 28.

Keyring (CONFIRMED): every document Keyring builds for its own VTA is signed.

- `kr/packages/core/src/modules/trust-tasks/module/VtaClient.ts:1919-1934` `sendTask`:
  `const document = await signDocumentProof(this.agent, { id, type, threadId, payload, issuer: did, recipient:
  this.vtaDid, issuedAt, ...documentExtras }, did, { proofPurpose: purposeForDocumentType(type) })`, then sent over
  TSP (`:1987`) or DIDComm (`:1993-2003`) with that signed document as the body.
- The TSP probe (`auth/whoami`) is signed the same way: `VtaClient.ts:1565-1578`.
- Purpose: `module/proofPurpose.ts`: `assertionMethod` only for request documents of `auth/step-up/approve-response`,
  `task-consent/decision` and `confirm/response`; `authentication` for everything else. Every `hcp/*` request would
  be signed `authentication`, eddsa-jcs-2022 (`packages/trust-tasks/src/documentProof.ts:265-278`).
- Unsigned paths: `relayConsentRequests` (`VtaClient.ts:2115-2135`) forwards VTA-signed consent requests unchanged to
  other approvers, not Keyring's own documents and not to the VTA. Other unsigned-looking sends in the module go to
  the mediator (`VtiMediatorTransport.ask`), communities (`vtiAgent.ts`), or peers (`sharedConnect*`), not the VTA.
  I found no path that sends an unsigned document to the VTA. (I checked every `sendTo`/`sendTspFrame` call outside
  tests; I did not prove that nothing else talks to the VTA.)

So signing is not a new burden. What is new:

1. **The token (blocker for #2823 V0 as written).** Every governance request requires `accessToken`:
   `grants/revoke/0.1/spec.md:118` "`grantId`, the grant to end, and `accessToken`, the Management Client's token.
   Both are REQUIRED." (likewise `audit/read`, `disclosures/summary`, `grants/list`: all have `accessToken` in
   `required`). #2823 says Keyring sends none in V0: `hcp.md:158` "Keyring → VTA | DIDComm authcrypt from the admin
   DID, a required document proof by that DID, the ACL admin role; no token (§4.4) | Dedicated management tokens
   (V1)", and `:591` lists it as a divergence. The VTA validates every payload with a published schema
   (`vti/vta-service/src/trust_tasks/mod.rs:605-633`, `validate_payload` → `against_schema`), and SPEC §7.2 item 2
   requires it. So a token-less Keyring revoke is refused `malformedRequest` by a conforming VTA. Neither document
   says what Keyring puts in `accessToken` in V0. Ask Brendan: mint a management token for Keyring in V0, or make the
   suite accept a DID-proven Management Client without one (and say how), or ship V0 with a VTA schema that differs
   from the suite's (which breaks "pins the family as frozen").
2. **Example proofs use `assertionMethod` (raise, small).** Every `hcp/*` spec's examples show `"proofPurpose":
   "assertionMethod"` (all 28 specs), while the framework says a producer SHOULD sign `authentication` and SHOULD NOT
   sign `assertionMethod` unless the spec defines the proof as an attestation (`tt/SPEC.md:374`; same at our pin
   `fw/SPEC.md:373`). No `hcp/*` spec requires a purpose, the demo signs `authentication` (14 proofs in the golden
   transcript), and Keyring signs `authentication`. Not an interop break (a consumer checks whichever relationship
   the proof names, `SPEC.md:376`), but the examples should match, or the spec should say which purpose.
3. **Keyring must verify the reply proofs (Keyring-side note).** Many `hcp/*` responses require a proof (e.g.
   `audit/read` and `disclosures/summary` `response: REQUIRED`), and SPEC §7.2 item 7 rejects a document lacking a
   required proof. Keyring today only logs: `VtaClient.ts:2090-2092` "Keyring logs the verdict first, off the answer's
   path, and refuses nothing yet." For the HCP lane Keyring should refuse an unsigned or unverified `hcp/*` reply.
4. **Token binding and key swap (note, UNVERIFIED impact).** The suite refuses a token "issued to a client other than
   the one the `issuer` VID identifies" (`grants/revoke/0.1/spec.md:227`). Keyring swaps its manager key
   (`acl/swap-key`, `VtaClient.ts:186`, `:769-810`). Once V1 management tokens exist, a token bound to the
   pre-swap DID would be refused unless the VTA rebinds it on swap.

## P4. The library fixes don't touch TypeScript

File lists (CONFIRMED, `gh api --paginate repos/trustoverip/dtgwg-trust-tasks-tf/pulls/<n>/files`; each count equals
the PR's `changedFiles`):

| PR | Title | Files | TypeScript paths |
|---|---|---|---|
| #1374 | build(go…)!: require Go 1.24 | 12 | 0 (`trust-tasks-go/*`, two Go examples, `.github`, `docs/packages/go.md`) |
| #1375 | feat(go): add trusttasks.Nullable | 4 | 0 (`trust-tasks-go/trusttasks/*`) |
| #1376 | feat(go-bindings)!: keep absent, null and a value apart | 144 | 0 (135 `trust-tasks-go/specs`, Go generator, `docs/runtime-parity.md`, `CLAUDE.md`, `website/assets/libraries.js` Go text) |
| #1378 | fix(go): write a required nullable member's null | 13 | 0 (Go generator and specs, `docs/runtime-parity.md`) |
| #1379 | fix(dart)!: write a required nullable member's null | 11 | 0 (`trust-tasks-dart/*`, Dart build script, `docs/runtime-parity.md`) |

The only TypeScript mention is doc text in the `docs/runtime-parity.md` row they add or edit, which says TS already
keeps all three states: "yes: plain JSON, `label?: string | null` …, `did: string | null` …; `_runtime/canonical.ts:37`
drops only `undefined`" (#1376's patch). #1380's own row agrees: "yes: generated types are interfaces over the parsed
JSON value, which passes through as received", and its "Known limitations" names only Rust, Go and Dart.

Issue #1377 (CONFIRMED, open, by the same author): its table has "| TypeScript | `did === undefined` | plain JSON, no
decode step; the type says `string \| null`, which hides the difference |", and the proposed TS fix is "Document that
the caller must validate the payload, or add a guard if the TS runtime ever gets typed decoding."

Does it matter for Keyring? Only in one narrow way (note):

- The issue's five named members (`vta/contexts/update-did` `did`, `vtc/vetting/hidden/{publish,show,withdraw}`
  `requirementsDigest`) are not read by Keyring from those tasks: Keyring's `requirementsDigest` comes from the join
  manifest (`kr/.../module/joinManifest.ts`), and the hidden-vetting prefix in `vtiAgent.ts:669-674` is used only for
  log redaction. No Keyring code sends or reads `update-did`.
- The `hcp/*` family adds many required-nullable members: `Grant.expiresAt` (null = persistent),
  `ClientSummary.usableUntil`, five `AuditEvent` members, `DelegationTerm.endsAt`, `restrict-purposes`
  `permittedPurposes`, query/get `directives` (from the schemas, and #1380's runtime-parity row). The TS types say
  `expiresAt: string | null` (`tt/trust-tasks-ts/src/_shared/components.ts:13741`), `usableUntil: string | null`
  (`hcp/disclosures/summary/0.1/payload.ts:94`).
- Keyring does not schema-validate VTA replies: `VtaClient.ts:2105-2110` returns `(body?.payload ?? body) as T`.
  So a reply that wrongly drops `expiresAt` would read as `undefined`, and code that tests `== null` or falsiness would
  treat the grant as persistent. Risk is low in practice: the VTA is Rust, and #1380's row says Rust writes "a
  required nullable member … an `Option` written `null`".
- Sending side is safe in TS: a required `T | null` member must be present for `tsc`, and `JSON.stringify` writes
  `null`.
- Keyring action (no ask of the PR): in the HCP lane, validate `hcp/*` replies with the Ajv validator Keyring already
  has (`packages/trust-tasks/src/validator.ts`) and test with `=== null`.

## P5. Memories: the HCP entry store is separate from VTA memory

CONFIRMED.

- #2823's keyspace table adds a new store: `vti2823/docs/05-design-notes/hcp.md:530` "| `hcp_entries` | Entries, with
  linear versions | Backed up |" (with `hcp_grants`, `hcp_tokens`, `hcp_tombstones`, `hcp_holds`, `hcp_directives`,
  `hcp_notices`, `:524-532`).
- VTA memory is the existing `memory` keyspace: `vti/vta-keyspaces/src/lib.rs:142-146` "Per-context key/value store for
  AI-agent memory (`vta/memory/{put,list,delete}/0.1`). One record per `(contextId, key)` pair … `pub const MEMORY: &str
  = "memory";`". Its authority is the ACL: "`vta/memory/*` is gated on `require_context(contextId)`"
  (`vti/docs/02-vta/examples/agent-memory-with-vta-mcp.md:40`). HCP entries' authority is the grant.
- #2823 never mentions `vta/memory/*` or the `memory` keyspace (grep of `hcp.md`, `hcp-plan.md`, `hcp-tasks.md`,
  `tasks/hcp-demo-plan.md`: no hits). The only "memory" in it is the demo's person-declared entry
  (`tasks/hcp-demo-plan.md:118` "The person adds a memory. In Keyring: "I'm vegetarian" (`hcp/entries/create`,
  `person-declared`)") and the V3 Memory Manager Profile (`hcp.md:322-325`, agent-written `model-inferred` entries).
- Our companion keeps them apart on purpose: `plan/agent-connect-plan/2026-11-25-bam.md:94` "**What does not change:**
  the ACL, `vta/memory/*`, rooms, the VDC and the chat." Our plan's base path memory is VTA contexts plus
  `vta/memory/*` under the ACL `act` list (`plan/agent-connect-plan.md:762-770`, §3.15, D31).
- Do they merge later? **No document says how.** The nearest is our companion's P1 work package C10 "memories on HCP
  (the memories list by `entries/get`, Delete memory … by `entries/withdraw`, edit by `entries/revise`)"
  (`2026-11-25-bam.md:386`, `:407`) and C12 "the two connect paths merged" (`:409`). Neither says what happens to
  existing `vta/memory/*` items, nor whether the P1 plugin (B7, Context Client, `entries/query`) stops reading
  `vta/memory/*`. #2823 lists C10 only as outside work (`hcp-plan.md:71`).

Ask (raise): ask Brendan whether `vta/memory/*` stays the agent's own working memory beside HCP entries, gets a
bridge, or is migrated into `hcp_entries` (and if so, under which declaration type: an agent-written item is
`model-inferred`, which needs the Memory Manager Profile, V3).

## Is the TypeScript a separate PR? (the user's question)

No. CONFIRMED with `gh pr list --author bmiller59 --state open`:

- trustoverip/dtgwg-trust-tasks-tf: #1382, #1381, #1380 (the HCP stack), #1379 (Dart), #1378, #1376, #1375, #1374 (Go),
  and #904 (proof-of-understanding, unrelated). No TypeScript PR.
- OpenVTC/verifiable-trust-infrastructure: #2823 only (docs).

Where the TypeScript lives:

1. **#1380, the generated TypeScript library.** 41 files under `trust-tasks-ts/`: the 28 payload modules
   `trust-tasks-ts/src/hcp/<slug>/0.1/payload.ts`, 10 shared modules `trust-tasks-ts/src/hcp/_shared/0.1/*.ts`,
   `src/_shared/components.ts`, `src/index.ts` (+114 lines, the prebuilt exports, each marked `@deprecated` in favour
   of generating with `@openvtc/trust-tasks-gen`), and `component-names.lock.json`. The PR body: "Regenerated libraries:
   Rust …, TypeScript, Go and Dart, all generated" and "TypeScript: `tsc --noEmit` clean and `npm test` 285/285."
2. **#1382, the TypeScript demo.** `examples/hcp-demo-ts/` (`src/demo.ts`, `test/demo.test.ts`, `SCENARIO.md`,
   `transcript.golden.txt`, its pinned bundles and lock). It is the first port; the Rust, Go and Dart ports copy its
   golden transcript. CI runs it from `.github/workflows/ts.yml` ("HCP demo: generate, build, run and test").
3. **#1381** has no TypeScript.
4. TypeScript also appears, as text only, in issue #1377's table and in `docs/runtime-parity.md` rows.

For Keyring (note): the HCP TS types are not on npm yet. `trust-tasks-ts/package.json` is 0.31.8 at both main and
pr1380; npm has 0.31.9; Keyring pins `@openvtc/trust-tasks` `npm:0.27.8` (`kr/package.json:132`). The PR adds no
version bump ("the Release PR assigns those"). So Keyring's C0 ("an HCP client with `trust-tasks-ts` types from the
suite as frozen at X0", `hcp-plan.md:117`) means either a big version jump to the release that carries `hcp/*`, or
generating the pinned tasks with `trust-tasks-gen-ts` from a lock, as the demo does (`examples/hcp-demo-ts/package.json`
`"generate": "trust-tasks-gen-ts --lock trust-tasks.lock --out src/trust-tasks"`).
