## Gap 1: the points the summary said it would raise (T5, T7, the mediator DID, the raise list, the companion's citations)

Read-only. Sources: Keyring at `d3-fast-send` (5daeba0d0); VTI pinned clone `external/verifiable-trust-infrastructure`
at f7b78e29d; framework pin `external/dtgwg-trust-tasks-tf` at 2a66a0351; the PR repo `tt` (pr1380 = 94ed4200c =
origin/feat/hcp-suite, pr1381 = 1b3ae9ed6 = origin/feat/hcp-unchecked-rules, pr1382 = e163cac1d =
origin/feat/hcp-demos); the companion `d3-plan-canvas/docs/plans/agent-connect-plan/2026-11-25-bam.md` (af6ccb8dd).
`kr/` = `~/keyring-worktrees/d3-fast-send`, `vti/` = the VTI pin, `tt/` = the PR checkout.

I did not edit `HCP-review.md` (outside the paths this track may write). The raise list below is written so it can
be pasted into its `SECTION:raise` block as is.

### G1-T5. Keyring refuses a `#request`-typed consent request: a conformance gap in Keyring, not a break with the VTA as built

CONFIRMED. Severity: **raise**, target **our own work**. No break with VTI today.

- The framework says both forms are one type and consumers MUST take both: "A *Trust Task document* whose `type` URI
  carries **no fragment** or the fragment `#request` is a *request*. The two forms are semantically equivalent;
  *producers* **MAY** emit either, *consumers* **MUST** accept both." (`tt/SPEC.md:209`; the same at our pin,
  `fw/SPEC.md:208`).
- Keyring compares the bare type exactly in **three** places, not one:
  - `kr/packages/core/src/modules/trust-tasks/module/vtaAgent.ts:576`
    `if (body?.type === VTA_TASK.consentRequest && body.payload?.challenge) {` (`keepManagerMessage`). A `#request`
    form falls through to `return undefined`: the request is **dropped silently**, no approval is listed.
  - `kr/.../module/VtaClient.ts:888-889` `UNSOLICITED … VTA_TASK.consentRequest`, used at `:1221`
    `if (body?.type && UNSOLICITED.has(body.type))`. A `#request` form is not recognised as unsolicited, so with one
    task in flight and no thread reference it can be **taken as that task's answer** (`:1286-1290` "a reply with no
    thread was taken as the answer to the task in flight"): the 09-29 "push finding F3" class the comment at
    `:1218-1220` was written to close.
  - `kr/.../module/consentCheck.ts:89` `if (doc.type !== VTA_TASK.consentRequest || …) return refuse('malformed')`.
  - `VTA_TASK.consentRequest` is the bare `'https://trusttasks.org/spec/task-consent/request/0.1'`
    (`VtaClient.ts:175`). Keyring's own `proofPurpose.ts:17` already parses `(#request|#response)?`, so the codebase
    knows the rule; the consent path does not apply it. No test covers the fragment form on the consent path (only
    `proofPurpose.test.ts` uses `#request`).
- Against the VTA as built it does not bite: the VTA writes the bare type.
  `vti/vta-service/src/trust_tasks/consent_request.rs:38-39`
  `pub(super) const TASK_CONSENT_REQUEST_0_1: &str = "https://trusttasks.org/spec/task-consent/request/0.1";`, used
  at `:113` `"type": TASK_CONSENT_REQUEST_0_1,` and in `helpers.rs:1054`. VTI #2823 reuses that producer "as is, with
  a new producer" (`vti2823/docs/05-design-notes/hcp.md:94`).
- Upstream's own approver has the same gap, so this is not Keyring drifting from vta-sdk:
  `vti/vta-sdk/src/task_consent.rs:132` `v.get("type").and_then(Value::as_str) == Some(REQUEST_TYPE)` and `:190`
  `if doc.type_uri.to_string() != REQUEST_TYPE {` → `Malformed`.
- Who would send the `#request` form? Not the PR: its demo never sends a task-consent document (the person's decision
  is a function call, `raised-points.md` P1). The demo writes `#request` on its own `hcp/*` requests
  (`tt/examples/hcp-demo-ts/src/demo.ts:554`, `:564`, `:576`, `:585`). So the exposure is a provider written in the
  demo's style, or a later VTI producer that adopts it. The test program's T5 probe (`rung/src/run.ts:655-661`)
  re-implements Keyring's check (`run.ts:479`) rather than calling Keyring's code, which matches `consentCheck.ts:89`
  but does not show the two other sites.
- Ask: none of the PR. Our own work: strip a `#request` fragment once, where a VTA document is read (or compare by
  a `bareType()` helper at all three sites), and add one jest row per site with a bare-form control. Optional note to
  VTI: `vta-sdk` `extract_requests`/`ConsentRequest::verify` has the same exact compare.

**Correction to errors/task-consent-handled (errors.md F18 [ok]).** It stands as "ok" for the VTA as built, but its
wording "Keyring already handles task-consent request 0.1" should read: "… handles the bare-typed request the VTA
sends (consent_request.rs:39). The `#request` form, which SPEC §4.4.1 rule 1 makes equivalent, is dropped by
`keepManagerMessage` (vtaAgent.ts:576), escapes the unsolicited filter (VtaClient.ts:889, :1221), and is refused
`malformed` by `checkConsentRequest` (consentCheck.ts:89); see G1-T5."

### G1-T7. No `accessTokenDigest` helper: true, and Keyring needs none (filed with signing-formats/digest-bases)

CONFIRMED. Severity: **note**, target: none (an optional wording ask of the PR is already in signing-formats Q2).

- The rule binds the **provider** only: "A provider that retains the request document … **MUST** remove
  `accessToken` from the copy it keeps and record in its place `accessTokenDigest`: the SHA-256 multihash of the
  token's UTF-8 bytes, multibase-encoded as base64url without padding (prefix `u`), the framework's
  `DigestMultibase` form" (`tt/specs/hcp/grants/revoke/0.1/spec.md:229`; the same paragraph in 27 `hcp/*` spec.md
  files). It appears in no schema. A *recipient* "**MUST NOT** log `accessToken` or retain it beyond the exchange"
  (`revoke/0.1/spec.md:225`). Keyring, as Management Client, is the sender, never the provider that retains.
- The T7 row is right that `digestMultibase` would be the wrong tool if Keyring ever needed it, for two reasons, not
  one: it hashes `JCS(value)`, so a token string is hashed **with its JSON quotes**, and it encodes base58btc:
  `kr/packages/trust-tasks/src/documentProof.ts:55-58` `multibase(base58btc, multihash(sha-256, JCS(value)))`. The
  spec hashes the raw UTF-8 bytes and encodes `u`. A comparison would still work for the base (SPEC §4.9.3 compares
  decoded multihash bytes, `tt/SPEC.md:558`; `digestBytesEqual` decodes `z` and `u`, `documentProof.ts:104-130`) but
  not for the quotes.
- Together with signing-formats/digest-bases: the spec calls the `u` form "the framework's `DigestMultibase` form"
  while `_framework` `DigestMultibase` RECOMMENDS base58btc; a one-word clarity ask at most. The real Keyring-side
  base gap is the other one already filed there: `consentMatchCode` decodes with credo's `MultiBaseEncoder`, which
  knows only `z` (`consentCheck.ts:26-38`), so a `u` `payloadDigest` would show no match code.
