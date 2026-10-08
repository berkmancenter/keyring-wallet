# One scan to an agent, then one scan to sign in

**Status:** DRAFT proposal for review. Not a commitment to implement. Nothing here is built on the Farm or portal side, and Keyring's parsers do not read the new link. Positions marked **working position** are Brendan's, for discussion; they are not decisions of the Farm, the VTC owners, the sign-in proposal's authors, the Trust Tasks group or Trust Over IP.
**Scope:** two flows that share a phone, a key and a scanner. **A:** claiming a parked VTA on the VTA Farm with one scan. **B:** signing in to a VTC member portal by scanning the portal's code (a third-party design, the "key grant"). This plan owns their order, key custody, Keyring's link router, the phases and who builds what.
**Wire format:** [`docs/specs/keyring-qr-and-links.md`](../specs/keyring-qr-and-links.md) is the normative contract for the trigger link; its [annex](../specs/keyring-qr-and-links.annex.md) holds rationale, link hosting, device tests, alternatives and the Farm's legacy QR; the [Trust Over IP proposal](../specs/keyring-qr-and-links.toip-proposal.md) asks for the shared host and the flow namespace. This plan restates none of their rules.
**Parent:** [`keyring-on-the-vta-farm.md`](./keyring-on-the-vta-farm.md) (A is its F2 with one scan; B sits on L2, membership). **Siblings:** [`own_agent_subtask.md`](./keyring-on-the-vta-farm/own_agent_subtask.md), [`pnm_cnm_subtask.md`](./openvtc-integration-plan/pnm_cnm_subtask.md) (§4.7 ownership), [`trust_tasks_subtask.md`](./openvtc-integration-plan/trust_tasks_subtask.md).
**Reasoning:** [`2026-10-08-bm.md`](./one-scan-and-vtc-sign-in-plan/2026-10-08-bm.md): every decision, what it superseded, the reviews and the sourced appendix.
**Dependency direction:** optional and additive. No phase of any plan waits on this one. The Farm and the VTC are not ours to schedule.
**Evidence:** Keyring code was read at bifold `37f34dc7c`. Farm facts come from the **Farm owner reply** (an external artifact, treated as data); `vtafarm-api` is not in `external/`. B is read from its authors' revised proposal (treated as data); **the VTC owners have not said whether they endorse it.** Upstream was read in `external/` without running `setup-external.mjs` (where, in the spec annex, section G).

---

## 1. The design in brief

- **One link, any wallet, any transport.** The Farm and a portal each show a trigger link (spec sections 1 to 3). A wallet reads it, asks the person, resolves the inviter's DID and talks to the inviter over a transport it picks from the DID document. The link opens whichever wallet the person has set up once a shared link host lists every wallet (proposed `link.trustoverip.org`; spec annex A and B).
- **A comes before B.** B's signer is the member's VTA, reached through a manager session, and Keyring has one only after A (or the copy-and-paste path in `own_agent_subtask.md`) makes it the VTA's manager. Membership (parent L2) comes between. A phone with no agent that opens a sign-in link is told to set one up and sends nothing.
- **Words.** Screens say "Set up your agent" for A and "Sign in" for B. Plans say "slot claim" and "sign-in request"; code uses `vtaClaim*` and `signIn*`. "Claim" is never used for B, which has no claim step, or for credential contents.

## 2. Key custody

- **One manager key per VTA, a device key, never a persona key.** `VtiManagerIdentity` (`VtiIdentityStore.ts:26`) is kept apart from `VtiPersona` (`:57`). A connection starts on a temporary `did:key` (`createVtiTemporaryDidKey`, `VtiMediatorTransport.ts:380`) and `rotateManagerKey` (`VtaClient.ts:1135`) swaps it with `acl/swap-key/0.1`.
- **Keys are software-held.** Credo's `SecureEnvironmentKeyManagementService` supports only P-256/ES256 (`@credo-ts/react-native` `build/kms/SecureEnvironmentKeyManagementService.mjs:12-13`), the Expo secure-environment module makes 256-bit EC keys, and `react-native-attestation` uses `secp256r1`. The Farm requires Ed25519, so hardware custody is a separate follow-up.
- **The phone does borrow persona keys today.** `VtaClient.borrowKey` (`VtaClient.ts:1683-1691`) fetches them over `keys/export-secret/0.1` into memory; callers `VtaClient.ts:1627`, `:1630`, `:1717`, `vtaRotation.ts:78-79`, `vtaKeyMigration.ts:83-84`, `app/src/screens/Developer.tsx:629`.
- **Rule for sign-in:** the sign-in module signs nothing with a persona key and never calls `borrowKey`; the VTA signs B's approval as the chosen DID. **Two login mechanisms stay separate:** B's portal sign-in (VTA-signed grant) and the Farm's own login (a SIOPv2 `id_token` signed by a separate phone-held Ed25519 `did:key`, §4).

