# Own my agent from the phone — create, protect, and keep a way back in

**Status:** Proposal for review. Not a commitment to implement. Target: the release after the one frozen on 2026-09-25; draft PRs only until that release ships.
**Parent:** [`keyring-on-the-vta-farm.md`](../keyring-on-the-vta-farm.md). This subtask carries its **F2 — Enrolment from the phone (L0)** for a person with no computer, and answers its §9 Q4 as far as code can (the rest is measurement, below).
**Siblings:** [`pnm_cnm_subtask.md`](../openvtc-integration-plan/pnm_cnm_subtask.md) owns the VTA client in general; this subtask adds only what owning an agent needs.
**Reasoning:** [`2026-09-25-cd.md`](./2026-09-25-cd.md). The facts this design rests on (plugin, VTA, Farm, and Keyring code, with citations), and the positions taken on key custody and the owner model. [`2026-09-25-uiux.md`](./2026-09-25-uiux.md): the screens, their words and test IDs, and why the address comes before the owner code.
**Screens:** §7, in plain words; this document owns the flow and the calls behind them.
**Baseline:** VTI `ed672fff`, vta-browser-plugin `43e2cc7df9`, vti-setup `22f712f`, all at the pins in `scripts/openvtc/PINS.json`; bifold `fe125e84`.

---

## 0. The plain version

- **The goal:** a person with only a phone and a web browser gets their own agent on the VTA Farm and owns it from Keyring. No computer and no command line.
- **On the Farm's website**, they create an agent. The Farm shows the new agent's address, and they bring that address into Keyring by pasting it, or by scanning it once the Farm shows a QR code.
- **In Keyring**, they tap **Create my agent**. Keyring makes an owner code on the phone and asks for Face ID. The person copies the code into the Farm's "Admin DID" box and taps **Provision agent**.
- **Keyring signs in as the owner** and moves onto a long-term key. From then on, the agent answers only to this phone.
- **The phone's code is protected by Face ID** (Android: fingerprint or screen lock). Owner actions, like adding a backup, always ask again.
- **Backup:** during setup Keyring offers a backup owner, most simply a second phone. The first phone approves it. A lost phone then isn't a lost agent.
- **With the Farm's help:** if the Farm adds a QR code for this, both copy-and-paste steps become one scan. We ask the Farm for that; until then, copy and paste works.
- **Effort:** about two weeks of our work for the minimum. Stronger hardware protection comes later, once one upstream question is measured.

## 1. What the person does, step by step

The order follows the Farm's own wizard, which shows the agent's address **before** it asks for the Admin DID ([[DEV-GUIDE]] `01-personal-vta.md`: _"Create session"_ shows the VTA DID; then _"paste the Admin DID … Provision agent"_). Keyring needs the address first: the phone's key is a `did:peer:2` that names the agent's mediator, which Keyring resolves from the agent's DID before it mints the key (`vtaEnrolment.ts` `resolveVtaMediator` then `createVtiClientDid`; `vtaAgent.ts` `startManualLink`).

