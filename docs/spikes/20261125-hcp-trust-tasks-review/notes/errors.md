# Track: error handling and held requests (HCP suite vs Keyring and VTA)

Read-only review, 2026-11-25. Sources read:

- PR branch `pr1382` (suite #1380 + demos #1382) at `<review>/tt` (head e163cac1d); `pr1381` read with `git show`.
- Framework at our pin 2a66a0351: `<keyring-main-checkout>/external/dtgwg-trust-tasks-tf`.
- HCP 2.0-draft-3 at b790561: `<review>/hcp-spec`.
- VTI #2823 design docs: `<review>/vti2823/docs/05-design-notes/{hcp,hcp-plan,hcp-tasks}.md`, `tasks/hcp-demo-plan.md`.
- VTI source pinned at f7b78e29d: `<keyring-main-checkout>/external/verifiable-trust-infrastructure`.
- Keyring at `<keyring>` (head 5daeba0d0).
- Our plan: `<plan-checkout>/docs/plans/agent-connect-plan.md` and `agent-connect-plan/2026-11-25-bam.md`.

Verdict legend per item: **compatible as is** / **needs work in Keyring** / **needs a change in the PR** (or in VTI #2823).

---

## Q1. What the hcp/* specs say about errors and holds

### 1.1 Codes used

Counted over `specs/hcp/**/0.1/spec.md` (28 specs):

| Code | Kind | Where | retryable |
|---|---|---|---|
| `malformedRequest` | standard | all 28 (HCP `malformed-request`; also unsupported `narrowedTo`, bad `onwardSharing`, a grants/request resubmission whose payload differs) | false |
| `permissionDenied` | standard | all 28 (HCP `scope-denied`, the wrong-VID token, an unregistered client, a decline, an unknown person, an interloper on a held thread, a resubmission after the post-approval hour) — "one fixed `message` whatever the reason" | false |
| `unavailable` | standard | all 28 (HCP `subject-unavailable`; HCP `rate-limited` "with `retryAfter`") | true (default) |
| `unsupportedVersion` | standard | all 28 (HCP `unsupported-version`) | false |
| `idConflict` | standard | entries/create, revise, withdraw, hard-delete (HCP `idempotency-conflict`) | false |
| `hcp:invalidToken` | extended, family ns | 26 front-matter declarations (every task that carries `accessToken`); HCP `invalid-token`, and also a revoked grant | false |
| `hcp:versionConflict` | extended, family ns | entries/confirm, restrict-purposes, revise, set-categories | false |
| `hcp:credentialInvalid` | extended, family ns | entries/create, revise | false |
| `hcp:exportTooLarge` | extended, family ns | export only ("not an HCP error", export spec.md:311) | false |

No hcp spec declares a `detailsSchema`; no HCP error carries `details`.

### 1.2 HCP 5.5 / error.json / problem.json → Trust Task code

HCP's Core error object (`schemas/2.0-draft-3/error.json`: `{type, detail}`) and HTTP problem details (`problem.json`: `{type: https://hcp.example/problems/<code>, title, status, detail}`) are **never sent** by the carriage (entries/query spec.md:278 "It never sends HCP's Core error object or the HTTP binding's problem details (HCP 9.7)"). The mapping, identical in every spec that has the row (checked by script over all 28 Errors tables):

| HCP 5.5 | HTTP (9.7) | Trust Task |
|---|---|---|
| `malformed-request` | 422 | `malformedRequest` |
| `invalid-token` | 401 | `hcp:invalidToken`, retryable false (also: grant revoked or expired) |
| `scope-denied` | 403 | `permissionDenied`, one fixed message |
| `idempotency-conflict` | 409 | `idConflict` where the task is a write; "does not arise" elsewhere |
| `version-conflict` | 409 | `hcp:versionConflict` (4 entries specs); "does not arise" elsewhere |
| `credential-invalid` | 422 | `hcp:credentialInvalid` (create, revise); import reports per item in its response |
| `subject-unavailable` | 503 | `unavailable` |
| `rate-limited` | 429 + Retry-After | `unavailable` with `retryAfter` (grants/revoke and relinquish: `unavailable` only — revocation is never rate limited, HCP 6.2.1) |
| `unsupported-version` | 400 | `unsupportedVersion` |

grants/request has its own table (spec.md:283-293): decline, unknown person, unregistered client, interloper and late resubmission are all `permissionDenied`; throttling `unavailable` with `retryAfter`.

### 1.3 How an error travels

`https://trusttasks.org/spec/trust-task-error/0.6`. Payload schema (`specs/trust-task-error/0.6/payload.schema.json`): `code` and `retryable` REQUIRED; `message` (≤1024), `retryAfter` (RFC 3339 **date-time**), `details` (object), `inResponseTo {typeUri, id?}`, `additionalProperties: false`. Code is a standard enum value or `^ns(/ns)*:local$`. `specs/trust-task-error`, `specs/trust-task-next-step` and `specs/task-consent` are byte-identical on `pr1382` and at our pin 2a66a0351 (`diff -r` empty).

Example (entries/query spec.md:260-274): `{"code":"hcp:invalidToken","message":"The access token is not valid.","retryable":false}`, unsigned in the spec example; signed in the demo transcript (transcript.golden.txt:392-416, with `inResponseTo` filled by the library's `rejectWith`, trust-tasks-ts/src/_runtime/document.ts:434-444).

### 1.4 Signed vs unsigned

- Demo (`examples/hcp-demo-ts/src/demo.ts:465-489`): `PIPELINE_CODES` = malformedRequest, unsupportedType, unsupportedVersion, unsupportedExtension, expired, proofRequired, proofInvalid, wrongRecipient, identityMismatch, idConflict. The TS library's SPEC §7.2 pipeline builds those unsigned (trust-tasks-ts-tsp/src/consumer.ts:186-209, 239-241); every handler reply (response, next step, refusal) is signed by the demo (`World.sign`, demo.ts:218-221, 260-263). `checkReply` accepts an unsigned reply only if it is a trust-task-error with a pipeline code. TSP's sealed, signed envelope authenticates either way; the proof matters for retention.
- `trust-task-error/0.6` proofRequirement is RECOMMENDED (spec.md:24-26).
- The VTA at f7b78e29d signs every reply, errors included (`sign_response`, vta-service/src/trust_tasks/mod.rs:694-763; an unsignable error goes out unsigned, :759-762). So for Keyring and our plugin, VTA errors arrive signed.
- Note: `malformedRequest` and `idConflict` can be either pipeline (unsigned in TS) or handler (signed) — the demo's own "resubmission differs" refusal is a signed handler `malformedRequest` (demo.ts:356). A client cannot use "signed" to tell which layer refused.

### 1.5 How a hold is signalled (grants/request only)

Only `hcp/grants/request` holds (grep for "next step"/"hold" over the other 27 specs finds none). grants/request spec.md:169-180:

1. reply `trust-task-next-step/0.1` with `expects[0].typeUri = …/hcp/grants/request/0.1#request`, `continuation: "resubmit"`, `inResponseTo {typeUri, id}` (example :184-215); never an error;
2. client resubmits: new `id`, same `threadId`, same `issuer`, same payload;
3. matched by (`threadId`, `issuer`); another issuer → `permissionDenied`, hold unaffected;
4. no second ask for a held thread; a differing payload → `malformedRequest`, hold unaffected;
5. `hint.retryAfter` **in seconds** (SHOULD), client SHOULD NOT resubmit sooner;
6. hold length is provider policy; an abandoned hold "leaves nothing pending, and a later resubmission is a new request, put to the person again".

After approval: same grant for 1 hour after the first response; later → `permissionDenied` (spec.md:307-314).

The next-step 0.1 schema leaves `hint` open ("governed by the specification named in typeUri", payload.schema.json); grants/request publishes **no schema** for its hint (its payload.schema.json mentions only `subjectHint`).

---

## Q2. Keyring today

### 2.1 VtiRefusal shape — needs work in Keyring (small)

- `VtiRefusal(code, message, details?)` (`packages/core/src/modules/trust-tasks/module/vtiAgent.ts:390-400`). Built from any `…/trust-task-error/<any>` by prefix (vtiAgent.ts:90, 516-525; VtaClient.ts:145, 2106-2108). **`retryable`, `retryAfter` and `inResponseTo` are dropped.**
- `retryable` is read only on Farm paths (`farmSignIn.ts:142-145, 178`; `vtaClaim.ts:352`; `agentHostConnection.ts:207`), never on the VTA leg. So HCP's `unavailable` + `retryAfter` (rate-limited, subject-unavailable) would surface as a plain failure; nothing waits or retries. For P0's few calls that is acceptable; for the HCP screens (new memory, revoke poll of `disclosures/summary`) Keyring should keep `retryable`/`retryAfter` on VtiRefusal and honour them.

### 2.2 Versions — compatible as is

- Keyring emits `trust-task-error/0.5` (vtiVetting.ts:119-126), reads 0.6 as 0.5 in vetting (`TASK_ERROR_EXTENDS`, vtiVetting.ts:133-136), and reads any version by prefix on the VTA and VTC legs. The suite's errors are 0.6. The VTA emits 0.6 (`framework_error_type_uri`, vta-service/src/trust_tasks/helpers.rs:705).
- Keyring is not asked to emit any HCP error: as Management Client it receives no hcp/* request (the revocation notice goes to the Context Client).

### 2.3 next-step and resubmit on the same thread — needs work in Keyring (not for V0)

- Keyring parses `trust-task-next-step/0.1` in exactly one place: the Farm claim (`vtaClaim.ts:36, 294-307`: checks `inResponseTo.id/typeUri`, finds the expected redeem in `expects`, reads `hint.handle`); the claim and its redeem polls share one `threadId` (`base.threadId`, vtaClaim.ts:280, 329). That is a `proceed`-style flow, not `resubmit`.
- On the VTA leg (`VtaClient.sendTask`) every send mints a **fresh** `threadId` (VtaClient.ts:1916), and any reply that is not a trust-task-error is returned as the task's answer (`return (body?.payload ?? body) as T`, VtaClient.ts:2110). A next step there would be read as a success payload.
- Keyring's held-task handling today is error-shaped: consent hold = trust-task-error with `details.reason = "auth:consent_required"` (`consentPendingOf`, VtaClient.ts:665-713; resubmit loop VtaClient.ts:1647-1690, each resubmit a new thread, stops when the challenge changes → `consentNotGiven`); step-up = `auth:step_up_required` with `details.approveRequest` (stepUp.ts:99, 149-194; VtaClient.ts:1813-1895). This matches what the VTA emits at the pin (policy_gate.rs:702-709: `RejectReason::TaskFailed { reason: "auth:consent_required", details }`), which SPEC §8.6 forbids ("MUST NOT answer with `taskFailed` … whose … `details` says the task is held", SPEC.md:1533 on the PR branch; same rule at our pin, SPEC.md:1414).
- For V0 this does not bite: Keyring sends no held hcp/* task (grants/request is the agent client's). It bites the day the VTA moves its policy gate to next steps.

### 2.4 Namespaced codes and splitting — compatible as is

- `refusalCode` takes the text after the **last** `:` (rooms/real/wire.ts:344-349, preferring `details.code`); `joinRequestRefusal` / `selfRemoveRefusal` use `split(':').pop()` (vtiAgent.ts:441-447, 479-483); files/upload.ts:125 the same. SPEC §8.5 (SPEC.md:1478) makes the local part colon-free, so last colon = first colon: `hcp:invalidToken` → `invalidToken`.
- No Keyring matcher tests `invalidToken`, `versionConflict`, `credentialInvalid`, `exportTooLarge`, `unavailable`, `taskFailed`, `internalError` on a refusal (grep over packages/core/src). So no collision, and no special handling either.
- The matching is namespace-blind, which SPEC §8.5 rule 1 forbids for codes kept beyond an exchange, but each Keyring call site knows the request it sent (the non-normative paragraph at SPEC.md:1486 says within one exchange nothing more is asked).

### 2.5 Step-down — compatible as is

`TaskVersions.ask` steps down only when `refusal.code` is exactly `unsupportedVersion` or `unsupportedType` (taskVersions.ts:30-31, 104). No `hcp:` code triggers it. HCP's `unsupported-version` maps to `unsupportedVersion`; every hcp family is 0.1-only, so `versionAfterRefusal` finds nothing older and the refusal is rethrown. A VTA built without the `hcp` feature should answer `unsupportedType` (per the taskVersions.ts:6-12 description of `method_not_found`; not checked for hcp specifically): Keyring's flagged HCP screens need a "your agent doesn't offer this" state.

---

## Q3. The VTA's emitted errors at f7b78e29d, and neutral denial

- Emits trust-task-error/0.6, routed via `reject_with` (helpers.rs:483-495) and unrouted (helpers.rs:705-747). Over DIDComm a refusal of a trust-task envelope is a trust-task-error, not a problem-report (messaging/handlers.rs:93-98); Keyring's problem-report branch (VtaClient.ts:2086-2089) is a fallback for older agents.
- `AppError::Forbidden/Unauthorized/Authentication` → `permissionDenied` with `message = err.to_string()` (helpers.rs:153-158), e.g. `"DID not in ACL: <did>"` (vti-common/src/acl/mod.rs:1370-1373). NotFound/Conflict/Gone → `taskFailed` + `details.reason` (helpers.rs:192-194). internalError messages are scrubbed (helpers.rs:195-210).
- `details` bounded at 4096 B JCS / 16 members, shedding `consentRequests` first (helpers.rs:284-330).
- **No `trust-task-next-step` anywhere** in vta-service, vta-sdk, vta-mcp or vti-common (grep empty). HCP needs a new emission path in the VTA, and our plugin's path needs it read: vta-sdk `names_a_reply` counts only `#response` and errors as replies (vta-sdk/src/inbound.rs:131-140), vta-sdk `trust_task_error` ignores an error with no `message` (client/mod.rs:2526-2528), and vta-mcp maps every `VtaError` to an MCP `internal_error` with the text (vta-mcp/src/server.rs:87-90).
- VTI #2823's own error vocabulary disagrees with the PR (finding F8): hcp.md:197-200 and hcp-tasks.md:96-98 say revoked, expired, wrong-purpose and unknown tokens "all answer the same `scope-denied`"; the PR sends `hcp:invalidToken` for the first, second and fourth and `permissionDenied` for wrong purpose, and `scope-denied` is not a valid trust-task-error code at all (no colon, not in the enum).

**Neutral denial vs Keyring's messages — compatible as is.** Keyring already words refusals from codes, with the code "behind a Details control" (vtiAgent.ts:384-389; e.g. polls/pollWords.ts:173 `refusalText`). A fixed `permissionDenied` text on hcp/* tasks costs Keyring nothing it relies on, with one exception to know: `refusedAsNotOnAcl` reads the VTA's ACL wording from `message` (VtaClient.ts:838-862); a fixed message on hcp/* refusals means that test never fires there, so "this agent no longer accepts this phone" stays detected from Keyring's other tasks only. As Management Client acting for the person, Keyring can re-read its own state (`hcp/grants/list`) to give a specific sentence after a fixed-text refusal.

---

## Q4. The approval leg (task-consent)

- **Versions — compatible as is.** Keyring takes `task-consent/request/0.1` (VtaClient.ts:175; `keepManagerMessage`, vtaAgent.ts:576-585) and answers with `decision/0.2`, stepping down to `0.1` (VtaClient.ts:176-178, 260, 2165-2183). VTI #2823 names request/0.1 + decision/0.2 (hcp.md:26-27, 547).
- **Checked before shown — compatible as is.** `listIfChecked`/`passesCheck` (vtaAgent.ts:3886-3955) run `checkConsentRequest` (consentCheck.ts:82-104: proof, `authentication` purpose, signer = issuer = linked VTA, addressed to this phone, not expired) and do not list a request that fails. (The `requestCheck` comment at vtaAgent.ts:153-156 still says "log-only"; the code gates.)
- **Owner check — compatible as is.** Approve requires the owner's biometric/passcode first (`confirmOwner`, vtaAgent.ts:3962-3978); deny is one tap.
- **What it shows — needs work in Keyring.** `consentOutcome` (consentCheck.ts:47-62) turns `effects[]` into lines of `summary` (else `kind`), else `consequences`, else "could not tell"; ApprovalDetails.tsx renders those lines and the match code. Nothing reads `detail`. The shared Effect schema says a surface "MUST render [summary] verbatim; it MUST NOT substitute its own prose" (task-consent/_shared/0.1/task-consent.schema.json:19-23). Our plan's C1 renders the checklist "row by row from the effects' `detail`" with Keyring's copy (companion :251): that can be added beside the summaries, not instead of them.
- **New for HCP's checklist:**
  1. the effect `kind`s and `detail` shapes for the HCP 6.1.6 items are not published anywhere (VTI hcp.md:263-270 says "one effect per item", kinds open);
  2. the scanned-`threadId` match: task-consent/request/0.1 carries `requester` (the client VID) but no member for the held request's `threadId` (required list: challenge, taskType, payloadDigest, sideEffects, exposure, effects, requester, approverSet, minApprovals, excludeRequester, expiresAt), and Keyring keeps only `body.payload` (vtaAgent.ts:576-585);
  3. the person's choices cannot travel back: decision/0.2 is `{challenge, payloadDigest, decision, reason?, actionId?, evidence?, ext?}` with `additionalProperties: false`, so "approve only these categories", "choose a purpose" (HCP 6.1.5.2, specification.md:1584 MUST, where the request names none), "a shorter duration" or "persistent" have no member; the digest binds the payload as asked. V0 (client names its purposes; approve as asked) works;
  4. repeated asks for one scan (finding F10): Keyring should accept at most one consent request per scanned thread.

---

## Findings (summary; severity in brackets)

- F1 [ok] Code inventory and HCP 5.5 mapping are consistent across all 28 specs.
- F2 [ok] Error shape is trust-task-error/0.6, identical at our pin; Keyring and the VTA both speak it.
- F3 [note] Pipeline errors unsigned in the TS library, handler errors signed; the VTA signs all. malformedRequest/idConflict can be either.
- F4 [note] VtiRefusal drops retryable/retryAfter/inResponseTo — Keyring work for HCP's `unavailable`.
- F5 [ok] `hcp:` codes do not break Keyring's colon splitting or any exact-string matcher.
- F6 [ok] No hcp code triggers Keyring's version step-down.
- F7 [raise] Keyring's VTA leg reads a next step as success and resubmits on new threads; the VTA's policy gate still holds with an error. Fine for V0; ask VTI #2823 whether Keyring's own hcp/* tasks can be held, and in which form.
- F8 [raise] VTI #2823 says `scope-denied` for revoked/expired/wrong-purpose/unknown token; the PR says `hcp:invalidToken` / `permissionDenied`; `scope-denied` fails the 0.6 schema.
- F9 [raise] grants/request reports a decline as `permissionDenied`; the SPEC on the PR's own branch says a decision task reports a refusal in its success response. State the deviation and why.
- F10 [raise] An abandoned hold re-asks the person on the same thread; with VTI's 300 s hold and 5 s resubmits that is a nag loop to Keyring.
- F11 [raise] `retryAfter` is an RFC 3339 instant in trust-task-error but integer seconds in grants/request's next-step hint, which has no schema.
- F12 [raise] A 1-hour token under a 4-hour grant (demo) fails with `hcp:invalidToken`, which the client must read as revocation, and 0.1 offers no refresh after the post-approval hour.
- F13 [raise] `hcp:exportTooLarge` is export-specific but uses the family namespace (SPEC §8.5 rule 2).
- F14 [note] `hcp:invalidToken` is declared 26 times with two wordings; no shared family convention document.
- F15 [raise] Errors on a held thread that leave the hold open vs "an error closes the exchange" and next-step producer rule 5.
- F16 [ok] Neutral denial is compatible with Keyring's code-worded messages (one ACL-text detector stops firing on hcp/* refusals).
- F17 [raise] No next-step support anywhere in the VTA stack at the pin (service, sdk, mcp); the plugin path needs it.
- F18 [ok] Keyring already handles task-consent request 0.1 / decision 0.2 with verification and owner check.
- F19 [raise] Effects: Keyring shows `summary` only; the checklist from `detail` needs published kinds/shapes and must keep `summary` verbatim.
- F20 [raise] The held request's `threadId` has no place in task-consent/request 0.1, so Keyring cannot do the scan match VTI #2823 relies on.
- F21 [raise] decision/0.2 cannot carry a narrowed approval or a chosen purpose; HCP 6.1.5.2 requires the choice when the request names no purpose.
- F22 [note] Management tasks' schemas require `accessToken` while VTI #2823 §4.4 has Keyring hold none (cross-track with auth).
- F23 [note] `hcp:credentialInvalid` puts "which check failed" in free-text `message`; a `details` member would be machine-readable and keep §8.2.1 clear.
