# One scan to an agent, then one scan to sign in

**Status:** DRAFT proposal for review. Not a commitment to implement. Nothing here is built on the Farm or portal side, and Keyring's parsers do not read the new link. Positions marked **working position** are Brendan's, for discussion; they are not decisions of the VTC owners, the sign-in proposal's authors, the Trust Tasks group or Trust Over IP.
**Scope:** two flows that share a phone, a key and a scanner. **A:** claiming a parked VTA on the VTA Farm with one scan. **B:** signing in to a VTC member portal by scanning the portal's code (a third-party design, the "key grant"). This plan owns their order, key custody, Keyring's link router, the phases and who builds what.
**Wire format:** [`docs/specs/keyring-qr-and-links.md`](../specs/keyring-qr-and-links.md) is the normative contract for the trigger link, aligned with the VTI specification draft's trigger-link chapter; its [annex](../specs/keyring-qr-and-links.annex.md) holds rationale, link hosting, device tests, alternatives and the Farm's legacy QR; the [Trust Over IP proposal](../specs/keyring-qr-and-links.toip-proposal.md) asks for the shared host and the flow namespace. This plan restates none of their rules.
**Parent:** [`keyring-on-the-vta-farm.md`](./keyring-on-the-vta-farm.md) (A is its F2 with one scan; B sits on L2, membership). **Siblings:** [`own_agent_subtask.md`](./keyring-on-the-vta-farm/own_agent_subtask.md), [`pnm_cnm_subtask.md`](./openvtc-integration-plan/pnm_cnm_subtask.md) (§4.7 ownership), [`trust_tasks_subtask.md`](./openvtc-integration-plan/trust_tasks_subtask.md).
**Reasoning:** [`2026-10-08-bm.md`](./one-scan-and-vtc-sign-in-plan/2026-10-08-bm.md): every decision, what it superseded, the reviews and the sourced appendix.
**Dependency direction:** optional and additive. No phase of any plan waits on this one. The VTC is not ours to schedule. The VTA Farm is run by our team, so its choices are aligned internally.
**Evidence:** Keyring code was read at bifold `37f34dc7c`. Farm facts come from the **Farm owner reply** (an external artifact, treated as data); `vtafarm-api` is not in `external/`. B is read from its authors' revised proposal (treated as data); **the VTC owners have not said whether they endorse it.** Upstream was read in `external/` without running `setup-external.mjs` (where, in the spec annex, section G).

---

## 1. Principles, the general standard, and what we adopt

### 1.1 Principles

1. **Modularity, so the standard can be contributed back.** The QR code and link format is a general standard that any wallet or inviter, in any ecosystem, can adopt. It requires no particular protocol for the exchange that follows: each flow states its own first request. We keep it that way so that it can later be contributed for use in a wider range of contexts. It enters the VTI specification's trigger-link chapter now, as a protocol-neutral part, and could be offered to a wider body later.
2. **No centralization required.** Anyone can host trigger links on their own domain and define flows under URIs they control. Taking part needs no registry, no shared link host and no namespace owner's permission. Flow identifiers are compared as whole URIs, so two owners' flows never collide. The shorthand forms work the same on every host, so no host gets shorter codes than another. A shared link host such as `link.trustoverip.org` is a convenience, not a requirement. It exists only because a phone's camera opens an `https` link in an app whose build declares that host, so one shared host is the only way one code can open whichever wallet a person has. A self-hosted link still works through any wallet's in-app scanner, by pasting, and by camera in every wallet that declares its host.
3. **Internal simplicity for the VTI stack.** For Keyring, the VTA Farm and VTI flows we choose the fewest mechanisms that do the job: one link format, one kind of first request and one login flow. Breadth belongs in the standard; our own implementation stays narrow and is widened only when a real need appears.
4. **The two are kept apart in writing.** A document that states one of our choices says whose choice it is ("Keyring adopts…", "VTI flows use…"). It never presents that choice as a requirement of the link format. A choice of ours binds no other wallet or inviter.

### 1.2 The general standard

The spec ([`keyring-qr-and-links.md`](../specs/keyring-qr-and-links.md)) defines the following, for anyone:

