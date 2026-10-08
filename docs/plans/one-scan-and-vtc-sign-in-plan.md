# One scan to an agent, then one scan to sign in — the two QR flows, aligned

**Status:** DRAFT. Proposal for review. Not a commitment to implement. Neither flow is built on the Farm or VTC side; nothing here blocks another plan. §7.1 records a **working position** (DRAFT, discussable) on the open decisions; it is not a decision of the Farm, the VTC owners or the Trust Tasks group.
**Scope:** two proposals that share a phone, a key and a scanner: **A**, "One scan to a VTA" (a Farm-parked VTA slot claimed with a one-time QR), and **B**, "Keyring QR Sign-in for the VTC Member Portal" (a member portal shows a QR; the phone approves; the member's VTA signs the login). This plan owns what they have in common: the order, key custody, one link router, the trigger model, lifetimes, the phases, and who builds what.
**Parent:** [`keyring-on-the-vta-farm.md`](./keyring-on-the-vta-farm.md). A is that plan's F2 (enrolment from the phone) done with one scan; B sits on L2 (membership). **Siblings:** [`keyring-on-the-vta-farm/own_agent_subtask.md`](./keyring-on-the-vta-farm/own_agent_subtask.md) (owner key, devices, the Farm asks U1–U3), [`openvtc-integration-plan/pnm_cnm_subtask.md`](./openvtc-integration-plan/pnm_cnm_subtask.md) (the VTA client, §4.7 ownership), [`openvtc-integration-plan/trust_tasks_subtask.md`](./openvtc-integration-plan/trust_tasks_subtask.md) (the Trust Task layer B's new tasks sit in).
**Reasoning:** [`2026-10-08-bm.md`](./one-scan-and-vtc-sign-in-plan/2026-10-08-bm.md) — how the proposals were read against the code, the positions this plan adopts and what each supersedes, the review findings and how each was applied, the sourced appendix, and what could not be verified. This document states current design only; see [`CLAUDE.md`](./CLAUDE.md).
**Wire format:** [`docs/specs/keyring-qr-and-links.md`](../specs/keyring-qr-and-links.md) (DRAFT, with test vectors beside it) is the neutral spec the Farm, a VTC portal and Keyring share: the trigger, its two candidate containers, the reader rules, the registry, how a wallet and an inviter agree on a transport (spec §6.2.1), claim authorisation, and the security rules. §4 here states how Keyring applies it; the spec wins where they differ. **Provisional home:** the task types go in the Trust Tasks registry and the profile is proposed as a Trust Tasks task-force (Trust Over IP) document, on Brendan's word that he can get it added; the governance of `trusttasks.org` is only informally understood to be Trust Over IP's, and the VSC registry is for credential predicates, so a flow is not a VSC predicate (§4, §11 F7).
**Dependency direction:** optional and additive. No phase of any plan is blocked on this one. The Farm service (A) and the VTC and portal (B) are not ours to schedule.
**Evidence status, up front.** Claims about Keyring's own code were checked against this checkout on 2026-10-08 (bifold `37f34dc7c`). Claims about the Farm come from the **Farm owner reply** (an external artifact dated 2026-10-08, treated as data and cited by that name) and are otherwise **unverified**: `vtafarm-api` is not in `external/`; Keyring's claim code was built against that repository's mobile-connection docs at `d2cc4100` (`agentHostConnection.ts:3-4`), so the current version is needed, not a first reading. B is an unbuilt third-party design dated 8 October 2026, treated as data. Upstream state at last fetch: VTI `origin/main` `49f5f1be` (the pin `822ff78a` is present and an ancestor; the working tree is still `187ad9cd`), `dtgwg-trust-tasks-tf` `7b6bb488` (pin `bdae1cf9`), `vta-browser-plugin` `8b062a2f` (pin `43e2cc7`), `openvtc` `2a4fa2b3` (pin `8991f9c`), `dtgwg-vsc-registry` `54a13abe` (unpinned), `dtgwg-cred-spec` `4088056` (pin `b89f389`). Re-run `node scripts/openvtc/setup-external.mjs` and re-check before building against any contract (§12).

---

## 1. The plain version

- **A** gives a person an agent in about two minutes with one scan: the Farm shows a QR, the phone scans it, the phone's key becomes the agent's administrator, and the phone swaps that key for a long-lived one.
- **B** lets that person sign in to a community's member portal by scanning the portal's QR, approving on the phone, and letting their own agent sign the login. The browser gets a session. The phone never receives it.
- **A comes first.** B's signer is the member's agent, and the agent only exists for Keyring once A (or the copy-and-paste path in `own_agent_subtask.md`) has made Keyring that agent's manager.
- **The QR is a one-way trigger, not a task.** It names who to contact, a handle, an optional expiry and an optional flow hint, and confers no authority. The wallet treats it as an untrusted hint, takes the endpoint from the inviter's DID document, and sends a wallet-signed first request over a real binding; replies and continuation travel over that binding (§4).
- **One router.** Every QR and link the app takes enters at `vtiLinks.ts`.

### Terms

"Claim" means three unrelated things in this material, and the screens must not use the word for any of them.

| Where | What it means | Our name |
|---|---|---|
| A | taking a parked VTA slot | **slot claim** in plans, `vtaClaim*` in code; the screen says "Set up your agent" |
| B | the phone taking a pending login (`auth/cross-device/claim`, an external task name we do not choose) | **login claim** in plans, `crossDeviceClaim*` in code; the screen says "Sign in" |
| VC | a statement inside a credential | "claim", as the credential specs use it, never in a flow name |

"Trigger" is an **unconfirmed working term**. Upstream defines no such term in a task document; the only upstream uses are the push binding's *Trigger* role (the party that decides when to wake a device, whose doorbell payload is an untrusted hint) and `vtc/admin/events/event/0.1` ("A hint is a trigger to re-read"). Brendan will ask the Trust Tasks expert for the exact term and source (§11). The word carries no upstream meaning here.

---

## 2. Order: A precedes B

B's design assumes, in its own words, that Keyring holds "its **device key** only, enrolled at the VTA", and that the VTA holds every persona key and signs the login on request (`vault/proxy-login/0.2`). Three of Keyring's calls in B need a live manager session on the member's VTA: listing the personas that have a login entry for the community, `vault/proxy-login`, and any step-up. A manager session exists only after enrolment, and A is the one-scan enrolment. So:

1. **A (or the manual path) first:** the phone becomes a manager of the VTA, swaps onto a long-lived key, and records an ownership declaration (§6).
2. **Community membership next** (parent plan L2): B refuses a community the member has not joined (§8, Later: K4).
3. **B last:** it assumes both.

A phone with no linked agent that opens a login trigger is told to set up or link an agent first; it sends nothing to the VTC.

---

## 3. Key custody

**The rule, for login: no persona DID key leaves the VTA for a login, and the login module signs no `id_token` with a persona key.** The login `id_token` is signed by the VTA with the chosen persona's authentication key, on `vault/proxy-login/0.2`; Keyring relays and approves. The rule is **scoped to persona keys and to the login (`vtc-login`) module**. It does not say the phone signs no `id_token` anywhere: the Farm credential (§8, Phase 1) needs the phone to sign a strict SIOPv2 `id_token` with a **separate phone-held Ed25519 `did:key`** that is not a persona key. The K4 regression guard (§8, Later) greps the login module for `borrowKey` and for a persona-key signer, and is scoped accordingly.

**One phone-held manager key per VTA, a device key.** It is the manager key, enrolled on that VTA's access list. It is never a persona key, and no persona key is ever enrolled as a manager. The Farm login key is a second phone-held key with a different purpose; it is registered only after the key swap succeeds (position 6).

### What Keyring does today (verified)

