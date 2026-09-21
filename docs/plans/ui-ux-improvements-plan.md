# UI/UX improvements — roles, agent linking, membership and vetting, for a person rather than a test harness

**Status:** Proposed. No code written. Target: the live demo at OSS Summit Europe, Prague, 1 October 2026.
**Reasoning:** [`2026-09-21-al.md`](./ui-ux-improvements-plan/2026-09-21-al.md) — the inventory of today's screens, what upstream supports for enrolment and sign-in (measured against the pinned clones), and the design research every principle in §3 cites. This document states current design only; see [`CLAUDE.md`](./CLAUDE.md).
**Related plans:** [`keyring-on-the-vta-farm/community_vetting_subtask.md`](./keyring-on-the-vta-farm/community_vetting_subtask.md) owns the ceremony, the protocol and the tests; this plan owns how a person meets them. It refines that subtask's §7 (user experience) — §7's screen list and one-scanner rule stand, and the changes this plan makes to them are named in §5. Once adopted, §7 there points here.
**Code under discussion:** the `feat/prague-farm-membership` branch of both repositories — screens in `bifold/packages/core/src/modules/trust-tasks/screens/` (`MyAgent.tsx`, `VtiCommunity.tsx`, `VtiVetting.tsx`), the developer surface in `app/src/screens/Developer.tsx`, lab scripts in `scripts/openvtc/local-vti-stack/`.

---

## 1. What this plan is for

The membership and vetting flows work end to end on two phones, but they were built to be driven by a test harness: setup happens in terminal scripts, resets happen on the Developer screen, and the screens show the plumbing (DIDs, transport names, "reach the community") as buttons. A person watching a demo cannot follow it, and a person using it could not complete it without us.

This plan makes the same flows usable by someone who has never seen a terminal, without changing what goes over the wire:

1. Name the **roles** a person moves through, and make the app show only what their current role allows (§2, §4).
2. Replace every **terminal step and Developer-screen step** in the user path with an in-app step or an off-app step owned by the right party (§5).
3. Reduce each journey to the **smallest number of decisions** a person actually makes (§5, §6).

## 2. Roles

### 2.1 Who acts, and where

| Role | In plain words | Acts in |
|---|---|---|
| **Person** | Anyone with Keyring installed | Keyring |
| **Agent (VTA)** | A server that works for the person: holds their identities and keys, carries messages | Runs at an agent host (the Farm, or our lab); the phone is its remote control |
| **Agent operator** | Whoever runs the agent host | The Farm console, or `pnm` on a laptop |
| **Community (VTC)** | A group with published rules for who gets in | A server |
| **Community admin** | Sets the rules, invites people, names vetters | The community's web portal or `cnm`; **never** Keyring |
| **Vetter** | A member the admin trusts to check that a new person is who they say they are | Keyring |
| **Approver** | A second device that must consent before the agent does something sensitive | Keyring — **not shown in the demo** |

### 2.2 The stages a person moves through

Stages 0–1 are about the person and their agent; stages 2–4 are **per community** — the same person can be a vetter in one community, a member of a second and a stranger to a third.

| Stage | Name shown | What they can do | How they leave it |
|---|---|---|---|
| 0 | *(none — no agent yet)* | Everything Keyring does today (contacts, credentials, VRCs) | Link an agent (§5.1) |
| 1 | **Linked** | See their agent, receive invitations | Scan an invitation, or find a community |
| 2 | **Applicant** (per community) | See what the community asks, get vetted, apply, withdraw | The community decides |
| 3 | **Member** (per community) | Hold the membership card, present it | The admin names them a vetter |
| 4 | **Vetter** (per community) | Everything a member does, plus hand out tickets and attest | The admin revokes the grant |

Two paths lead from 1 to 3: **by invitation** (an admin invites; one tap) and **by vetting** (a vetter checks the person, the person applies with the statement). A community's first members can only arrive by invitation, because nobody can vet before a vetter exists.

## 3. Design principles

Each principle carries its source; the evidence is in the dated companion, §C.