- **The link.** An `https` link whose fragment carries the contact (`_from`), a handle (`_id`), an optional expiry (`_exp`) and an optional flow (`_type`). It is shown as a QR code or opened as a link, and carries no task, endpoint, key or secret (spec sections 1 to 3).
- **Reading.** Strict parsing of the four names. Other parameters are ignored, so added tracking parameters change nothing. Host rules, expiry with clock skew, and the messages a person sees (section 3).
- **Safety.** These apply whatever protocol follows (section 5 rules 1 to 6, section 6):
  - confirm before any network activity;
  - verify the contact's DID document, and send nothing until the person approves;
  - take the transport only from that document;
  - the handle grants nothing and is never spent by a GET;
  - nothing is logged;
  - producers' pages leak nothing.
- **Flows.** Anyone may define a flow under a URI they control. **Each flow states its first request** (section 5 rule 7). The Trust Task first request (section 8.1) is one defined option; a flow may define a DIDComm, OpenID or other request instead.
- **Shorthand: optional ways to shorten a link.** The standard lets a producer shorten a link in several ways, none of which a reader can mistake for something else:
    - **`_type` as a path,** resolved against the link's own host: `_type=/vti/flow/sign-in/0.1` on `link.trustoverip.org` means `https://link.trustoverip.org/vti/flow/sign-in/0.1`. Any host's own flows get this form (spec section 4; VTI-LNK-040 to 043). A producer uses it whenever the flow is on the link's own host.
    - **Optional fields left out.** `_type` is optional, though a reader may refuse a code it cannot place. `_exp` is optional unless the flow requires it.
    - **Characters written raw.** Colons and slashes may be written unencoded, and read the same as their percent-encoded forms (spec section 3). Producers encode only `&`, `=`, `#` and `%` inside values.
    - **The shortest handle.** 16 bytes (22 characters) is the floor and the usual choice.
    - **Agent names in `_from`,** reserved for a later revision. `example.com/@alice` resolves to a DID and is about a third the length of a `did:webvh`. The VTI draft reserves the `/@` form (VTI-LNK-032) until the agent-names questions are settled.
    - **An uppercase prefix** (`HTTPS://LINK.TRUSTOVERIP.ORG/T#…`) would let a QR encoder use its compact alphanumeric mode for the prefix. It is a possible later saving, pending a device test, and not yet part of the standard.
- **Size and rendering.** A producer cap that keeps codes scannable, and rendering guidance (spec and annex, as agreed with the VTI draft).
- **Where it lives.** This spec today, aligned rule for rule with the VTI draft's trigger-link chapter (PR #58, VTI-LNK-001 to 116), with two named differences that scope the Trust Task first request to the flows that adopt it (spec section 5 rules 4 and 7). Then the protocol-neutral part of the VTI specification's trigger-link chapter, with the link host `link.trustoverip.org` proposed to Trust Over IP.

### 1.3 What we adopt internally, at this point

Keyring, the Farm and VTI adopt a narrower and simpler subset:

- **Two flows:** `vti/flow/sign-in` (B) and `vti/flow/vta-claim` (A), defined in the VTI specification. The spec's section 4 table still shows their earlier names until the VTI text lands.
- **One kind of first request:** the Trust Task first request (spec section 8.1), for every flow under `vti/flow/`.
- **One login flow:** `sign-in`, for VTC portals and for the Farm.
  - Keyring implements no SIOPv2.
  - The Farm, run by our team, retires its SIOPv2 login.
  - The Farm puts its DID in the claim's progress response, so every claimed wallet knows it as an inviter (§4, K8).
- **Our safety choices on top of the standard:**
  - the known-inviter exception for `sign-in`, which resolves a community already in the wallet's records before the tap;
  - the first-scanner lock with the Continue tap before the claim;
  - a code check after a claim.
- **Our rollout:**
  - the in-app scanner first;
  - Keyring's interim link host for the Farm claim only (§3);
  - the camera path after the device tests (annex C).

| | General standard (proposed to everyone) | What we adopt internally (Keyring, the VTA Farm, VTI flows) |
|---|---|---|
| Where it is written | The spec, sections 1 to 7 (section 8 records our adoption); then the VTI specification's trigger-link chapter, as a protocol-neutral part | This plan, and the VTI flow definitions |
| The link and how it is read | Link form, fields, parsing, host rules, size cap, rendering guidance | The same |
| Safety | Confirm before any network activity, verify the DID document, take the transport only from it, handle security, no logging | The same, plus the known-inviter exception for `sign-in` |
| The first request | Each flow's choice. The Trust Task first request (spec section 8.1) is one defined option; a flow may define a DIDComm, OpenID or other request instead | The Trust Task first request, for every flow under `vti/flow/` |
| Flows | None required. Anyone may define a flow under a URI they control | `vti/flow/sign-in` and `vti/flow/vta-claim` |
| Other login protocols | Not addressed. A wallet may support any alongside trigger links | None. `sign-in` is our one login flow; Keyring does not implement SIOPv2, and the Farm retires its SIOPv2 login |