- **The manager key is a device key and is stored apart from persona keys.** `VtiManagerIdentity` (`VtiIdentityStore.ts:26`) is one record per VTA, kind `manager`, holding the phone's own DID, a `stage` (`temporary` or `permanent`) and swap bookkeeping. `VtiPersona` (`VtiIdentityStore.ts:57`) is a separate record per community. A connection starts with a temporary `did:key` (`createVtiTemporaryDidKey`, `VtiMediatorTransport.ts:380`; used at `vtaAgent.ts` `confirmHostOffer`) and `rotateManagerKey` (`VtaClient.ts:1135`) swaps it, with `acl/swap-key/0.1`, onto a new phone-minted DID that the phone's KMS holds.
- **That key is software in the Credo KMS, not hardware, and Ed25519 hardware custody is not possible on the current stack.** The Credo `SecureEnvironmentKeyManagementService` is P-256/ES256 only; `expo-secure-environment` is secp256r1; `react-native-attestation` is P-256. The Farm login requires Ed25519 (§8), so that key is software-held. `own_agent_subtask.md` D1 accepts software custody for the minimum; hardware custody is a separate follow-up.
- **Today's phone does hold copies of persona keys.** `VtaClient.borrowKey` (`VtaClient.ts:1683-1691`) fetches a persona's private signing and key-agreement keys over `keys/export-secret/0.1` and imports them into an in-memory KMS backend. Callers: `VtaClient.ts:1627`, `:1630`, `:1717`, `vtaRotation.ts:78-79`, `vtaKeyMigration.ts:83-84`, `app/src/screens/Developer.tsx:629`. They are never persisted and are refetched each session, but they leave the VTA. Whether the persona's authentication key (the one the VTC checks) is the same key the phone already borrows for signing is unknown (§11 V2); if it is, the VTA must still sign logins.
- **Approvals.** `keys/export-secret/0.1` is on the phone's own send list (`approvalRules.ts:61`), so it can be put behind an approval rule; this plan does not change that list.

---

## 4. One router, the trigger model

Both flows enter through `bifold/packages/core/src/modules/trust-tasks/module/vtiLinks.ts`: `keyringAgentLinkKind` (line 81) classifies and `routeKeyringAgentLink` (line 292) acts. The scanner, the paste screen and deep links (`TabStack.tsx` `handleDeepLink`, via `openKeyringLink` in `keyringLinkOpen.ts`) all call it, so a new flow is one new `KeyringAgentLinkKind` and one new `case`.

### The trigger

The text that the Farm or a portal shows is a **trigger** (spec §0 to §1): a contact DID (`from`), a handle (`id`, 16 to 128 base64url characters), an optional expiry (epoch seconds), an optional flow hint (a Trust Task Type URI) and an optional, advisory transport hint (`tp`). It carries no task body, no endpoint, no key, no challenge and no secret that authorises anything, and the wallet treats each field as an **untrusted hint**. What the wallet does:

1. Read and validate the trigger by the spec's reading order (spec §3). Nothing is sent.
2. Resolve the contact's DID, verify the document, and choose a transport by the wallet's own preference among the services the document offers and the wallet implements (`DIDCommMessaging`, `TrustTaskHTTPS`; `TSPTransport` is reserved and unverified); the endpoint comes from that service, never from the text. If the document offers nothing the wallet implements, nothing is sent and the screen says "This service can't be reached from your wallet." (spec §6.2.1, below).
3. Send a **wallet-signed first request** to that endpoint, a Trust Task document with `issuer` the wallet's DID for the exchange, `recipient` the inviter's DID (audience binding belongs here: framework Consumer Requirements requires a consumer to "reject any document whose `recipient` member is set and does not identify the consumer's own party", so an offer addressed to an unknown phone cannot carry one), a proof, a unique `id`, short `expiresAt`, and the handle echoed (DIDComm `pthid` where the binding is DIDComm).
4. Replies and continuation travel over that binding. The trigger is not consulted again.

### Agreeing on the transport (spec §6.2.1)

The screen that shows a code is usually not the endpoint, so the trigger names an inviter DID and the wallet works the transport out from that DID's document. Standing rules (the spec is normative; open decision T7 is the wallet's preference order):

- The document must be verifiable (the `did:webvh` log); an unverifiable one ends the exchange with nothing sent.
- Candidates are services whose `type` maps to a binding the wallet implements: `DIDCommMessaging` to DIDComm, `TrustTaskHTTPS` to the Trust Task HTTPS binding (matched on `type`, never `id`; `https/0.2` and `0.3`, section 6.2). The wallet picks by its own preference order. DIDComm `accept` is an ordered list of media types for the message, not a transport selector, and how DID Core or upstream rank several services in one document is **not verified**, so the document does not rank them.
- No candidate is the defined outcome `no-common-transport`: nothing is sent.
- The first request and the reply use the same binding.
- The optional `tp` hint only orders choices; it cannot add a candidate and a wallet may ignore it. An endpoint is never taken from the trigger, and one that is not in the DID document is rejected; the one exception is the allow-listed legacy Farm callback.
- **Out of scope:** the device-to-device case, where the QR holder is the endpoint (no server), needs a `transports` list in the trigger and a proximity check; the spec records it as a future profile.

The inviter decides what the signed request is worth by its own policy; the handle is a lookup key and grants nothing. **The legacy Farm QR `{vta_did, callback_url}` is version 0 of the same model**: the contact is `vta_did` and `callback_url` is the endpoint and the secret in one string.