1. **Show the next action, and show locked steps as locked, not hidden.** A person at stage 1 sees "Apply" and a greyed "Vet others — unlocks when an admin names you a vetter". *(NN/g progressive disclosure; GOV.UK task list "Cannot start yet".)*
2. **Roles live on the community, not on the app.** A role badge in the community's header; vetting is an action inside that community, not an app-wide "vetter mode". A mode is avoided where a slip is costly, and signing a statement is. *(NN/g modes; Slack and Discord per-workspace roles.)*
3. **No DIDs, transport names or key identifiers in the main path.** They move behind a **Details** disclosure on the screen they belong to, or to the Developer screen. *(EUDI Wallet Design Guide, ARF annex 8; Bifold's own design guidelines.)*
4. **Plumbing is automatic.** Connecting to the agent, preparing the persona and opening the community session are things the app does when the person's next action needs them, with named progress while they run — never buttons.
5. **The Developer screen is for logs, probes and resets only.** No step of any user journey, and no step of the demo, opens it. It is hidden in release builds. *(Android developer options; React Native release builds.)*
6. **The device being linked shows the QR; the trusted side scans and confirms, naming what is being linked.** Short-lived, single-use, visually distinct from an invitation QR. *(WhatsApp/Signal linked devices; FIDO cross-device sign-in; IETF cross-device security draft.)*
7. **A new capability is introduced where it appears, once.** When a vetter grant arrives, a dismissible tip on that community — not a tour. *(NN/g onboarding tutorials; Apple HIG onboarding.)*
8. **In-person steps: one scan, one short code on both screens, an explicit match / no match.** *(Signal safety numbers; Bluetooth numeric comparison.)*
9. **Every signing act is biometric-gated** — sending the card, attesting, applying.

## 4. Information architecture

```
Tab: Communities                          (today: "My Agent")
 ├─ header: your agent — Linked ✓ / Link your agent      → Agent screen
 ├─ Invitations (only when there are some)
 ├─ Your communities: one row each, with a role badge
 │     Applicant · Member · Vetter
 └─ Scan (the app's one scanner: invitation, vetting ticket, agent link)

Community screen (one per community)
 ├─ header: name, your role badge
 ├─ task list for your stage:
 │     Applicant → What they ask · Get vetted · Apply
 │     Member    → Your card · (locked) Vet others
 │     Vetter    → Your card · Vet someone
 └─ Details (disclosure): community DID, your persona DID, transport

Agent screen
 ├─ host name, linked since, this phone
 ├─ Approvals (only when enforcement is on)
 └─ Details (disclosure): agent DID, manager DID, mediator, transport
```

`VtiVetting.tsx` stops being one screen with two modes. It becomes two flows reached from the community screen — **Get vetted** and **Vet someone** — with one step per screen (§5.3, §5.4).

## 5. Journeys

Each journey lists its steps as the person sees them. Anything marked **(off-app)** is done by another role elsewhere; anything marked **conditional** depends on a decision or an upstream item named at the step.

### 5.1 Link your agent (stage 0 → 1)

**What upstream supports today**, measured in the companion (§B1–B4):

- A VTA admits a new manager DID only when an **already-authorised admin** grants it. There are two ways: offline, by stopping the daemon (what our `enrol-manager.sh` does), or **online**, with `pnm acl create --did <did> --role admin --expires 1h` from a signed-in laptop, which is the same thing as the `acl/grant` Trust Task. No self-enrolment token exists for a non-TEE VTA; one was designed and removed.
- `pnm` and the browser extension both do it the same way: the client mints a **temporary** key, shows it, a human with admin rights grants it for an hour, and on the first connect the client rotates to a long-lived key and the temporary one drops out of the access list.
- The VTA also offers **passkey login** for an admin DID whose document carries a passkey verification method (`/auth/passkey-login/{start,finish}`, and a browser popup at `/auth/portal`). A passkey session carries that DID's role, so it can grant. Native-app passkeys need the VTA's domain to publish `apple-app-site-association` / `assetlinks.json`, which no upstream component does.
- The Farm provisions the VTA from a passkey-authenticated web console and then waits for the person to **paste** an admin DID. There is no phone hand-off.

**The journey Keyring builds:**

| Step | Person sees | Behind it |
|---|---|---|
| 1 | "Link your agent" → enters or scans the agent's address | The agent's DID is chosen at runtime, not baked into `app/.env`. **Conditional** on the runtime-configuration change in phase U6. |
| 2 | A QR code and a Copy/Share button: "Give this to your agent host" | The phone's temporary manager key, `pnm`-style. |
| 3 | **(off-app)** The agent operator grants it | **Lab:** the enrolment script uses the online `pnm acl create … --expires 1h` path, not the offline stop-and-restart. **Farm:** the person pastes it at the console's "admin DID" step (the paste the Farm asks for today). |
| 4 | "Linked ✓" with the host's name | First connect rotates to the long-lived key (the upstream pattern). |
| — | Later sign-ins: none. The app reconnects on its own; the device key is gated by the phone's biometric. | The phone's key is already device-bound and phishing-resistant; a passkey adds nothing here that the biometric gate does not. |

**Target, conditional:** step 2–3 collapse into **"Sign in with your passkey"** — the phone opens the VTA's `/auth/portal` in the system browser session (where the VTA's own domain makes the web passkey valid without app association), gets an admin-role session, and grants its own manager key with `acl/grant`. Conditional on: (a) the person's admin DID being a `did:webvh` with a passkey method enrolled, (b) a spike proving the portal session can be handed back to the app, (c) the Farm console enrolling that passkey method. Phase U7 measures it; nothing in U1–U6 depends on it.