### 1.4 The two flows in brief

- **One link, any wallet, any transport.** The Farm and a portal each show a trigger link. A wallet reads it, asks the person, resolves the inviter's DID and talks to the inviter over a transport it picks from the DID document. The link opens whichever wallet the person has set up, once a shared link host lists every wallet (spec annex A and B).
- **A comes before B.** B's signer is the member's VTA, reached through a manager session. Keyring has one only after A, or the copy-and-paste path in `own_agent_subtask.md`, makes it the VTA's manager. Membership (parent L2) comes between. A phone with no agent that opens a sign-in link is told to set one up and sends nothing.
- **Words.** Screens say "Set up your agent" for A and "Sign in" for B. Plans say "slot claim" and "sign-in request"; code uses `vtaClaim*` and `signIn*`. "Claim" is never used for B, or for credential contents.

## 2. Key custody

- **One manager key per VTA, a device key, never a persona key.** `VtiManagerIdentity` (`VtiIdentityStore.ts:26`) is kept apart from `VtiPersona` (`:57`). A connection starts on a temporary `did:key` (`createVtiTemporaryDidKey`, `VtiMediatorTransport.ts:380`) and `rotateManagerKey` (`VtaClient.ts:1135`) swaps it with `acl/swap-key/0.1`.
- **Keys are software-held.** Credo's `SecureEnvironmentKeyManagementService` supports only P-256/ES256 (`@credo-ts/react-native` `build/kms/SecureEnvironmentKeyManagementService.mjs:12-13`), the Expo secure-environment module makes 256-bit EC keys, and `react-native-attestation` uses `secp256r1`. The Farm requires Ed25519, so hardware custody is a separate follow-up.
- **The phone does borrow persona keys today.** `VtaClient.borrowKey` (`VtaClient.ts:1683-1691`) fetches them over `keys/export-secret/0.1` into memory; callers `VtaClient.ts:1627`, `:1630`, `:1717`, `vtaRotation.ts:78-79`, `vtaKeyMigration.ts:83-84`, `app/src/screens/Developer.tsx:629`.
- **Rule for sign-in:** the sign-in module signs nothing with a persona key and never calls `borrowKey`; the VTA signs B's approval as the chosen DID. **One login mechanism:** `sign-in` (a VTA-signed grant) serves both VTC portals and the Farm (§4). There is no separate phone-held login key.

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

Status values are `provisioning`, `awaiting_mobile`, `connected`, `failed`, `expired`. The pool is capped near 100. A pooled VTA is reached by DID plus mediator, never by hostname. There is no recovery, and the claim page says the instance is temporary. "Default manager", in the Farm's words, means the PNM role; Keyring has no second notion beside the active agent.

**Claim authorisation (working position).** Version 1 is **option A, hardened**: the Farm's single-use callback stays the authority, spent by the claim POST and never by a GET; Keyring asks for device authentication (biometric, passcode as fallback, as `ownerConfirm.ts` already allows with `BIOMETRY_ANY_OR_DEVICE_PASSCODE`) before claiming; and after the key swap Keyring checks with `acl/list` (`VtaClient.listAcl`, `VtaClient.ts:1284`; on the send list, `approvalRules.ts:62-63`) that its key is the sole super-administrator before it calls itself owner. This is still bearer: whoever uses an unused callback first wins, and the phone's own key does not change that.

**Phase 2: the claim on the trigger link.** The claim moves to `vti/flow/vta-claim/0.1` (VTI-LNK-110 to 116).
- **The code.** The contact is the Farm's VID, not the VTA's. `_exp` is required, at most 300 s after the code is made, and the handle is 16 bytes. The known-contact exception does not apply: the Farm is a first contact.
- **The claim.** It is a Trust Task first request issued and signed by a fresh Ed25519 `did:key`, which becomes the VTA's administrator. It is posted to the `vta-claim` service in the Farm's verified document.
- **First key wins.** The Farm accepts one claim per handle, atomically.
- **The claim check.** After the claim, the Farm page and the phone both show the first six base32 characters of the SHA-256 of the claiming identifier. The Farm releases the VTA only when the person confirms they match, and revokes and returns it to the pool when they don't. This is option C of the earlier list, run after the claim rather than before it. Its strength for adding a device to a running VTA (SHOULD or MUST) is decided internally with the Farm.
- **Order.** The QR changes meaning, so it waits for the Keyring release that ignores unknown keys (K0).

