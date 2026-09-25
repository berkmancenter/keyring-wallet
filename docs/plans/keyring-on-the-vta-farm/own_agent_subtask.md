# Own my agent from the phone — create, protect, and keep a way back in

**Status:** Proposal for review. Not a commitment to implement. Target: the release after the one frozen on 2026-09-25; draft PRs only until that release ships.
**Parent:** [`keyring-on-the-vta-farm.md`](../keyring-on-the-vta-farm.md). This subtask carries its **F2 — Enrolment from the phone (L0)** for a person with no computer, and answers its §9 Q4 as far as code can (the rest is measurement, below).
**Siblings:** [`pnm_cnm_subtask.md`](../openvtc-integration-plan/pnm_cnm_subtask.md) owns the VTA client in general; this subtask adds only what owning an agent needs.
**Reasoning:** [`2026-09-25-cd.md`](./2026-09-25-cd.md). The facts this design rests on (plugin, VTA, Farm, and Keyring code, with citations), the positions taken on key custody and the owner model, the decisions (F6), and the Admin DID measurement with the temporary `did:key` design it forces (F7). [`2026-09-25-uiux.md`](./2026-09-25-uiux.md): the screens, their words and test IDs, and why the address comes before the owner code.
**Screens:** §7, in plain words; this document owns the flow and the calls behind them.
**Baseline:** VTI `ed672fff`, vta-browser-plugin `43e2cc7df9`, vti-setup `22f712f`, all at the pins in `scripts/openvtc/PINS.json`; bifold `fe125e84`.

---

## 0. The plain version

- **The goal:** a person with only a phone and a web browser gets their own agent and owns it from Keyring. No computer and no command line.
- **Like email, the agent lives with a hosting service of the person's choice,** or on their own server. The VTA Farm is the first service we support and test. Keyring's screens never name a service. They say "the service that hosts your agent".
- **On the hosting service's website**, the person creates an agent. The service shows the new agent's address, and they bring it into Keyring by pasting it, or by scanning it where the service shows a QR code.
- **In Keyring**, they tap **Create my agent**. Keyring makes an owner code on the phone and asks for Face ID. The person gives the code to the service: on the Farm, its "Admin DID" box. If they host the agent themselves, the code goes to whoever runs it.
- **Keyring signs in as the owner** and moves onto a long-term key. From then on, the agent answers only to this phone.
- **The phone's code is protected by Face ID** (Android: fingerprint or screen lock). Owner actions, like adding a backup, always ask again.
- **Backup:** during setup Keyring offers a backup owner, most simply a second phone. The first phone approves it. A lost phone then isn't a lost agent.
- **With the service's help:** a service that shows a QR code for this turns both copy-and-paste steps into one scan. We ask the Farm for that first; until then, copy and paste works everywhere.

## 1. What the person does, step by step

The Farm is the VTA Farm portal at `vtafarm.ic3.dev`. The order follows its wizard, which shows the agent's address **before** it asks for the Admin DID ([[DEV-GUIDE]] `01-personal-vta.md`: _"Create session"_ shows the VTA DID; then _"paste the Admin DID … Provision agent"_). Keyring needs the address first: it signs in through the agent's own mediator, which it resolves from the agent's DID before it shows a key (`vtaAgent.ts` `startManualLink`).

**The owner code is an Ed25519 `did:key`.** The portal's Admin DID field accepts nothing else: _"Paste only the did:key value (e.g. did:key:z6Mk…) with no surrounding text, labels, quotes, or whitespace"_ (measured 2026-09-25; companion F7). Keyring mints that key as a temporary one (`createVtiTemporaryDidKey`, keyring-bifold #136), and the connect in step 6 swaps it onto Keyring's long-term `did:peer:2`. The VTA answers a `did:key` through its own mediator, which holds the reply in that DID's queue, and the phone collects it on the socket it opened as the key (VTI `vta-service/src/messaging/service.rs:535-600`; mediator `routing.rs:382-405`). The swap checks no DID method on either side (`operations/acl.rs:849-944`). The QR enrolment path (§5) keeps its `did:peer:2`.

