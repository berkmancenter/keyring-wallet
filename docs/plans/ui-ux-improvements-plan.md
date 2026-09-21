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

**Linked** means the phone has been admitted by the person's agent, once (§5.1). It is a lasting state, like a paired device, and says nothing about whether the agent can be reached right now — that is the agent's **status** (Online, Reconnecting, Offline), shown separately (§4.1).

Two paths lead from 1 to 3: **by invitation** (an admin invites; one tap) and **by vetting** (a vetter checks the person, the person applies with the statement). A community's first members can only arrive by invitation, because nobody can vet before a vetter exists.

## 3. Design principles

Each principle carries its source; the evidence is in the dated companion, §C.

1. **Show the next action, and show locked steps as locked, not hidden.** A person at stage 1 sees "Apply" and a greyed "Vet others — unlocks when an admin names you a vetter". *(NN/g progressive disclosure; GOV.UK task list "Cannot start yet".)*
2. **Roles live on the community, not on the app.** A role badge in the community's header; vetting is an action inside that community, not an app-wide "vetter mode". A mode is avoided where a slip is costly, and signing a statement is. *(NN/g modes; Slack and Discord per-workspace roles.)*
3. **No DIDs, transport names or key identifiers in the main path.** They move behind a **Details** disclosure on the screen they belong to, or to the Developer screen. *(EUDI Wallet Design Guide, ARF annex 8; Bifold's own design guidelines.)*
4. **Plumbing is automatic.** Connecting to the agent, preparing the persona and opening the community session are things the app does when the person's next action needs them, with named progress while they run — never buttons.
5. **The Developer screen is for logs, probes and resets only.** No step of any user journey, and no step of the demo, opens it. It is hidden in release builds. *(Android developer options; React Native release builds.)*
6. **The phone always does the scanning; the side that holds the authority confirms.** A phone has a good camera and a laptop does not, so a screen that wants something from the phone shows a QR and the phone scans it. The QR is short-lived, single-use and bound to the session that showed it, and it looks different from an invitation QR. Whoever grants something — the agent's admin on a web page, the vetter on their phone — confirms on their own screen after seeing a short code that matches the one on the phone. *(WhatsApp/Signal linked devices; FIDO cross-device sign-in; IETF cross-device security draft, context on the approving device.)*
7. **A new capability is introduced where it appears, once.** When a vetter grant arrives, a dismissible tip on that community — not a tour. *(NN/g onboarding tutorials; Apple HIG onboarding.)*
8. **In-person steps: one scan, one short code on both screens, an explicit match / no match.** *(Signal safety numbers; Bluetooth numeric comparison.)*
9. **Every signing act asks for Face ID or a fingerprint** — sending the card, attesting, applying, joining. It is also how the phone's device-bound key is unlocked, so it is the only "sign-in" a person ever sees.

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

### 4.1 The agent screen — what "signed in" looks like

A VTA has no login session a person enters and leaves: once the phone is linked, every request it sends is authenticated by the phone's key, and the phone unlocks that key with Face ID or a fingerprint. So "signed in" is not a state to display. What a person needs instead is to know that their agent is **there**, what it **holds**, what it has **done**, and what it **makes possible**.

Upstream's own client shows the operator's view once connected: "Connected ✓", the VTA's DID, the wallet's DID, the role and transports, and a "Manage this agent" console of contexts, keys, credentials, access and audit (`vta-browser-plugin` `packages/extension/src/popup.tsx`, the connected view). Keyring keeps that view behind Details and leads with the person's view:

| Part | Shows | Source |
|---|---|---|
| **Status** | One line with a dot: **Online** · **Reconnecting…** · **Offline since 14:02**. Elsewhere in the app, a banner appears only when the agent is not online. | The mediator session and the last successful exchange |
| **What your agent holds** | Your identities, one per community, by community name · your membership cards · later, the vault | The agent's replies (persona list, held cards) — nothing mirrored on the phone that the agent owns |
| **What your agent did** | A short activity list in plain words: "Sent your application to *Community*", "Received a statement from *vetter*", "An invitation arrived" | The app's own record of exchanges |
| **What you can do** | Capability cards: Join a community · Get vetted · Vet others (locked until a grant) | The person's stages (§2.2) |
| **Details** (closed) | Agent host, agent DID, this phone's key, role, transport | As today |

**The first-link introduction.** Right after linking, three short dismissible panels introduce the agent as the person's stand-in online: *it keeps your identities*, *it answers communities while your phone is off*, *you approve anything important with your face or fingerprint*. A "What is my agent?" link on the agent screen brings them back. Nothing else in the app repeats this.

### 4.2 State, and how the screens read it

Today the agent's state is a four-value status (`disconnected | connecting | connected | failed` in `vtaAgent.ts`) plus booleans and step strings held in each screen's own `useState`. The screen decides what it is showing by combining them, which is how "Connected" and an error can both be on screen at once. The agent screen and everything that depends on the agent instead read **one state machine**, owned by the module and exposed through the same `useSyncExternalStore` subscription the screens already use.

```
NotLinked ──scan enrolment QR──▶ AwaitingGrant ──grant seen──▶ Linking ──rotated──▶ Linked
    ▲                              │ (expires)                    │ (fails)               │
    └──────────── Re-link ◀────────┴──────────────────────────────┴──── Revoked ◀─────────┤
                                                                                         │
Linked has one connection sub-state:  Online ⇄ Reconnecting(attempt, nextRetryAt) ⇄ Offline(since, reason)
```

- **The persisted and the live are separate.** *Linked* (with host, since, and the phone's key) survives restarts; *Online / Reconnecting / Offline* is recomputed every launch and never stored.
- **Every transition has a cause the machine names** — a scan, a grant seen, a rotation, the session opening or dropping, the app returning to the foreground, the network changing, the mediator's resync signal — and each is a unit test.
- **Reconnecting is quiet.** Backoff with a ceiling, an immediate retry on foreground and on network change. The offline banner appears only after a drop has lasted a few seconds, so a brief blip does not flash it.
- **Each section has its own four states** — loading, empty, error, content — and they do not share a spinner. Once loaded, content stays on screen while offline, marked "Updated 2 min ago", rather than being replaced by an error.
- **Pull to refresh** reconnects if needed and re-reads what the agent holds.
- **An action in flight belongs to the machine, not to the button.** Leaving the screen and coming back shows the same "Granting…" or "Sending…" state instead of a fresh, tappable button.

### 4.3 Buttons and controls

They use the app's theme as it is: bifold's `Button` with its `ButtonType` (Primary, Secondary, Tertiary, Critical), colours and type from `useTheme()` and the Keyring theme, and the icon set the screens already use. The trust-task screens' hand-rolled `Pressable` buttons are replaced with it.

- **One primary button per screen**, at the bottom, where a thumb reaches it. Everything else is Secondary or Tertiary. *(Apple HIG, buttons; EUDI Wallet Design Guide, main controls in the lower half.)*
- **Labels are verbs that name the outcome:** "Link your agent", "Scan ticket", "Send my name", "Attest". Never "OK" or "Continue" where a verb fits. *(Apple HIG, buttons.)*
- **A pressed button shows its own progress** and cannot be pressed twice; the action it started is idempotent, so a retry after a timeout does not send twice. *(Apple HIG, buttons.)*
- **A locked action says why, next to it**, rather than sitting greyed with no explanation: "Unlocks when an admin names you a vetter".
- **Destructive actions are Critical and confirmed, and the confirm names the outcome** — "Leave *Community*" / "Stay", "Unlink this phone" / "Keep linked" — never "Are you sure?" with Yes / No. Confirmations are kept for what cannot be undone, so they are not clicked through. *(NN/g, confirmation dialogs.)*
- **Two-sided checks use outcome labels too:** the match-code screens answer "Codes match" / "Codes differ" (§5.3, §5.4).
- **Targets are at least 44 × 44 pt** (48 dp on Android), with a label, a role and busy/disabled state for screen readers, and a test ID. *(Apple HIG; WCAG 2.2 SC 2.5.8 sets the floor at 24 × 24.)*

`VtiVetting.tsx` stops being one screen with two modes. It becomes two flows reached from the community screen — **Get vetted** and **Vet someone** — with one step per screen (§5.3, §5.4).

## 5. Journeys

Each journey lists its steps as the person sees them. Anything marked **(off-app)** is done by another role elsewhere; anything marked **conditional** depends on a decision or an upstream item named at the step.

### 5.1 Link your agent (stage 0 → 1)

**What upstream supports today**, measured in the companion (§B1–B4):

- A VTA admits a new manager DID only when an **already-authorised admin** grants it. There are two ways: offline, by stopping the daemon (what our `enrol-manager.sh` does), or **online**, with `pnm acl create --did <did> --role admin --expires 1h` from a signed-in laptop, which is the same thing as the `acl/grant` Trust Task. No self-enrolment token exists for a non-TEE VTA; one was designed and removed.
- `pnm` and the browser extension both do it the same way: the client mints a **temporary** key, shows it, a human with admin rights grants it for an hour, and on the first connect the client rotates to a long-lived key and the temporary one drops out of the access list.
- The VTA also offers **passkey login** for an admin DID whose document carries a passkey verification method (`/auth/passkey-login/{start,finish}`, and a browser popup at `/auth/portal`). A passkey session carries that DID's role, so it can grant. Native-app passkeys need the VTA's domain to publish `apple-app-site-association` / `assetlinks.json`, which no upstream component does.
- The Farm provisions the VTA from a passkey-authenticated web console and then waits for the person to **paste** an admin DID. There is no phone hand-off.
- **A web page for granting already exists upstream:** the browser extension's management console has an **Access** pane whose *Grant access* form takes a pasted `did:key`, a role and an expiry and sends `acl/grant` as the signed-in admin. It has no QR and no camera.

**The journey Keyring builds** — linking is a step the person takes, by QR, and the demo shows it live:

| Step | Person sees | Behind it |
|---|---|---|
| 1 | **(off-app)** The agent's admin opens the enrolment page and clicks *Add a phone*. The page shows a QR. | A short-lived, single-use enrolment link bound to that page session. It names the agent, so the app needs no agent address baked into `app/.env`. |
| 2 | "Link your agent" → **Scan** → "Link this phone to *agent host*?" → Link | The phone mints its temporary key and sends it to the link, signed with that key, so the page knows the phone holds it. |
| 3 | A short code on the phone: "Check that the page shows the same code" | The key's fingerprint, shown on both screens. |
| 4 | **(off-app)** The page shows the same code and *Grant*; the admin clicks it | `acl/grant` for the temporary key, an hour's expiry, through the online path. |
| 5 | "Linked ✓" with the host's name, then the first-link introduction (§4.1) | First connect rotates to the long-lived key (the upstream pattern). |
| — | Fallback when scanning fails: *Show my code instead* displays the key with Copy/Share, for pasting into upstream's *Grant access* form or the Farm console | The paste path upstream supports today. |
| — | Later sign-ins: none. The app reconnects on its own and the phone's key unlocks with Face ID or a fingerprint. | The key is **device-bound** and stays so: it never leaves the phone, and a lost phone is re-linked, not restored. That keeps hardware attestation available to the key, and it is phishing-resistant without a passkey. |

**Granting the phone.** The admin role is right — an agent must only accept a device someone authorised says yes to — but a person should not need a terminal to say it. It arrives in four stages:

1. **Automated, now (lab).** The grant is a script call on a *running* VTA (`pnm acl create --did <temporary key> --role admin --expires 1h`), made by the e2e runner with the key it reads off the phone's screen. Nothing restarts. This is what the harness uses throughout.
2. **Upstream's own page, measured.** The browser extension's *Grant access* form, signed in as the lab agent's admin, with the key pasted from the phone's fallback screen. It needs no code from us; U8 first confirms it works against the lab agent.
3. **The lab enrolment page, experimented locally.** A small page beside the lab stack that adds the QR half upstream's form lacks — steps 1–4 of the journey above. It is where the demo links its phones. It is not a product: it exists to prove the exchange end to end (§6, U8).
4. **Upstream, from what stage 3 proves.** The exchange is handed to upstream as concrete indications — the enrolment link, the signed key submission, the matching code — for the extension's Access pane and for the Farm console's "admin DID" step (VTI-Q10; the enrolment contract in the vetting subtask's §9 request 2). Keyring then scans whichever of them ships it, and the lab page retires.

**Target, conditional:** step 2–3 collapse into **"Sign in with your passkey"** — the phone opens the VTA's `/auth/portal` in the system browser session (where the VTA's own domain makes the web passkey valid without app association), gets an admin-role session, and grants its own manager key with `acl/grant`. Conditional on: (a) the person's admin DID being a `did:webvh` with a passkey method enrolled, (b) a spike proving the portal session can be handed back to the app, (c) the Farm console enrolling that passkey method. Phase U7 measures it; nothing in U1–U6 depends on it.

**Demo:** linking is shown live, through the lab enrolment page on the presenter's laptop, and it is the first thing the audience sees. A second pair of phones, linked beforehand and kept off stage, covers a venue network that fails.

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
| 4 | Waiting for the vetter → **full-screen match code**, "Does the vetter's screen show the same code?" **Codes match** / **Codes differ** | Match code in a card; no explicit confirmation |
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
| 4 | **Full-screen match code**, "Does their screen show the same code?" **Codes match** / **Codes differ** | Match code in a card |
| 5 | "Check their ID. Does it say *legal name*?" → **I checked — attest** (biometric) | Card claims and the Attest button |
| 6 | "Statement sent ✓" | — |

Publishing a vetter profile moves to the community's Details; it is optional and not part of a session.

### 5.5 Administer a community (off-app)

The admin works in the community's web portal. Its first sign-in is an **install URL plus a claim code**, after which the admin registers a passkey and signs in with it from then on (companion §B5). Keyring shows none of this. What Keyring does need from the admin is named in the steps above: an invitation (§5.2) and a vetter grant (stage 3 → 4).

### 5.6 What is out of scope by design

**The identity document never enters Keyring.** The vetting session specification forbids it: the vetter "MUST NOT capture or store any detail of the documentation it inspects", and the applicant "MUST NOT put a document number, a document image, a portrait … on the card" (`specs/vetting/session/0.1`, Trust Tasks). The vetter looks at the physical document and checks it against the typed name the applicant sends. Reading an eMRTD chip or scanning a document is not planned.

## 6. Phases

Each phase ends with the vetting, invitation and enrolment e2e runners green on the iOS simulator and the Android emulator. **The runners are rewritten with the flow, not after it:** a phase that changes a screen changes the runners that drive it in the same change, and phase UT below carries what the harness needs that no single phase owns.

### U1 — The Developer screen leaves the user path

- "Forget this community" becomes **Leave community** on the community screen, behind a confirm. The vetting runner resets the applicant through it instead of through the Developer screen.
- The automatic VTA probe runs only in dev builds.
- **Done when:** `run-vti-vetting.js`, `run-vti-invite.js` and `run-vta-enrol.js` complete without opening the Developer screen, and a release build has no Developer entry point.

### U2 — Plumbing is automatic

- Remove the "Connect my agent", "Reach the community" and "Create my identity" buttons from the main path; the app does each when the next action needs it, with named progress.
- DIDs, host names and the transport label move behind **Details**.
- **Done when:** no DID and no transport name is visible on any main-path screen with Details closed, and a linked person reaches "Get vetted" in one tap from the community row.

### U3 — Communities home, the community screen and the agent screen

- Rename the tab; build the community screen with the role badge and the stage task list (§4), locked steps shown as locked.
- Build the agent screen (§4.1) on the state machine (§4.2), with the theme's buttons (§4.3): status line, what it holds, what it did, what you can do, Details; the app-wide banner when the agent is not online; the first-link introduction.
- Replace the trust-task screens' hand-rolled `Pressable` buttons with bifold's `Button`.
- One-time tip when a vetter grant first appears.
- **Done when:** each of stages 1–4 renders its own task list in a unit test; every transition of the state machine (§4.2) has a unit test naming its cause, and no screen keeps its own copy of connection state; the status line reads Online, Reconnecting and Offline in a unit test driven by the session's events, and a sub-threshold drop shows no banner; no trust-task screen renders a raw `Pressable` button; the introduction shows once after linking and again from "What is my agent?"; the tip shows once per grant.

### U4 — One scanner and the ticket QR

- The vetter's ticket renders as a QR with a typed fallback code; the app's scanner dispatches `vetting-ticket:` links and `keyring://vti/invitation` links to their flows.
- **Done when:** the vetting runner hands the ticket over by scanning on at least one platform (or by the scanner's dispatch function with the scanned text, where a simulator cannot scan).

### U5 — Two vetting flows, one step per screen

- Split `VtiVetting.tsx` into Get vetted (§5.3) and Vet someone (§5.4); full-screen match code answered "Codes match" / "Codes differ" on both sides; biometric on send, attest and apply.
- "Codes differ" on either phone ends the session on both.
- **Done when:** the two-device vetting runner is green through the new screens, and a "Codes differ" test ends the session on both.

### U6 — Linking an agent without a stopped daemon

- The phone mints a temporary manager key per link attempt and rotates to the long-lived key on first connect; the *Show my code instead* fallback displays the temporary key with Copy/Share.
- `enrol-manager.sh` uses the online grant (`pnm acl create … --expires 1h`) against a running VTA, and the enrolment runner calls it with the key it reads off the phone — stage 1 of *Granting the phone* (§5.1).
- The agent's address comes from what the phone scans (U8) or is typed on the fallback path, not from `app/.env`.
- **Done when:** `run-vta-enrol.js` passes with the VTA never restarted and no human step, and the temporary key is absent from the VTA's access list after the first connect.

### U7 — Passkey sign-in spike (measure, do not ship)

- Measure §5.1's target on the lab VTA: enrol a passkey method on an admin `did:webvh`, sign in through `/auth/portal` from an in-app browser session on both platforms, and grant the phone's key.
- **Done when:** a dated companion records whether it works, what the session hand-back needs, and what the Farm would have to add — as a finding either way.

### U8 — Enrolment by QR: upstream's page first, then the lab page

- **Measure first:** grant a phone's key through upstream's browser extension (*Grant access* in its console's Access pane) against the lab agent, with the key pasted from the phone's fallback screen. Record what it takes, including how the extension itself is admitted as admin.
- **Then build the lab enrolment page** (§5.1, *Granting the phone*, stage 3): *Add a phone* shows a short-lived, single-use enrolment QR bound to the page session; the phone scans it and submits its temporary key signed with that key; both screens show the key's fingerprint; *Grant* sends `acl/grant` with an hour's expiry. The page runs only in the lab, signed in as the lab agent's admin.
- **Then write the indications for upstream:** a dated companion describing the exchange as it ran — the link format, the signed submission, the fingerprint check, the expiry — addressed to the extension's Access pane and the Farm console. Whether and how it is sent is a separate decision (§8).
- Browser UI tests drive the page: the test reads the enrolment link from the page (it is our page, so the link is in the DOM as well as in the QR), hands it to the simulator the way UT scans, and clicks *Grant* once the fingerprints match; where a passkey guards the page, the browser's virtual authenticator answers it.
- **Done when:** a browser test and a simulator link a phone end to end with no terminal step; a mismatched fingerprint is refused; an expired or reused enrolment link is refused; and the demo phones link through the page on the presenter's laptop.

### UT — The harness follows the flow (alongside every phase)

What the runners need that no single phase owns:

- **Scanning on simulators.** The iOS simulator has no camera. The scanner's dispatch function takes the scanned text, and dev builds expose it to the runner (a deep link or a test hook), so a runner "scans" by handing over the text the other screen shows — the vetter's ticket, or the enrolment page's link. On at least one Android emulator run, a real scan goes through the virtual camera scene.
- **Face ID and fingerprints.** Every signing act now asks for one (principle 9). The runners enrol and match them — Appium's simulator biometric commands on iOS, the emulator's fingerprint command on Android — and one test refuses a non-match.
- **Resets without the Developer screen.** Leave community (U1) and the lab scripts replace every Developer-screen step; the VTA probe no longer fires in the builds the runners install.
- **Both-sides confirmations.** The match code is answered on both phones, and one run answers "Codes differ".
- **Enrolment without a person.** The runner reads the temporary key off the screen and grants it (U6); the browser tests cover the enrolment page and hand its link to the simulator (U8).
- **Test IDs.** The renamed and moved screens keep a documented test-ID map in `e2e/`, so a failure names a screen that exists.
- **Done when:** all four runners (enrol, invite, approve, vetting) and the browser tests run unattended against the lab stack from a clean install, with no step that opens the Developer screen or waits for a human.

## 7. Blocked, and on whom

| Item | Blocks | Waiting on |
|---|---|---|
| Invitations by reference (VTI-32) | Scanning an invitation (§5.2) | Upstream |
| A phone hand-off at the Farm's "admin DID" step (VTI-Q10; the enrolment contract in the vetting subtask's §9 request 2) | Linking without a paste on the Farm (§5.1) | The Farm operator |
| Enrolment by QR in upstream's own surfaces — the extension's Access pane, the Farm console | Retiring the lab enrolment page (§5.1 stage 4) | Upstream and the Farm operator, after U8 hands them the indications |
| App association on the VTA domain | A native passkey sign-in (§5.1 target) | Upstream; U7 measures whether the browser-session route avoids needing it |
| Where the legal name lives — on the phone today, in the VTA's persona faces upstream (proposed design) | Where step 2 of §5.3 stores what it collects | The profile–persona reconciliation in progress on the feature branch |

## 8. Decisions

**Decided:**

- **The phone's key is device-bound.** No synced passkey carries it. A lost phone is re-linked through §5.1, which the agent screen offers.
- **Leave community is in the app** (U1).
- **The approver stays out of the demo.** Its code and runner stay as they are.

- **Linking is a step the person takes, by QR, and the demo shows it live** (§5.1). So the lab enrolment page (U8) is built before Prague.

**Open:**

1. **How the indications for upstream are sent** once U8 has run — an issue, a pull request against the extension's Access pane, or a note with the next report. Anything public needs a go.
2. **Whether the lab enrolment page is guarded by a passkey** or runs as the lab admin with no sign-in. The plan assumes no sign-in; it never leaves the lab.