**Ownership.** The Farm's grant kind (`provision_vta` owner, `grant_acl` delegate) gates screens only; the `acl/list` check is the authority (`pnm_cnm_subtask.md` §4.7: "ownership is not on the wire"). The claim screen says the host operator keeps infrastructure control and that there is no recovery.

**Farm login.** The Farm's login is `sign-in`, the same flow as a VTC portal's. Keyring implements no SIOPv2, and the Farm retires its SIOPv2 login; one login mechanism keeps our design simple, and the Farm is run by our team. `sign-in` acts only for an inviter the wallet already knows, so the wallet must hold the Farm's DID. A claim through the legacy QR does not give it: `parseAgentHostQr` (`agentHostConnection.ts:152-170` on bifold `origin/main`) reads only the VTA's DID and the callback, and nothing names the Farm. The Farm therefore puts its DID in the claim's progress response, where it already plans mediator and DID-log hints, and Keyring records it as a known inviter (K8). Which DID the Farm accepts as the account holder at sign-in is designed with the Farm. **Working position:** if recording the Farm fails after `connected`, Keyring retries while the progress credential is valid.

**Claim relay (reported, not verified).** A review reported that an attacker could relay a claim code from the attacker's own Farm account to a victim, whose key then administers a VTA under the attacker's account. The mitigation, showing the signed issuer and Farm account before the claim, belongs to the Phase 2 design, and is settled internally with the Farm.

## 5. B: community portal sign-in

**The design (theirs, revised 8 Oct; unbuilt).**
1. The portal's browser makes a non-extractable key and opens a request at the VTC. The portal shows a code, `_type=/vti/flow/sign-in/0.1`, and a two-digit number.
2. The phone checks its own records. For an unknown community it stops, sends nothing, and offers to join.
3. For a known community, it may resolve and verify the VTC's DID document before the tap (spec section 5 rule 1's known-contact exception).
4. It shows "Sign in to <community> at <origin>?", and the member picks an identity and taps Continue.
5. Only then does it send the claim from a fresh `did:key`. The claim locks the request to this phone (the first-scanner lock, confirmed by Glenn Gore from the 8 Oct revision). The phone checks the VTC-signed step 1 response (browser key, approximate location, browser, three numbers) against what it showed.
6. The member matches the number and approves with a biometric.
7. Keyring builds the approval document, and the member's VTA signs it as the chosen DID through `vault/sign-trust-task/0.2`.
8. Keyring sends it to the VTC. The browser redeems it with its own key and gets a session.

Live relay stays a residual risk until a proximity check exists. On the same device, a browser extension that receives the click compares the page's origin with the portal's (VTI-LNK-105).

**What Keyring builds (K4).** Classify the sign-in trigger; refuse an unknown community and offer to join (`communityTarget.set` and `VtiJoin`, `vtiLinks.ts:178-179`); for a known community, resolve and verify the VTC DID, take the portal endpoint from its document, and show the Continue screen from the wallet's own record; after Continue, send the claim and ask for the description from a fresh `did:key` and verify its proof against the VTC DID, checking the request id, the VTC DID, the purpose, the origin and the expiry; list the persona DIDs with a signable vault entry for the community; show the consent screen (community, origin, identity, requester details labelled as reported by the community, three numbers, "This signs in that browser for this session only") and require a biometric; build the approval (a wrong number builds a decline); have the VTA sign it with `vault/sign-trust-task/0.2` and refuse a returned document that differs from the one sent except for `proof`; send it; log none of the request id, the description or the grant. `VtaClient.task` (`VtaClient.ts:767`) is generic, but nothing wraps `vault/sign-trust-task` or lists signable entries yet.

**What is agreed with the VTC side** (Glenn Gore, 9 Oct; dated companion `2026-10-09-bm.md`):
- the trigger link instead of a custom-scheme QR;
- unknown parameters ignored, and a repeated one rejected;
- the expiry in the link;
- any VID as the contact;
- the flow `vti/flow/sign-in/0.1`;
- the Continue tap before the claim, with the lock kept.