1. **My Agent → Create my agent.** Keyring explains the three steps and opens the Farm's website.
2. **Farm: create account → Create VTA → Create session.** The Farm shows the agent's address.
3. **Keyring: paste (or scan) the address.** Keyring checks that it's an agent (it resolves and names a mediator).
4. **Keyring: the owner code.** Keyring makes the key and offers Copy and Share. The first Copy or Share asks for Face ID, once for the visit.
5. **Host: give the code as the agent's admin** (on the Farm: paste into Admin DID → Provision agent).
6. **Keyring connects by itself.** From the first Copy or Share, Keyring asks the agent every 6 s whether the code is admitted ("Waiting for your agent host to add this phone… we'll continue automatically"). It stops after 10 min and offers "Check again", and "I've added it — check now" is always there. It pauses while the screen or app is in the background. At the first yes it signs in as that key (whoami), swaps it onto a long-term key (`acl/swap-key/0.1`, with the crash-safe pending-swap recovery of #127/#132), labels its own entry "Keyring — <device name>" (`acl/update/0.1`, in the background), and reads the agent's name. None of the checks asks for Face ID again.
7. **Ready.** Setup offers no backup step (D3). "Add another device" is in **My devices** (§4).

**With the Farm QR (§5):** steps 2–5 become "scan the Farm's QR, compare a short code, tap Provision". The phone hands its key to the Farm itself, over the existing `keyring://vta/enrol` exchange.

## 2. The owner model

- **The key the person pastes becomes the agent's full administrator.** The VTA has no owner tier above "admin with no context restriction" (super-admin: `vti-common/src/acl/mod.rs:492-513`, `:868-870`). On the Farm the pasted DID becomes **"admin (super admin)", contexts unrestricted, with no expiry** (M2, read from the Farm's ACL list on 2026-09-25; companion F9), the same row `vta import-did --role admin` writes (`vta-service/src/import_did.rs:57-71`).
- **The swap keeps that authority.** `acl/swap-key` moves the caller's own entry, keeping its role and contexts, and makes it permanent (`vta-service/src/operations/acl.rs:836-930`). So after step 6, the long-term key _is_ the owner: that key is the one to protect (§3), not the temporary one. The temporary key is software and short-lived, as for every link today.
- **The temporary key needs no service of its own.** It lasts from the grant to the first connect, stays on DIDComm (no TSP), and its swap target is the `did:peer:2` that names the mediator, so pushes reach the phone after that.
- **The swap's new key must be Ed25519.** The link proof is EdDSA-only (`vta-sdk/src/protocols/acl_management/swap.rs:171, 208`). Keyring's keys are Ed25519 today, so nothing changes for the minimum.

## 3. Protecting the owner key

**The constraint.** A key in the Secure Enclave or StrongBox is P-256 and can only sign. Keyring's session with its agent is DIDComm v2 authcrypt or TSP. Both need the phone's key to take part in key agreement, which a sign-only P-256 key cannot do. The Trust Task proofs Keyring and the swap use are EdDSA. So the phone's everyday agent key cannot live in secure hardware as things stand (evidence: [`2026-09-25-cd.md`](./2026-09-25-cd.md) F3).

**The minimum (Phase 1):**

- **Where the key lives.** The owner key stays an Ed25519 key in Keyring's wallet. The wallet is encrypted and opened by the app's PIN or biometrics, as the manager key is today (Askar KMS, `utils/agent.ts:82-87`).
- **Two rules on top:**
  - **No owner without a screen lock.** "Create my agent" refuses to make an owner key on a phone with no biometrics or passcode, and says why.
  - **Owner actions need a fresh confirmation.** Granting or removing a backup, and removing a device, need a fresh biometric or passcode confirmation at that moment, not only the app unlock.
- **What the screens say.** They describe this honestly: "protected by your Face ID", not "stored in secure hardware".

**Hardware-held owner (Phase 3, conditional on measurement M4):**

- **Two keys.**
  - A **P-256 owner key in the Secure Enclave or StrongBox**, biometric-gated per use. Credo's `SecureEnvironmentKeyManagementService` is already registered in Keyring (`utils/agent.ts:85`, with `biometricsBacked: false` today). It holds the super-admin entry and is used only for owner acts.
  - A **software Ed25519 everyday key** holding a narrower admin entry for the session.