**Demo:** the phones are linked before the talk; the audience sees step 4's state, and a slide shows steps 1–3.

### 5.2 Join by invitation (stage 1 → 3)

1. **(off-app)** The admin creates an invitation for the person in the portal.
2. The person scans it with the app's one scanner.
3. Confirm screen: "Join *Community name* as a member?" → Join (biometric).
4. "Member ✓" — the card appears on the community screen.

**Blocked on upstream:** an invitation is 6,331 bytes and a QR code carries at most 2,953 (VTI-32, High, open). Until invitations travel by reference, the lab hands the link over as a deep link (AirDrop or a message), and the demo does not scan one.

### 5.3 Get vetted (applicant)

| Step | Person sees | Replaces today |
|---|---|---|
| 1 | Community screen → **Get vetted**: "This community needs 1 person to check your ID in person." | "Start my vetting", requirements text, identity creation button |
| 2 | "Your legal name, as on your ID" → Continue | The face field and Save |
| 3 | **Scan the vetter's ticket** | Pasting a `vetting-ticket:` link, then "Request vetting" |
| 4 | Waiting for the vetter → **full-screen match code**, "Does the vetter's screen show the same code?" Yes / No | Match code in a card; no explicit confirmation |
| 5 | "Send your name to *vetter*?" → Send (biometric) | "Send my card" |
| 6 | "Statement received ✓ — 1 of 1" → **Apply** (biometric) | Checklist and Apply button |
| 7 | "Member ✓" | — |

Refusals and a deferred application (add what is missing, or withdraw) stay on the community screen as its current state, in plain words.

### 5.4 Vet someone (vetter)

| Step | Vetter sees | Replaces today |
|---|---|---|
| 1 | Community screen → **Vet someone** | "Open the vetting desk" |
| 2 | A **ticket QR**, large, with a short typed code under it for when scanning fails | A text link and "New ticket" |
| 3 | "*Name* wants to be vetted" appears → Open | Request list, "Open session" |
| 4 | **Full-screen match code**, "Does their screen show the same code?" Yes / No | Match code in a card |
| 5 | "Check their ID. Does it say *legal name*?" → **I checked — attest** (biometric) | Card claims and the Attest button |
| 6 | "Statement sent ✓" | — |

Publishing a vetter profile moves to the community's Details; it is optional and not part of a session.

### 5.5 Administer a community (off-app)

The admin works in the community's web portal. Its first sign-in is an **install URL plus a claim code**, after which the admin registers a passkey and signs in with it from then on (companion §B5). Keyring shows none of this. What Keyring does need from the admin is named in the steps above: an invitation (§5.2) and a vetter grant (stage 3 → 4).

### 5.6 What is out of scope by design

**The identity document never enters Keyring.** The vetting session specification forbids it: the vetter "MUST NOT capture or store any detail of the documentation it inspects", and the applicant "MUST NOT put a document number, a document image, a portrait … on the card" (`specs/vetting/session/0.1`, Trust Tasks). The vetter looks at the physical document and checks it against the typed name the applicant sends. Reading an eMRTD chip or scanning a document is not planned.