## 3. Keyring's link handling

- **One router.** Scans, pastes and deep links reach `keyringAgentLinkKind` (`vtiLinks.ts:81`) and `routeKeyringAgentLink` (`:292`); deep links arrive through `handleDeepLink` (`TabStack.tsx:144`) and `openKeyringLink` (`keyringLinkOpen.ts:29`). A trigger becomes one new link kind, recognised before the generic path, which otherwise passes text containing `oob=`, `c_i=`, `d_m=` or `url=` (and OpenID credential offers) to the connection handler (`TabStack.tsx:187`). A trigger never reaches that handler.
- **Keyring's alias scheme is `keyring://`**, for its own scanner and paste screen only (spec section 3). Other `keyring://` links (`vta/enrol`, `vta/approvals`, `vti/community`, `vti/invitation`), ticket links, bare DIDs and OpenID offers are not triggers and are unchanged. `keyring://vta/enrol` stays lab-only: it carries a proof of the key and a code both screens compare, the right shape for an operator who grants by hand.
- **The Farm's legacy QR** is read by a separate handler (spec annex F). Today `parseAgentHostQr` (`agentHostConnection.ts:152-171`) requires exactly the two keys and rejects the QR the Farm wants to extend (test `'an extra member'`, `__tests__/agentHostConnection.test.ts:49`).
- **Two defects to fix.** `allowedHostOf` (`agentHostConnection.ts:122-127`) accepts `https://.ic3.dev/x`, `https://a..ic3.dev/x`, a fragment after the path and a NUL in the path (evaluated by copying its logic; the host still ends in an allowed name in each case). `TabStack.tsx:146` logs every deep link in full, and the app's logger is a `RemoteLogger` (`app/container-imp.ts:449`, `app/src/utils/logger.ts:25`) that can ship logs off the device. The scan path logs only "qr scan" (`helpers.ts:1304`).
- **Link host.** Today's build declares `applinks:` and `autoVerify` filters for `wallet.asml.berkmancenter.org` and `witness.asml.berkmancenter.org` only (`AriesBifold.entitlements:5-11`; `AndroidManifest.xml:72-84`), so no Farm or portal link opens Keyring from a camera. **Working position:** the first releases use the in-app scanner only; `wallet.asml.berkmancenter.org` is Keyring's **interim** link host and opens only Keyring; the shared host comes in the camera phase, after the device tests (spec annex C). The interim host is never part of a flow identifier.

## 4. A: the Farm claim

**How it works today.** The Farm's QR is `{vta_did, callback_url}`. The callback is the endpoint and the secret: "possession of an unused callback nominates an administrator for the agent" (`agentHostConnection.ts:17-18`). Per the Farm owner reply, it is an HMAC-SHA256 over the request id under a server secret, single use per DID; re-posting the same `admin_did` within 24 hours is idempotent and a different DID gets `409`; callbacks are always Farm-origin, so the `ic3.dev` and `firstperson.dev` list holds. **The Farm keeps the QR unchanged until a Keyring release ignores unknown keys.**

| Window | Value | Source |
|---|---|---|
| scan | about 5 minutes; the phone mirrors it (`AGENT_HOST_QR_LIFETIME_MS`, `agentHostConnection.ts:31`) | code; Farm reply |
| scan to connected | about 1 hour: the lifetime of Keyring's progress credential, **not** an admin grant (the admin key is permanent once accepted) | Farm reply |
| never scanned / scanned, never connected | the slot returns to the pool / is destroyed and rebuilt | Farm reply |
| Farm login nonce | 120 seconds, one use | Farm reply |

Status values are `provisioning`, `awaiting_mobile`, `connected`, `failed`, `expired`. The pool is capped near 100. A pooled VTA is reached by DID plus mediator, never by hostname. There is no recovery, and the claim page says the instance is temporary. "Default manager", in the Farm's words, means the PNM role; Keyring has no second notion beside the active agent.