1. **My Agent → Create my agent.** Keyring explains the three steps and opens the Farm's website.
2. **Farm: create account → Create VTA → Create session.** The Farm shows the agent's address.
3. **Keyring: paste (or scan) the address.** Keyring checks that it's an agent (it resolves and names a mediator).
4. **Keyring: the owner code.** Keyring makes the key, which needs Face ID, and offers Copy and Share.
5. **Farm: paste into Admin DID → Provision agent.** The person waits for "Agent is online".
6. **Keyring: Connect.** Keyring signs in as that key (whoami), then swaps it onto a long-term key (`acl/swap-key/0.1`, with the crash-safe pending-swap recovery of #127/#132), then reads the agent's name. All of this happens under the same Face ID prompt.
7. **Backup (skippable).** Another phone, or the browser plugin (§4).
8. **Ready.**

**With the Farm QR (§5):** steps 2–5 become "scan the Farm's QR, compare a short code, tap Provision". The phone hands its key to the Farm itself, over the existing `keyring://vta/enrol` exchange.

## 2. The owner model

- **The key the person pastes becomes the agent's full administrator.** The VTA has no owner tier above "admin with no context restriction" (super-admin: `vti-common/src/acl/mod.rs:492-513`, `:868-870`). What the Farm grants the pasted DID is **not documented**. The guide pairs the paste with `vta import-did --role admin`, which writes an unrestricted, permanent admin (`vta-service/src/import_did.rs:57-71`). **Measure M2.**
- **The swap keeps that authority.** `acl/swap-key` moves the caller's own entry, keeping its role and contexts, and makes it permanent (`vta-service/src/operations/acl.rs:836-930`). So after step 6, the long-term key _is_ the owner: that key is the one to protect (§3), not the temporary one. The temporary key is software and short-lived, as for every link today.
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

**U2 — say what the Admin DID box accepts and grants.** Which DID methods it accepts (`did:key` only, or also `did:peer:2`, which Keyring uses today), which role, and whether the grant expires.

**U3 — recovery.** If every admin key is lost, can the account holder re-provision or reset the Admin DID?

**U4 (VTI, for Phase 3 only).** Confirm `ecdsa-jcs-2019` proofs on `auth/authenticate` for a P-256 `did:key` admin. Also note that `acl/swap-key` accepts only an EdDSA link proof.

## 6. Phases, estimates, acceptance

Estimates are one engineer's working days. **Ours** is Keyring work; **Farm/upstream** is theirs and not estimated here.

| Phase                                                                                                                                                              | Ours | Needs Farm/upstream                | Done when                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- | ---------------------------------- | ---------------------------------------------------------------------------------------- |
| **M — measure first** (M1 `did:peer:2` accepted in Admin DID; M2 role and expiry granted; M3 P-256 `did:key` accepted; M4 `ecdsa-jcs-2019` on `/auth` at VTA 0.42) | 1    | a Farm account (attended, passkey) | Each answer recorded in a dated companion with evidence (the whoami result, the ACL row) |
| **1 — the minimum, copy/paste**                                                                                                                                    | 8–9  | none, if M1 and M2 hold            | see below                                                                                |
| **2 — Farm QR**                                                                                                                                                    | 1    | U1 shipped by the Farm             | see below                                                                                |
| **3 — hardware owner**                                                                                                                                             | 6–10 | U4; maybe a VTI change if M4 fails | see below                                                                                |
| **4 — browser-plugin backup**                                                                                                                                      | 1–2  | none                               | D4 decided; the plugin, granted by the owner phone, completes its own onboarding         |

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

- **No provider named on screen.** The app says "your agent's host", like an email provider; the Farm is one such host, and self-hosting stays possible in the words. Provider-specific help belongs behind **How?**, never in the main text.

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

> Your agent lives with a service that hosts it and keeps it online when your phone is off, much like an email provider. You can also run your own. Keep Keyring open while you set it up.
> 1. Create your agent with the service that hosts it
> 2. Bring its address here
> 3. Add this phone's owner code to your agent
>
> **[Open your agent host's website]** (only once a host's website is known) · [Continue]

**2 — Bring your agent here** (§1 step 3).

> **Step 1 of 3 · Your agent's address**
> Once your agent is created, its host shows its address. It starts with `did:webvh:`. Copy it and paste it here.
>
> [Paste] (and **Scan** once hosts show a QR, U1) · **[Continue]**

Errors:
- Not an address: "That isn't an agent's address. It starts with did:webvh: — copy the whole line your agent's host shows."
- It doesn't resolve or names no mediator: "Keyring couldn't find an agent at that address. Check you copied the whole line, and that your agent has finished being created."
- No connection: "Keyring couldn't reach your agent. Check your connection and try again."

**3 — This phone's owner code** (§1 step 4). Keyring makes the key when this screen opens, once the phone has a screen lock (§3).

> **Step 2 of 3 · Your owner code**
> This code tells your agent that this phone owns it. The code is protected by your Face ID.
> Copy this code and add it as an owner (admin) in your agent host's settings. If you run your own agent, give this code to it as an admin. Come back when your agent is online.
> › How? (a host's settings page where admins are added; or your own agent's command-line tool — a host may be named here later, never in the main text)
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
- Not admitted yet (the key is not in the agent's ACL): "Your agent isn't accepting this phone yet. Check that the code is added as an admin and your agent is online, then try again."
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
- **D3 — an equal backup phone now.** The backup is a second unrestricted admin, and the screens state the risk in one line: the backup can also remove this phone.
- **D4 — the browser plugin as a backup: held.** Important later, not in Phase 1.
- **D5 — the Farm asks go out.** U1–U3 are sent to the Farm's maintainers. The Farm QR (U1) is their build; Keyring's side of it is already implemented (§5).

## 10. Rejected alternatives, as standing rationale

- **The plugin's onboarding as Keyring's.** The plugin takes ownership through `provision/integration/0.3` with `adminRotation`, which returns a VTA-minted, VTA-retained admin key (`core/src/provision/run.ts:186-230`; the plugin's own comment calls it minted "under its own custody", `extension/src/offscreen.ts:1719-1723`). The parent plan's F2 names this as the case not to implement: _"the negative case — a VTA-minted key — explicitly not implemented"_. Keyring keeps its own key and the swap. The plugin's code is reused only as reference for the grant command's shape and the ACL tasks (`core/src/admin/acl.ts:19-116`).
- **The attestation key as the owner key.** On iOS it is an App Attest key whose assertions are not plain signatures (§3), so no DID can be built on it.
- **Owner stays and swap is skipped.** Skipping the swap leaves the pasted temporary key as the admin, and the swap exists to move off it. In Phase 3, "owner stays" means a second row made with `acl/grant`, never the swap, because the swap moves the entry (`operations/acl.rs:836-930`).