## 6. Phases

Each phase ends with the vetting, invitation and enrolment e2e runners green on the iOS simulator and the Android emulator. Test IDs that move are renamed in the runners in the same change.

### U1 — The Developer screen leaves the user path

- Move "Forget this community" to the community screen as **Leave community** (behind a confirm), or to a lab-only script; the vetting runner stops opening the Developer screen.
- The automatic VTA probe runs only in dev builds.
- **Done when:** `run-vti-vetting.js`, `run-vti-invite.js` and `run-vta-enrol.js` complete without opening the Developer screen, and a release build has no Developer entry point.

### U2 — Plumbing is automatic

- Remove the "Connect my agent", "Reach the community" and "Create my identity" buttons from the main path; the app does each when the next action needs it, with named progress.
- DIDs, host names and the transport label move behind **Details**.
- **Done when:** no DID and no transport name is visible on any main-path screen with Details closed, and a linked person reaches "Get vetted" in one tap from the community row.

### U3 — Communities home and the community screen

- Rename the tab; build the community screen with the role badge and the stage task list (§4), locked steps shown as locked.
- One-time tip when a vetter grant first appears.
- **Done when:** each of stages 1–4 renders its own task list in a unit test, and the tip shows once per grant.

### U4 — One scanner and the ticket QR

- The vetter's ticket renders as a QR with a typed fallback code; the app's scanner dispatches `vetting-ticket:` links and `keyring://vti/invitation` links to their flows.
- **Done when:** the vetting runner hands the ticket over by scanning on at least one platform (or by the scanner's dispatch function with the scanned text, where a simulator cannot scan).

### U5 — Two vetting flows, one step per screen

- Split `VtiVetting.tsx` into Get vetted (§5.3) and Vet someone (§5.4); full-screen match code with an explicit Yes / No on both sides; biometric on send, attest and apply.
- A "No" on the match code ends the session on both phones.
- **Done when:** the two-device vetting runner is green through the new screens, and a "No" test ends the session on both.

### U6 — Linking an agent without a stopped daemon

- The phone shows its temporary manager key as a QR plus Copy/Share; rotation on first connect.
- `enrol-manager.sh` uses the online grant (`pnm acl create … --expires 1h`) against a running VTA.
- The agent's address is chosen at runtime rather than from `app/.env`. **Conditional:** decide whether the demo build keeps a default agent.
- **Done when:** `run-vta-enrol.js` passes with the VTA never restarted, and the temporary key is absent from the VTA's access list after the first connect.

### U7 — Passkey sign-in spike (measure, do not ship)

- Measure §5.1's target on the lab VTA: enrol a passkey method on an admin `did:webvh`, sign in through `/auth/portal` from an in-app browser session on both platforms, and grant the phone's key.
- **Done when:** a dated companion records whether it works, what the session hand-back needs, and what the Farm would have to add — as a finding either way.

## 7. Blocked, and on whom

| Item | Blocks | Waiting on |
|---|---|---|
| Invitations by reference (VTI-32) | Scanning an invitation (§5.2) | Upstream |
| A phone hand-off at the Farm's "admin DID" step (VTI-Q10; the enrolment contract in the vetting subtask's §9 request 2) | Linking without a paste on the Farm (§5.1) | The Farm operator |
| App association on the VTA domain | A native passkey sign-in (§5.1 target) | Upstream; U7 measures whether the browser-session route avoids needing it |
| Where the legal name lives — on the phone today, in the VTA's persona faces upstream (proposed design) | Where step 2 of §5.3 stores what it collects | The profile–persona reconciliation in progress on the feature branch |

## 8. Decisions open

1. **Device-bound only, or a synced passkey as well?** Device-bound keeps the hardware-attestation story and needs a visible re-link path when a phone is lost; a synced passkey recovers more easily and cannot carry attestation. The plan assumes device-bound.
2. **Does the demo show linking live, or start linked?** The plan assumes pre-linked (§5.1).
3. **Leave community in-app, or lab script only?** U1 offers both.
4. **Keep the approver out of the demo entirely?** The plan assumes yes.