**Still asked of the sign-in authors:**
- update the 8 Oct revision to this format;
- rename the task family without the word `oob` (for example `auth/handoff`), since it is also DIDComm's term for out-of-band messages, which Keyring's generic path keys on (`helpers.ts:1168-1186`);
- treat the grant as an attestation (below).

**Their names.** The 8 Oct revision calls its family `auth/oob/*`, including `claim`, which locks the request. Its QR is `trusttasks://oob?v=1&svc=<VTC DID>&id=<requestId>`.

**Found while checking.** At the Trust Tasks `origin/main` and the VTI pin `822ff78a`, `vault/sign-trust-task/0.2` chooses the proof purpose from the envelope's `type`: `assertionMethod` only for a listed few types (`auth/step-up/approve-response`, `task-consent/decision`, `confirm/response`), `authentication` otherwise. The proposal requires an `assertionMethod` proof on its approval document, which is not on that list. - The pinned Trust Tasks commit `bdae1cf9` still says `assertionMethod` always.
- Glenn Gore confirmed this reading. The `assertionMethod` comment in `vta-browser-plugin` `packages/core/src/vault/sign-trust-task.ts:58` is stale.
- **Proposed fix:** treat the grant as an attestation, by adding its slug to `ATTESTATION_SLUGS` with a VTI-KEY-106 change, and verify identify against `authentication`. This needs the sign-in authors and the VTA team before K4.

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
| **Phase 1** | Farm login through `sign-in`; designed with the Farm, and needs K4's sign-in module | |
| K8 | record the Farm as a known inviter from the progress response | after a faked claim whose progress response carries the Farm's DID, the Farm is a known inviter; a claim without it leaves the Farm unknown, and a Farm sign-in link then shows the set-up message and sends nothing |
| K9 | Farm login through `sign-in` | against a faked Farm serving the `sign-in` tasks, a claimed wallet signs in; the K4 criteria hold with the Farm as inviter |
| K7 | the grant-kind signal for screens | a delegate signal shows delegate screens; nothing declares ownership without the `acl/list` check |
| **Phase 2** | the claim on the trigger link; blocked on the Farm's `vta-claim` service and K0 | |
| K2 | route `vta-claim` (spec section 5; VTI-LNK-110 to 116) | with a faked claim service, a trigger and the legacy QR reach the same confirm screen; nothing is sent to an endpoint in the text or before approval; the first request is signed by a fresh `did:key`, addressed to the contact, and carries the handle as `parentThreadId`; the phone shows the claim check computed from its own identifier. Also blocked on proving `did:webvh` resolution of a real Farm log on each supported device, with a tampered log rejected (the slot's DID is already resolved today: `confirmHostOffer`, `vtaAgent.ts:1253`, calls `resolveVtaMediator` at `:1272`) |
| **Later** | K4 (§5), once the proposal's tasks exist at a pinned version, a VTC serves them and VQ3 is answered; proximity for sign-in; recovery; hardware custody | K4: an end-to-end test against a faked VTC and VTA passes; each bad description, expiry or unknown community shows an error and sends nothing; a wrong number sends a decline; a test asserts the sign-in module never calls `borrowKey` |

## 7. Who builds what

- **The Farm** (run by our team): the claim pool and callback as today; quotas and rate limits against pool draining; its own DID, the mediator DID and DID-log hints in the progress response; the `sign-in` tasks for Farm login, and retiring its SIOPv2 login; for Phase 2, the `vta-claim` service in the Farm's DID document, first-key-wins claims and the claim check (VTI-LNK-112 to 115), on a DID host only the Farm publishes to.
- **The VTC and portal** (per the proposal; unverified): the five tasks on the VTC's signed-document path; admission of a browser `did:key` before sign-in for three tasks; signed descriptions; the long-poll redeem; the portal's sign-in page; and the portal's service published in the VTC DID document (not yet checked).
- **Trust Over IP** (if it agrees): the shared link host.
- **The VTI specification** (Glenn Gore drafting, PR #58): the trigger-link chapter and the `sign-in` and `vta-claim` flows.
- **Keyring:** §6.

## 8. Open questions

**Decisions (team):** T3 the link host (working position: the shared host, proposed). T5 what the first request is when there is no hint. T8 what to do if a camera or OS drops the fragment (annex C, C13 and C14). (T2, T4 and T6 are settled by the VTI draft: the claim check and first key wins; any VID as the contact; the link and handle limits of VTI-LNK-033 and 081.)

**For the Farm (internal):** FQ1 the current `vtafarm-api` mobile-connection docs (Keyring was built against `d2cc4100`, `agentHostConnection.ts:3-4`). FQ2 does a GET on a callback have no side effects? FQ3 quotas against pool draining. FQ4 the progress credential's lifetime and renewal. FQ5 the progress-response hints, including the Farm's DID. FQ6 a re-registration path after the credential expires. FQ7 can the account reset the admin key, and is admin revoke possible later? FQ8 is the claim relay possible, and can a signed response name the slot's account and issuer? FQ9 which domain will a claim-service DID use, and should the Farm's own app open Farm links? FQ10 who can create DID paths on the Farm's DID host? FQ11 does the Farm plan a browser dashboard with sign-in, and would it use the key-grant pattern there?

**For the VTC owners and the proposal's authors:** VQ1 do the VTC owners endorse the proposal? VQ2 does the VTC DID document publish the portal's service, and of what `type`? VQ3 will VTA policy allow `vault/sign-trust-task` for the approval type, and which proof purpose will it produce (§5)? VQ4 can the VTC admit a browser `did:key` for three tasks before sign-in? VQ5 the remaining asks of §5 (update the 8 Oct revision, rename, the grant as an attestation). VQ6 which of a persona's keys does the phone borrow today, and which task lists signable entries? VQ7 is Keyring's join flow reachable from a sign-in trigger without a new link?

**For the Trust Tasks group:** whether a trigger profile belongs to a task-force document; whether the handle may be `parentThreadId` with the invitation read as the containing exchange; whether "trigger" has an upstream term.

**For Brendan:** BQ1 is "losing the phone loses the agent" acceptable, and should the shipped recovery screens (`LostPhoneCard`, `NewPhoneOffer`, `VtaNewPhoneOffer`, `KeysMovedNotice`) be hidden for a claimed slot? BQ2 should the Farm also be offered `keyring://vta/enrol` for a human-granted path? BQ3 should hardware custody gate A (working position: no)? 

## 9. Remaining steps

No dates. Ours first.

1. Brendan sends the Trust Over IP proposal. Nothing is agreed until Trust Over IP answers.
2. Run the device tests (annex C) before anything is built on the fragment link.
3. Keyring code changes, each its own PR: Phase 0, then Phase 0b, Phase 1 and K4 as their blockers clear.
4. Settle FQ1 to FQ11 internally with the Farm; ask the VTC owners VQ1 to VQ7.
5. Review Glenn Gore's VTI draft (PR #58) against the spec, and update the vectors to its wording.
6. Ask the Trust Tasks group its three questions.
7. Run `node scripts/openvtc/setup-external.mjs` after a memory check, so the VTI and openvtc clones sit on their pins, and spike `did:webvh` resolution of a real Farm log.

Review page: the private "One Scan Alignment" artifact presents the proposal and its application to the Farm and the VTC portal, with each partner's questions.

## 10. Review index

| Companion | Author | What it settles |
|---|---|---|
| [`2026-10-08-bm.md`](./one-scan-and-vtc-sign-in-plan/2026-10-08-bm.md) | BM | Every decision in this plan and the spec, what each superseded, the reviews and the verification of the earlier drafts, and the sourced appendix |
| [`2026-10-10-bm.md`](./one-scan-and-vtc-sign-in-plan/2026-10-10-bm.md) | BM | The general link standard kept apart from what Keyring, the Farm and VTI adopt (section 1; spec principles and section 8); SIOPv2 ruled out for Keyring and the Farm while the general spec stays protocol-neutral; the Farm aligned internally; Glenn Gore's `vta-claim` note |
| [`2026-10-09-bm.md`](./one-scan-and-vtc-sign-in-plan/2026-10-09-bm.md) | BM | Glenn Gore's *Sign-in QR Alignment* review against this branch: the three conflicts, the exchange with Glenn Gore through to the agreed link format (to be written into the VTI specification), what to adopt, and open questions by owner (Glenn Gore for the VTC, Geoff Turk for the Farm). Agreed with Glenn; not yet applied to the spec or plan |
| [`keyring-on-the-vta-farm/2026-10-08-bm.md`](./keyring-on-the-vta-farm/2026-10-08-bm.md) | BM | The first evaluation of the one-scan Farm proposal |
