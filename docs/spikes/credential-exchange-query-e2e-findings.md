# `yarn e2e:credential-exchange-query` — first live run, six real bugs (2026-09-04)

Session context: first on-device run of `credential-exchange/query` → consent →
`credential-exchange/present`, branch `feat/trust-tasks-vta-credential-exchange`.
The app-level handler (`ceremony.ts`'s `handleInboundCredentialExchangeQuery`/
`respondToCredentialExchangeQuery`) and the e2e script
(`e2e/run-credential-exchange-query.js`) were both written in a prior session
with no device available — this entry is that first live run, and everything
below was found by actually watching two real devices, not by inspection.
`yarn e2e:credential-exchange-query` passed clean at the end (Pixel 8 API 33
emulator + `R5CN70Q6PDP` physical phone).

Six independent, real bugs surfaced, roughly in the order hit. None were
guessed — each was root-caused from `adb logcat` evidence (or, for the last
one, from Credo's own installed source) before being fixed.

## 1. App auto-navigates onto a "Relationship confirmed" overlay after VRC — not scoped out of `assertVrcReceived`

**Symptom**: after the ordinary VRC exchange between the two wallets (needed
so the query has something real to ask for), the script's next step —
inviting a third-party verifier — spun forever polling for `ScanQRCode`/
`InviteContact`, never finding them.

**Diagnosis**: a screenshot at the failure point showed Alice's device sitting
on Bob's chat screen with `Chat.tsx`'s VRC-flow overlay ("Relationship
confirmed — Bob Baker added to Contacts") on top — not the Contacts tab.
`assertVrcReceived` (`e2e/lib/flows.js`) navigates to the Contacts tab and then
polls `byTextContains(driver, peerName)` until the peer's name is visible — but
the app auto-pushes the peer's chat screen right as the VRC lands, and that
chat screen's own header text is literally the peer's name. So
`byTextContains(driver, "Bob Baker")` matches the chat header just as
well as the contacts-list row, and the assertion returns successfully while
the device is actually on the overlay, not the Contacts tab. This was
invisible to every *existing* e2e flow because none of them needed to drive
the UI any further afterward — this is the first one that does.

**Remedy**: a new `dismissVrcConfirmationOverlayIfPresent(driver)` helper in
`e2e/lib/flows.js` (checks for the overlay's text, taps its "View contacts"
button if present, no-ops otherwise), called right after `assertVrcReceived`
in the new script. `assertVrcReceived` itself is untouched — every existing
caller still relies on its current (successful-if-name-visible-anywhere)
behavior.

## 2. The test's own DCQL query had an invalid empty `claims: []`

**Symptom**: the query never reached a consent prompt at all — Alice's
logcat showed `Error handling message` for the `credential-exchange/query`
document, with an empty-looking `"error": {}`.

**Diagnosis**: the real error was buried further down the same log dump:
`ValiError` — `"Array must be non-empty and have length of at least 1"` at
`credentials[0].claims`. The test's `DCQL_QUERY` fixture set `claims: []`.
DCQL's own schema makes `claims` OPTIONAL (omit it to mean "no specific
claim-disclosure constraint") but explicitly forbids an *empty* array when
present — this is Credo correctly rejecting a malformed query, not an app
bug.

**Remedy**: omit `claims` entirely from the test's `DCQL_QUERY` (this query
only needs to confirm the credential type, not select individual disclosed
claims).

## 3. A real upstream bug in `@credo-ts/core`'s `DcqlService`: `ldp_vc` matching always finds zero candidates

**Symptom**: with #2 fixed, the query validated fine but the wallet always
logged `credential-exchange query has no satisfying credential — no prompt
shown`, even though Alice's wallet definitely held a matching
`RelationshipCredential` (confirmed by dumping `agent.w3cCredentials.getAll()`
directly in a temporary debug log).

**Diagnosis**: read `DcqlService.mjs`'s `queryCredentialsForDcqlQuery`
directly (`node_modules/@credo-ts/core/build/modules/dcql/DcqlService.mjs`).
Inside `if (formats.has("ldp_vc"))`, the storage pre-filter is:

```js
$or: dcqlQuery.credentials.flatMap((c) => c.format === "jwt_vc_json" ? c.meta.type_values : [])
  .map((typeValues) => ({ expandedTypes: typeValues }))
```

— copy-pasted from the `jwt_vc_json` block immediately above it. For a query
whose `format` is `"ldp_vc"` (ours), `c.format === "jwt_vc_json"` is never
true, so `flatMap` always produces `[]`, the `$or` filter matches nothing, and
`w3cCredentialRepository.findByQuery` returns zero `ldp_vc` records — before
DCQL's own matching logic ever runs. This is a genuine upstream bug, not
something our code or query could work around.

**Remedy**: patched via `yarn patch` (`.yarn/patches/@credo-ts-core-npm-0.6.3-28b59086b0.patch`)
in *both* the outer repo and `bifold/` (separate installs, separate patch
application — this repo's own established gotcha). One line: `"jwt_vc_json"`
→ `"ldp_vc"` inside that `if` block, with a `KEYRING PATCH` comment. This
package already carried an unrelated pre-existing patch (VCDM 2.0
`issuanceDate`-optional + `@context` v2 acceptance, from an earlier session) —
the new fix was combined into the *same* patch file properly (re-extract
pristine, re-apply the old patch, add the new line, `patch-commit` once),
not layered on top of an already-patched extraction, which would have
silently discarded the original fix. Worth a `yarn patch` gotcha of its own:
`yarn patch <ident>` always diffs against a *pristine* copy of the package,
never against whatever the project currently has installed/patched — adding
to an existing patch means manually re-applying the old one first.

## 4. The test's query used short compact type names, not JSON-LD-expanded IRIs

**Symptom**: with #3 fixed, `getCredentialsForRequest` finally returned
candidate records but `can_be_satisfied` was still `false`, with
`credential_matches` showing `{"success":false,"credential_query_id":"vrc1"}`
and no `failed_credentials` breakdown (meaning zero credentials even reached
DCQL's own per-credential matching loop).

**Diagnosis**: `DcqlService.getCredentialsForRequest`'s own code builds each
`ldp_vc` candidate's `type` field from `record.getTags().expandedTypes`, not
the credential's raw `type` array. Logging a real stored credential's tags
confirmed `expandedTypes` is a JSON-LD **fully-expanded IRI** list —
`["https://www.firstperson.network/relationship#DTGCredential",
"https://www.firstperson.network/relationship#RelationshipCredential",
"https://www.w3.org/2018/credentials#VerifiableCredential"]` — not the
compact `["VerifiableCredential","DTGCredential","RelationshipCredential"]`
the test's query asked for. DCQL's own schema description confirms this is
by design: `type_values` are "the fully expanded types (IRIs) after the
@context was applied", matched as a subset, order-independent
(`node_modules/dcql/dist/index.mjs`'s `vIncludesAll`). Note also:
`"VerifiableCredential"` expands to the **VCDM 1.1** IRI
(`.../2018/credentials#VerifiableCredential`) even though the credential's own
`@context` is VCDM 2.0 — some context in the chain (`dtg/v1` or
`relationship/v1`) aliases the term back to it. Confirmed empirically, not
assumed.

**Remedy**: the test's `DCQL_QUERY` now uses the real expanded IRIs, copied
verbatim from the logged `expandedTypes` tag rather than hand-derived.

## 5. `agent.modules.openid4vc` is not reliably registered on this app's agent

**Symptom**: with #3 and #4 fixed, the DCQL match succeeded and the consent
modal appeared — real progress — but tapping Share threw
`Cannot read property 'holder' of undefined`, both as `agent.openid4vc.holder`
and as `agent.modules.openid4vc.holder` (the form
`modules/openid/resolverProof.tsx` already uses successfully elsewhere for a
*different* codepath — line 126, `resolveOpenId4VpAuthorizationRequest`).

**Diagnosis**: logged `Object.keys(agent.modules)` directly — it came back as
exactly `["askar","anoncreds","indyVdr","didcomm"]`. Not even `kms` or `dcql`
appear, though both are configured unconditionally in
`getAgentModules()` (`utils/agent.ts`) and `DcqlService` resolves fine via
`agent.dependencyManager.container.resolve(DcqlService)` — so the module *is*
registered in the DI container, it's just not surfaced via the `agent.modules`
shorthand. (Credo's `BaseAgent` builds `this.modules` from `getAgentApi`,
which only includes a module if it has a declared `.api` class *and*
successfully resolves one — plausible that `OpenId4VcModule` constructed with
no issuer/verifier config doesn't complete that path, though this wasn't
traced further.) Not fully root-caused, and not worth blocking on: this
exchange never needed Credo's OID4VP/DCQL *presentation* pipeline anyway (see
`respondToCredentialExchangeQuery`'s own doc comment — the spec's
`vp_token` is already exactly what `buildChallengeBoundVp` constructs; the
`openid4vc` holder API was only ever used for the *selection* step, picking
which stored record matched).

**Remedy**: `matchDcqlQuery` now selects the concrete record itself, directly
against `agent.w3cCredentials.getAll()` (filter by `claimFormat ===
ClaimFormat.LdpVc`, then check `expandedTypes` is a superset of one of the
query's `type_values` — the same rule DCQL itself uses), with no dependency
on `agent.modules.openid4vc` at all.

## 6. `did:peer` numalgo 4 verification method ids are relative — signing under one silently never completes

**Symptom**: with #5 fixed, the Share tap reliably reached
`respondToCredentialExchangeQuery`, resolved the match, resolved the
connection, resolved its DID document — and then just stopped. No thrown
error, no redbox, no further log line at all; the verifier's 30 s wait always
timed out.

**Diagnosis**: step-by-step logging through the whole function (added
temporarily, removed once fixed) showed the last thing to print was
`verificationMethodId=#key-1` — a **bare relative fragment**, not a
DID-qualified id (`did:peer:4zQm...#key-1`). `connection.did` here is a
`did:peer:4` (numalgo 4) DID; the spec's short-form documents embed
verification methods with relative ids, unlike the `did:peer:0` (numalgo 0)
relationship DIDs this file already signs under elsewhere in `ceremony.ts`,
whose resolved ids are already fully qualified — which is exactly why no
prior code path in this file had hit this. Passing the bare fragment into
`agent.w3cCredentials.signPresentation({ verificationMethod, ... })` didn't
throw; the promise chain simply never settled, with nothing surfacing as an
unhandled rejection either.

**Remedy**: qualify the id before use — if it starts with `#`, prepend
`connection.did`. Small, and confirmed to be the actual fix: the very next
run passed clean end to end, verifier receiving a correctly-threaded, signed
`credential-exchange/present`.

## Harness enhancement made along the way: mixed emulator + physical device

Unrelated to the six bugs above but worth recording: the second emulator
(`Pixel_8_API_33_b`) crashed twice outright mid-session (real qemu crash-dump
output in its log, not a hang) after many repeated full-onboarding cycles —
apparent host resource exhaustion from sustained heavy use, not a code issue.
`run-credential-exchange-query.js` now accepts `ANDROID_UDID2=<udid>` as an
alternative to `ANDROID_AVD2=<avd>` for wallet B (mirrors the existing
`ANDROID_UDID`/`ANDROID_UDID2` convention `run-vrc-exchange-witnessed-*-devices.js`
already uses), so a physical device can stand in when a second emulator is
unavailable or unstable. The final clean pass ran mixed:
`emulator-5554` + `R5CN70Q6PDP`.

## Net result

`yarn e2e:credential-exchange-query` passes clean: two Android wallets
complete an ordinary VRC exchange, a third minimal verifier agent
(`e2e/lib/verifier.js`) connects to the holder and sends
`credential-exchange/query`, the holder's app shows a real "Credential
request" consent prompt, Share produces a correctly-threaded, signed
`credential-exchange/present` with a real `vp_token`, and the verifier
receives and checks it. `trust_tasks_subtask.md` §9 step 4's happy path is
now **device-verified**, not just unit-tested.