**Claim authorisation (working position).** Version 1 is **option A, hardened**: the Farm's single-use callback stays the authority, spent by the claim POST and never by a GET; Keyring asks for device authentication (biometric, passcode as fallback, as `ownerConfirm.ts` already allows with `BIOMETRY_ANY_OR_DEVICE_PASSCODE`) before claiming; and after the key swap Keyring checks with `acl/list` (`VtaClient.listAcl`, `VtaClient.ts:1284`; on the send list, `approvalRules.ts:62-63`) that its key is the sole super-administrator before it calls itself owner. This is still bearer: whoever uses an unused callback first wins, and the phone's own key does not change that. **Phase 2 is open (T2).** Candidates: **C**, a QR with no secret, where the phone's signed, challenge-bound claim makes the slot pending and the person confirms a code derived from the phone's key on the Farm page; **B**, a claim code delivered on another channel (the `vtc/install/claim/start/0.3` pattern); A with B's code is the fallback if the Farm will not build C. C changes what the QR means, so it waits for the Keyring release that ignores unknown keys.

**Ownership.** The Farm's grant kind (`provision_vta` owner, `grant_acl` delegate) gates screens only; the `acl/list` check is the authority (`pnm_cnm_subtask.md` §4.7: "ownership is not on the wire"). The claim screen says the host operator keeps infrastructure control and that there is no recovery.

**Farm login.** The Farm requires a strict SIOPv2 `id_token` (header only `alg=EdDSA`, `kid`, optional `typ=JWT`; payload exactly `iss`, `sub`, `aud`, `nonce`, `iat`, `exp`; `iss == sub`; `aud` from `GET /api/v1/auth/siop/metadata`), signed by a separate Ed25519 `did:key` registered after the key swap. Keyring has no SIOP code; `signCompactJws` (`vtiInvitationOffer.ts:175`) is reusable. **Working position:** if registration fails after `connected`, Keyring retries idempotently while the progress credential is valid. Admin-side revocation of login identities does not block.

**Claim relay (reported, not verified).** A review reported that an attacker could relay a claim code from the attacker's own Farm account to a victim, whose key then administers a VTA under the attacker's account. The mitigation, showing the signed issuer and Farm account before the claim, belongs to the Phase 2 design. The Farm is asked.

## 5. B: community portal sign-in

**The design (theirs, revised; unbuilt).** The portal's browser makes a non-extractable key and opens a request at the VTC; the portal shows a code and a two-digit number. The phone asks the VTC to describe the request (the VTC signs the description: browser key, approximate location, browser, three numbers), the member picks an identity, matches the number and approves with a biometric. Keyring builds the approval document and the member's VTA signs it as the chosen DID through `vault/sign-trust-task/0.2`; Keyring sends it to the VTC; the browser redeems it with its own key and gets a session. No first-scanner lock; a "code opened" hint instead. Live relay stays a residual risk until a proximity check exists. The proposal's own task names are in the note below.

**What Keyring builds (K4).** Classify the sign-in trigger; refuse an unknown community and offer to join (`communityTarget.set` and `VtiJoin`, `vtiLinks.ts:178-179`); confirm before any network activity; resolve the VTC DID and take the portal endpoint from its document; ask for the description from a fresh `did:key` and verify its proof against the VTC DID, checking the request id, the VTC DID, the purpose, the origin and the expiry; list the persona DIDs with a signable vault entry for the community; show the consent screen (community, origin, identity, requester details labelled as reported by the community, three numbers, "This signs in that browser for this session only") and require a biometric; build the approval (a wrong number builds a decline); have the VTA sign it with `vault/sign-trust-task/0.2` and refuse a returned document that differs from the one sent except for `proof`; send it; log none of the request id, the description or the grant. `VtaClient.task` (`VtaClient.ts:767`) is generic, but nothing wraps `vault/sign-trust-task` or lists signable entries yet.

**What we ask the authors.** Emit the trigger link (spec section 3) instead of a custom-scheme QR; tolerate unknown parameters and keep rejecting a repeated one; put the expiry in the link; say whether the VTC DID is always `did:webvh`; and rename the task family without the word `oob` (for example `auth/handoff`), since it is also DIDComm's term for out-of-band messages, which Keyring's generic path keys on (`helpers.ts:1168-1186`). The flow identifier `community-sign-in` does not depend on their names.