- **The owner signs over REST**, not DIDComm: `auth/challenge` → a DI-signed `auth/authenticate/0.1` with `ecdsa-jcs-2019` → bearer (`vta-service/src/routes/auth.rs:152-164`). The VTA's proof library supports that suite for P-256 (`affinidi-data-integrity` 0.7.11 `crypto_suites.rs:37-39`), but it has not been seen to work end to end.
- **What Keyring lacks today:** a REST client, an ECDSA proof signer, and P-256 `did:key` encoding.
- **The pasted key.** It would then be the P-256 owner, **if** the Farm's Admin DID box accepts it (M3). Otherwise the owner is granted over REST by the pasted software key, which then removes itself.
- **Not the attestation key.** `react-native-attestation`'s iOS key is an App Attest key. Its assertion is not a plain signature over a message, so it cannot be a DID key (`react-native-attestation/ios/Attestation.mm:395-496`).

**Condition flagged:** Phase 3's design depends on M3 and M4. If the VTA does not accept `ecdsa-jcs-2019` on `/auth`, the hardware owner needs an upstream change, and the minimum stands as the design.

## 4. A backup way back in

**My devices** (on My Agent) lists every administrator of the agent, not only Keyring phones: other phones, a computer's pnm key, the browser plugin. Each has a friendly name (its label, or "A Keyring phone" / "A computer or other app" by DID type) and the date it was added. "Add another device" is at the top; Remove is on every row but this phone's. Setup itself offers no backup step (D3): a person who already holds other administrators (a pnm key, the plugin) has their way back in, and a host with an account login (the Farm's passkey plus its "Link another PNM") is another. **Keyring names its own rows** "Keyring — <device name>" (§1 step 6), so an admin can tell them apart.

The VTA's ACL rows are independent, so a second full administrator is a second row (R: `acl/mod.rs`). Only a super-admin may create an unrestricted admin (`acl/mod.rs:1081-1112`; `operations/acl.rs:361-363`). The owner phone is one (M2).

**Another phone (Phase 1, recommended):**

1. **The owner phone** chooses Add a backup and shows the agent's address as a QR code. The second phone needs it first, for the same reason as §1: its key names the agent's mediator, so it can't be made until the agent is known.
2. **The second phone** uses today's "I already have one — link it" without a QR, and scans that address (Keyring already reads a bare agent DID from a scan). It makes its temporary key and shows it as a QR code and as text (`vtaAgent.startManualLink`).
3. **The owner phone** chooses Add a backup → scans that QR → confirms with Face ID → sends `acl/grant/0.1` for that DID: role admin, no context restriction. This call is new in Keyring. The task already exists upstream (`acl/{grant}` in `vta-service/src/trust_tasks/acl.rs`), and Keyring's generic `task()` already sends any task (`VtaClient.ts:420-473`).
4. **The second phone** notices the grant, signs in and swaps onto its own long-term key: today's `checkManualGrant` → `finishLink`, unchanged.

**The browser plugin (Phase 4, decision needed):**

- **What exists.** The plugin never grants itself. It shows a temporary key and a `pnm acl create … --role admin` line for an operator to run (`extension/src/grant-command.ts:52-73`). Its onboarding then asks the VTA for a VTA-minted admin key (`core/src/provision/run.ts:123-231`, `adminRotation`). That key is generated off the device and kept by the VTA.
- **Keyring's part** is step 2 above, applied to the plugin's temporary key.
- **The catch.** The plugin's own custody is a VTA-minted software key. That is acceptable for the plugin, but it contradicts the parent plan's position against VTA-minted keys for _Keyring_ (parent §3.2).

**The risk to state plainly.** A backup administrator is an equal: the VTA lets one admin delete another (`operations/acl.rs:783-813` forbids only deleting yourself). A stolen backup phone could lock out the owner. Decision D3.

**Lost phone and no backup.** Keyring cannot help. Whether the Farm account (passkey) can reset the Admin DID is not documented. That is upstream ask U3, and the Ready screen will say what the answer is.

## 5. The Farm asks (upstream)

**U1 — show an enrolment QR, and receive the phone's key.** No copy and paste in either direction. After _Create session_, the Farm shows a QR code, and the same text as a link, of Keyring's existing enrolment offer (`packages/trust-tasks/src/enrolment/offer.ts`):

```
keyring://vta/enrol?o=<base64url(JSON)>
{ "v":1, "t":"vta-enrol", "vta":"<the new agent's DID>", "label":"VTA Farm",
  "url":"<a Farm endpoint for this session>", "n":"<single-use nonce>", "exp":<unix seconds> }
```

The Farm then answers three requests:

- **`POST {url}/submit`** with `{ "did": "<phone key>", "proof": "<compact JWS>" }`. The JWS is EdDSA; its claims are `iss` = the DID, `aud` = `url`, `nonce` = `n`, plus `iat` and `exp`. The Farm replies `{ "code": "<code>" }`, computed from `n` and the DID with the same function (`enrolmentCode`, `offer.ts`). Both screens show that code.
- **The person compares the codes on the Farm page and taps Provision.** The Farm uses the submitted DID as the Admin DID.
- **`GET {url}/status`** → `{ "state": "pending" | "granted" | "refused" | "expired" }`. The phone polls until `granted` (`vtaEnrolment.ts` `waitForGrant`).

No redirect is needed: the phone waits on the status.

Keyring already implements the phone's half; our lab's enrolment page is the reference implementation of the Farm's half. It already appears on the board as a maintainer's suggestion.

**U2 — say what the Admin DID box grants.** Which methods it accepts is measured: an Ed25519 `did:key` only (F7). Still unknown: which role, and whether the grant expires.

**U3 — recovery.** If every admin key is lost, can the account holder re-provision or reset the Admin DID?

**U4 (VTI, for Phase 3 only).** Confirm `ecdsa-jcs-2019` proofs on `auth/authenticate` for a P-256 `did:key` admin. Also note that `acl/swap-key` accepts only an EdDSA link proof.

## 6. Phases, estimates, acceptance

Estimates are one engineer's working days. **Ours** is Keyring work; **Farm/upstream** is theirs and not estimated here.

| Phase                                                                                                                                                                                     | Ours | Needs Farm/upstream                | Done when                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---------------------------------- | ---------------------------------------------------------------------------------------- |
| **M — measure first** (M1 and M2 **answered**: the Admin DID field takes an Ed25519 `did:key` only, and grants "admin (super admin)", unrestricted, no expiry; M3 and M4 move to Phase 3) | 1    | a Farm account (attended, passkey) | Each answer recorded in a dated companion with evidence (the whoami result, the ACL row) |
| **1 — the minimum, copy/paste**                                                                                                                                                           | 8–9  | none, if M1 and M2 hold            | see below                                                                                |
| **2 — Farm QR**                                                                                                                                                                           | 1    | U1 shipped by the Farm             | see below                                                                                |
| **3 — hardware owner**                                                                                                                                                                    | 6–10 | U4; maybe a VTI change if M4 fails | see below                                                                                |
| **4 — browser-plugin backup**                                                                                                                                                             | 1–2  | none                               | D4 decided; the plugin, granted by the owner phone, completes its own onboarding         |

**Phase 1 pieces:**

- **Create-my-agent flow** (address first, owner code, connect, swap, name) on today's manual-link code: 2 days.
- **Owner confirmation rules** (no screen lock → refuse; fresh confirmation for owner acts): 1 day.
- **Add a backup phone** (the `acl/grant` call, scan and approve on the owner phone): 2–3 days.
- **Tests:** 2 days.
- **Copy review with UI/UX:** 1 day.

**Phase 1 done when:**

- **Start to finish:** on the Farm, a person with no computer goes from an empty My Agent to a linked agent on Android and on iOS.
- **Ownership:** the agent's ACL shows the phone's long-term key as an unrestricted admin, and the temporary key is gone.
- **Backup:** a second phone added from the first shows as a second admin row. It signs in, and it keeps working after the first phone unlinks.
- **Refusals:**
  - With no screen lock, "Create my agent" refuses with its words.
  - A cancelled Face ID sends nothing.
  - A wrong address, or an agent not yet provisioned, each show their own words (from the screens document).
- **A lost answer during the swap** ends linked, not failed (#132's behaviour, now on this path).

**Phase 2 done when:** a scan of the Farm's QR plus one tap on the Farm page links the phone, with no paste on either side, and the codes match on both screens.

**Phase 3 done when:**

- **Owner acts** (grant a backup, remove one) work only with the hardware P-256 key under a fresh biometric check, over REST.
- **The everyday key** can no longer create or delete admins.
- **Re-enrolling Face ID** (which destroys a `biometryCurrentSet` key) is detected, and the person is sent to their backup.

## 7. Screens

The screens, in the order of §1, with their English words. Other languages follow the same keys. Rules they all keep:

- **Provider-neutral, like email.** The screens never name a hosting service. They say "the service that hosts your agent" and, for a self-hosted agent, "whoever runs your agent". Nothing in the flow assumes one provider. The owner code is an Ed25519 `did:key`, which any host that admits a `did:key` admin accepts (the Farm's field takes only that form, §1; pnm and the VTA plugin accept any DID). The Farm is the first provider we support and test: its Admin DID box and the QR handoff (U1) are plan details, not app words.
- **Plain words.** "Agent" is the only term, and the person already met it on My Agent. No "DID", "key", "ACL" or "VTA" on screen. Codes are something to paste, not read, and stay behind a **Show the code** toggle, as on the link screen today.
- **One job per screen, never a dashboard.** Each screen has one primary button.
- **Errors sit beside the button that caused them** (the rule the link and join screens already follow), in words, with the developer text behind **Details**.
- **Face ID is not a step.** It is the system prompt, shown when the phone acts as owner (§3). Android says "fingerprint or screen lock" wherever iOS says "Face ID".

**My Agent, no agent yet.** Today's empty state, with a new primary button:

> **Your agent**
> An agent holds your identity for a community and carries messages to it. You need one before you can join or be vetted.
> **[Create my agent]** · [I already have one — link it]

The second button is today's **Link your agent**, renamed. **Link without a QR code** stays under it.

**1 — Create your agent.**

> Your agent runs on the VTA Farm, a free service that keeps it online when your phone is off. You set it up on the Farm's website in a few minutes. Keep Keyring open.
>
> 1. Create your agent on the Farm's website
> 2. Bring its address here
> 3. Give the Farm this phone's owner code
>
> **[Open the Farm's website]** · [Continue]

**2 — Bring your agent here** (§1 step 3).

> **Step 1 of 3 · Your agent's address**
> On the Farm, choose **Create session**. It shows your agent's address, starting with `did:webvh:`. Copy it and paste it here.
>
> [Paste] (and **Scan** once the Farm shows a QR, U1) · **[Continue]**

Errors:

- Not an address: "That isn't an agent's address. It starts with did:webvh: — copy the whole line from the Farm."
- It doesn't resolve or names no mediator: "Keyring couldn't find an agent at that address. Check you copied the whole line, and that the Farm finished creating it."
- No connection: "Keyring couldn't reach the Farm. Check your connection and try again."

**3 — This phone's owner code** (§1 step 4). Keyring makes the key when this screen opens, once the phone has a screen lock (§3).

> **Step 2 of 3 · Your owner code**
> Give this code to the Farm so your agent knows this phone owns it. The code is protected by your Face ID.
> On the Farm, paste it where it asks for the **Admin DID**, then choose **Provision agent**. Come back when it says **Agent is online**.
>
> **[Copy]** · [Share] · › Show the code
> **[It's online — connect]**

Errors:

- No screen lock or biometrics set up: "To protect your agent, turn on Face ID or a passcode in Settings first." [Open Settings]. No key is made until then.
- Face ID cancelled: no message, and the button stays.
- Face ID failed or locked out: "Keyring couldn't confirm it's you. Try again, or use your passcode."

**4 — Connecting** (§1 step 6). Progress only, under one Face ID prompt:

> Signing in to your agent… · Making sure it's yours… · Getting it ready…

Errors:

- Not admitted yet (the key is not in the agent's ACL): "Your agent isn't accepting this phone yet. Check the Farm says Agent is online, then try again."
- A lost answer during the move is not an error on screen. The next connect settles it (#127/#132), and the line reads "Still getting it ready…".

**5 — Add a backup** (§4; skippable).

> **Step 3 of 3 · Add a backup**
> If you lose this phone, a backup keeps your agent yours. It takes a minute.
> **[Use another phone]** · [Not now]

- **Another phone** (the handoff of §4), in four turns:
  1. This phone shows the agent's address as a QR: "Scan this with your other phone."
  2. On the other phone: **I already have one — link it** → **Link without a QR code** → scan it. That phone then shows its own code.
  3. This phone: "Now scan the code it shows" (or paste it). Face ID confirms, then "Added: {{device}}."
  4. The other phone finishes linking by itself and says **Linked**, as today.
- **Not now:** "You can add a backup later from My Agent."
- **The browser plugin** is not offered until D4 is decided (Phase 4).

**6 — Ready.**

> **Your agent is ready**
> {{agent name}} is online and belongs to this phone. {{Your backup: {{device}}.}}
> **[Join a community]** · [Done]

**Afterwards, on My Agent:** a **Backup** line reads "None — add one" or "{{device}}". A missing backup is a quiet line there, never a prompt.

The full draft, with the test IDs each screen carries for the e2e runner (§8), is kept with the reasoning in [`2026-09-25-uiux.md`](./2026-09-25-uiux.md).

## 8. Tests and infrastructure

- **Unit:**
  - the `acl/grant` call and its refusals;
  - the order guard (no owner code without an agent address);
  - the owner confirmation rules;
  - the enrolment offer from a Farm-shaped page, against the existing offer and submit tests.
- **Offline twin (automated, both platforms):** on the local lab stack, a fresh VTA context with the phone's pasted key admitted by `vta import-did --role admin`. That is the same ACL row the Farm's guide pairs with the paste, so the run goes through steps 3–8 unattended, including the backup phone. It is a new e2e runner beside `run-vta-link.js`.
- **The Farm (attended):** the Farm needs its passkey account in a browser, so provisioning can't be scripted from here. Alberto, or a tester, runs Phase 1 once per platform on the Farm, with the phone's log captured, before the release that ships it.
- **CI:** nothing new beyond the unit tests. The e2e runners run from the lab host, as today.

## 9. Decisions

Decided by Alberto on 2026-09-25 ([`2026-09-25-cd.md`](./2026-09-25-cd.md) F6). "Own my agent" is the top priority for the next release.

- **D1 — custody for the minimum: software key, honestly worded.** Phase 1's owner key is Ed25519 inside Keyring's encrypted wallet, and owner acts need a fresh Face ID, fingerprint or passcode confirmation. The screens say "protected by your Face ID". The hardware owner (Phase 3) is held for later.
- **D2 — two keys, later.** A hardware owner plus a narrower everyday key is the eventual model, and is held with Phase 3.
- **D3 — no backup step in setup; "Add another device" in My devices.** A backup is an equal unrestricted admin, and the screen states the risk in one line: the backup can also remove this phone.
- **D4 — the browser plugin as a backup: held.** Important later, not in Phase 1.
- **D5 — the Farm asks go out.** U1–U3 are sent to the Farm's maintainers. The Farm QR (U1) is their build; Keyring's side of it is already implemented (§5).

## 10. Rejected alternatives, as standing rationale

- **The plugin's onboarding as Keyring's.** The plugin takes ownership through `provision/integration/0.3` with `adminRotation`, which returns a VTA-minted, VTA-retained admin key (`core/src/provision/run.ts:186-230`; the plugin's own comment calls it minted "under its own custody", `extension/src/offscreen.ts:1719-1723`). The parent plan's F2 names this as the case not to implement: _"the negative case — a VTA-minted key — explicitly not implemented"_. Keyring keeps its own key and the swap. The plugin's code is reused only as reference for the grant command's shape and the ACL tasks (`core/src/admin/acl.ts:19-116`).
- **The attestation key as the owner key.** On iOS it is an App Attest key whose assertions are not plain signatures (§3), so no DID can be built on it.
- **Owner stays and swap is skipped.** Skipping the swap leaves the pasted temporary key as the admin, and the swap exists to move off it. In Phase 3, "owner stays" means a second row made with `acl/grant`, never the swap, because the swap moves the entry (`operations/acl.rs:836-930`).