| Flow | Hint (Type URI slug) | Contact (`from`) | Channels | Notes |
|---|---|---|---|---|
| A, slot claim | `vta-claim` (new; **no upstream task covers a pool claim**, checked at `origin/main`) | the Farm's always-on claim-service DID (a parked slot runs nothing and cannot be the inviter; inference, unverified) | scan, deep link, paste | expiry required; contact's domain must be on Keyring's list |
| B, login | `auth/cross-device/claim` (B's name, not an upstream spec); `auth/authenticate/0.3` for the sign-in itself | the community's DID | scan, deep link, paste | expiry required (120 s); the community must be one the wallet knows |
| A, legacy | none: JSON `{"vta_did":"…","callback_url":"…"}` | `vta_did` | scan only | frozen until the Phase 0 release (§8); accepted exactly as the Phase 0 reader takes it |
| lab / self-hosted | `keyring://vta/enrol?o=<base64url JSON>` | | | outside the trigger model, **lab-only**, unchanged |
| unchanged | `keyring://vta/approvals`, `keyring://vti/community?d=`, `keyring://vti/invitation?c=`, `vetting-ticket:?…`, a bare DID, an OID4VCI offer | | | not touched |

### Container (open decision T1)

The trigger is carried in one of two containers, **open decision T1**; the spec's reader and vectors implement both (spec §2.3). **Working position (DRAFT, discussable, §7.1 WP3): Y**, proposed to the Trust Tasks task force as a profile; X is the recorded standards-aligned alternative; the legacy JSON stays version 0. Pros, cons and the recommendation are in the companion (F13).

- **X, a DIDComm v2.1 out-of-band invitation with no attachment** (`from`, `id` as the handle and the first reply's `pthid`, `expires_time`, `body.goal`, and the flow hint in `body.goal_code` as a Type URI): a published container, DIDComm scanners and Credo parse it. Cons: larger (about 400 to 550 characters), base64url JSON to read strictly; a generic DIDComm path (Credo) that on receipt saves an out-of-band record and makes a connection to `from` with a `did:peer` of its own, before looking at the goal (read from `node_modules`, not run); `goal_code` is not namespaced the way DIDComm asks ("goal codes defined outside of this spec MUST use Reverse Domain Name Notation", DIDComm v2.1, Goal Codes), and a Type URI is not that form.
- **Y, a plain `https` link with a small fixed parameter set** (`_from`, `_id`, `_exp`, `_type`, and the optional `_tp`; names are placeholders): smallest (about 150 to 250 characters), trivial to read, no DIDComm side effect. Cons: not a standard, so a second format every scanner learns and five names someone must govern, which is why it is proposed as a profile; and it cannot carry a `did:webvh` DID that encodes a port (`%3A`), because `%` is outside its value characters, which affects lab stacks served on `localhost:<port>` (container X can).

Both are delivered as a claimed `https://<inviter domain>/<path>?…` link; `keyring://` is a convenience alias carrying the same host, path and query, **never the form a camera is expected to open**. A trigger **never causes a fetch**: DIDComm's `_oobid` (a GET whose response format DIDComm does not define) is not part of the profile, so nothing is spent on a GET (§4 rule 9). Which app opens an `https` link is decided by the operating system from files the link's domain publishes and the domains each wallet build declares (spec §2.5, §2.6).

### Rules Keyring applies

1. **Flow routing is by the hint's Type URI** `https://<authority>/spec/<slug>/<MAJOR.MINOR>` (framework 0.7.0 draft, Type URI and Compatibility Rules): the flow is named once, never by a second bare `goal_code`. MINOR is additive; a task at MAJOR 0 is draft and its MINOR may break, so Keyring accepts only the MINORs it implements for it; an unknown MAJOR is refused with `unsupportedVersion` and ends in the "update the app" outcome, never a silent fallback.
2. **Unknown flow: the update outcome.** After `unknown-flow` or `unsupported-version` the router tries no other flow, major or parser. Texts with no marker (`keyring://vta/enrol`, ordinary links, `vetting-ticket:`) are not ours and go to the existing classifier unchanged. **A trigger link never reaches the generic connection handler**, including a container-X link with no attachment, so no connection to `from` is made as a side effect.
3. **Authorities are a set.** Keyring's accepted authorities are a list from day one, with `https://trusttasks.org` the provisional entry (§11 F7; working position WP7, DRAFT). Moving the task types to another authority needs: wallets accept the new authority **before** any producer switches; inviters accept requests under both authorities during the window and move the hint last; the registry publishes an alias (framework: old and new URIs "identify distinct specifications unless and until the registry policy explicitly aliases them"); producers emit both forms during a transition (the inviter accepts both; the hint moves last, because a hint names one URI); `trusttasks.org` keeps serving the old URIs; a known flow under an unknown authority shows "update the app". The framework hard-codes `https://trusttasks.org/spec/...` as the public-registry form, so moving core tasks needs a framework change and every upstream Type URI Keyring already speaks changes with it. Reported, unverified: `trusttasks.org` is informally ToIP-governed, its owner is a ToIP editor, long term the core tasks are likely under a `trustoverip` subdomain, and Brendan is an editor and can propose.
4. **Draft tasks strand wallets unless producers keep the previous version working.** Both new tasks start at MAJOR 0. Inviters keep accepting first requests under the previous Type URI until the named wallets have shipped the new one (framework, Migrating Between Versions: update receivers first, then senders, then retire).
5. **Endpoint from the DID document, never from the text.** The phone resolves the contact and takes the service endpoint from the document. Keyring acts on a `vta-claim` only when the contact's DID domain is on its list. The legacy callback keeps its allow-list (`ic3.dev`, `firstperson.dev`).
6. **Identifiers are compared as exact strings and never edited**; slugs are kebab-case, the version is last (framework Type URI, Stability).
7. **Percent-decoding and base64url are strict.** No value is percent-decoded; `_oob` is unpadded base64url; duplicate parameters and duplicate JSON member names reject.
8. **A trigger never carries an admin key, a challenge, a nonce, a task body, an endpoint or a display name the wallet trusts.** The phone supplies its own key; the inviter supplies the challenge; names come from signed responses.
9. **Nothing is spent on a GET, and the router redacts.** `TabStack.tsx:146` logs every deep link in full (`logger.info(\`Handling deeplink: ${deepLink}\`)`), and `UTIL_LOGGER` is a remote logger with a Loki transport toggled in `app/src/screens/Developer.tsx`; so a trigger link, or any text opened as a deep link, is written to device logs and possibly shipped off-device before any classifier runs. The legacy JSON is scan-only and does not pass that line: the scan path (`connectFromScanOrDeepLink`, `utils/helpers.ts`) logs only the channel ("qr scan"). The rule is therefore tested on both paths (K1b). The router logs at most the class of a link, never the text, the handle or the contact.
10. **Step-up and consent are Keyring policy, not task text.** A task specification "MUST NOT declare that a task does or does not require consent, human approval, or an authentication step-up" (framework, Governance Considerations); a task declares `sideEffects` (`destructive` covers "authority-shifting") and `exposure.actsAsSubject` (a login), and Keyring and the inviter apply their own approval and biometric rules (§6).
11. **Every flow documents which field is a secret and which is a handle.**

| Flow | Field | Secret or handle | Consequence |
|---|---|---|---|
| `vta-claim` | the handle in the trigger | **a bearer if the Farm treats it as the authority** (§11 F2, spec §7); proof of possession by the claimant's own key does not change this | never logged, never in an error or analytics; a pasted or opened link is a credential in Option A; spent only on the signed claim request |
| `vta-claim`, legacy | `callback_url` ("Possession of an unused callback nominates an administrator", `agentHostConnection.ts` header; HMAC-SHA256 over the request id, single-use per DID) | **secret** | the same; no `keyring://` fallback button on a landing page that carries it |
| `vta-claim` | the slot DID, the contact | handle (public DIDs) | may be shown |
| login | the pending-login handle | handle, at least 128 bits; grants nothing alone | still not logged; the VTC allows one claimant |
| login | the community DID (equal to the contact) | handle | must already be a community this phone knows (K4) |

### Upstream Trust Tasks reused, and not

Read at `origin/main` of `dtgwg-trust-tasks-tf` (`7b6bb488`, not the pin `bdae1cf9`); all `draft`. Detail with section anchors is in the spec's §6.4.

| Upstream | `vta-claim` | login |
|---|---|---|
| `vtc/invitations/deliver/0.1` (QR-sized OID4VCI offer; redeems only for a key-binding proof by the invited DID) | pattern only: the invited DID is known up front, a pool claim's is not; **not** a precedent for a Trust Task in a QR | not relevant |
| `vtc/install/claim/{start,finish}/0.3` (token, separately delivered claim code, step-up approver) | pattern only; the model for claim Option B | not relevant |
| `auth/authenticate/0.2`, `0.3` (0.3: a delegate such as the holder's VTA authenticates a principal) | not relevant | **fits** the VTA-proxied sign-in leg (0.3, draft; portal use not checked) |
| `auth/step-up/*` | pattern only (two-channel code, wrong-code limit) | **a partial fit only**; a bound-operation or `task-consent` task may fit login consent better; **fit not verified** |
| Trust ceremonies (`ceremony` member and `/ceremony/` namespace normative; design note "Draft — proposed, not implemented"; definitions `vtc/member-onboarding`, `vetting/identity-vetting`, `mutual-attestation`) | **no ceremony defines an entry, a trigger or a QR format**; membership "is a claim, not a permission" (grants no authority) | same. Keyring MAY tag its exchanges with the `ceremony` member as a claim only |
| pool claim, Farm, `auth/cross-device/claim`, `qr-login` | **no upstream task** (`git grep` at `7b6bb488`) | **no upstream task**: the pairing is a new type |

### What is custom

TSP defines no invitation format (the specification calls out-of-band introduction "out of scope"), so a TSP-based inviter shows a trigger in one of the containers and replies over TSP (§11 F6). The `vta-claim` and login tasks are new, and no standard defines the login pairing. **The authority for Keyring-published task types is provisional** (§11 F7).

### Generic camera apps: what Keyring's build must declare

The spec's §2.5 holds the platform requirements (sources and verified marks are in the companion's appendix G):

- **Today's build declares two domains, neither an inviter's.** `app/ios/AriesBifold/AriesBifold.entitlements:5-11` has `applinks:` for `wallet.asml.berkmancenter.org` and `witness.asml.berkmancenter.org`, each also with `?mode=developer`; `app/android/app/src/main/AndroidManifest.xml:72-84` has `autoVerify` `https` filters for the same two hosts. No Farm or portal domain is declared, so **no trigger link opens in Keyring from a camera until a build declares its domain** (spec G8). The first release needs only the Farm's domains already on the allow-list (`ic3.dev`, `firstperson.dev`): add a host and path to the entitlement and the manifest (decision T3; the Farm may prefer its own app, `vta-mobile-agent-ios`, and Android resolves two wallets on one host and path by install order, so ask the Farm owners early).
- **The schemes are declared and are not enough.** `keyring`, `didcomm`, `did`, `vetting-ticket` and `openid-credential-offer` are in `Info.plist:23-50` and `AndroidManifest.xml:50-70`; they serve Keyring's own scanner and links Keyring controls. RFC 8252 section 7.1 is a MUST for a domain-based scheme and section 8.1 says which app receives a shared scheme is indeterminate.
- **Each inviter domain publishes the two files and a landing page** (spec §2.7); Keyring's existing pair is described in `docs/UNIVERSAL_LINKING_SETUP.md`. Camera and QR-app handling of custom schemes is **unverifiable from documents** and stays an untested hypothesis (acceptance tests C1 to C12).

### Whether Keyring reads v2 `_oob` links today

Partly, and not by flow. `vtiLinks.ts` has no `https` or `_oob` classification. The generic connection path (`bifold/packages/core/src/utils/helpers.ts:1127-1224`) passes a v2 `_oob` link to Credo as an ordinary connection invitation. Read from the Credo build in `node_modules` (not run): an attachment-only v2 invitation is accepted at connection level and then fails with "Invalid message type", because the attachment carries `type`, not `@type`; and for any v2 invitation Credo connects to `from` first. The K1 classifier therefore runs ahead of this path.

### Claim v2: endpoint from the DID document

It is **blocked on proving `did:webvh` resolution of a Farm claim-service DID on every supported device, with a tampered log rejected**, and on the Farm publishing a claim service entry in the claim-service document. Resolution itself is not missing: the shipped legacy claim already resolves the slot's `did:webvh` to reach its mediator (`confirmHostOffer`, `vtaAgent.ts:1272`, calls `resolveVtaMediator`, `VtaClient.ts:303`, which resolves the document and reads its `DIDCommMessaging` service), `RetryingWebVhDidResolver` is registered (`utils/agent.ts:164`) and `classifyDid.ts:100` resolves with `agent.dids.resolve`. **Not verified:** that a real Farm log, with a path-bearing DID, resolves on Hermes on each supported device and that a tampered log is rejected (parent F1's acceptance criterion). The legacy path stays valid meanwhile.

---

## 5. Lifetimes

| Flow | Window | Who enforces | Source |
|---|---|---|---|
| A, QR scan | about **5 minutes** from when the Farm made the code | the Farm; the phone mirrors it (`AGENT_HOST_QR_LIFETIME_MS`, `agentHostConnection.ts:31`) and a trigger carries `exp` | verified in code; Farm side per Farm owner reply, otherwise unverified |
| A, scan to connected | about **1 hour** | the Farm; the phone shows a countdown | the hour is Keyring's **progress credential**, **not an admin grant window**: the admin key is permanent once accepted (Farm owner reply) |
| A, never scanned | a reserved slot returns to the pool and refunds the link use | the Farm | Farm owner reply |
| A, scanned never connected | the slot is destroyed and rebuilt | the Farm | Farm owner reply |
| A, status | `provisioning`, `awaiting_mobile`, `connected`, `failed`, `expired` | the Farm | Farm owner reply |
| A, callback | HMAC-SHA256 over the request id under a server secret, recomputed; single-use per DID; a re-post of the same `admin_did` is idempotent for 24 hours, a different DID gets `409` | the Farm | Farm owner reply |
| B, pending login | **120 seconds** from the portal's `start`; claiming does not extend it; the trigger's `exp` states it | the VTC | B; unverified |
| B, `id_token` | at most 5 minutes, one use | the VTC and VTA | B, T4; `vault/proxy-login` caps tokens at 300 s (B cites `pnm-core/src/vault/proxy-login.ts`; unverified here) |
| Farm login nonce | **120 seconds**, one time | the Farm | Farm owner reply (§8) |

The trigger's `exp` lets the phone refuse a stale code before it asks (`expired`); clock skew applies and the inviter remains the authority. A deep link that arrives while the wallet is locked is held until unlock (`deep-links-while-locked.test.tsx`), which is why `expired` is checked at unlock. An expired code is answered with "This code has expired. Get a new one."

---

## 6. Ownership, and checks around claiming it

Claiming a parked slot makes the scanner the agent's super admin: a stronger grant than a device join. [`pnm_cnm_subtask.md`](./openvtc-integration-plan/pnm_cnm_subtask.md) §4.7 states that *"ownership is not on the wire"*, so the phone writes the local ownership declaration at claim time.

- **The Farm's signal gates screens only.** The Farm exposes the grant kind (`provision_vta` = owner, `grant_acl` = delegate; Farm owner reply). It is a Farm assertion and is used only to choose screens.
- **The phone verifies sole ownership itself.** After the key swap it calls `acl/list` (`VtaClient.listAcl`, `VtaClient.ts:1284`; `acl/list/0.1` and `0.2` are on the phone's own send list, `approvalRules.ts:62-63`) and checks that its key is the **sole super-administrator** entry, and refuses to call itself owner otherwise. The host operator retains infrastructure-level control of a hosted VTA, so the claim screen says that and shows which Farm account, if any, the slot is provisioned under, from a signed response. Who can reset the admin key is a Farm question (§11 F5).
- **A fresh biometric or OS local authentication is required at the claim (working position WP2 and WP4, DRAFT; open decision B3).** Today the claim path checks that the phone has a screen lock (`deviceCanOwn`, run in `confirmHostOffer`, `vtaAgent.ts:1253`) but does not prompt; the owner acts that follow do (`confirmOwner`, `vtaAgent.ts:1811` onward, on `ownerConfirm.ts`). The reason to prompt is that the claim is the moment the owner key comes to exist, and that "whoever scans owns the slot" makes the scanning person the only check; it also lowers the value of a leaked handle, because a leaked handle used on another phone still needs that phone's owner to authenticate. The cost is one more tap on a path sold as one scan. `confirmOwner` already reads a Keychain item stored with `BIOMETRY_ANY_OR_DEVICE_PASSCODE`, so the device passcode is the fallback and no new dependency is needed (read from `ownerConfirm.ts`). Login needs a biometric at every approval regardless.
- **No recovery.** The Farm owner reply says there is no recovery and the claim page says the instance is temporary; Keyring says so on the claim screen (position 8).

---

## 7. Positions on A, and what the Farm said

Brendan accepted ten positions on 2026-10-08 as Keyring's position going into talks with the Farm owners. The Farm owner reply answered several. Reasoning is in [`keyring-on-the-vta-farm/2026-10-08-bm.md`](./keyring-on-the-vta-farm/2026-10-08-bm.md) and the companion here.

1. **QR shape.** The QR is a trigger (§4). The legacy JSON is version 0 and is **frozen** until a Keyring release ignores unknown keys (§8, Phase 0). The Farm builds one payload, not this one and the enrolment offer.
2. **Allow-list.** No callback URL rides in a trigger; the phone takes the endpoint from the claim service's DID document and applies a list to the contact's domain. The legacy callback list (`ic3.dev`, `firstperson.dev`) holds because callbacks are built server-side and are always Farm-origin (Farm owner reply). Farm domains only.
3. **Super-admin ownership.** **Answered:** the Farm exposes the grant kind, which is a Farm assertion for gating screens only; the phone verifies sole ownership by `acl/list` (§6).
4. **Unfinished claims.** **Answered (§5):** about 5 minutes to scan and about 1 hour to connect; reserved-never-scanned slots return to the pool; scanned-never-connected slots are destroyed and rebuilt. The 1 hour is the lifetime of Keyring's progress credential, not an admin grant.
5. **Claim links.** A use counter and expiry at the Farm; a re-post of the same `admin_did` is idempotent for 24 hours and a different DID gets `409`. Revocation, and admin-side revocation after the claim, are Farm questions (§11).
6. **Farm credential.** **Answered:** registration needs only a DID (the progress credential authenticates it); **login requires proof of possession** by a strict SIOPv2 `id_token` (§8, Phase 1). A separate phone-held Ed25519 key, registered only after the key swap succeeds.
7. **Default manager.** Dropped; where the Farm uses the term it means the PNM role. The claimed VTA becomes the active agent.
8. **No recovery in the first release.** Said plainly on the claim screen. The shipped screens `LostPhoneCard`, `NewPhoneOffer`, `VtaNewPhoneOffer` and `KeysMovedNotice` (under `trust-tasks/screens/`) are reconciled with that: a claimed-slot agent either suppresses them or the stance changes (§11 B2).
9. **Key custody.** Hardware custody does not block the first release. Ed25519 hardware custody is not possible on the current stack (§3); recovery and hardware custody are separate follow-ups.
10. **Verification.** Before building against the Farm contract, run `scripts/openvtc/setup-external.mjs` and obtain the current `vtafarm-api` docs or source, after checking free memory.

The Farm also said: reach a pooled VTA by DID plus mediator, never by hostname (pooled VTAs move to a separate DNS zone; names carry a random suffix such as `brave-otter-k7`); the pool is capped near 100 slots; Ed25519 is mandatory, so P-256-only hardware does not work; the progress response will gain the VTA's **mediator DID and DID-log hints** (to be added by the Farm; Keyring does not rely on them until they ship, and still resolves the DID itself); and **only the metadata SIOP route** (`GET /api/v1/auth/siop/metadata`) was given, so the registration, nonce and login routes are requested and not yet seen (K5, K6 are blocked on them). The Farm-facing draft also says the VTA stays usable after a registration failure; that statement is not recorded anywhere else and is unverified.

**Asks of the Farm, not yet answered** (§11 F9 to F11): per-issuer quotas and rate limits against pool draining (spec §7.3); the progress credential's lifetime and renewal (is the hour measured from the scan or from issue, and can it be renewed); a re-registration path after a failed login registration (WP8a).


### 7.1 Working position on the open decisions (DRAFT, discussable)

Brendan accepted the following on 2026-10-08 as a **working position to take into discussion**, not as a decision of the Farm, the VTC owners or the Trust Tasks group. Each row maps to an existing identifier; pros, cons and the recommendation behind each are in the companion (F13).

| # | Working position | Maps to | State |
|---|---|---|---|
| WP1 | **The first release is one small hardening release:** K0 (the agent-host QR parser requires `vta_did` and `callback_url` and ignores the rest; the `'an extra member'` test flips), K1a (the `allowedHostOf` fix: no leading dot, double dot, fragment or control character) and K1b (deep-link log redaction, `TabStack.tsx:146`), bundled. If any slips, ship K0 alone. SIOPv2 (Phase 1) is a separate phase. K1a and K1b are code PRs, not part of the documents here | Phase 0 (K0, K1a, K1b); no decision ID | not decided by the Farm; ours to schedule |
| WP2 | **Claim token, staged.** v1 keeps the Farm's HMAC callback (a bearer) hardened: single use spent on the claim POST and never on a GET, biometric or OS local authentication at the claim with the device passcode as fallback, and the sole-super-administrator check by `acl/list` after the key swap. **Option C** (no secret in the QR; a challenge-bound signed claim from the scanner; a code derived from the phone's key confirmed on the Farm page) is the phase 2 target. **Option B** (a second-factor claim code) only if C proves impractical | T2, F2, B3; K3a, Phase 2 | Farm input needed for C; the hardening is ours |
| WP3 | **Trigger container.** A plain `https` URL with a small fixed query (inviter DID, handle, optional expiry, optional Type URI hint, optional advisory transport hint), **proposed to the Trust Tasks task force as a profile.** A DIDComm out-of-band invitation with no attachment is recorded as the standards-aligned alternative with its drawbacks (§4). The legacy `{vta_did, callback_url}` stays version 0 | T1 (T4 and T5 unchanged) | Trust Tasks view needed |
| WP4 | **Login is not scanner-only.** Camera-opened links are allowed. Mitigations: number matching, an inviter-signed screen showing who is asking, a biometric at every approval. A proximity (BLE) check is a later version, per RFC 10027 section 6.1.1 and CTAP hybrid | B4; K4 (Later); spec §8.2 | later version unscheduled |
| WP5 | **Admin-side revocation of login identities does not block.** Self-service deletion is accepted for now; the Farm is asked for admin revoke later | F5; Farm question "admin-side revocation" (§11) | waiting on the Farm |
| WP6 | **Camera support.** First release: the in-app scanner only. **No "Open Keyring" button on the Farm's claim page in the first release, and none in the Farm ask:** the legacy JSON is QR-only, so a button that delivers it as a link is `wrong-channel` (spec §9); an `https` button opens nothing in Keyring until a build declares the Farm domain (K1d); and a `keyring://` button on a page carrying a spendable callback is forbidden (spec §2.7 item 5). The button belongs to the **camera phase** (after K1d and a device run of C1 to C12, with a trigger link, not the legacy JSON). Universal Links and App Links on a neutral link domain are also camera-phase work | T3, F8; K1d | needs the domain owner and a device run |
| WP7 | **Authority.** `trusttasks.org` now, provisional and informally ToIP-governed. Wallets accept a **set** of authorities from day one; producers emit both forms during a transition; the registry publishes an alias. A formal link to ToIP is Brendan's proposal; long term the core tasks are likely under a `trustoverip` subdomain (reported, unconfirmed) | F7; §4 rule 3 | Brendan to propose |
| WP8 | **Smaller items.** (a) Login registration failing after `connected`: Keyring retries idempotently while the progress credential is valid, and asks the Farm for a re-registration path. (b) Ask the Trust Tasks expert for the exact meaning and source of "trigger". (c) Confirm that the VTC owners endorse the third-party VTC sign-in proposal before treating it as their position. (d) Run `scripts/openvtc/setup-external.mjs`, after checking free memory, because VTI claims depend on it. (e) Spike early: a real Farm `did:webvh` log resolves on Hermes on each supported device and a tampered log is rejected (the shipped claim already resolves a slot's `did:webvh` for its mediator, `resolveVtaMediator`, `VtaClient.ts:303`) | (a) Farm question "login registration fails after `connected`" (K5); (b) "For the Trust Tasks expert"; (c) **new, V3**; (d) F1 and position 10; (e) the blocker under "Claim v2" in §4 and parent plan F1; no ID here | (b) to (e) not yet done |

Transport is a further open decision that the working position leaves undecided: **T7**, the wallet's preference order among bindings (§11).

---

## 8. Phases and what each side builds

Estimates are not given for the Farm, the VTC or the portal: they are not ours to schedule.

### Phase 0 — the first release: one small hardening release

**Goal.** Unblock the Farm's frozen QR and fix two defects, in one release (working position WP1, DRAFT): K0, K1a and K1b are bundled; if K1a or K1b slips, K0 ships alone, because the Farm waits on K0. SIOPv2 is a separate phase (Phase 1). **Blocked on:** nothing external. Steps K3a and K1c follow in a later release (Phase 0b, below); K1d is the camera phase (below).

| # | Step | Done when |
|---|---|---|
| **K0** | **Ignore unknown keys in the agent-host QR.** Change `parseAgentHostQr` (`agentHostConnection.ts:152-172`) to require the two keys and ignore the rest (minimal fix). | The test `'an extra member'` (`bifold/packages/core/src/modules/trust-tasks/__tests__/agentHostConnection.test.ts`, about line 49) flips to accepted; a missing key still rejects; a release containing it is named and dated to the Farm (answers the Farm's first question). **No store release is queued** (changelog 0.2.0 "Unreleased"; staging builds are being cut, latest tag `staging-v0.2.0-241`) |
| **K1a** | **Host-check fix (follow-up code PR, not this change).** Replace `allowedHostOf` (`agentHostConnection.ts:121-126`) with a label-based check: no empty label, trailing dot, fragment or control character in the path. | The spec's host vectors pass; `https://.ic3.dev/x`, `https://a..ic3.dev/x`, `…/x#frag` and a NUL in the path are refused |
| **K1b** | **Redact the deep-link log.** `TabStack.tsx:146` and any other site log the class of a link only. | Two tests, one per path: a trigger link through the deep-link handler (`TabStack.tsx`), and a trigger text and a legacy JSON through the scan path (`connectFromScanOrDeepLink`); each asserts no logger call contains the text, the handle or the contact. (The legacy JSON never reaches the deep-link line; the scan path logs only "qr scan".) |
| **Phase 0b** | **Later release, still no Farm work except where named:** K3a, K1c | |
| **K1c** | **Router.** Recognise a trigger (both containers: `_oob` with no attachment; `_from`) before the generic connection path; refuse an unknown flow with the update outcome; never fall through to the generic connection handler (§4 rule 2). Route `vta-claim` into the existing confirm screen only when K2's blockers are cleared; until then a recognised trigger shows the update screen. | Every vector in `docs/specs/keyring-qr-and-links.vectors.json` for the container(s) chosen passes against Keyring's parsers (the reference reader tested only the vectors); unknown flow and unknown MAJOR end in the update outcome; the legacy JSON still parses; a trigger link never reaches the generic connection handler (asserted); a handle never appears in an error, log or toast (asserted) |
| **K3a** | **Claim hardening, no Farm needed:** the post-swap `acl/list` sole-super-administrator check (§6); the plain "no recovery" and "temporary instance" words on the claim screen; the biometric or OS local authentication at claim, device passcode as fallback (§6, WP2). | After a faked claim, a faked `acl/list` showing any other super-administrator makes the phone refuse to declare ownership; the declaration is recorded before the first owner act; a claim that fails before the swap registers nothing; cancelling the authentication prompt abandons the claim before anything is registered |
| **K1d** | **Camera phase: declare the link domain(s)** (working position WP6: a phase of its own, separate from §8 Phase 2, after a device run of C1 to C12; the first release uses the in-app scanner only, with no "Open Keyring" button). Add the Farm's allow-listed domains (T3, option P) to `AriesBifold.entitlements` and an `autoVerify` filter in `AndroidManifest.xml`; run the spec's tests C1 to C12. **Blocked on** T3 and on the domain owner publishing both files. | C1 to C12 are recorded for iOS Camera, Android camera and Google Lens, a third-party scanner, no app installed and two wallets installed, with device, OS and result; the `?mode=developer` entitlement entries are absent from a release build |

### Phase 1 — Farm credential, SIOPv2 login, ownership signal

**Goal.** Make the claimed VTA reachable through the Farm without a hostname. **Blocked on the Farm owners** (their registration and login endpoints; the answers to the questions below) and on Keyring being able to mint the token.

| # | Step | Done when |
|---|---|---|
| **K5** | **Farm credential module.** A separate phone-held **Ed25519 `did:key`** (software-held; recommended by the Farm; `did:webvh` and `did:peer` are accepted), registered after the key swap succeeds (position 6). | A claim that fails before the swap registers nothing; registration needs only the DID, with the progress credential as authentication |
| **K6** | **SIOPv2 login.** Mint a strict `id_token`: header only `alg=EdDSA`, `kid=<did>#<fragment>`, optional `typ=JWT`; payload exactly `iss`, `sub`, `aud`, `nonce`, `iat`, `exp`; `iss == sub`; the nonce is a 120-second one-time challenge; `aud` is the `rp_did` from the public `GET /api/v1/auth/siop/metadata`. Reuses `signCompactJws` (`vtiInvitationOffer.ts:175`); there is **no SIOP code in Keyring today** and `VtiMediatorTransport.login` (about `:533`) is authcrypt DIDComm, not SIOP. | A faked Farm accepts a token that the Farm owner reply's rules accept and rejects one with an extra payload member, a wrong `aud`, a stale nonce or a reused nonce; the K4 guard (§8, Later) stays scoped to the login module and persona keys |
| **K7** | **Ownership signal.** Read the grant kind from the Farm for screens only (§6); the phone's own `acl/list` check stays the authority. | A `grant_acl` signal shows the delegate screens; no screen declares ownership without the `acl/list` check |

**Questions to Keyring from the Farm (open items):** which release ignores unknown keys; can Keyring mint strict SIOPv2 tokens and when; which DID method for the login identity; does Keyring need hostname access; admin-side revocation; Ed25519 enclaves; what happens when login registration fails after `connected`; the ownership signal inside the VTA session (§11 F-list).

### Phase 2 — the trigger profile (pointer model) and the claim-option decision

**Goal.** Move the Farm from the frozen QR to a trigger whose endpoint comes from the claim service's DID document. **Blocked on the Farm owners** (the claim task, a claim-service DID document, the claim option) and on T1 and T2.

| # | Step | Done when |
|---|---|---|
| **K2** | **Route `vta-claim`.** Resolve the contact, read the claim endpoint from its document, send the wallet-signed first request (§4), and reach the same confirm screen as `scanHostOffer` for the legacy JSON. | With a faked claim service, a `vta-claim` trigger and the equivalent legacy JSON reach the same confirm screen; nothing is sent to a slot DID or to an endpoint named in the text; the first request is signed, audience-bound to the contact and echoes the handle |
| **T2** | **Decide the claim option with the Farm** (§11, spec §7). Working position WP2 (DRAFT): v1 is A hardened (single use spent on the claim POST, biometric at claim, `acl/list` check); **C is the phase 2 target** (no-secret QR, signed claim, confirmation on the Farm page; conflicts with the frozen QR, so only after Phase 0 has shipped and with Farm input); **B only if C proves impractical**. Add the pool-draining requirements (spec §7.3) to the ask. | A written decision with the Farm owners; the chosen option's inviter requirements are in the Farm's backlog |

### Later (not scheduled, separate follow-ups)

- **`vtc-login` (K4).** Refuse an unknown community and offer the join flow (`communityTarget.set` and `navigate('VtiJoin')`, as `vtiLinks.ts:177` does); read the portal endpoint from the VTC DID document; list the personas that have a login entry for the community; verify the VTC's signed requester-context response against its DID's `assertionMethod` and show nothing otherwise; show who requested the login, number matching and a biometric (spec §8.2); `vault/proxy-login/0.2` to the VTA; post the SIOP envelope to the completion endpoint. K4 needs two things Keyring does not have: a client for the VTA's `vault/*` tasks (a search for `proxy-login` and `cross-device` in `bifold/packages/*/src` and `app/src` finds neither) and a way to list a persona's login entries (the task is unnamed in B; unverified). Starts when the `auth/cross-device/*` specs exist at a pinned version, a VTC that serves them exists to test against, and the `vault/*` client is scoped. Done when: an end-to-end test against a faked VTC and a faked VTA passes; a response with a bad proof, a wrong handle or a wrong community DID shows an error and nothing else; a wrong number sends `decline`; the login module never calls `borrowKey` and signs no `id_token` with a persona key (a test greps the module for both); nothing logs the handle, the challenge or the `id_token`.
- **Relay mitigations for login** beyond the first: proximity (RFC 10027 section 6.1.1; CTAP hybrid's BLE advertisement). Keyring has no proximity transport.
- **Recovery** and **hardware custody** (Ed25519 curve support first).

### The Farm (A) — per the Farm owner reply, otherwise unverified; not this repository

A pool of built, parked VTA slots with a replenisher and a claim service; a callback (HMAC over the request id, single-use per DID); status values; an ownership signal (grant kind); a registration and login endpoint for the Farm credential; slot destruction after the window; and, in Phase 2, a trigger with a claim-service DID document that publishes the claim endpoint, plus whichever claim option is chosen and the pool-draining controls (spec §7.3).

### The VTC and portal (B) — unverified, B's own work list

Pending-login store and `qr-login/*` routes; `auth/cross-device/claim/0.1` (response signed by the VTC) and `decline/0.1`; a `crossDevice` flag on challenges; server-set cookies at redeem; requester location and browser in the signed response; audit events; the member portal published as a `service` in the VTC DID document (**a prerequisite to check**); the portal's "Sign in with Keyring" page. New Trust Tasks go to the `dtgwg-trust-tasks-tf` working group (B's open decision 4).

---

## 9. Sequencing

1. **Now, ours, no counterpart needed:** Phase 0, the one hardening release (K0, K1a, K1b); then Phase 0b (K3a, K1c). K1d (the camera phase) waits for T3, a device run and the domain owner. None needs the Farm to change what it emits.
2. **With the Farm owners:** ship K0 and tell them the release; then Phase 1 (the Farm credential, SIOPv2, the ownership signal); then Phase 2 and the claim option. Obtain `vtafarm-api` (§12).
3. **B's counterpart work** (trust tasks, VTC, portal) proceeds on its own schedule; K4 starts per Later.
4. **Prove with the lab first,** per the `vti-lab-and-field` skill: a local stack we own carries B's claims about the VTC only if it runs a VTC build that has the routes; claims about the Farm need the Farm.

Neither flow is a phase of the parent plan: under its dependency rule they block nothing.

---

## 10. Standing rationale

- **A trigger, not a task.** Putting a task body, an endpoint or a credential in the text makes the text the authority, and the text is shown on a screen, photographed, previewed and logged. A trigger confers nothing, so a leaked one costs only a request the inviter answers by its own policy. A task body in a URL also needs a new link binding the Trust Tasks group has not seen, for no gain over a hint (framework Binding Namespace; a binding carries a document, and a trigger has none); that **Option 2, a new `link` binding, is a recorded alternative**, not a v1 design.
- **No attachment in the invitation.** A plaintext document in a DIDComm attachment falls outside binding `didcomm/0.2` ("Envelope arrived as anoncrypt or plaintext ... the message MUST NOT enter the framework pipeline"), and Credo dispatches attachments by `@type`, which a Trust Task document does not carry. The container carries none.
- **No fetch, nothing spent on GET.** Link previews, mail scanners, chat unfurlers, in-app browsers and an unverified-App-Link browser fallback all GET a link before the phone does; a handle spent on GET strands the real user. DIDComm's `_oobid` GET also has no defined response format.
- **A handle alone is a bearer.** In a pool claim the claimant's key is unknown in advance, so proof of possession by that key does not stop a leaked handle claiming, and it is not counted as a control.
- **`keyring://` is never the camera form, and never a fallback on a spendable handle.** RFC 8252 section 8.1: with a shared scheme "it is indeterminate as to which app will receive" the code.
- **One router.** The flow is named once, by the hint's Type URI; there is no second registry of bare codes (a bare `goal_code` is un-namespaced and duplicates the type).
- **Login is not scanner-only.** A stock camera delivers the link as a link, so refusing links breaks the generic-camera requirement and does nothing against a relay (RFC 8628 section 5.4); the controls are the signed requester screen, number matching, a short expiry, a biometric and, later, proximity.
- **Step-up lives in policy.** A task specification MUST NOT declare consent or step-up (framework, Governance Considerations).
- **`keyring://vta/enrol` stays outside the trigger model and lab-only.** It carries an EdDSA proof of the key and a code both screens compare before an operator grants, the right shape for a self-hosted or lab operator; the lab page and tests use it. What is retired is U1 as a request to the Farm, so the Farm builds one payload. Whether the Farm should also adopt it is §11 B5.
- **No pre-shared secret or account-first claim.** The proposal avoids one deliberately; the account-first path in `own_agent_subtask.md` costs a copy-and-paste round trip.
- **The presenting screen is not the endpoint.** A web page that draws a QR, or a card, shows a code on behalf of a service; the wallet learns where the service is, and which transports it speaks, from the inviter's verifiable DID document and chooses by its own preference, so no text can steer the wallet to an endpoint the inviter did not publish (spec §6.2.1). A transport hint in the text can only order choices.
- **No endpoint from a QR.** A code that carried an endpoint could point the phone at a lookalike server (B, T8); the endpoint is read from the inviter's DID document, which is why K2 depends on the claim service's document.
- **No "default manager".** A second notion beside the active agent would need its own switching rules for no gain (position 7).
- **No persona key on the phone for logins.** A phone that signs logins with persona keys makes a stolen phone a stolen identity for every community (§3).

---

## 11. Open questions

**For the Farm owners** (per the Farm owner reply where it spoke; otherwise unverified):

F1. Keyring's claim code was built against `vtafarm-api` `docs/mobile-connection-app-api.md` and `docs/vta-mobile-connection-design.md` at `d2cc4100` (`agentHostConnection.ts:3-4`). Is the current version, or the source, available to read, and at what commit? Without it Keyring relies on a description that may have moved.
F2. **Open decision T2, no option chosen.** How is a claim authorised (spec §7)? **A**: handle, single-use, bearer (proof of possession does not stop a leaked handle claiming; controls are lifetime, single use, first-wins). **B**: a second-factor claim code on another channel (`vtc/install/claim`, OpenID4VCI `tx_code` style). **C**: no secret in the QR; a challenge-bound signed claim from the scanner; a code derived from the phone's key shown on the Farm page for the person to confirm (conflicts with the frozen QR; later phase; needs Farm input). A with B's code as a second factor is the fallback.
F3. Is the ownership signal sufficient for gating screens, given the phone verifies sole ownership itself (§6)?
F4. Can partner domains be allow-listed, and who vets them? The `from` list (`ic3.dev`, `firstperson.dev`) may not cover a claim-service DID in the Farm's new DNS zone for pooled VTAs; which domain will it be?
F5. Can the Farm account reset the admin key (`own_agent_subtask.md` U3), or is loss final? Admin-side revocation after a claim? **Working position WP5 (DRAFT): not blocking; self-service deletion now, ask for admin revoke later.**
F6. How does a TSP-based inviter show a trigger, given that TSP defines no invitation format?
F7. **Authority** for Keyring-published task types (working position WP7, DRAFT: §7.1). Provisional: the Trust Tasks registry (`https://trusttasks.org/spec/<slug>/<MAJOR.MINOR>`), the profile proposed as a Trust Tasks task-force (Trust Over IP) document. Governance of `trusttasks.org` is informally understood, not confirmed; the VSC registry is predicates only. Who submits, and under what process, is open. A private spec would use an authority its publisher controls (framework Private and Unpublished Specifications).
F8. Which domain(s), and does the Farm want its own app to open its links (T3)?
F9. **Quotas.** Per-issuer quotas and rate limits against a script draining the pool (spec §7.3).
F10. **Progress credential.** Its lifetime and renewal: is the hour from scan or from issue, and can it be renewed?
F11. **Routes and hints.** Only the metadata SIOP route was given: please provide registration, nonce and login; and the mediator DID and DID-log hints the Farm said it would add to the progress response.

**Decisions for team discussion** (open; no lean recorded):

T1. **Container.** X: a DIDComm v2.1 out-of-band invitation with no attachment (standard; larger; Credo makes a connection to `from`; `goal_code` is not namespaced as DIDComm asks) or Y: a plain `https` URL with a small fixed parameter set (smallest; not a standard; five names to govern). Spec §2.3 has the table. **Working position WP3 (DRAFT): Y, proposed as a Trust Tasks profile; X recorded as the alternative.**
T2. **Claim authorisation** (F2). **Working position WP2 (DRAFT): A hardened in v1, C the phase 2 target, B only if C proves impractical.**
T3. **Link domains.** Neutral shared domain, wildcard subdomains, or per-inviter domains added to each build. The first needs someone to run and govern the domain and its two files and, on Android, two wallets resolve by install order; the second needs a per-subdomain file on iOS; the third needs a wallet release per new domain. Spec §2.6. **Working position WP6 (DRAFT): in-app scanner only first; a neutral link domain in the camera phase (K1d) after C1 to C12.**
T4. **Contact as a URL.** Is an `https` origin contact needed beyond the legacy callback?
T5. **The first request when no hint is given.**
T6. **Limits** (1,536 characters, 1,024 bytes, 16 to 128 handle characters): proposals, spec §13.
T7. **Transport preference order.** Which binding the wallet ranks first when the inviter offers several (spec §6.2.1), and whether the `tp` hint may break ties. A wallet decision with no lean; inviters need to know it.

**For the Trust Tasks expert (Brendan will ask):** the exact term and source for "trigger"; whether a Type URI is an acceptable DIDComm `goal_code` value; whether a trigger profile belongs to a task-force document; the authority move.

**For the VTC and trust-task authors:**

V1. Does the VTC DID document already publish the member portal's endpoint as a service? B marks this *assumed*. The same is needed of the Farm's claim-service document.
V3. Do the VTC owners endorse the third-party VTC sign-in proposal (B)? It is treated as an external proposal and not as their position until they confirm (working position WP8).
V2. Which task lists a persona's login entries, and is the persona's `authentication` key the key Keyring already borrows for signing? (§3)

**Questions the Farm put to Keyring** (Farm owner reply; Phase 1): which release ignores unknown keys (K0); can Keyring mint strict SIOPv2 tokens and when (K6); which DID method for login (`did:key` recommended); hostname access (the Farm says DID plus mediator only); admin-side revocation; Ed25519 enclaves (not on the current stack, §3); what happens when login registration fails after `connected` (working position WP8: Keyring retries idempotently while the progress credential is valid and asks for a re-registration path); the ownership signal inside the VTA session (K7, §6).

**For Brendan:**

B1. Is "losing the phone loses the account" acceptable given the recovery screens already shipped? (Position 8.)
B2. Should the recovery screens be suppressed for a claimed slot, or should the stance change?
B3. Should claiming require a fresh biometric (§6)? **Working position WP2 and WP4 (DRAFT): yes, with the device passcode as fallback.**
B4. Should login ever get a stricter channel rule, once relay mitigations exist? (§10) **Working position WP4 (DRAFT): no scanner-only rule; number matching, an inviter-signed screen and a biometric now, proximity later.**
B5. Should the Farm also be asked to adopt `keyring://vta/enrol` for a human-granted path?
B6. Should hardware custody of the manager key gate A or follow it? (Position 9: follow.)
B7. Where does "claim" go in the user-facing words: "Set up your agent" and "Sign in", per §1, or something else?

---

## 12. What is verified, and what is not

| Claim | Status |
|---|---|
| The agent-host flow, its allow-list, lifetime, and the two-key QR rule | verified, `agentHostConnection.ts` (parser `:152-172`, host check `:121-126`, test `agentHostConnection.test.ts` about `:49`) |
| `TabStack.tsx:146` logs every deep link in full; the logger can be remote; the scan path logs only "qr scan" (`helpers.ts`, `connectFromScanOrDeepLink`) | verified in code (`TabStack.tsx:146`; `Developer.tsx` toggle) |
| One router, the classifier and the routing cases | verified, `vtiLinks.ts` lines 81 and 292 |
| Manager key kept apart from persona records; temporary `did:key` then a phone-minted DID | verified, `VtiIdentityStore.ts`, `vtaAgent.ts`, `VtaClient.ts:1135` |
| Persona keys are copied to the phone in memory over `keys/export-secret/0.1` | verified, `VtaClient.ts:1683-1691` and the callers in §3 |
| `acl/list` exists in Keyring's client and send list | verified, `VtaClient.ts:1284`, `approvalRules.ts:62-63` |
| No `vault/proxy-login`, `cross-device` or SIOP code in Keyring | verified by search, 2026-10-08; reusable `signCompactJws` at `vtiInvitationOffer.ts:175` |
| Hardware custody is P-256 only on the current stack | read from the Credo KMS, `expo-secure-environment` and `react-native-attestation` sources by the verification run; not re-read for this revision |
| Credo's handling of an attachment-only v2 invitation (connection to `from`, then "Invalid message type") | read from `node_modules/@credo-ts/didcomm` `0.7.1-pr-2704-20260909134930`, **not run** |
| Framework: a consumer rejects a document whose `recipient` is not itself; a task spec MUST NOT declare consent or step-up; expand-then-contract; `sideEffects` `destructive` covers authority-shifting; the public-registry form is `https://trusttasks.org/spec/...` | verified, `dtgwg-trust-tasks-tf` `origin/main` `7b6bb488` (not the pin) |
| Binding `didcomm/0.2`: a plaintext or anoncrypt arrival "MUST NOT enter the framework pipeline" | verified, `7b6bb488` |
| Push binding Trigger role and "untrusted hint"; `vtc/admin/events/event/0.1` "A hint is a trigger to re-read" | verified, `7b6bb488`; no task document defines "trigger" as a term |
| Trust ceremonies: `ceremony` member normative, design note "Draft — proposed, not implemented", no entry or QR format | verified, `7b6bb488` |
| `vta-service/src/operations/vault/proxy_login.rs` exists at the VTI pin | verified, `822ff78a` (present; ancestor of `origin/main` `49f5f1be`) |
| RFC 10027 / BCP 247 (August 2026) section 6.1.1 on proximity; RFC 8628 section 5.4; CTAP 2.2 section 11.5.1 | verified, fetched and read in full text 2026-10-08 |
| QR version 40 byte capacity L 2,953, M 2,331, Q 1,663, H 1,273 | verified, Denso Wave table 2026-10-08; **scan reliability by length is unverifiable from documents** |
| Apple per-subdomain file and entitlement, `*.` prefix with the `appclips` exclusion, CDN 24 hours and weekly | verified, Apple documentation data, 2026-10-08 |
| Android: a wildcard `android:host` verifies against the root host's `assetlinks.json`; one `assetlinks.json` may list several apps; the most recently installed resolves an identical host and path | verified, Android pages read raw 2026-10-08 |
| What iOS Camera, Android camera, Google Lens and third-party scanners do with a link or a `keyring://` text | **unverifiable from documents**; iOS Camera and universal links from a 2017 session only; tests C1 to C12 untested |
| Everything about the Farm's API and behaviour | the Farm owner reply (data) for the facts in §5, §6 and §8; Keyring's claim code cites `vtafarm-api` docs at `d2cc4100` (`agentHostConnection.ts:3-4`), so a first reading exists, but `vtafarm-api` is not cloned here and the current version is needed; **otherwise unverified** |
| The Farm's QR is frozen until a Keyring release ignores unknown keys; no store release is queued | per the Farm owner reply (freeze) and the repository (no store release: changelog "Unreleased"; staging builds exist, tag `staging-v0.2.0-241`) |
| `trusttasks.org` is informally ToIP-governed; its owner is a ToIP editor; core tasks likely move to a `trustoverip` subdomain | **reported by Brendan, unconfirmed** |
| `auth/authenticate/0.3` fits VTA-proxied login; `auth/step-up/*` is a partial fit | read from the spec files (draft); **fit not verified** |
| The reference reader agrees with the vectors | true for the 201 trigger vectors and the 17 transport-selection vectors; **it does not test Keyring's parsers or selection code** |
| DIDComm: goal codes defined outside its spec "MUST use Reverse Domain Name Notation"; `accept` is an ordered list of media types for the message; the order of endpoints inside one `DIDCommMessaging` service SHOULD indicate the owner's preference | verified, DIDComm v2.1 text read 2026-10-08 (Goal Codes; Service Endpoint) |
| `TrustTaskHTTPS` is matched on `type`, never `id`, and its endpoint is an `https:` URL; the DIDComm binding resolves `DIDCommMessaging`; the TSP binding resolves a VID by TSP's own mechanism and names no DID-document service type | verified, `dtgwg-trust-tasks-tf` `origin/main`, `bindings/https/0.2` and `0.3` section 6.2 (the DIDComm and TSP statements are the `0.3` text); `TSPTransport` as a service type **unverified** |
| How DID Core or upstream rank several services in one DID document | **not verified**; the wallet's preference decides |
| Credo on receiving a v2 invitation saves an out-of-band record and creates a connection with a `did:peer:2` | read from `node_modules/@credo-ts/didcomm` (`DidCommOutOfBandApi`, `DidCommConnectionsApi`), **not run** |
| `confirmOwner` accepts biometrics or the device passcode | verified in code, `ownerConfirm.ts` (`BIOMETRY_ANY_OR_DEVICE_PASSCODE`) |
| ISO/IEC 18013-5 device engagement lists retrieval methods in the QR | **unverified** (paywalled; from memory) |
| B's code citations (`siop.rs`, `routes/auth.rs`, `member_portal.rs`, `proxy-login.ts`) | taken from B; **not re-checked** |

---

## 13. Review index

| Companion | Author | What it settles |
|---|---|---|
| [`2026-10-08-bm.md`](./one-scan-and-vtc-sign-in-plan/2026-10-08-bm.md) | BM | Why the two proposals are one plan; what B's custody rule conflicts with; the bespoke envelope, the OOB-with-attachment container and why each was superseded (F8, F11, F12); the authority and reuse decisions (F9); the claim-authorisation options (F10); the trigger direction, the Farm owner reply, the adversarial review and how each finding was applied, and the revised v1 scope (F12); the working position of §7.1 with pros, cons and recommendations (F13); why the transport is agreed from the inviter's DID document (F13); the independent final review and how each finding was applied (F14); a sourced appendix with each claim marked verified or not |
| [`keyring-on-the-vta-farm/2026-10-08-bm.md`](./keyring-on-the-vta-farm/2026-10-08-bm.md) | BM | The evaluation of A: what Keyring already ships, what is missing, the ten positions agreed |
