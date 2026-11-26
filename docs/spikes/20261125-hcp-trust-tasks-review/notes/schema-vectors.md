# HCP vs the proposed hcp/* Trust Task schemas: schema comparison and vector tests

Track: JSON-to-JSON schema comparison and vector tests. Read-only review of trustoverip/dtgwg-trust-tasks-tf
#1380 (specs), #1381 (uncheckedRules) and #1382 (demos), against HCP 2.0-draft-3 at loyalagents/hcp-spec b790561.
Written 2026-11-25.

## What was compared, and how

- **HCP side.** `hcp-spec/schemas/2.0-draft-3/*.json` and `operations/*.json` at b790561 (HEAD of the local clone,
  clean). Every concrete JSON example in `spec/2.0-draft-3/specification.md` and `guides.md`.
- **TT side.** `tt-drift/specs/hcp/**` (branch pr1380, 94ed4200c). The schemas are byte-identical on pr1381 and
  pr1382 (`git diff --stat pr1380 pr1381 -- 'specs/hcp/**/*.json'` is empty); #1381 changes only spec.md front
  matter. #1381's `uncheckedRules` were read with `git show pr1381:<path>`: 114 entries in 16 specs
  (`vectors/out/unchecked-rules-1381.json`), the number the PR states.
- **Validators.** Ajv 2020-12 with ajv-formats (`vectors/validators.mjs`). HCP schemas are registered under
  their own `$id`. TT schemas are registered under their file URL, as the framework itself does in
  `scripts/lib/spec-examples.mjs:131-134` ("The published `$id` names the registry URL, against which the
  relative on-disk `$ref`s do not resolve; the file URL does."). So anyone who validates the published TT
  schemas by `$id` must do the same, or use bundles. That holds for the whole registry, not only hcp/*.
- **Structural comparison.** The previous agent's `compare.mjs` and `lib.mjs`, unchanged except that each
  difference now records both schema locations. It re-ran to the same 339 differences.
- **Reproduce.** `vectors/run-all.sh`. Every output named below is in `vectors/out/`.

## 1. The mapping, checked first

The previous agent's 59 pairings (`vectors/mapping.mjs`) are the PR's own 55 (`scripts/lib/hcp-drift-map.json`),
plus 4 of its own:

| added pairing | judgement |
|---|---|
| `hcp/entries/hard-delete` response ↔ `operations/withdraw-result.json` | Fair: HCP 9.4.5 shows one result for DELETE and withdraw. The PR lists this side `notCompared` (Q11) and documents its own shape (`hard-delete/0.1/spec.md:113`, `:162`). Kept, marked documented. |
| `hcp/grants/request` `access[]` ↔ `common.json#/$defs/accessDetail` | Approximate: the task carries no HCP operation (`grants/request/0.1/spec.md:65`) and HCP has no request schema. Every difference is documented and consistent with HCP prose. Class (a). |
| `hcp/grants/request` `requestingParty` ↔ `grant.json#/properties/requestingParty` | Same as above. |
| `hcp/grants/request` response `grant` ↔ `grant.json` | Exact (spec.md:96: "HCP's grant object, whole and unrenamed"). No differences beyond the shared Grant's. |

No difference below comes from a wrong pairing. Coverage: 422 distinct node pairs, and 50 of 55 HCP schema units
reached. The five not reached are `discovery.json`, `error.json` and `problem.json` (not carried; TT uses
trust-task-error), `minimization-report.json` (an `allOf` alias of `common.json#/$defs/minimization`, which is
compared), and `common.json#/$defs/credential` (reached only inside HCP conditionals, which TT does not carry).

## 2. How the PR's drift check treats bounds

`scripts/lib/hcp-drift.mjs:23-27` says: "Not compared: bounds (`minItems`, `maxLength`, ...), `pattern`,
`format`, `additionalProperties: false` on our closed payloads, and the conditionals (`if`/`then`/`else`, `not`,
`contains`) the framework's generators cannot express." So the tool ignores every bound, in both directions:
upper and lower, framework or not. It compares only member presence, required, types, nullability, enums and
`{required}` alternatives. Its output: 38 differences, all 38 allowlisted, 0 stale
(`out/their-drift-verbose.txt`). The tool is "Not part of `npm run check` or CI: it needs an HCP checkout"
(`scripts/check-hcp-drift.mjs:22`).

The framework does ask for upper bounds: free-text members MUST declare `maxLength` (SPEC.md:2223, §7.3 item 19).
The schema-bounds lint (`scripts/lib/schema-bounds.mjs` header) asks for request-side array `maxItems`, `limit`
`maximum` and `cursor` `maxLength`. Nothing in the framework asks for a lower bound.

## 3. The 301 differences outside the PR's list, classified

Script: `vectors/classify.mjs` → `out/classified.json`, `out/classified.md`. Every lower bound, closed root,
union and format was decided by running both validators on a probe value, not by reading.

| class | count | what it is |
|---|---|---|
| ok (redundant) | 12 | 9 `minLength: 1` where HCP's own pattern or enum already refuses `""`. `Entry.type` `minItems: 1`, which HCP's `contains ContextEntry` already implies. `Delegation.scope.actions` `maxItems: 2`, the size of its unique 2-value enum. Revise's `not subject/classification`, which TT's closed root enforces (vector: both reject). |
| (a) intentional, documented | 90 | 71 upper bounds whose TT description says "framework bound", or derives the bound from HCP (`AuditEvent.disclosed` 20, HCP 7.2). 12 bounds on grants/request, where HCP has no request schema to narrow. 4 grant-request closed objects. The grant-request `purposes`, `purposes[].description` and `notTo` differences (documented at spec.md:126 and in the `OnwardSharingRequest` description; consistent with HCP 6.1.5.2, specification.md:1584). |
| (b) intentional, undocumented | 88 | Upper bounds only: 54 × `maxLength` 2048 (every URI, Category, PurposeCode, identifier), 9 × 1024, 8 × 4096, 3 × 256, 3 × 253, 1 × 64 (`Content.language`), 10 × `maxItems` 1 000 000 and 2 × 100 000 on export arrays, 2 × 64. Each follows the framework rule; no description says so. Across all 117 `maxLength` differences in (a) and (b), a probe one character over the cap is refused by TT and accepted by HCP in 106; the other 11 fail both sides on pattern first. |
| (c) meaning-changing | 111 | 47 documented, 64 undocumented. Broken down below; every item is listed with both schema paths at the end of this file. |

The (c) items, by kind:

- **c1. Lower bounds (67).** TT adds `minLength: 1` (or `minItems: 1`) where HCP's schema accepts `""` or `[]`.
  11 are documented: `query.categories` under Q42, and 10 members (the AuditEvent identifiers and `eventType`,
  `Named.name`, the grant's `subject.id`) whose description says "The minLength and maxLength are framework
  bounds". 56 are undocumented: identifiers such as `subject.id`,
  `client.id`, `setBy`, `ref`, `outcomes[].reason`. Each refuses only the empty value. That is low risk, but it
  is a real narrowing, and the PR's drift check cannot see it because it compares no bounds.
- **c2. HCP schema rules TT does not check (16).** 15 HCP conditionals: content profile, model-inferred
  confidence, VC credential, one `content` evidence item, proposal only on `contradicts`, `ContextEntry` in
  `type`, grant `expiresAt` by `grantType`, delegation basis, import `rejected` → `reason`. Plus hard-delete's
  `exactly one of (ref | entryId)`. All are documented: the TT description says so (for example "This rule is
  stated here and not as a schema conditional: the registry's Rust generator does not support
  `if`/`then`/`else`") and #1381 lists them. One placement is missing from #1381 (finding F3).
- **c3. Closed payload roots (17).** HCP's request and result schemas are open, and TT's payload roots are
  `additionalProperties: false`. The shared HCP objects inside are open on both sides: `Entry`, `Content` and
  the rest are `additionalProperties: true` in TT. 15 follow the framework norm (SPEC.md:1217, §7.3 item 4).
  2 are undocumented and collide with an HCP MUST: the **create and revise request roots** (finding F1).
- **c4. Unions and a format (6).** HCP writes Category, `Directive.action` and `Delegation.relationship` as
  `anyOf [slug or enum | format:uri + pattern]`. TT writes one pattern and drops `format: uri`. `AuditEvent.purpose`
  (and the import copy of it) drops `format: uri` too, while the shared `PurposeCode` keeps it. Across 26 string
  probes (`out/vectors-edge.txt`, groups union and format), the two sides agree on 19 and differ on 7. All 7
  are a non-URI such as `x:<y>` or `a:%zz`, which HCP refuses and TT accepts. None is documented (finding F4).
- **c5. hard-delete response (5).** TT requires `entryId` and `hardDeleted: true`, and has no `status` or `ref`.
  HCP's withdraw-result requires `status`. This is documented as pending Q11.

## 4. Vector test HCP → TT

Script `vectors/vectors-hcp-to-tt.mjs` → `out/vectors-hcp-to-tt.txt`. 22 cases from 15 concrete HCP examples. The
mapping is mechanical: the path parameter moves into the payload, `accessToken` is added, `timestamp` is renamed
`respondedAt`, and a result is wrapped in its member. Two cases are derived: an HCP entry turned into a create
request, and an entry as a Management Client get-entry result. The control (HCP's own schema) passes on 17 cases,
fails on 1, and 4 have no HCP schema (prose only).

| result | cases | cause |
|---|---|---|
| TT pass | 19 | including query request/result, the disclosed entry, revise, withdraw, confirm, set-categories, restrict-purposes, import result, report sharing, the revocation SET mapped to hcp/grants/revoked, the 11.4 and G2.2 entries and the create requests made from them, and the 14.2 VC Evidence content |
| TT fail | 3 | (1) 9.4.2 get-entry result (`specification.md:2156`): "must have required property 'directives'". HCP's own example omits it; TT requires it (Q42, allowlisted). Passes once `directives: []` is added. (2) 9.4.5 result with `hardDeleted: true`, mapped to hcp/entries/hard-delete: "must NOT have additional properties (status)", the Q11 shape. Passes with `status` dropped. (3) 9.4.11 import request: HCP's example has `"export": {}`, a placeholder that **fails HCP's own schema too** (HCP's tools/check_schemas.py:193 treats it as a template). Not a finding. A full export made from the 11.4 entry passes both sides (edge vector). |

Templates (placeholders, 18 of them) were checked member by member against the TT schema
(`out/template-members.txt`). Every member name HCP's templates use is declared by TT, or falls inside an object
TT leaves open (`narrowedTo`, the credential, `conversion.unmapped`). None would be refused.

## 5. Vector test TT → HCP

Script `vectors/vectors-tt-to-hcp.mjs` → `out/vectors-tt-to-hcp.txt`. 72 hcp/* documents: 10 from
`examples/hcp-demo-ts/transcript.golden.txt` and 62 from the fenced examples in `specs/hcp/**/spec.md`. Each is
stripped of `accessToken` (and `ext` on the import result), has `respondedAt` renamed `timestamp`, and is
unwrapped, then validated against HCP.

- TT control: 72 of 72 pass.
- HCP: 38 pass, 1 fails, 33 have no HCP schema for that side (path or query parameters, 204 answers, the SET).
- The one failure: `specs/hcp/entries/hard-delete/0.1/spec.md:166`, "must have required property 'status'". It is
  the documented Q11 shape. An implementation that serves both bindings must add `status: "deleted"` on the
  HTTP side.
- The transcript's query response carries two real disclosures (not an empty list), so its pass means
  something.

## 6. Edge vectors

Script `vectors/vectors-edge.mjs` → `out/vectors-edge.txt`. There are 40 edge vectors plus the 26 string probes;
the full table is at the end of this file. On 20 of the 40, HCP and TT disagree:

- **Temporary grant without `expiresAt`:** both reject (both list it as required). **Temporary with `null`**, and
  **persistent with an instant:** HCP rejects, TT accepts. #1381 lists the rule (grants/list, read-own, request).
- **Both `ref` and `entryId`:** on the get and withdraw requests, both accept, because HCP's request schemas do not
  check it either. On the withdraw result, HCP rejects (`oneOf`) and TT accepts. #1381 lists all three (Q6).
- **Required-nullable, absent vs null.** TT has 11 required-and-nullable members. Get/query result `directives`:
  absent → TT rejects, HCP accepts (Q42). `null` → HCP rejects ("must be array"), TT accepts (Q5). So a TT
  Management Client result does not validate against HCP's schema unchanged. `AuditEvent.entryId` absent → TT
  rejects, HCP accepts (Q42); null → both accept. All documented.
- **Entry without `ContextEntry`**, **model-inferred with confidence null**, and **General Context content without
  `value`:** HCP rejects, TT accepts. #1381 lists each.
- **Standing rule with neither `operators` nor `requires`:** the shared rule and the rules/set response → HCP
  rejects, TT accepts. #1381 lists it. The rules/set request → TT rejects, because that schema has the `anyOf`.
  An import whose export holds such a rule → HCP rejects, TT accepts. #1381 lists it.
- **Query with empty `categories`:** HCP accepts, TT rejects (Q42, documented).
- **Size:** 257 categories, a 2049-character purpose URI, 65 evidence items on create, and a 65-character
  `content.language` → HCP accepts, TT rejects. 21 query results → both reject (HCP 7.2 caps it in HCP's schema
  too). `maxEntries: 1000` → both accept (TT adds no `maximum`; the provider returns at most 20).
- **Create request with an entry member HCP does not define** → HCP accepts, TT rejects (finding F1). The same
  member on a stored Entry → both accept.
- **Disclosed VC evidence item without `credential` in a query result** → HCP rejects, TT accepts, and #1381 does
  not list it for query (finding F3). Control: with a credential present, both accept.

## 7. #1381 coverage, checked as a walk

Script `vectors/unchecked-coverage.mjs` → `out/unchecked-coverage.txt`. It walks every TT payload (request and
`$defs/Response`) through its `$ref`s, and records each place a shared object that carries an HCP schema rule is
embedded, as the payload-schema pointer #1381 uses for `member`. There are 91 sites; 90 match a #1381 entry
exactly, and 1 is missing:

`hcp/entries/query` `/$defs/Response/properties/entries/items/anyOf/0/properties/evidence/items/allOf/0/properties/credential`.
That is the VC-credential rule on a *disclosed* evidence item. `hcp/entries/get` lists that same placement
(`pr1381:specs/hcp/entries/get/0.1/spec.md:78`). Query lists only the whole-Entry branch, `anyOf/1`
(`pr1381:specs/hcp/entries/query/0.1/spec.md:96`).

The other 24 #1381 entries are rules from HCP's prose or the carriage's own rules (Q6 ref/entryId, Q7, `assertedBy.id`,
`onwardSharing` sensitivity, `provenance` only with `read`, `categoryMap` keys, the import `ext`). They are not
HCP schema rules, so this walk does not pair them.

## 8. Also seen: HCP's own MCP tools take another shape

`vectors/vectors-mcp.mjs` → `out/vectors-mcp.txt`. HCP 10.3 publishes an `inputSchema` for six MCP tools. The TT
request examples, stripped of `accessToken`, pass `hcp_queryContext`, `hcp_getEntry`, `hcp_withdrawEntry` and
`hcp_reportSharing`. They fail `hcp_createEntry`, which requires the flat `categories`, `declarationType` and
`sourceContext`, and `hcp_reviseEntry` ("/content must be string"). That is HCP's own split between its HTTP and
MCP shapes, not the PR's. It matters to us because vti-agent-connect reaches the VTA over MCP (`vta-mcp`).

## Findings

- **F1 (raise).** The create and revise request roots are closed (`entries/create/0.1/payload.schema.json:7`,
  `entries/revise/0.1/payload.schema.json:7`: `"additionalProperties": false`). So a client cannot write an entry
  member HCP does not define. HCP 4.2 says "An HCP Provider MUST preserve members of an entry that this
  specification does not define and MUST NOT interpret them" (specification.md:783; A.3 row at :3938). Nothing in
  either spec.md mentions this. Vector: HCP create-request accepts a top-level custom member, and TT refuses it
  ("must NOT have additional properties"). The gap is only at the top level: TT's `record`, `subject` and
  `classification` on create are open (`entry-write.schema.json` `CreateRecord` and the others are
  `additionalProperties: true`), and a create carrying `record.metadata` passes both sides (vector). Ask: say in
  the field mapping that top-level custom entry members cannot be written through the carriage, and where they go
  instead, or open the root to them.
- **F2 (note).** The drift check ignores bounds, patterns, formats, closedness and conditionals by design
  (hcp-drift.mjs:23-27). Of the 301 differences outside its list, 293 are of kinds it does not compare. The other
  8 are member, required and enum differences on the 4 pairings it does not map (hard-delete response,
  grants/request). Among the 293, 56 are undocumented lower bounds that refuse `""`, and 88 are undocumented
  upper bounds. Ask (optional): a one-line
  statement in the family that "every `maxLength`/`maxItems`/`minLength: 1` not in HCP is a framework bound", or a
  bounds-aware mode in the drift check.
- **F3 (raise, small).** #1381 misses one placement: the disclosed-evidence credential rule in the
  `hcp/entries/query` result (see section 7). Vector: HCP rejects, TT accepts, nothing lists it.
- **F4 (raise, small).** Category, `Directive.action`, `Delegation.relationship` and `AuditEvent.purpose` drop
  `format: uri`, and TT accepts `x:<y>` and `a:%zz`, which HCP refuses. TT `common.schema.json:24` Category pattern
  `^([a-z][a-z0-9_]*|[a-zA-Z][a-zA-Z0-9+.-]*:\S+)$` carries no format; `PurposeCode` (`:32`) keeps
  `"format":"uri"`. Undocumented. Ask: add `format: uri` to these members, as HCP has it, or say why it is left out.
- **F5 (note).** The hard-delete result has no `status` (Q11). It fails HCP's withdraw-result on that one member.
  Documented; HCP's answer is pending.
- **F6 (note).** `directives: null` (Q5) and required `directives` (Q42) make get/query results differ from HCP's
  schema in both directions. Documented and allowlisted.
- **F7 (ok).** The vector tests confirm compatibility in every other case: all 72 TT examples, all 22 mapped HCP
  examples except the 3 explained ones, all 18 HCP templates by member name, and the shared objects being open
  like HCP's.
- **F8 (note, framework-wide).** Published TT `$id`s do not resolve the relative `$ref`s
  (spec-examples.mjs:131-134). Keyring must load the schemas by file or bundle, not by fetching `$id`.

## Limits

- The comparison follows the previous agent's shape folding (`lib.mjs` `absorb`). A rule HCP writes with a
  keyword that folding does not read could be missed; I did not cross-check its rule count against a raw keyword
  count.
- `ajv-formats`' `uri` decides what "URI" means in the probes. HCP's own tools use Python jsonschema's
  FormatChecker, which may judge some edge strings differently.
- Documentation was looked for in schema descriptions (the member, its `$ref` chain and its parent) and by grep
  in spec.md. A sentence elsewhere could document a bound I counted as undocumented.
- Nothing was run in tt-drift beyond reading. The PR's drift output is the previous agent's run
  (`out/their-drift.txt`).

## Appendix A: every (c) difference, with both schema paths

#### c1. Lower bounds TT adds that reject a value HCP's schema accepts (empty string or empty array) (67)

| # | TT object, member | difference | documented | TT schema (specs/hcp/) | HCP schema (schemas/2.0-draft-3/) |
|---|---|---|---|---|---|
| 1 | _shared:MinimizationReport `method` | minLength: TT 1, HCP (none) | no | `_shared/common.schema.json#/$defs/MinimizationReport/properties/method` | `common.json#/$defs/minimization/properties/method` |
| 2 | _shared:EvidenceItem `type` | minLength: TT 1, HCP (none) | no | `_shared/context-entry.schema.json#/$defs/EvidenceItem/properties/type` | `common.json#/$defs/evidenceItem/properties/type` |
| 3 | _shared:ClientDescription `id` | minLength: TT 1, HCP (none) | no | `_shared/context-entry.schema.json#/$defs/ClientDescription/properties/id` | `common.json#/$defs/clientDescription/properties/id` |
| 4 | _shared:ClientDescription `name` | minLength: TT 1, HCP (none) | no | `_shared/context-entry.schema.json#/$defs/ClientDescription/properties/name` | `common.json#/$defs/clientDescription/properties/name` |
| 5 | _shared:ClientDescription `operator.id` | minLength: TT 1, HCP (none) | no | `_shared/context-entry.schema.json#/$defs/ClientDescription/properties/operator/properties/id` | `common.json#/$defs/named/properties/id` |
| 6 | _shared:ClientDescription `operator.name` | minLength: TT 1, HCP (none) | no | `_shared/context-entry.schema.json#/$defs/ClientDescription/properties/operator/properties/name` | `common.json#/$defs/named/properties/name` |
| 7 | _shared:Entry `record.provenance.assertedBy.id` | minLength: TT 1, HCP (none) | no | `_shared/context-entry.schema.json#/$defs/Provenance/properties/assertedBy/properties/id` | `entry.json#/properties/record/properties/provenance/properties/assertedBy/properties/id` |
| 8 | _shared:Entry `record.provenance.assertedBy.via.id` | minLength: TT 1, HCP (none) | no | `_shared/context-entry.schema.json#/$defs/Provenance/properties/assertedBy/properties/via/properties/id` | `entry.json#/properties/record/properties/provenance/properties/assertedBy/properties/via/properties/id` |
| 9 | _shared:Entry `record.provenance.authorizedUnder` | minLength: TT 1, HCP (none) | no | `_shared/context-entry.schema.json#/$defs/Provenance/properties/authorizedUnder` | `entry.json#/properties/record/properties/provenance/properties/authorizedUnder` |
| 10 | _shared:Entry `record.provenance.confirmations[].confirmedBy.id` | minLength: TT 1, HCP (none) | no | `_shared/context-entry.schema.json#/$defs/Provenance/properties/confirmations/items/properties/confirmedBy/properties/id` | `entry.json#/properties/record/properties/provenance/properties/confirmations/items/properties/confirmedBy/properties/id` |
| 11 | _shared:Entry `record.provenance.recordedByProvider` | minLength: TT 1, HCP (none) | no | `_shared/context-entry.schema.json#/$defs/Provenance/properties/recordedByProvider` | `entry.json#/properties/record/properties/provenance/properties/recordedByProvider` |
| 12 | _shared:Entry `record.provenance.source` | minLength: TT 1, HCP (none) | no | `_shared/context-entry.schema.json#/$defs/Provenance/properties/source` | `entry.json#/properties/record/properties/provenance/properties/source` |
| 13 | _shared:Entry `record.relationships[].assertedBy.id` | minLength: TT 1, HCP (none) | no | `_shared/context-entry.schema.json#/$defs/Relationship/properties/assertedBy/properties/id` | `entry.json#/properties/record/properties/relationships/items/properties/assertedBy/properties/id` |
| 14 | _shared:Entry `record.relationships[].proposal.entry` | minLength: TT 1, HCP (none) | no | `_shared/context-entry.schema.json#/$defs/RecordedProposal/properties/entry` | `entry.json#/properties/record/properties/relationships/items/properties/proposal/properties/entry` |
| 15 | _shared:Entry `record.relationships[].proposal.proposedBy.id` | minLength: TT 1, HCP (none) | no | `_shared/context-entry.schema.json#/$defs/RecordedProposal/properties/proposedBy/properties/id` | `entry.json#/properties/record/properties/relationships/items/properties/proposal/properties/proposedBy/properties/id` |
| 16 | _shared:Entry `record.relationships[].proposal.weighed[]` | minLength: TT 1, HCP (none) | no | `_shared/context-entry.schema.json#/$defs/RecordedProposal/properties/weighed/items` | `entry.json#/properties/record/properties/relationships/items/properties/proposal/properties/weighed/items` |
| 17 | _shared:Entry `record.relationships[].target` | minLength: TT 1, HCP (none) | no | `_shared/context-entry.schema.json#/$defs/Relationship/properties/target` | `entry.json#/properties/record/properties/relationships/items/properties/target` |
| 18 | _shared:Entry `subject.id` | minLength: TT 1, HCP (none) | no | `_shared/context-entry.schema.json#/$defs/EntrySubject/properties/id` | `entry.json#/properties/subject/properties/id` |
| 19 | _shared:Entry `type[]` | minLength: TT 1, HCP (none) | no | `_shared/context-entry.schema.json#/$defs/Entry/properties/type/items` | `entry.json#/properties/type/items` |
| 20 | _shared:Disclosure `provenance.submittedBy.name` | minLength: TT 1, HCP (none) | no | `_shared/disclosure.schema.json#/$defs/DisclosedProvenance/properties/submittedBy/properties/name` | `disclosure.json#/properties/provenance/properties/submittedBy/properties/name` |
| 21 | _shared:Disclosure `provenance.submittedBy.operator` | minLength: TT 1, HCP (none) | no | `_shared/disclosure.schema.json#/$defs/DisclosedProvenance/properties/submittedBy/properties/operator` | `disclosure.json#/properties/provenance/properties/submittedBy/properties/operator` |
| 22 | _shared:Disclosure `relationships[].target` | minLength: TT 1, HCP (none) | no | `_shared/disclosure.schema.json#/$defs/DisclosedRelationship/properties/target` | `disclosure.json#/properties/relationships/items/properties/target` |
| 23 | _shared:Named `id` | minLength: TT 1, HCP (none) | no | `_shared/grant.schema.json#/$defs/Named/properties/id` | `common.json#/$defs/named/properties/id` |
| 24 | _shared:Named `name` | minLength: TT 1, HCP (none) | yes | `_shared/grant.schema.json#/$defs/Named/properties/name` | `common.json#/$defs/named/properties/name` |
| 25 | _shared:AccessDetail `onwardSharing.domains[]` | minLength: TT 1, HCP (none) | no | `_shared/grant.schema.json#/$defs/OnwardSharing/properties/domains/items` | `common.json#/$defs/accessDetail/properties/onwardSharing/properties/domains/items` |
| 26 | _shared:AccessDetail `onwardSharing.notTo[]` | minLength: TT 1, HCP (none) | no | `_shared/grant.schema.json#/$defs/OnwardSharing/properties/notTo/items` | `common.json#/$defs/accessDetail/properties/onwardSharing/properties/notTo/items` |
| 27 | _shared:Grant `authorizingPrincipal.delegation` | minLength: TT 1, HCP (none) | no | `_shared/grant.schema.json#/$defs/AuthorizingPrincipal/properties/delegation` | `grant.json#/properties/authorizingPrincipal/properties/delegation` |
| 28 | _shared:Grant `authorizingPrincipal.id` | minLength: TT 1, HCP (none) | no | `_shared/grant.schema.json#/$defs/AuthorizingPrincipal/properties/id` | `grant.json#/properties/authorizingPrincipal/properties/id` |
| 29 | _shared:Grant `client.id` | minLength: TT 1, HCP (none) | no | `_shared/grant.schema.json#/$defs/GrantClient/properties/id` | `grant.json#/properties/client/properties/id` |
| 30 | _shared:Grant `requestingParty.id` | minLength: TT 1, HCP (none) | no | `_shared/grant.schema.json#/$defs/RequestingParty/properties/id` | `grant.json#/properties/requestingParty/properties/id` |
| 31 | _shared:Grant `subject.id` | minLength: TT 1, HCP (none) | yes | `_shared/grant.schema.json#/$defs/GrantParty/properties/id` | `grant.json#/properties/subject/properties/id` |
| 32 | _shared:StandingRule `setBy` | minLength: TT 1, HCP (none) | no | `_shared/standing-rule.schema.json#/$defs/StandingRule/properties/setBy` | `standing-rule.json#/properties/setBy` |
| 33 | _shared:Directive `setBy` | minLength: TT 1, HCP (none) | no | `_shared/directive.schema.json#/$defs/Directive/properties/setBy` | `directive.json#/properties/setBy` |
| 34 | _shared:Delegation `basis.description` | minLength: TT 1, HCP (none) | no | `_shared/delegation.schema.json#/$defs/DelegationBasis/properties/description` | `delegation.json#/properties/basis/properties/description` |
| 35 | _shared:Delegation `basis.establishedBy` | minLength: TT 1, HCP (none) | no | `_shared/delegation.schema.json#/$defs/DelegationBasis/properties/establishedBy` | `delegation.json#/properties/basis/properties/establishedBy` |
| 36 | _shared:Delegation `delegate.id` | minLength: TT 1, HCP (none) | no | `_shared/delegation.schema.json#/$defs/Delegation/properties/delegate/properties/id` | `delegation.json#/properties/delegate/properties/id` |
| 37 | _shared:Delegation `subject.id` | minLength: TT 1, HCP (none) | no | `_shared/delegation.schema.json#/$defs/Delegation/properties/subject/properties/id` | `delegation.json#/properties/subject/properties/id` |
| 38 | _shared:AuditEvent `eventType` | minLength: TT 1, HCP (none) | yes | `_shared/audit-event.schema.json#/$defs/AuditEvent/properties/eventType` | `audit-event.json#/properties/eventType` |
| 39 | _shared:AuditEvent `participants.authorizingPrincipal.id` | minLength: TT 1, HCP (none) | yes | `_shared/audit-event.schema.json#/$defs/AuditParty/properties/id` | `audit-event.json#/properties/participants/properties/authorizingPrincipal/properties/id` |
| 40 | _shared:AuditEvent `participants.clientOperator.id` | minLength: TT 1, HCP (none) | yes | `_shared/audit-event.schema.json#/$defs/AuditParty/properties/id` | `audit-event.json#/properties/participants/properties/clientOperator/properties/id` |
| 41 | _shared:AuditEvent `participants.initiator.id` | minLength: TT 1, HCP (none) | yes | `_shared/audit-event.schema.json#/$defs/AuditParticipants/properties/initiator/properties/id` | `audit-event.json#/properties/participants/properties/initiator/properties/id` |
| 42 | _shared:AuditEvent `participants.model.id` | minLength: TT 1, HCP (none) | yes | `_shared/audit-event.schema.json#/$defs/AuditParty/properties/id` | `audit-event.json#/properties/participants/properties/model/properties/id` |
| 43 | _shared:AuditEvent `participants.provider.id` | minLength: TT 1, HCP (none) | yes | `_shared/audit-event.schema.json#/$defs/AuditParty/properties/id` | `audit-event.json#/properties/participants/properties/provider/properties/id` |
| 44 | _shared:AuditEvent `participants.requestingParty.id` | minLength: TT 1, HCP (none) | yes | `_shared/audit-event.schema.json#/$defs/AuditParty/properties/id` | `audit-event.json#/properties/participants/properties/requestingParty/properties/id` |
| 45 | _shared:Export `exportedBy` | minLength: TT 1, HCP (none) | no | `_shared/export.schema.json#/$defs/Export/properties/exportedBy` | `export.json#/properties/exportedBy` |
| 46 | _shared:Export `subject.id` | minLength: TT 1, HCP (none) | no | `_shared/export.schema.json#/$defs/Export/properties/subject/properties/id` | `export.json#/properties/subject/properties/id` |
| 47 | entries/create:request `record.provenance.assertedBy.id` | minLength: TT 1, HCP (none) | no | `_shared/entry-write.schema.json#/$defs/AssertedBy/properties/id` | `operations/create-request.json#/properties/record/properties/provenance/properties/assertedBy/properties/id` |
| 48 | entries/create:request `record.provenance.source` | minLength: TT 1, HCP (none) | no | `_shared/entry-write.schema.json#/$defs/CreateProvenance/properties/source` | `operations/create-request.json#/properties/record/properties/provenance/properties/source` |
| 49 | entries/create:request `record.relationships[].proposal.entry` | minLength: TT 1, HCP (none) | no | `_shared/entry-write.schema.json#/$defs/Proposal/properties/entry` | `operations/create-request.json#/properties/record/properties/relationships/items/properties/proposal/properties/entry` |
| 50 | entries/create:request `record.relationships[].proposal.rationale` | minLength: TT 1, HCP (none) | no | `_shared/entry-write.schema.json#/$defs/Proposal/properties/rationale` | `operations/create-request.json#/properties/record/properties/relationships/items/properties/proposal/properties/rationale` |
| 51 | entries/create:request `record.relationships[].proposal.weighed[]` | minLength: TT 1, HCP (none) | no | `_shared/entry-write.schema.json#/$defs/Proposal/properties/weighed/items` | `operations/create-request.json#/properties/record/properties/relationships/items/properties/proposal/properties/weighed/items` |
| 52 | entries/create:request `record.relationships[].target` | minLength: TT 1, HCP (none) | no | `_shared/entry-write.schema.json#/$defs/WriteRelationship/properties/target` | `operations/create-request.json#/properties/record/properties/relationships/items/properties/target` |
| 53 | entries/create:request `subject.id` | minLength: TT 1, HCP (none) | no | `_shared/entry-write.schema.json#/$defs/WriteSubject/properties/id` | `operations/create-request.json#/properties/subject/properties/id` |
| 54 | entries/get:request `ref` | minLength: TT 1, HCP (none) | no | `entries/get/0.1/payload.schema.json#/properties/ref` | `operations/get-entry-request.json#/properties/ref` |
| 55 | entries/query:request `categories` | minItems: TT 1, HCP (none) | yes | `entries/query/0.1/payload.schema.json#/properties/categories` | `operations/query-request.json#/properties/categories` |
| 56 | entries/revise:request `record.provenance.assertedBy.id` | minLength: TT 1, HCP (none) | no | `_shared/entry-write.schema.json#/$defs/AssertedBy/properties/id` | `operations/revise-request.json#/properties/record/properties/provenance/properties/assertedBy/properties/id` |
| 57 | entries/revise:request `record.provenance.source` | minLength: TT 1, HCP (none) | no | `_shared/entry-write.schema.json#/$defs/WriteProvenance/properties/source` | `operations/revise-request.json#/properties/record/properties/provenance/properties/source` |
| 58 | entries/revise:request `record.relationships[].target` | minLength: TT 1, HCP (none) | no | `_shared/entry-write.schema.json#/$defs/WriteRelationship/properties/target` | `operations/revise-request.json#/properties/record/properties/relationships/items/properties/target` |
| 59 | entries/revise:request `ref` | minLength: TT 1, HCP (none) | no | `entries/revise/0.1/payload.schema.json#/properties/ref` | `operations/revise-request.json#/properties/ref` |
| 60 | entries/withdraw:request `ref` | minLength: TT 1, HCP (none) | no | `entries/withdraw/0.1/payload.schema.json#/properties/ref` | `operations/withdraw-request.json#/properties/ref` |
| 61 | entries/withdraw:response `ref` | minLength: TT 1, HCP (none) | no | `entries/withdraw/0.1/payload.schema.json#/$defs/Response/properties/ref` | `operations/withdraw-result.json#/properties/ref` |
| 62 | import:request `export.audit[].eventType` | minLength: TT 1, HCP (none) | yes | `import/0.1/payload.schema.json#/$defs/ImportedAuditEvent/properties/eventType` | `audit-event.json#/properties/eventType` |
| 63 | import:request `export.exportedBy` | minLength: TT 1, HCP (none) | no | `import/0.1/payload.schema.json#/$defs/ImportedExport/properties/exportedBy` | `export.json#/properties/exportedBy` |
| 64 | import:request `export.subject.id` | minLength: TT 1, HCP (none) | no | `import/0.1/payload.schema.json#/$defs/ImportedExport/properties/subject/properties/id` | `export.json#/properties/subject/properties/id` |
| 65 | import:response `outcomes[].id` | minLength: TT 1, HCP (none) | no | `import/0.1/payload.schema.json#/$defs/Outcome/properties/id` | `operations/import-result.json#/properties/outcomes/items/properties/id` |
| 66 | import:response `outcomes[].reason` | minLength: TT 1, HCP (none) | no | `import/0.1/payload.schema.json#/$defs/Outcome/properties/reason` | `operations/import-result.json#/properties/outcomes/items/properties/reason` |
| 67 | shares/report:request `refs[]` | minLength: TT 1, HCP (none) | no | `shares/report/0.1/payload.schema.json#/properties/refs/items` | `operations/report-sharing-request.json#/properties/refs/items` |

#### c2. HCP schema rules (if/then, contains, oneOf) TT does not check (16)

| # | TT object, member | difference | documented | TT schema (specs/hcp/) | HCP schema (schemas/2.0-draft-3/) |
|---|---|---|---|---|---|
| 1 | _shared:Content `(root)` | HCP schema rule not in the TT schema: if {"properties":{"profile":{"const":"https://hcp.example/spec/profiles/general-context/2.0"}}} then { | yes | `_shared/context-entry.schema.json#/$defs/Content` | `common.json#/$defs/content` |
| 2 | _shared:Content `(root)` | HCP schema rule not in the TT schema: if {"properties":{"profile":{"const":"https://hcp.example/spec/profiles/vc-evidence/2.0"}}} then {"not | yes | `_shared/context-entry.schema.json#/$defs/Content` | `common.json#/$defs/content` |
| 3 | _shared:Assertion `(root)` | HCP schema rule not in the TT schema: if {"properties":{"declarationType":{"const":"model-inferred"}}} then {"properties":{"confidence":{"en | yes | `_shared/context-entry.schema.json#/$defs/Assertion` | `common.json#/$defs/assertion` |
| 4 | _shared:EvidenceItem `(root)` | HCP schema rule not in the TT schema: if {"properties":{"type":{"const":"verifiable-credential"}},"required":["type"]} then {"properties":{" | yes | `_shared/context-entry.schema.json#/$defs/EvidenceItem` | `common.json#/$defs/evidenceItem` |
| 5 | _shared:Entry `evidence` | HCP schema rule not in the TT schema: contains {"properties":{"role":{"const":"content"}},"required":["role"]} minContains 0 maxContains 1 | yes | `_shared/context-entry.schema.json#/$defs/Entry/properties/evidence` | `entry.json#/properties/evidence` |
| 6 | _shared:Entry `record.relationships[]` | HCP schema rule not in the TT schema: if {"not":{"properties":{"type":{"const":"contradicts"}}}} then {"not":{"required":["proposal"]}} | yes | `_shared/context-entry.schema.json#/$defs/Record/properties/relationships/items` | `entry.json#/properties/record/properties/relationships/items` |
| 7 | _shared:Entry `type` | HCP schema rule not in the TT schema: contains {"const":"ContextEntry"} | yes | `_shared/context-entry.schema.json#/$defs/Entry/properties/type` | `entry.json#/properties/type` |
| 8 | _shared:Disclosure `evidence[]` | HCP schema rule not in the TT schema: if {"properties":{"type":{"const":"verifiable-credential"}},"required":["type"]} then {"properties":{" | yes | `_shared/disclosure.schema.json#/$defs/Disclosure/properties/evidence/items` | `disclosure.json#/properties/evidence/items` |
| 9 | _shared:Grant `(root)` | HCP schema rule not in the TT schema: if {"properties":{"grantType":{"const":"temporary"}}} then {"properties":{"expiresAt":{"format":"date- | yes | `_shared/grant.schema.json#/$defs/Grant` | `grant.json#` |
| 10 | _shared:Grant `(root)` | HCP schema rule not in the TT schema: if {"properties":{"grantType":{"const":"persistent"}}} then {"properties":{"expiresAt":{"type":"null"} | yes | `_shared/grant.schema.json#/$defs/Grant` | `grant.json#` |
| 11 | _shared:Delegation `basis` | HCP schema rule not in the TT schema: if {"properties":{"method":{"const":"evidence"}}} then {"properties":{"evidence":{"minItems":1}},"requ | yes | `_shared/delegation.schema.json#/$defs/Delegation/properties/basis` | `delegation.json#/properties/basis` |
| 12 | _shared:Delegation `basis` | HCP schema rule not in the TT schema: if {"properties":{"method":{"const":"delegated"}}} then {"required":["parent"]} else {"not":{"required | yes | `_shared/delegation.schema.json#/$defs/Delegation/properties/basis` | `delegation.json#/properties/basis` |
| 13 | entries/create:request `evidence` | HCP schema rule not in the TT schema: contains {"properties":{"role":{"const":"content"}},"required":["role"]} minContains 0 maxContains 1 | yes | `entries/create/0.1/payload.schema.json#/properties/evidence` | `operations/create-request.json#/properties/evidence` |
| 14 | entries/revise:request `evidence` | HCP schema rule not in the TT schema: contains {"properties":{"role":{"const":"content"}},"required":["role"]} minContains 0 maxContains 1 | yes | `entries/revise/0.1/payload.schema.json#/properties/evidence` | `operations/revise-request.json#/properties/evidence` |
| 15 | entries/hard-delete:response `(root)` | HCP schema rule not in the TT schema: exactly one of (entryId \| ref) present | yes | `entries/hard-delete/0.1/payload.schema.json#/$defs/Response` | `operations/withdraw-result.json#` |
| 16 | import:response `outcomes[]` | HCP schema rule not in the TT schema: if {"properties":{"outcome":{"const":"rejected"}}} then {"required":["reason"]} | yes | `import/0.1/payload.schema.json#/$defs/Response/properties/outcomes/items` | `operations/import-result.json#/properties/outcomes/items` |

#### c3. Payload roots TT closes where HCP is open (17)

| # | TT object, member | difference | documented | TT schema (specs/hcp/) | HCP schema (schemas/2.0-draft-3/) |
|---|---|---|---|---|---|
| 1 | entries/create:request `(root)` | TT closed, HCP open | no | `entries/create/0.1/payload.schema.json#` | `operations/create-request.json#` |
| 2 | entries/get:request `(root)` | TT closed, HCP open | yes | `entries/get/0.1/payload.schema.json#` | `operations/get-entry-request.json#` |
| 3 | entries/get:response `(root)` | TT closed, HCP open | yes | `entries/get/0.1/payload.schema.json#/$defs/Response` | `operations/get-entry-result.json#` |
| 4 | entries/query:request `(root)` | TT closed, HCP open | yes | `entries/query/0.1/payload.schema.json#` | `operations/query-request.json#` |
| 5 | entries/query:response `(root)` | TT closed, HCP open | yes | `entries/query/0.1/payload.schema.json#/$defs/Response` | `operations/query-result.json#` |
| 6 | entries/revise:request `(root)` | TT closed, HCP open | no | `entries/revise/0.1/payload.schema.json#` | `operations/revise-request.json#` |
| 7 | entries/withdraw:request `(root)` | TT closed, HCP open | yes | `entries/withdraw/0.1/payload.schema.json#` | `operations/withdraw-request.json#` |
| 8 | entries/withdraw:response `(root)` | TT closed, HCP open | yes | `entries/withdraw/0.1/payload.schema.json#/$defs/Response` | `operations/withdraw-result.json#` |
| 9 | entries/hard-delete:response `(root)` | TT closed, HCP open | yes | `entries/hard-delete/0.1/payload.schema.json#/$defs/Response` | `operations/withdraw-result.json#` |
| 10 | import:request `(root)` | TT closed, HCP open | yes | `import/0.1/payload.schema.json#` | `operations/import-request.json#` |
| 11 | import:response `(root)` | TT closed, HCP open | yes | `import/0.1/payload.schema.json#/$defs/Response` | `operations/import-result.json#` |
| 12 | export:request `(root)` | TT closed, HCP open | yes | `export/0.1/payload.schema.json#` | `export.json#/properties/options` |
| 13 | shares/report:request `(root)` | TT closed, HCP open | yes | `shares/report/0.1/payload.schema.json#` | `operations/report-sharing-request.json#` |
| 14 | rules/set:request `(root)` | TT closed, HCP open | yes | `rules/set/0.1/payload.schema.json#` | `standing-rule.json#` |
| 15 | directives/set:request `(root)` | TT closed, HCP open | yes | `directives/set/0.1/payload.schema.json#` | `directive.json#` |
| 16 | delegations/list:response `(root)` | TT closed, HCP open | yes | `delegations/list/0.1/payload.schema.json#/$defs/Response` | `operations/delegations-result.json#` |
| 17 | disclosures/summary:response `(root)` | TT closed, HCP open | yes | `disclosures/summary/0.1/payload.schema.json#/$defs/Response` | `operations/disclosure-summary-result.json#` |

#### c4. Unions merged into one pattern, and a dropped format (6)

| # | TT object, member | difference | documented | TT schema (specs/hcp/) | HCP schema (schemas/2.0-draft-3/) |
|---|---|---|---|---|---|
| 1 | _shared:Category `(root)` | HCP is a choice of [pattern ^[a-z][a-z0-9_]*$ \| format uri pattern ^[A-Za-z][A-Za-z0-9+.-]*:]; TT is a single shape [type string pattern ^( | no | `_shared/common.schema.json#/$defs/Category` | `common.json#/$defs/category` |
| 2 | _shared:Directive `action` | HCP is a choice of [type string enum "share", "sign", "transact" \| type string format uri pattern ^[A-Za-z][A-Za-z0-9+.-]*:[^\s]+$]; TT is  | no | `_shared/directive.schema.json#/$defs/Directive/properties/action` | `directive.json#/properties/action` |
| 3 | _shared:Delegation `relationship` | HCP is a choice of [type string enum "attorney-in-fact", "caregiver", "legal-guardian", "parent-or-guardian" \| type string format uri patte | no | `_shared/delegation.schema.json#/$defs/Delegation/properties/relationship` | `delegation.json#/properties/relationship` |
| 4 | _shared:AuditEvent `purpose` | TT (none), HCP uri | no | `_shared/audit-event.schema.json#/$defs/AuditEvent/properties/purpose` | `audit-event.json#/properties/purpose` |
| 5 | import:request `export.audit[].purpose` | TT (none), HCP uri | no | `import/0.1/payload.schema.json#/$defs/ImportedAuditEvent/properties/purpose` | `audit-event.json#/properties/purpose` |
| 6 | directives/set:request `action` | HCP is a choice of [type string enum "share", "sign", "transact" \| type string format uri pattern ^[A-Za-z][A-Za-z0-9+.-]*:[^\s]+$]; TT is  | no | `directives/set/0.1/payload.schema.json#/properties/action` | `directive.json#/properties/action` |

#### c5. hcp/entries/hard-delete response vs HCP withdraw-result (my pairing; Q11) (5)

| # | TT object, member | difference | documented | TT schema (specs/hcp/) | HCP schema (schemas/2.0-draft-3/) |
|---|---|---|---|---|---|
| 1 | entries/hard-delete:response `entryId` | required in TT, optional in HCP | yes | `entries/hard-delete/0.1/payload.schema.json#/$defs/Response` | `operations/withdraw-result.json#` |
| 2 | entries/hard-delete:response `hardDeleted` | required in TT, optional in HCP | yes | `entries/hard-delete/0.1/payload.schema.json#/$defs/Response` | `operations/withdraw-result.json#` |
| 3 | entries/hard-delete:response `hardDeleted` | closed in TT only (true) | yes | `entries/hard-delete/0.1/payload.schema.json#/$defs/Response/properties/hardDeleted` | `operations/withdraw-result.json#/properties/hardDeleted` |
| 4 | entries/hard-delete:response `ref` | optional in HCP; TT does not declare it | yes | `entries/hard-delete/0.1/payload.schema.json#/$defs/Response` | `operations/withdraw-result.json#` |
| 5 | entries/hard-delete:response `status` | required in HCP; TT does not declare it | yes | `entries/hard-delete/0.1/payload.schema.json#/$defs/Response` | `operations/withdraw-result.json#` |

## Appendix B: edge vectors and string probes

| vector | HCP schema | TT schema | HCP | TT | #1381 lists it | note |
|---|---|---|---|---|---|---|
| temporary grant without expiresAt | `grant.json` | `_shared/grant.schema.json#/$defs/Grant` | **rejects** | **rejects** | yes |  |
| temporary grant with expiresAt null | `grant.json` | `_shared/grant.schema.json#/$defs/Grant` | **rejects** | accepts | yes |  |
| persistent grant with an expiresAt instant | `grant.json` | `_shared/grant.schema.json#/$defs/Grant` | **rejects** | accepts | yes |  |
| get request naming both ref and entryId | `operations/get-entry-request.json` | `entries/get/0.1/payload.schema.json` | accepts | accepts | yes |  |
| get request naming neither ref nor entryId | `operations/get-entry-request.json` | `entries/get/0.1/payload.schema.json` | accepts | accepts | yes |  |
| withdraw request naming both ref and entryId | `operations/withdraw-request.json` | `entries/withdraw/0.1/payload.schema.json` | accepts | accepts | yes |  |
| withdraw result naming both ref and entryId | `operations/withdraw-result.json` | `entries/withdraw/0.1/payload.schema.json#/$defs/Response` | **rejects** | accepts | yes |  |
| withdraw result with hardDeleted true | `operations/withdraw-result.json` | `entries/withdraw/0.1/payload.schema.json#/$defs/Response` | accepts | **rejects** | - | Q10: TT closes hardDeleted to false on withdraw; HCP 9.4.5 answers DELETE with the same shape |
| get result, directives absent | `operations/get-entry-result.json` | `entries/get/0.1/payload.schema.json#/$defs/Response` | accepts | **rejects** | - | Q42 presence |
| get result, directives null | `operations/get-entry-result.json` | `entries/get/0.1/payload.schema.json#/$defs/Response` | **rejects** | accepts | - | Q5: null for a Management Client |
| query result, directives null | `operations/query-result.json` | `entries/query/0.1/payload.schema.json#/$defs/Response` | **rejects** | accepts | - | Q5 |
| audit event, entryId absent | `audit-event.json` | `_shared/audit-event.schema.json#/$defs/AuditEvent` | accepts | **rejects** | - | Q42: TT requires the member (null when none) |
| audit event, entryId null | `audit-event.json` | `_shared/audit-event.schema.json#/$defs/AuditEvent` | accepts | accepts | - |  |
| audit event, purpose null | `audit-event.json` | `_shared/audit-event.schema.json#/$defs/AuditEvent` | accepts | accepts | - |  |
| restrict-purposes request, permittedPurposes null (removes the narrowing) | `-` | `entries/restrict-purposes/0.1/payload.schema.json` | n/a | accepts | - | no HCP schema: HCP 9.4.10 prose says null removes the narrowing |
| restrict-purposes request, permittedPurposes absent | `-` | `entries/restrict-purposes/0.1/payload.schema.json` | n/a | **rejects** | - |  |
| grant, expiresAt null on a persistent grant (control) | `grant.json` | `_shared/grant.schema.json#/$defs/Grant` | accepts | accepts | - |  |
| entry whose type lacks ContextEntry | `entry.json` | `_shared/context-entry.schema.json#/$defs/Entry` | **rejects** | accepts | yes |  |
| entry, model-inferred with confidence null | `entry.json` | `_shared/context-entry.schema.json#/$defs/Entry` | **rejects** | accepts | yes |  |
| entry, General Context content without value | `entry.json` | `_shared/context-entry.schema.json#/$defs/Entry` | **rejects** | accepts | yes |  |
| entry with a member HCP does not define (HCP 4.2, A.3: preserved) | `entry.json` | `_shared/context-entry.schema.json#/$defs/Entry` | accepts | accepts | - |  |
| create request with a member HCP does not define (HCP 4.2, A.3) | `operations/create-request.json` | `entries/create/0.1/payload.schema.json` | accepts | **rejects** | - | TT payload root is additionalProperties:false |
| create request with record.metadata (nested, open on both sides) | `operations/create-request.json` | `entries/create/0.1/payload.schema.json` | accepts | accepts | - |  |
| create request with classification.permittedPurposes | `operations/create-request.json` | `entries/create/0.1/payload.schema.json` | accepts | accepts | yes | Q7 (allowlisted hcp-only) |
| revise request carrying subject | `operations/revise-request.json` | `entries/revise/0.1/payload.schema.json` | **rejects** | **rejects** | - | HCP `not` rule vs TT closed root |
| standing rule with neither operators nor requires | `standing-rule.json` | `rules/set/0.1/payload.schema.json#/$defs/Response` | **rejects** | accepts | yes |  |
| rules/set request with neither operators nor requires | `-` | `rules/set/0.1/payload.schema.json` | n/a | **rejects** | - | request side: the TT schema has the anyOf |
| import whose export holds a rule with neither | `operations/import-request.json` | `import/0.1/payload.schema.json` | **rejects** | accepts | yes |  |
| import of a realistic export (control) | `operations/import-request.json` | `import/0.1/payload.schema.json` | accepts | accepts | - |  |
| query with empty categories | `operations/query-request.json` | `entries/query/0.1/payload.schema.json` | accepts | **rejects** | - | Q42: documented |
| query with 257 categories | `operations/query-request.json` | `entries/query/0.1/payload.schema.json` | accepts | **rejects** | - | framework bound 256 |
| query with maxEntries 1000 | `operations/query-request.json` | `entries/query/0.1/payload.schema.json` | accepts | accepts | - | neither side caps it; the provider returns at most 20 |
| query result with 21 entries | `operations/query-result.json` | `entries/query/0.1/payload.schema.json#/$defs/Response` | **rejects** | **rejects** | - | HCP 7.2 cap on both sides |
| query with a 2049-character purpose | `operations/query-request.json` | `entries/query/0.1/payload.schema.json` | accepts | **rejects** | - | framework bound 2048 on every URI |
| entry content.language of 65 characters | `entry.json` | `_shared/context-entry.schema.json#/$defs/Entry` | accepts | **rejects** | - | undocumented bound 64 |
| create request with 65 evidence items | `operations/create-request.json` | `entries/create/0.1/payload.schema.json` | accepts | **rejects** | - | framework bound 64 |
| accessToken of 8193 characters | `-` | `entries/query/0.1/payload.schema.json` | n/a | **rejects** | - | carriage member; framework bound 8192 |
| query result: disclosed VC evidence item without credential | `operations/query-result.json` | `entries/query/0.1/payload.schema.json#/$defs/Response` | **rejects** | accepts | **no** | #1381 lists this rule for get (anyOf/0) but not for query |
| query result: disclosed VC evidence item WITH a credential (control) | `operations/query-result.json` | `entries/query/0.1/payload.schema.json#/$defs/Response` | accepts | accepts | - |  |
| disclosed evidence item with revealed (allOf over an open EvidenceItem) | `disclosure.json` | `_shared/disclosure.schema.json#/$defs/Disclosure` | accepts | accepts | - |  |
| category "health_context" | `common.json#/$defs/category` | `_shared/common.schema.json#/$defs/Category` | accepts | accepts | - |  |
| category "Health" | `common.json#/$defs/category` | `_shared/common.schema.json#/$defs/Category` | **rejects** | **rejects** | - |  |
| category "foo:" | `common.json#/$defs/category` | `_shared/common.schema.json#/$defs/Category` | **rejects** | **rejects** | - |  |
| category "foo:bar" | `common.json#/$defs/category` | `_shared/common.schema.json#/$defs/Category` | accepts | accepts | - |  |
| category "a:b c" | `common.json#/$defs/category` | `_shared/common.schema.json#/$defs/Category` | **rejects** | **rejects** | - |  |
| category "x:<y>" | `common.json#/$defs/category` | `_shared/common.schema.json#/$defs/Category` | **rejects** | accepts | - |  |
| category "a:%zz" | `common.json#/$defs/category` | `_shared/common.schema.json#/$defs/Category` | **rejects** | accepts | - |  |
| category "https://cat.example/x" | `common.json#/$defs/category` | `_shared/common.schema.json#/$defs/Category` | accepts | accepts | - |  |
| category "urn:x:y" | `common.json#/$defs/category` | `_shared/common.schema.json#/$defs/Category` | accepts | accepts | - |  |
| directive action "share" | `directive.json#/properties/action` | `_shared/directive.schema.json#/$defs/Directive/properties/action` | accepts | accepts | - |  |
| directive action "Share" | `directive.json#/properties/action` | `_shared/directive.schema.json#/$defs/Directive/properties/action` | **rejects** | **rejects** | - |  |
| directive action "foo:" | `directive.json#/properties/action` | `_shared/directive.schema.json#/$defs/Directive/properties/action` | **rejects** | **rejects** | - |  |
| directive action "x:<y>" | `directive.json#/properties/action` | `_shared/directive.schema.json#/$defs/Directive/properties/action` | **rejects** | accepts | - |  |
| directive action "a:%zz" | `directive.json#/properties/action` | `_shared/directive.schema.json#/$defs/Directive/properties/action` | **rejects** | accepts | - |  |
| directive action "https://act.example/x" | `directive.json#/properties/action` | `_shared/directive.schema.json#/$defs/Directive/properties/action` | accepts | accepts | - |  |
| delegation relationship "caregiver" | `delegation.json#/properties/relationship` | `_shared/delegation.schema.json#/$defs/Delegation/properties/relationship` | accepts | accepts | - |  |
| delegation relationship "Caregiver" | `delegation.json#/properties/relationship` | `_shared/delegation.schema.json#/$defs/Delegation/properties/relationship` | **rejects** | **rejects** | - |  |
| delegation relationship "foo:" | `delegation.json#/properties/relationship` | `_shared/delegation.schema.json#/$defs/Delegation/properties/relationship` | **rejects** | **rejects** | - |  |
| delegation relationship "x:<y>" | `delegation.json#/properties/relationship` | `_shared/delegation.schema.json#/$defs/Delegation/properties/relationship` | **rejects** | accepts | - |  |
| delegation relationship "https://rel.example/x" | `delegation.json#/properties/relationship` | `_shared/delegation.schema.json#/$defs/Delegation/properties/relationship` | accepts | accepts | - |  |
| audit purpose "https://purposes.example/x" | `audit-event.json#/properties/purpose` | `_shared/audit-event.schema.json#/$defs/AuditEvent/properties/purpose` | accepts | accepts | - |  |
| audit purpose "x:<y>" | `audit-event.json#/properties/purpose` | `_shared/audit-event.schema.json#/$defs/AuditEvent/properties/purpose` | **rejects** | accepts | - |  |
| audit purpose "a:%zz" | `audit-event.json#/properties/purpose` | `_shared/audit-event.schema.json#/$defs/AuditEvent/properties/purpose` | **rejects** | accepts | - |  |
| audit purpose "foo:" | `audit-event.json#/properties/purpose` | `_shared/audit-event.schema.json#/$defs/AuditEvent/properties/purpose` | **rejects** | **rejects** | - |  |
| purpose code "x:<y>" (control: both have format uri) | `common.json#/$defs/purposeCode` | `_shared/common.schema.json#/$defs/PurposeCode` | **rejects** | **rejects** | - |  |
| purpose code "a:%zz" (control: both have format uri) | `common.json#/$defs/purposeCode` | `_shared/common.schema.json#/$defs/PurposeCode` | **rejects** | **rejects** | - |  |