- If Keyring ever keeps copies of documents it sent with a token in them (an outbox, a debug log), the rule that
  binds it is "MUST NOT … retain it beyond the exchange", not the digest rule. Today no Keyring code holds an HCP
  token (`grep accessToken` in `packages/core/src/modules/trust-tasks` finds only the mediator transport's own).

### G1-M. `tsp-reference` still defaults to the dead dev-mediator DID

CONFIRMED. Severity: **note**, target **our own work**.

- The public log at `https://webvh.storm.ws/mediator/did.jsonl` (fetched 2026-11-25) starts at version 1,
  `versionTime` `2026-09-27T20:12:31Z`, `scid` `QmR5xGk8pkd3ymu7xpfkjr7XZmwDALA5ZJmgG7qcrD2mKA`, with a second
  entry on 2026-10-06. The old SCID `QmTS3a3H9Dk4…` no longer matches the log at that path, so a did:webvh
  resolver refuses it.
- Still the default on `origin/main`: `tsp-reference/ref-04-mediator/run.mjs:41-42`
  `?? "did:webvh:QmTS3a3H9Dk4ZMPAZ8jNWGeyPbuKrPbrPZcSbg8CJ6yynD:webvh.storm.ws:mediator";` (last changed 1367eed1d,
  2026-08-17) and **also** `tsp-reference/ref-06x-cypress-stack/run.mjs:63`, which the review did not mention. The
  app's own tests already use the new DID (`packages/core/src/modules/trust-tasks/__tests__/vtiMediatorTspOnlyRoute.test.ts:20`).
- Upstream at our pin also defaults to the old DID in test code: `vti/vta-mobile-core/src/mediator.rs:229`, `:287`,
  `resolver.rs:203`, `tsp.rs:202` (all behind `VTA_TEST_MEDIATOR`). Not ours to fix; worth one line to VTI if asked.
- `docs/VTI_UPSTREAM_FINDINGS.md:1378` names the old DID as of its date; that is a dated record and should stay.
- Fix: one small PR that moves the two `run.mjs` defaults to the new DID (or to a shared constant), tier `docs`/tools.

### G1-C. The companion's suite citations, re-checked at pr1380 94ed4200c

CONFIRMED. Severity: **note** (one line moved; the anchor commits are stale).

- `2026-11-25-bam.md:57` cites the suite at `feat/hcp-suite` `51730da20` ("unpushed and still being edited") and the
  demos at `feat/hcp-demos` `f5f3b2804`. Neither object exists in the PR repo (`git cat-file -t` → "Not a valid
  object name"), nor in our framework pin. Both branches are now pushed: `origin/feat/hcp-suite` = 94ed4200c (#1380),
  `origin/feat/hcp-demos` = e163cac1d (#1382). `:368` ("by a separate read of `feat/hcp-suite` at `51730da20`") can
  no longer be reproduced by anyone.
- Line by line at 94ed4200c:

| Companion line | Citation | At 94ed4200c |
|---|---|---|
| `:102` | `entries/query/0.1/spec.md:93` "a provider **MUST NOT** claim this carriage in its HCP `conformsTo`" | **Moved to `:94`** (`:93` is blank). Text unchanged ("…so a provider **MUST NOT** claim this carriage in its HCP `conformsTo`, and advertises…"); also at `:302` (question 1). "The same in each spec": 27 of 28 say "claim this carriage"; `grants/request/0.1/spec.md:320` says "**MUST NOT** claim this task", same rule |
| `:174` C7 | `grants/revoked/0.1/spec.md:91` | Unchanged: "Each attempt is a new Trust Task document, with its own `id`, `issuedAt` and `proof`… the same `noticeId`" |
| `:174` C7 | `revoked :124` | Unchanged: the payload `noticeId`, `grantId`, `revokedAt`, all REQUIRED; `noticeId` the SET `jti`, question 16 |
| `:174` C7 | `revoked :247` | Unchanged: "at least 5 attempts over at least one hour (HCP 9.9)… **MUST NOT** make a delivery attempt more than 24 hours after the notice's first attempt" |
| `:174` C7 | `revoked :249` | Unchanged: "any acknowledgement… as successful delivery. It records `revocation.notified` on the first acknowledgement, or when it abandons delivery" |
| `:186` step 2 | `grants/request/0.1/spec.md:173-178` | Unchanged: items 1-6 of the hold (next-step with `continuation: resubmit`, never an error; same thread; match by `threadId` and `issuer`; no second ask; `retryAfter`; hold length is policy) |
| `:170` C3 | `_shared/0.1/common.schema.json:27-33` | Unchanged: `"PurposeCode": {` at :27 to its description at :33 (`format: uri`, pattern `^[a-zA-Z][a-zA-Z0-9+.-]*:\S+$`, max 2048) |

- Also spot-checked, all unchanged at 94ed4200c: `grants/request :85` (C1, registered name), `:126` (C3, purposes),
  `:127-128` (C2, persistence and the 4-hour default), `:129` (C8, onward sharing); `grants/revoke :176` (I2, never
  rate limited); `entries/create :99` (C10), `:135-136` (C6; and the spec indeed names no Memory Manager rule);
  `audit/read :96`, `disclosures/summary :97` (C11); `disclosures/summary :166-174` (`notification` at :173);
  `directives/set/0.1/payload.schema.json:14, :19` (C9).
- Ask (our own work): in the companion, re-anchor `:57` and `:368` to `94ed4200c` / `e163cac1d` (PR #1380 / #1382)
  and change `:102`'s `:93` to `:94`. HCP line numbers were not in this gap's scope.

### G1-R. The raise list (for `HCP-review.md` `SECTION:raise`)

One line per T row, then per raise finding. Target in brackets: **PR** (#1380-#1382 or the library-fix PRs),
**VTI** (#2823 or the VTI code), **ours** (Keyring, the plugin, our plan). Finding ids are the track notes'.

T rows:

- **T1** Governance tasks require `accessToken`, VTI V0 gives Keyring none. [PR + VTI: mint a Management Client token in V0, or let a DID-proven Management Client go without one, and say how] — coverage-mcp F8 (blocker), errors F22, raised-points P3, signing-formats ask (b).
- **T2** No typed "declined" or "expired": a decline is the fixed `permissionDenied`. [PR: state the deviation from SPEC's decision-task rule and add a decline to the shared scenario] — errors F9, raised-points P1.
- **T3** `vta_call` cannot resubmit on a held thread (fresh id, no `threadId`). [VTI (vta-sdk/vta-mcp) + ours (plugin plan D40)] — coverage-mcp F11 (blocker for D40).
- **T4** vta-sdk/vta-mcp read a held next-step reply as the result. [VTI + ours] — errors F17.
- **T5** Keyring drops or refuses a `#request`-typed consent request, against SPEC §4.4.1 rule 1 (MUST accept both); three exact compares. [ours; optional note to VTI for vta-sdk's same compare] — G1-T5, corrects errors F18.
- **T6** Keyring's `sendTask` reads a held reply as success and resubmits on new threads. [VTI #2823: can Keyring's own `hcp/*` tasks be held, and in which form; then ours] — errors F7.
- **T7** No `accessTokenDigest` helper; none needed (provider-only rule); `digestMultibase` would be wrong (JCS quotes, base `z`). [no ask; optional PR wording on "the framework's DigestMultibase form"] — G1-T7, signing-formats Q2.
- **Mediator DID** `tsp-reference/ref-04-mediator` and `ref-06x-cypress-stack` default to the dead dev-mediator DID. [ours] — G1-M.

Raise findings from the tracks:

- errors F8 / coverage-mcp F16: VTI says `scope-denied` for a revoked or wrong token; the PR says `hcp:invalidToken` / `permissionDenied`, and `scope-denied` fails trust-task-error 0.6. [VTI]
- errors F10: an abandoned hold re-asks the person on the same thread; with VTI's 300 s hold and 5 s resubmits, a nag loop on Keyring. [PR + VTI] (ceremonies §5 ask 2: one visible end per hold)
- errors F11: `retryAfter` is an instant in trust-task-error but integer seconds in grants/request's untyped next-step hint. [PR] (ceremonies §5 ask 3: a schema for `hint`)
- errors F12: a 1-hour token under a 4-hour grant fails `hcp:invalidToken`, read as revocation; no refresh in 0.1. [PR]
- errors F13: `hcp:exportTooLarge` is export-specific but in the family namespace (SPEC §8.5 rule 2). [PR]
- errors F15: errors on a held thread that leave the hold open vs "an error closes the exchange". [PR]
- errors F19: Keyring shows effect `summary` only; the HCP checklist from `detail` needs published kinds and must keep `summary` verbatim. [VTI (effect kinds) + ours (screen)]
- errors F20: the held request's `threadId` has no member in task-consent/request 0.1, so Keyring cannot do #2823's scan match. [VTI: carry `parentThreadId` on the envelope, ceremonies §5 ask 1; PR: say so in grants/request]
- errors F21: decision/0.2 cannot carry a narrowed approval or a chosen purpose, which HCP 6.1.5.2 requires when none is named. [framework/VTI task-consent]
- coverage-mcp F3: the MCP binding and HCP 10.5 are never cited, though the family moves the token into a payload. [PR]
- coverage-mcp F4: questions 35-52 (44, 45, 47 first) are in no spec; the description says every spec cites them. [PR]
- coverage-mcp F5 (blocker): every spec has the client check the provider against HCP discovery, whose schema needs `conformsTo` and `bindings`; VTI V0 publishes neither. [PR + VTI]
- coverage-mcp F7: HCP Core 5.4 carries governance only over HTTP; a Core claim with Keyring's governance over Trust Tasks rests on question 37. [PR]
- coverage-mcp F10 (blocker for D40): `vta_call` puts the token in the model's context. [ours + VTI]
- coverage-mcp F12 (blocker for D40): `vta-mcp` has no receive loop for the revocation notice. [VTI + ours]
- coverage-mcp F13: `vta-mcp` caps MCP at 2025-11-25 and binds loopback only; HCP's MCP binding needs 2026-07-28 and a remote endpoint. [VTI]
- coverage-mcp F14: #2823 H5 puts the provider's Agent Interop binding in `vta-mcp` while 10.5 makes a bridge a client. [VTI]
- coverage-mcp F15: the memory ACL entry and the HCP grant on one agent identity conflict with VTI §4.3. [VTI]
- coverage-mcp F19: question 46 / N3 (is a model API onward disclosure?) decides whether a Claude Code plugin can use HCP disclosures at all. [PR (HCP editors) + ours]
- schema-vectors F1: create and revise request roots are closed, so HCP 4.2's custom entry members cannot be written. [PR]
- schema-vectors F3: #1381 misses the disclosed-evidence credential rule in the query result. [PR #1381]
- schema-vectors F4: Category, `Directive.action`, `Delegation.relationship`, `AuditEvent.purpose` drop `format: uri`. [PR]
- schema-vectors F2 (optional): say every bound not in HCP is a framework bound, or make the drift check bounds-aware. [PR]
- signing-formats (a): regenerated Go and Dart types drop a required-nullable `null`; fixes are in #1374-#1379, not #1380. [PR: land them with or before #1380]
- signing-formats (c) / raised-points 2: all 47 example proofs say `assertionMethod`, against SPEC §4.7.3 and the PR's own libraries and demo. [PR]
- raised-points P5: `hcp_entries` is separate from `vta/memory/*`; nothing says whether they merge. [VTI + ours]
- signing-formats Keyring-side gaps (not asks of anyone else): reply payloads not schema-validated, key not bound to relationship, `verifyDocumentProof`'s `assertionMethod` default, Ajv ignoring `format`, `undefined` turning a required `null` absent. [ours]
- Companion citations: re-anchor `2026-11-25-bam.md:57`/`:368` to 94ed4200c/e163cac1d; `:102` `:93` → `:94`. [ours] — G1-C.

## Gap 3: the vectors run through Keyring's own validator (JSON-to-JSON and vector comparison, as local tests)

Written 2026-11-25. Script: `vectors/keyring/compare-keyring.mjs` (reads only; writes `vectors/keyring/out/keyring-compare.{txt,json}`).
Re-run: `cd vectors/keyring && node compare-keyring.mjs`.

**Three validators, the same vectors.**

- **H, the review harness.** `vectors/validators.mjs`: Ajv 8.17.1 with ajv-formats. The pr1380 schema files are registered
  by file URL. Each H verdict was re-run here and checked against the recorded one. All 160 matched.
- **K, Keyring.** `d3-fast-send/packages/trust-tasks/src/validator.ts:13-25` reproduced exactly:
  `new Ajv2020({ strict: false })`, one shared instance, `ajv.validate(schema, payload)`, no ajv-formats. The Ajv
  comes from Keyring's own `node_modules`, version 8.20.0, which is what `yarn.lock` resolves `ajv@^8.17.1` to. The
  schemas are the inlined `PAYLOAD_SCHEMA` and `RESPONSE_PAYLOAD_SCHEMA` constants of all 28 hcp/* modules in pr1380
  `trust-tasks-ts/src/hcp/**/0.1/payload.ts`. They were read as text and JSON-parsed (`vectors/keyring/load-inlined.mjs`).
- **D, the PR demo.** `tt/examples/hcp-demo-ts/src/validator.ts:18-29` reproduced: Ajv 8.20.0 with ajv-formats 3.0.1
  from the demo's own `node_modules`, `{ strict: false, allErrors: true }`, one compile per schema object. It was fed
  the same inlined constants. I checked that the demo's own vendored copies of the four modules it uses (entries/query,
  grants/request, grants/revoke, grants/revoked) are deep-equal to pr1380's constants. Only the header comment and the
  key order differ.

Comparing H with D isolates the inlining, because both load formats. Comparing D with K isolates Keyring's missing formats.

A vector that targets a `_shared` `$def` rather than a module payload was run two ways under K and D:

- as a wrapper `{ $ref: "#/$defs/<Name>/…", $defs: <a module's inlined $defs> }`, which is the same subschema H used;
- embedded in a real module payload, which is what Keyring would actually receive. Examples: a grant goes into
  grants/read-own's response, a category into the query request's `categories`, a purpose code into its `purpose`.

All 43 such vectors gave the same verdict both ways. Every inlined `$def` used (Disclosure, Entry, Content, Grant,
AuditEvent, Category, Directive, Delegation, PurposeCode) is identical in every module that inlines it.

**Results on the review's 160 vectors**

| set | vectors | H accepts | K accepts | D accepts | K differs from H and D |
|---|---|---|---|---|---|
| TT→HCP documents (transcript + spec.md) | 72 | 72 | 72 | 72 | 0 |
| HCP→TT mapped examples | 22 | 19 | 19 | 19 | 0 (same 3 rejections) |
| edge | 40 | 25 | 25 | 25 | 0 |
| string, union group | 20 | 13 | 13 | 13 | 0 |
| string, format group | 6 | 3 | 5 | 3 | **2** |

- **The two differences.** They are the "control" probes `purpose code "x:<y>"` and `purpose code "a:%zz"`.
  `PurposeCode` (`trust-tasks-ts/src/hcp/entries/query/0.1/payload.ts:406-408`: `"type": "string", "format": "uri"`,
  also in `specs/hcp/_shared/0.1/common.schema.json:27-29`) carries both `format: uri` and the pattern
  `^[a-zA-Z][a-zA-Z0-9+.-]*:\S+$`. H and D reject both strings with `must match format "uri"`. K accepts them,
  as the wrapper and when embedded as the query request's `purpose`. They are the only differences.
- **Inlining.** H and D agree on all 160 vectors. The inlined constants behave exactly as the schema files under a
  format-aware validator.
- **The c4 union strings (Category, `Directive.action`, `Delegation.relationship`, `AuditEvent.purpose`).** K agrees
  with H on all of them. TT already drops `format: uri` there (F4 in `schema-vectors.md`), so TT's verdict is
  pattern-only on every validator. Once Keyring ignores format, F4 makes no difference to Keyring: Keyring accepts
  `x:<y>` and `a:%zz` in these members, and in `PurposeCode` too.
- **No exceptions.** All 56 module constants compile in one shared Keyring Ajv instance: no duplicate `$id`, and
  no `$ref` that fails to resolve.

**Extra probes, not in the harness** (`keyring-compare.txt`, "Extra probes"). Each probe was run under K in memory,
under K after a JSON round trip, and under D.

- **date-time: Keyring accepts any string.** Every `format: date-time` in the hcp constants (43 nodes: `Instant`,
  nullable `DelegationTerm.endsAt`, `expiresAt`, `validUntil`, `usableUntil`) carries **no pattern and no
  minLength**. For example, `grants/revoked/0.1/payload.ts:115-118` reads `"Instant": { "type": "string",
  "format": "date-time", … }`, and the file schema `common.schema.json:35-38` reads the same.
  - K accepts as `revokedAt` all of: `"yesterday"`, `""`, `"2026-13-45T99:99:99Z"`, `"2026-11-25T10:00:00"` (no
    offset) and `"2026-11-25"`. It also accepts as the query result's `respondedAt` both `"not a time"` and
    `"2026-02-30T00:00:00Z"`.
  - D rejects all seven with `must match format "date-time"`. All 72 real documents pass all three validators, so
    this shows only on bad input.
  - D accepts `"2026-11-25 10:00:00Z"`: ajv-formats takes a space for the `T`.
- **uri.** `https://p.example/%` and `x:é` are accepted by K and rejected by D. `https://p.example/a b` is rejected by
  both, because of the pattern. `urn:x:y` and `mailto:a@b` are accepted by both. Every one of the 35 `format: uri`
  nodes carries that pattern, so on URIs Keyring still enforces "scheme, colon, no whitespace". It does not enforce
  RFC 3986.
- **required-nullable and JS `undefined`.** Ajv's `required` treats a member whose value is `undefined` as
  absent. So these are rejected by K in memory, by K after a JSON round trip, and by D:
  - restrict-purposes `permittedPurposes: undefined`,
  - get result `directives: undefined`,
  - read-own `grant.expiresAt: undefined`.

  `null` is accepted. An optional member set to `undefined` is accepted. One quirk: an *undeclared* key whose value
  is `undefined`, on a closed root (query request `extra: undefined`), is rejected in memory
  (`must NOT have additional properties`, because Ajv's for..in sees the key) but accepted after
  `JSON.stringify`. The trap therefore bites only where Keyring would validate its own object before serializing
  it. On the wire, Keyring and the reference agree.
- **`$id` reuse.** The 56 module constants compile cleanly in one instance. But a deep *copy* of a `PAYLOAD_SCHEMA`
  (same `$id`, new object) makes Keyring's `validate` **throw** `schema with key or id
  "https://trusttasks.org/spec/hcp/entries/query/0.1" already exists`. It does not return a verdict. The demo's
  validator throws the same way, and `RESPONSE_PAYLOAD_SCHEMA` (which has no `$id`) does not throw. A copy can
  reach the validator in two ways: two copies of the library in the bundle (a hoisted copy and a nested one), or
  a spec registry that clones schemas. I did not check whether `consumeInbound` turns that throw into a refusal.
- **Ajv warnings.** K logs `unknown format "uri" ignored …` and `unknown format "date-time" ignored …` once per
  compiled schema path, through `console.warn`. The default logger is on in `validator.ts`. A Keyring test already
  documents that formats are ignored on purpose: `packages/core/src/modules/trust-tasks/__tests__/pcsVtaPayloads.test.ts:60-63`,
  "the shared schemas use formats ajv does not know without ajv-formats".

**The claim "Keyring ignores format" (schema-vectors F4 and `signing-formats.md:54,312`): CONFIRMED by running it.**
The Ajv warnings and the verdicts show it. On hcp/* schemas the practical effect is:

- **Timestamps:** not checked at all. Any string, even `""`, passes.
- **URIs:** checked only by the PR's pattern.
- **Everything else:** `pattern`, bounds, `required`, nullability, closed roots, `$ref`/`$defs`, and the
  conditionals the schemas carry give the same verdicts as under the reference.

So the claim "Keyring accepts what the reference accepts" now holds by test, not only by reading the code: on all
160 vectors Keyring never rejects what the reference accepts. Keyring accepts a strict superset: the 2 format
controls here, plus the 9 date-time and uri probes above.

What to do on Keyring's side, which is our change and not the PR's: either add ajv-formats to
`@bifold/trust-tasks`'s validator, or check hcp `Instant` members ourselves wherever we act on them. Examples are
grant `expiresAt`, `revokedAt` and `respondedAt`.

## Gap 2: Keyring's real transport against the PR's TSP binding and the VTA's ingress; size caps

Question (b), formats and compatibility with Keyring's real transport. Read: `tt/bindings/tsp/0.2/spec.md` (whole),
`tt/bindings/didcomm/0.2/spec.md` §2-§4.1, `tt/trust-tasks-ts-tsp/src/{envelope,consumer}.ts` and the
`@openvtc/vti-tsp-js` it resolves; Keyring (`d3-fast-send` 5daeba0d0) `packages/trust-tasks/src/{v2Binding,carriage,
TrustTaskEnvelopeV2Message,TspEnvelopeMessage}.ts`, `tsp/{binding,version}.ts`, `core/.../module/{VtaClient,vtiTsp,
VtiMediatorTransport,vtaClaim}.ts`; VTI pin f7b78e29d `vta-service/src/messaging/{handlers,service,tsp_inbound}.rs`,
`vta-sdk/src/tsp_binding.rs`; mediator pin f6ed815 (`external/affinidi-messaging-mediator`); affinidi-tsp 0.3.0 and
tungstenite 0.29.0 from the cargo registry; #2823 `hcp.md` §3-§5.

### What Keyring actually sends to its VTA

- Two carriages, chosen per VTA by `chooseCarriage` (`VtaClient.ts:1959-1969`): TSP when the VTA advertises it and the
  wallet has a TSP identity, else DIDComm v2. #2823 puts Keyring on DIDComm (`hcp.md:131`, `:158`), but both are live.
- **DIDComm v2** (`VtaClient.ts:1993-2003`): `type` = `https://trusttasks.org/binding/didcomm/0.1/envelope`, a fresh
  `id` (the envelope id, not the document's), `from` = manager DID, `to` = `[vtaDid]`, `thid` = the document's
  `threadId`, `body` = the signed document, authcrypted to the VTA and wrapped in a Routing 2.0 forward to the
  mediator (`VtiMediatorTransport.ts:1531-1534`, `:1560-1570`, inner JWE as `attachments[].data.json`).
- **TSP** (`VtaClient.ts:1987-1988`): `packTrustTaskForPeer(..., 'v1')` = binding envelope
  `{"type":"https://trusttasks.org/binding/tsp/0.1/envelope","document":…}` (`tsp/binding.ts:25-27`), sealed with
  `tsp.packV1` as a **Direct** message (`vtiTsp.ts:169-171`), sent as a raw binary frame on the mediator socket
  (`VtiMediatorTransport.ts:1514-1524`). `VID_sndr` = the same `did` that is the document's `issuer`; `VID_rcvr` =
  `vtaDid` = the document's `recipient`.
- The document (`VtaClient.ts:1916-1934`): `id`, `type` (no `#request` fragment), `threadId` (fresh, not equal to
  `id`), `payload`, `issuer`, `recipient`, `issuedAt`, `proof`. No `deliveryId`, no `expiresAt`.

### Findings

**G2-1 (raise, CONFIRMED). The PR's TypeScript TSP binding speaks the pre-1.0 TSP wire, which neither Keyring's VTA leg
nor the pinned VTA speaks. The test program's TSP result therefore does not carry over to Keyring's real frames.**
- `tt/trust-tasks-ts-tsp/package.json:22` `"@openvtc/vti-tsp-js": "^0.2.0"`; installed 0.2.0
  (`trust-tasks-ts-tsp/node_modules/@openvtc/vti-tsp-js/package.json:3`).
- That package writes and reads only TSP major 0: `dist/cesr/wire.js:32` `TSP_VERSION = { major: 0, minor: 0, patch: 1 }`;
  `:294` `return decodeCount(TSP_VERSION.major, stream, cur) !== undefined;`; `dist/message/envelope.js:37-38`
  `throw new Error("tsp: missing or malformed version marker")`.
- Keyring packs TSP 1.0 to a VTA: `VtaClient.ts:1986-1987` "To an upstream service TSP means TSP 1.0" …
  `packTrustTaskForPeer(this.tsp, did, this.vtaDid, document, 'v1')`; `tsp/version.ts:7-8` "`YTSP-BAA` is 1.0".
- The pinned VTA's TSP library speaks 1.0 and refuses another major: affinidi-tsp 0.3.0 (`external/verifiable-trust-
  infrastructure/Cargo.lock:922-923`), `src/message/wire.rs:219` `TSP_VERSION: (u16, u16) = (1, 0)`, `:484`
  `if major != TSP_VERSION.0`.
- Effect, read from code (not run): a Keyring TSP frame given to the PR's `TspConsumer.receive` fails in
  `advertisedSender` (its `decodeEnvelope` throws on the major-1 marker) and is refused as `notForThisReceiver`
  "not a TSP message this consumer can read" (`consumer.ts:148-151`), before any pipeline step. A frame from the PR's TS
  packer would equally be refused by the VTA. The rung used this package for all three parties
  (`rung/package.json` `"@openvtc/trust-tasks-tsp": "file:../tt/trust-tasks-ts-tsp"`; `rung/src/run.ts:28`), so its 48
  frames were major-0 frames.
- Not checked: the Rust crate (`trust-tasks-tsp` on affinidi-tsp 0.5.0, `tt/Cargo.lock:286-287`; not in the local
  registry) and the Dart/Go TSP libraries. UNVERIFIED which wire they write.
- Ask of the PR: move `trust-tasks-ts-tsp` to a TSP 1.0 `vti-tsp-js`, or state which TSP revision the binding's
  libraries implement. Keyring impact: none on Keyring ↔ VTA, which does not use this library; an agent CLI built on
  the PR's TS library could not reach the current VTA over TSP.

**G2-2 (ok, CONFIRMED). Apart from the TSP version, Keyring's TSP framing is exactly what TSP binding 0.2 and the PR's
consumer expect.**
- Envelope: Keyring `tsp/binding.ts:26` `JSON.stringify({ type: TSP_BINDING_ENVELOPE_TYPE, document })` = binding
  §2 (`tt/bindings/tsp/0.2/spec.md:41-46`) = PR `envelope.ts:88`. No `deliveryId`, which is optional (§2.1).
- Mode: Direct (`packV1`, not `packWithHopsV1`). The PR consumer accepts only Direct (`envelope.ts:137-144`).
- Sender binding: `VID_sndr` = `issuer` and `VID_rcvr` = `recipient`, as exact strings (`VtaClient.ts:1926-1927`,
  `:1987`). That satisfies binding §3 (`spec.md:90-99`) and the PR's `TspTransport.deriveParties`
  (`envelope.ts:26-28`).
- Document: `id` and `type` are strings (`envelope.ts:156`). `type` has no fragment, which SPEC §4.4.1 rule 1 makes
  equal to `#request`. The proof is always present, which every hcp spec requires.
- The VTA side matches the same envelope: `vta-sdk/src/tsp_binding.rs:47-79` (`wrap_envelope`), `tsp_inbound.rs:79-94`
  (refuses a frame that is not the envelope). Its reply goes back "in the same envelope it arrived in"
  (`tsp_inbound.rs:149-153`).
- Keyring's TSP inbound checks what binding §3 asks: `vtiTsp.ts:349-363` (`issuer` = TSP sender, `recipient` = us,
  else `identityMismatch`); a payload that is not an envelope is "not a Trust Task", not an error
  (`tsp/binding.ts:42-44` = binding §2 step 2).

**G2-3 (ok, CONFIRMED). Keyring's DIDComm v2 framing matches DIDComm binding 0.2 and the VTA's ingress. An hcp/*
document needs no change on this path.**
- Binding §2 (`tt/bindings/didcomm/0.2/spec.md:37-45`): envelope type, fresh `id`, `to` with one element, `body` = the
  document as an object, authcrypt. Keyring `VtaClient.ts:1993-2003`. §3.1: Keyring sets `thid` = `threadId`, so the
  two agree when both are present (`spec.md:91-97`).
- VTA: `handlers.rs:28-41` routes on that one envelope type. `handlers.rs:59-61` reads the body as the document.
  `accept_from_proven_sender` requires the document's proof to verify as its `issuer`, and that issuer to be the
  authcrypt sender (`handlers.rs:89-99`, `:111-121`). Keyring signs as the same DID it seals from
  (`VtaClient.ts:1910-1915`, `:1926`, `:1997`).
- Note: the VTA re-serialises `message.body` with serde before verifying (`handlers.rs:61` `serde_json::to_vec(&message.body)`).
  JCS makes this order-independent. Signing-formats covers JCS, so this gap does not re-check it.

**G2-4 (note, CONFIRMED). The VTA threads its DIDComm reply to Keyring's envelope `id`, not to the document's
`threadId`, which differs from DIDComm binding 0.2 §3.1. Keyring tolerates this; a strict §3.1 consumer would not.**
- `service.rs:751-755` `let thid = reply.thid.unwrap_or(msg_id); … .thid(thid)`; `handlers.rs:155-156` "the service
  sets `thid` from the inbound message id". The reply document's `threadId` is the request's `threadId`
  (framework rule, `tt/trust-tasks-rs/src/document.rs:390-403`; the VTA builds replies with trust-tasks-rs
  `success_response`/`reject_with`, `vta-service/src/trust_tasks/app_state.rs:51`).
- Binding §3.1: "A *producer* **SHOULD** set `thid` from the document's `threadId`" (`spec.md:91`); and where both are
  present they "**MUST** be equal … reject a mismatch with `malformedRequest`" (`spec.md:95`). Keyring's envelope id
  is different from its `threadId` (`VtaClient.ts:1916-1918`), so on a VTA reply both are present and unequal.
- Keyring: `VtaClient.deliver` matches the reply's `thid`, `pthid` or `body.threadId` against
  `{envelopeId, documentId, threadId}` (`VtaClient.ts:1233-1239`, `:1944`). It runs no §3.1 check on this leg (`checkV2ThreadCorrelation`
  is used only in `DidCommV2Carriage.ts:108` and the witness server). So it works.
- Over TSP, Keyring shows the reply document's own `threadId` as `thid` (`vtiTsp.ts:227-240`). That matches too.
- Ask: this belongs to VTI (#2823 or an issue), not to the PR. An agent client or Management Client that applies the
  PR's own DIDComm consumer rules to VTA replies would refuse them.

**G2-5 (note, CONFIRMED). Keyring's VTA client would take a `trust-task-next-step` reply as the task's success answer.
Nothing in the hcp suite sends Keyring one today.**
- `sendTask` deals with two kinds of answer only: a DIDComm problem-report (`VtaClient.ts:2086-2089`) and a type that
  starts with `trust-task-error/` (`:2106-2109`). Anything else matched by thread is returned as `body.payload`
  (`:2110`). Keyring knows the next-step type only in `vtaClaim.ts:36`, `:294` (the Farm's HTTPS claim flow).
- In the suite, only `hcp/grants/request` holds (`specs/hcp/grants/request/0.1/spec.md:171-178`, which must answer with
  `trust-task-next-step`, `continuation: resubmit`). That is a Context Client task. No Management Client task holds
  (a grep of `specs/hcp/**/spec.md` finds next-step only in grants/request). The VTA's own consent hold on Keyring's
  tasks stays a `trust-task-error` with `auth:consent_required`, which Keyring reads (`VtaClient.ts:665-713`).
- It matters only if (a) the VTA moves its general consent hold to next-step, as #2823 does for grants/request
  (`hcp.md:299-303`), or (b) the agent plugin reuses `VtaClient` for `hcp/grants/request`. It also reuses a fresh
  `threadId` per send, which breaks the same-thread resubmit (`VtaClient.ts:1916`; signing-formats Q3). Our plan
  routes the plugin through vta-mcp, so neither applies yet. Nothing to ask of the PR; this is a Keyring
  to-do if either one happens.

**G2-6 (ok, CONFIRMED). A VTA notice to Keyring gets through on either carriage.**
- #2823 sends Keyring a VTA-signed `task-consent/request` (`hcp.md:159`, `:289`). Keyring lists that type as
  unsolicited (`VtaClient.ts:175`, `:888-894`) and hands it to `onInbound` before any thread matching
  (`:1221-1224`), whether or not a task is waiting.
- On DIDComm it arrives as the binding envelope with `body` = document. On TSP, `plaintextFromTrustTask` shows the
  document as the body (`vtiTsp.ts:227-240`; delivered at `VtaClient.ts:1479-1485`). `deliver` reads `body.type`
  either way.
- The mediator transport filters nothing by envelope type on this leg (`VtaClient.ts:1471`).
- Not in scope here: whether Keyring's consent check accepts it "only for the VID and threadId it scanned"
  (`hcp.md:159`). That is new consent-screen logic, which the rung exercised.

**G2-7 (raise, CONFIRMED caps; sizes on the wire computed, not measured). A mediator with default settings refuses any
message over 1 MiB on both DIDComm and TSP. Most of the hcp size bounds are far above that, the largest by 12 to 28
times.**
- The mediator checks every ingress against `limits.message_size`. It says so at `crates/affinidi-messaging-mediator/
  src/messages/inbound/mod.rs:32-36`: "Every ingress path (HTTP `POST /inbound`, WebSocket text, WebSocket binary /
  TSP) funnels through…". The DIDComm check is at `:70`, the TSP check at `inbound/tsp.rs:51`. The answer is problem
  code 100 `message.size.exceeded` (`mod.rs:49-60`).
- Defaults: `affinidi-messaging-mediator-config/src/defaults.rs:48-49` `MESSAGE_SIZE: usize = 1_048_576`;
  `:60-61` `WS_SIZE: usize = 10_485_760`; `:35` `HTTP_SIZE: usize = 10_485_760` (`conf/mediator.toml:492-497`). `message_size` must be no larger
  than `http_size` and `ws_size` (`conf/mediator.toml:575-580`). Raising it past 10 MiB therefore means raising all
  three.
- Keyring's own mediators run at those defaults: `deploy/keyring-messaging/mediator/mediator.toml:126`
  `message_size = "1048576"`, `:134` `ws_size = "10485760"`; `deploy/keyring-messaging/mailbox/mailbox.toml:192`,
  `:202` (the same). The Farm's and the ecosystem dev mediator's settings: UNVERIFIED.
- On the VTA and agent side, the SDK's WebSocket uses tungstenite's defaults (`affinidi-messaging-sdk/src/transports/
  websockets/proxy.rs:262` `connect_async(request)`). In tungstenite 0.29.0 that is a 16 MiB frame and a 64 MiB
  message (`src/protocol/mod.rs:101-102`). The TSP codec itself allows about 48 MiB
  (`affinidi-tsp/src/message/wire.rs:41`). Neither is the binding limit.
- Keyring has no size guard of its own on this leg: it sends DIDComm as one text frame (`VtiMediatorTransport.ts:1500-1505`)
  and TSP as one binary frame.
- The declared bounds exclude the transport envelope (SPEC §7.3 item 21, `tt/SPEC.md:1297`). By the encoding, a
  DIDComm message through a forward is the document behind two JWE layers, each base64url (about 4/3 each). That makes
  roughly 1.78 times the document, so a default mediator takes a document of about 0.56 MiB at most. TSP is binary
  (CESR, HPKE): roughly 1 times, about 1 MiB at most. Computed, not measured.
- Bounds against that (front matter `maxDocumentBytes`, read from each spec): import request 16 MiB; export response
  14 MiB; entries/query response 12 MiB; grants/read-own 5 MiB; grants/list, rules/list, directives/list 4 MiB;
  audit/read, delegations/list, disclosures/summary 2 MiB; grants/request response 1 MiB; entries/* 512 KiB. Only
  the 512 KiB documents fit a default mediator on both carriages. The 1 MiB grants/request response fits only over
  TSP, and only just.
- Failure shape: if a VTA reply is too large, the VTA's own send to the mediator is refused, and the send is
  `Delivery::BestEffort` (`service.rs:757-765`). Keyring then hears nothing and ends with `VtaNoAnswer` after the
  timeout (`VtaClient.ts:2023-2080`). It does not get `hcp:exportTooLarge`, which the provider sends only above the
  spec's own 14 MiB (`specs/hcp/export/0.1/spec.md:323`). An export between about 0.56 and 14 MiB is within its bound
  and still lost on the wire, with no error. How the VTA-side send logs it: UNVERIFIED.
- The VTA at the pin enforces no `maxDocumentBytes` on DIDComm or TSP (a grep finds none in `vta-service/src` or
  `vta-sdk/src`). Its REST route is capped at 1 MiB (`routes/mod.rs:84`).
- The PR's TSP binding states no carriage limit, and its TS consumer says "this binding has no transport body limit of
  its own to fall back on" (`consumer.ts:88-90`).
- #2823 puts export/import in V2 with the full HTTP Binding (`hcp-plan.md:145-150`). The export spec already names
  HTTP as the way to take an export too large for the task (`export/0.1/spec.md:323`). So there is a way out. But
  nothing in the suite or #2823 says that through a mediator, the effective limit sits well below the declared bound.
- Ask of the PR: say in the TSP binding (or the hcp `_shared` conventions) that the declared bounds are not carriage
  guarantees: mediators commonly cap a message at 1 MiB, and DIDComm through a forward adds about 78%. Ask for a
  provider to refuse with the spec's size error (`hcp:exportTooLarge` for export) when the reply would exceed what
  its carriage to that client can carry, rather than send it and lose it. Ask #2823 how V2 export/import reach a
  Management Client that sits behind a mediator.
- Keyring impact: at today's mediator settings Keyring cannot move an hcp/export or hcp/import of any real size over
  its real transport. It would need the HTTP Binding, raised limits on its mediators (and on the VTA's), or chunking.
  Even the 2-5 MiB list and read answers can exceed the cap at their bounds.

### Not checked in this gap
- Live frames: nothing here was sent. G2-1's refusal and G2-7's ratios are read from code and computed.
- React Native WebSocket send and receive limits (OkHttp on Android, SocketRocket on iOS): UNVERIFIED.
- The mediator's pickup `delivery` budget (`message_pickup.rs:43-55`) for a stored message near the cap.

## Gap 5: (d) could these Trust Tasks run as ceremonies later? The ceremony member on the wire

Written 2026-11-25. What was missing: the ceremony evidence (`notes/ceremonies.md` §6) was static only. Nothing had
sent an `hcp/*` document carrying a `ceremony` member through the PR's TS consumer, the grants/request
resubmission match, or Keyring's documentProof code. Nobody had checked either whether a `trust-task-error`
can be a terminal step.

### Setup (the original rung is unchanged)

- The rung was copied, not edited, to
  `<scratch>/rung-ceremony/`
  (its `node_modules` is a symlink to `rung/node_modules`; nothing was installed). The script
  `scratchpad/rung-ceremony-tools/patch.py` (with `gapchecks.ts`) changes the copy. The original `rung/src/*.ts` still
  matches its sha1 (`scratchpad/rung-orig.sha`), and `rung/out/report.json` was not written.
- With `CEREMONY=1`, every connect and revoke document carries `ceremony {enactment, step, round?, terminal?}`:
  - The agent's first request is `ask`. Each resubmission is `collect` with round 1..n. Each next step is `hold`
    with round 1..n. The consent request and Keyring's acknowledgement are `consult`. Keyring's decision is `approve`,
    or `decline` with terminal set. The grant response is `grant`, terminal.
  - The refusal after a decline is a new `refuse` step, terminal. The toy provider signs it.
  - Keyring's `revoke` is terminal, and so is its reply. The notice is `notify` #1/#2, and the agent's reply is
    `acknowledge` #1/#2.
  - The probe-b connect also carries a member.
- `DECISION_DELAY_MS=3500` holds the person's decision back, so a hold lasts 4 rounds. Otherwise the approval lands
  before the first resubmission and only round 1 is tested.
- All runs used Node 22.17.1 (`~/.nvm/versions/node/v22.17.1`) in memory (`--loopback`), with no mediator.

| Run | Result |
|---|---|
| baseline copy, no member | 30/37, the same 7 as the README |
| baseline, decision delay 3500 ms | 30/37, same 7 |
| `CEREMONY=1`, 200 ms | 38/47 |
| `CEREMONY=1`, 3500 ms | 38/47 |

**None of the 37 original checks changes** when the member is added: the same id gives the same verdict in all four
runs. The one schema note (entries/create without `accessToken`) is the same in all of them. Reports:
`scratchpad/gap5-{base,base-3500,cer-200,cer-3500}.json`.

### New checks (`CEREMONY=1`, 3500 ms run)

| Check | Result | Observed |
|---|---|---|
| c-members-present | ✓ | 37 of 37 connect/revoke documents arrived with their member. The PR's `TspConsumer` hands the `accepted` document on with `ceremony` intact (the agent's acknowledgement copied `accepted.ceremony.round`). |
| c-envelope-schema | ✓ | All 38 documents carrying a member validate against `specs/_framework/0.6/trust-task.schema.json` (ajv 2020). |
| c-resubmit-rounds | ✓ | `collect` rounds [1,2,3,4] and `hold` rounds [1,2,3,4], then `grant!`. The held request still matched, because the match compares only the payload (`kr.jcs(p)`), as grants/request spec.md:174-176 and the PR demo (`examples/hcp-demo-ts/src/demo.ts:348,356` `canonicalize(doc.payload)`) do. Wire order: `VTA<-ask Agent<-hold#1 Keyring<-consult VTA<-consult VTA<-collect#1 … Agent<-hold#4 VTA<-approve Keyring<-approve VTA<-collect#4 Agent<-grant!` |
| c-proof-covers-ceremony-provider | ✓ | A VTA-signed grant reply with a member verifies under Keyring's `verifyTrustTaskProof` and under the PR's `DataIntegrityProofVerifier`. Change `ceremony.round` to 2 and both refuse (`kr=proof`, `pr=false`). |
| c-proof-covers-ceremony-keyring | ✓ | A Keyring-signed decision with a member verifies under the PR verifier and under Keyring's strict `verifyDocumentProof(assertionMethod)`. Add `terminal: true` and both refuse. Keyring signs everything except `proof` (`documentProof.ts:420,543` `const { proof, ...unsecured }`), so the member is covered, as SPEC §4.11.3 requires. |
| c-decline-terminal-error | ✓ | After the decline, the next resubmission gets a signed `trust-task-error/0.6` `permissionDenied` carrying `{enactment, step:"refuse", terminal:true}`, and both verifiers accept its proof. It passes only because the toy provider built and signed the refusal itself; see the next two rows. |
| c-lib-carries-ceremony | ✗ | **The PR's TS `respondWith` and `rejectWith` do not copy `ceremony`**, though they do copy `parentThreadId` (`trust-tasks-ts/src/_runtime/document.ts:446-462`, `:506-519`). SPEC.md:659 says a producer SHOULD carry the same enactment "onto every document of the step it names, including any *error response*". The PR's Rust library does copy it (`trust-tasks-rs/src/document.rs:369` and `:409` `ceremony: self.ceremony.clone()`), and the pinned VTA relies on that (`vta-service/src/trust_tasks/helpers.rs:746-750`: "The *routed* rejects get this right for free, because `reject_with` copies it"). Go and Dart builders not checked. |
| c-pipeline-refusal | ✗ | An unsigned grants/request carrying a member is refused `proofRequired` by the TS consumer's own pipeline, with no `ceremony` and no `proof`. A refusal like that can never be a receipt step (receipt spec.md:138 rule 11 verifies "each held step document's own `proof`"), and it can never carry the signed terminal marker (spec.md:88-90). |
| info-malformed-ceremony | ✓ (as described) | A Keyring grants/list whose member has no `enactment` and has `round: 0` is still answered by the TS consumer, because `envelope.ts:35` checks only that `ceremony` is an object. The 0.6.0 envelope schema refuses it (`/ceremony must have required property 'enactment'`, `/ceremony/round must be >= 1`). Not answering it would be wrong: SPEC.md:671 says a consumer MUST NOT reject on the member alone. Rust, Go and Dart typed decoding were not run here, so whether they refuse it is UNVERIFIED. |
| c-revoke-steps | ✓ | `VTA<-revoke! Keyring<-revoke! Agent<-notify#1 VTA<-acknowledge#1 Agent<-notify#2 VTA<-acknowledge#2`. The notice retry with the same `noticeId` is round 2, and the dedupe check (`notice-dedupe`) still passes. |

### Can a step be typed trust-task-error and marked terminal? Yes, as far as the schema and the JS checker go

- `ceremonies/ceremony.meta.schema.json:145-149`: a step's `type` is any URI "including any #request / #response
  fragment". `:206-209` says `terminal` "Marks a step that can end the enactment". No rule excludes a reserved
  `trust-task-*` type.
- Experiment (`scratchpad/ceremony-check/gap5/`): the draft connect plus a step
  `refuse {type: trust-task-error/0.6, issuer: provider, recipient: context-client, prev: [collect, decline], optional, terminal}`,
  with completion `allOf[ask, consult, anyOf[allOf[approve, grant], allOf[decline, refuse]]]`. Result:
  **`ok … (8 steps, 3 roles, evidence: receipt)`**.
  - Control: the four original drafts still pass.
  - Negative control: the same definition typed `trust-task-error/0.9` fails with `names Type URI with no spec in this
    registry`, so the type really is resolved.
- The framework itself makes this the decline outcome. SPEC.md:779 (rule 2) says: "For a task that does not exist to
  produce a decision, a deny after a declined referral is `permissionDenied`". The verdict table (SPEC.md:768-774) says
  of a may-not-ask deny: "Ends."
- No precedent: none of the shipped definitions uses `trust-task-error` as a step. Vetting ends a decline with its own
  task (`ceremonies/vetting/identity-vetting/0.1/ceremony.json:59` `"decline"` = `vetting/decline/0.1`, terminal).
  None of them uses a `#response` type as a step either. Every step there is a separate bare-typed task.
- Receipt verification of such a step was **UNVERIFIED**:
  - No JS receipt builder or verifier exists. The TS library has only the generated payload type
    (`trust-tasks-ts/src/trust-ceremony-receipt/0.1/payload.ts`), and there is no step-digest helper. Keyring has
    neither (it uses `ceremony.enactment` only, in `sharedConnect*.ts`).
  - The only verifier is the Rust crate `trust-tasks-ceremony`, and cargo builds are not allowed here.
  - From reading its source:
    - It checks a receipt entry's `typeUri` against the declared type by exact string (`lib.rs:557-566`), with no
      bare-vs-`#request` normalization, although SPEC.md:191-192 calls the two forms equivalent.
    - It rejects `round > maxRounds` as Invalid (`lib.rs:569-572`).
    - It leaves verifying each step's proof to the caller (`lib.rs:13`).
    - Nothing in it singles out a `trust-task-error` step (`grep -c trust-task-error lib.rs tests.rs` gives 0).

### What this means for (d)

1. **ok.** A `ceremony` member can be added to `hcp/*` documents without breaking anything:
   - the PR's TS consumer passes it,
   - the resubmission match ignores it (it lives outside `payload`),
   - Keyring's signer covers it and Keyring's verifiers check it,
   - and changing it after signing is caught by both verifiers.
2. **raise (library).** The TS `respondWith`/`rejectWith` drop the member, but Rust copies it. A TS producer, which
   includes Keyring if it builds replies with these helpers, falls out of the enactment on every reply and every
   error unless the caller adds it back. This is a parity gap between the PR's own languages. Ask: copy `ceremony` in
   the TS builders (and check Go/Dart).
3. **raise (spec design).** Copying is not enough for a receipt either.
   - What gets copied: Rust copies the whole member, including the request's `step`, `round` and `terminal`. So a
     response is labelled with the request's step. That is wrong for a definition that, like the draft and every shipped
     one, names the outcome as its own step (`grant`, `refuse`).
   - Who has to set it: the provider has to set the outcome step and the signed `terminal` itself.
   - Pipeline refusals: they are unsigned and unmarked (c-pipeline-refusal). An enactment that ends in one has no
     terminal step document. A receipt verifier then reports it Unverifiable, never Complete.
4. **raise (HCP polling vs bounded rounds).** HCP's hold is open-ended: "A hold lasts as long as the provider is willing
   to wait" (grants/request spec.md:178). The PR demo uses `retryAfter: 1` (`demo.ts:407`). The ceremony format
   forbids unbounded repetition ("Unbounded repetition is deliberately not expressible", meta schema `:196`), and the
   Rust verifier marks `round > maxRounds` Invalid.
   - With `retryAfter` 1 s, the draft's `maxRounds: 60` covers about one minute of a `PT2H` window. A 3.5 s decision
     here already used 4 rounds.
   - Ask: either the polling resubmissions are not ceremony rounds (the hold is one step, and only the collect that
     gets the outcome is a step), or the spec ties `retryAfter` to the hold's lifetime, so a definition can bound
     `maxRounds`.
5. **note (privacy).** grants/request spec.md:293 gives every `permissionDenied` the same fixed message, so that a client
   "cannot tell a decline from an unknown person". A signed `ceremony.step` on the refusal undoes that if the
   provider names it differently in the decline case (`decline`, or `terminal` only on a decline). The toy marks
   every grant-request refusal `refuse`/terminal the same way. A definition and its provider would have to do the same.
6. **note (new ceremony after an abandoned hold).** SPEC.md:782 (rule 5) says "A *producer* that wants a new decision
   issues a new document, which begins a new ceremony". grants/request spec.md:178 says that after an abandoned hold,
   "a later resubmission is a new request, put to the person again". That resubmission still carries the old
   enactment, and the client is not told the hold was dropped. Neither spec says whether it continues the old
   enactment or must start a new one.
7. **note (Keyring).**
   - Keyring's reply path does not check the proof on a `trust-task-error` at all (`vtaReplyProof.ts:33`
     `{ kind: 'exempt' }`). So Keyring would have to verify a signed terminal error explicitly before keeping it as
     step evidence.
   - Keyring's `consentCheck` exact type match (probe-consent-fragment) is unchanged by the member.

Not proven here:
- no mediator (in-memory only);
- no receipt was built or verified (no JS implementation; cargo not allowed);
- no salted step digests or `prev` chain;
- projection and reachability are still not checked by `validate-ceremonies.mjs`;
- the Go, Dart and Rust consumers were not run with the member.