**Their names.** The proposal calls its family `auth/oob/*` with `request`, `describe`, `respond`, `redeem` and `cancel`, and its QR `keyring://oob?v=1&svc=<VTC DID>&id=<requestId>`.

**Found while checking.** At the Trust Tasks `origin/main` and the VTI pin `822ff78a`, `vault/sign-trust-task/0.2` chooses the proof purpose from the envelope's `type`: `assertionMethod` only for a listed few types (`auth/step-up/approve-response`, `task-consent/decision`, `confirm/response`), `authentication` otherwise. The proposal requires an `assertionMethod` proof on its approval document, which is not on that list. The pinned Trust Tasks commit `bdae1cf9` still says `assertionMethod` always. This needs an answer from the VTC owners before K4.

## 6. Phases

| Step | What | Done when |
|---|---|---|
| **Phase 0** | One small hardening release (working position): K0, K1a and K1b together; if K1a or K1b slips, K0 ships alone, because the Farm waits on it. Blocked on nothing external. | |
| K0 | `parseAgentHostQr` requires the two keys and ignores the rest | `'an extra member'` flips to accepted; a missing key still rejects; every `legacyVectors` case passes; the release is named to the Farm |
| K1a | replace `allowedHostOf` with the spec's host rules | the defect cases above and the spec's `bad-authority` vectors are refused |
| K1b | the router logs the class of a link only | one test per path (a trigger link through `handleDeepLink`; a trigger and a legacy QR through the scan path) asserts no log line contains the text, handle or contact |
| **Phase 0b** | K1c and K3a; no Farm work | |
| K1c | the trigger reader and the confirm screens | every `vectors` case passes against Keyring's parser; an unknown flow or version shows the update outcome; a trigger never reaches the generic connection handler; no network call before the confirmation tap (asserted). A recognised `vta-claim` trigger shows the update outcome until K2 |
| K3a | claim hardening: device authentication at claim, the `acl/list` sole-super-administrator check, the "temporary instance, no recovery" words | a faked `acl/list` with another super-administrator makes the phone refuse ownership; cancelling the authentication abandons the claim before anything is registered |
| **Camera phase** | K1d, after the device tests | |
| K1d | declare the shared host (if agreed) or the interim host, and any inviter host that stays, in the entitlement and an `autoVerify` filter | annex C tests recorded per camera path; no `?mode=developer` entries in a release build. Blocked on Trust Over IP (or another host owner) and the device tests |
| **Phase 1** | Farm credential; blocked on the Farm's routes | |
| K5 | the Ed25519 `did:key` Farm credential, registered after the key swap | a claim that fails before the swap registers nothing |
| K6 | strict SIOPv2 login | a faked Farm accepts a valid token and rejects an extra payload member, a wrong `aud`, a stale or reused nonce |
| K7 | the grant-kind signal for screens | a delegate signal shows delegate screens; nothing declares ownership without the `acl/list` check |
| **Phase 2** | the claim on the trigger link; blocked on the Farm and T2 | |
| K2 | route `vta-claim` (spec section 5) | with a faked claim service, a trigger and the legacy QR reach the same confirm screen; nothing is sent to an endpoint in the text or before approval; the first request is signed, addressed to the contact and carries the handle as `parentThreadId`. Also blocked on proving `did:webvh` resolution of a real Farm log on each supported device, with a tampered log rejected (the slot's DID is already resolved today: `confirmHostOffer`, `vtaAgent.ts:1253`, calls `resolveVtaMediator` at `:1272`) |
| T2 | the Phase 2 claim option, decided with the Farm | a written decision with the Farm owners |
| **Later** | K4 (§5), once the proposal's tasks exist at a pinned version, a VTC serves them and VQ3 is answered; proximity for sign-in; recovery; hardware custody | K4: an end-to-end test against a faked VTC and VTA passes; each bad description, expiry or unknown community shows an error and sends nothing; a wrong number sends a decline; a test asserts the sign-in module never calls `borrowKey` |

## 7. Who builds what

- **The Farm** (per its reply; not ours to schedule): the claim pool and callback as today; quotas and rate limits against pool draining; the registration, nonce and login routes; the mediator DID and DID-log hints it said it would add to the progress response; for Phase 2, a claim-service DID document that publishes the claim service, and the chosen claim option.
- **The VTC and portal** (per the proposal; unverified): the five tasks on the VTC's signed-document path; admission of a browser `did:key` before sign-in for three tasks; signed descriptions; the long-poll redeem; the portal's sign-in page; and the portal's service published in the VTC DID document (not yet checked).
- **Trust Over IP** (if it agrees): the shared host and the flow namespace.
- **Keyring:** §6.

## 8. Open questions

**Decisions (team):** T2 the Phase 2 claim option. T3 the link host (working position: the shared host, proposed). T4 whether an `https` contact is ever needed instead of a DID. T5 what the first request is when there is no hint. T6 the limits (1,536 characters, handle 22 to 128, contact 256, legacy callback 512), and whether a contact DID with a path must be allowed. T8 what to do if a camera or OS drops the fragment (annex C, C13 and C14).

**For the Farm:** FQ1 the current `vtafarm-api` mobile-connection docs (Keyring was built against `d2cc4100`, `agentHostConnection.ts:3-4`). FQ2 does a GET on a callback have no side effects? FQ3 quotas against pool draining. FQ4 the progress credential's lifetime and renewal. FQ5 the registration, nonce and login routes and the progress-response hints. FQ6 a re-registration path after the credential expires. FQ7 can the account reset the admin key, and is admin revoke possible later? FQ8 is the claim relay possible, and can a signed response name the slot's account and issuer? FQ9 which domain will a claim-service DID use, and should the Farm's own app open Farm links? FQ10 is `vta-claim` an acceptable flow name? FQ11 does the Farm plan a browser dashboard with sign-in, and would it use the key-grant pattern there?

**For the VTC owners and the proposal's authors:** VQ1 do the VTC owners endorse the proposal? VQ2 does the VTC DID document publish the portal's service, and of what `type`? VQ3 will VTA policy allow `vault/sign-trust-task` for the approval type, and which proof purpose will it produce (§5)? VQ4 can the VTC admit a browser `did:key` for three tasks before sign-in? VQ5 the requests of §5 (link, unknown parameters, expiry, DID method, rename). VQ6 which of a persona's keys does the phone borrow today, and which task lists signable entries? VQ7 is Keyring's join flow reachable from a sign-in trigger without a new link?

**For the Trust Tasks group:** whether a trigger profile belongs to a task-force document; whether the handle may be `parentThreadId` with the invitation read as the containing exchange; whether "trigger" has an upstream term.

**For Brendan:** BQ1 is "losing the phone loses the agent" acceptable, and should the shipped recovery screens (`LostPhoneCard`, `NewPhoneOffer`, `VtaNewPhoneOffer`, `KeysMovedNotice`) be hidden for a claimed slot? BQ2 should the Farm also be offered `keyring://vta/enrol` for a human-granted path? BQ3 should hardware custody gate A (working position: no)? BQ4 propose the Trust Over IP prefix now (working position: yes), or an interim prefix we control?

## 9. Remaining steps

No dates. Ours first.

1. Brendan sends the Trust Over IP proposal. Nothing is agreed until Trust Over IP answers.
2. Run the device tests (annex C) before anything is built on the fragment link.
3. Keyring code changes, each its own PR: Phase 0, then Phase 0b, Phase 1 and K4 as their blockers clear.
4. Ask the Farm FQ1 to FQ11 and the VTC owners VQ1 to VQ7 (the review page below carries them).
5. Ask the Trust Tasks group its three questions.
6. Run `node scripts/openvtc/setup-external.mjs` after a memory check, so the VTI and openvtc clones sit on their pins, and spike `did:webvh` resolution of a real Farm log.

Review page: the private "One Scan Alignment" artifact presents the proposal and its application to the Farm and the VTC portal, with each partner's questions.

## 10. Review index

| Companion | Author | What it settles |
|---|---|---|
| [`2026-10-08-bm.md`](./one-scan-and-vtc-sign-in-plan/2026-10-08-bm.md) | BM | Every decision in this plan and the spec, what each superseded, the reviews and the verification of the earlier drafts, and the sourced appendix |
| [`keyring-on-the-vta-farm/2026-10-08-bm.md`](./keyring-on-the-vta-farm/2026-10-08-bm.md) | BM | The first evaluation of the one-scan Farm proposal |
