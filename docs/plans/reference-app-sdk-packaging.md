# Packaging Keyring as a Reference App + SDK — Working Notes

**Status:** Exploratory notes, not a commitment to implement. Not yet reviewed against `docs/plans/CLAUDE.md`'s companion structure — this is a single working draft, to be split into a proper plan + dated companions once a direction is chosen.
**Scope:** whether/how to repackage this repo so prospective developers can stand up small demo apps for distinct identity/credential use cases, each backed by the same underlying Keyring/Credo/VRC/Trust-Task infra.
**Related:** [`openvtc-integration-plan.md`](./openvtc-integration-plan.md) (Trust Tasks, TSP transport), its [`trust_tasks_subtask.md`](./openvtc-integration-plan/trust_tasks_subtask.md) (Trust Task message shape, witness recast) and [`pnm_cnm_subtask.md`](./openvtc-integration-plan/pnm_cnm_subtask.md) (PNM/VTA client, "the phone as approver"), and [`../HARDWARE_ATTESTATION_FLOW.md`](../HARDWARE_ATTESTATION_FLOW.md) (hardware signing).

**Positioned as a sibling to the openvtc plan, not a subtask of it** — same relationship `locality-plan.md` has (openvtc-integration-plan.md §4.6: "the locality axis now has its own plan"). It depends on that plan's infra (Trust Tasks, witness recast, PNM/VTA) but its own scope — developer packaging, DI/theming ergonomics, a trading-card demo — extends past Trust Tasks into territory the parent plan doesn't own. It stays a standalone exploratory doc rather than moving under `openvtc-integration-plan/` because subtasks there state *current design* in present tense (per `docs/plans/CLAUDE.md`); this is still pre-decision brainstorming.

**Review index.** Companions carrying the reasoning behind the positions below:

| Companion | Author | What it settles |
|---|---|---|
| [`2026-09-01-al.md`](./reference-app-sdk-packaging/2026-09-01-al.md) | AL | SDK scope and framing (mobile-first, SDK as the deliverable); consume upstream Trust Tasks rather than reimplement, and the duplicate-implementation problem it exposes; wrap orchestration rather than types; the VTA Farm as first-class onboarding; `ref-08-pnm-core-hermes` as the unblocking experiment; requirements R6–R12 |
| [`2026-09-03-bm.md`](./reference-app-sdk-packaging/2026-09-03-bm.md) | BM | Fundraising-driven phasing (reference-app track first, SDK track deferred); the one-app/additive-registry/picker architecture; sequencing with hardware-signing decoupling pulled forward; the `feat/trust-tasks-over-didcomm-v1` cross-check that constrains how R5 must be built, and what to tell that branch's owner |
| [`2026-09-04-bm.md`](./reference-app-sdk-packaging/2026-09-04-bm.md) | BM | R1–R4 as built: "no hand-configured `.env`" raised to an acceptance criterion, and why that forces the mediator to start before any build; a fresh invitation every boot; the tunnel needed only for physical devices and mixed pairs; R3 satisfied by `DefaultOCABundleResolver` with no new code; the starter container alongside `container-imp.ts` rather than trimming it; two ways the RN toolchain reports success having done nothing. Sequencing item 3 as built: hardware signing extracted to `@bifold/core/hardware-signing` behind an enforced Credo-free boundary, why a new package is not yet warranted, and the third case of the plan overestimating work sized from prose |

**Reconciled against `openvtc-integration-plan.md` §6 ("Demo concepts — brainstorm only")**, which already proposes several of the same demos under different names, with more ecosystem grounding (real Trust Task type URIs, a stated flagship target). This file's per-idea notes below cite the overlap explicitly rather than treating these as independent proposals:

| This file's idea | §6 prior art |
|---|---|
| The Agent Leash | "Meet your Agent" — LLM beside the VTA, its own scoped-DID identity, phone holds `approve`; "a prompt-injected agent is rejected/escalated identically — security never depends on the model behaving" |
| The Approver / Passkeys | "Log in with your Agent" + one-veto ACL grant demo (P1 MVP); vignettes: subscription killer (`vault/proxy-login`, each login phone-approved), temporary family access (`acl/grant` + `expiresAt`) |
| Human Factor Authentication | Vignette: "AI-written commits signed only after phone approval" (VGI `did-git-sign`) — a human confirms an agent's action, the same shape as HFA |
| Prove You're Human, or an Honest Agent | Vignette: "verified-human interaction (PHC personhood without identity disclosure)" — human half only; no §6 prior art for the "honest agent" half |
| The Quorum, Recovery, Invite-Nobody-Can-Forward, Trading cards | No §6 prior art — genuinely new to this file |

**Correction to this file's original research (2026-08-31):** the first draft characterized "a generic Trust Task inbox/approve-deny surface" as not existing anywhere, based on reading `bifold/packages/trust-tasks` (platform-neutral wire plumbing) and the legacy `vrc-manager.ts`/`witnessed-vrc-manager.ts`. It missed `bifold/packages/core/src/modules/trust-tasks/` — the app-level recast module current work on `feat/trust-tasks-integration` is actively building (files touched as recently as today). That module's `TrustTasksService.consume()` already takes an arbitrary `TrustTaskSpecPolicy` (any `typeUri`) and handler callback, running it through real §7.2 schema validation, proof policy and identity cross-check, with generic `respondWith`/`refuse` replies — a genuine, VRC-agnostic consume/respond engine, not a VRC-specific one. What's *not* generic yet: `setupTrustTasksInbound` in `ceremony.ts` dispatches on `document.type` via a closed if/else chain (one branch per known VRC/witness/discovery type), each branch calling a bespoke business-logic handler — not an open registry — and there is no UI anywhere that renders an arbitrary incoming Trust Task and lets a person approve/deny it; the existing handlers respond automatically per-protocol. So the "Approver" gap is real but narrower than first stated: it's an open type→handler registry plus a UI render/approve-deny layer sitting *on top of* an engine that already exists, not a new engine. Item 1 below and the Patterns section are corrected accordingly.

---

## Checklist

One row per proposed demo. Status is about **infra that exists in this repo today**, not about idea quality.

| # | Idea | Status | Blocking gap |
|---|---|---|---|
| 1 | The Approver | 🧩 partial (engine exists) | The consume/respond engine (`TrustTasksService.consume()`) is already generic; the gap is an open type→handler registry (today a closed if/else in `ceremony.ts`) plus a UI render/approve-deny layer, neither of which exists for arbitrary task types |
| 2 | Passkeys Nobody Has to Store | 🧩 partial | Hardware signing is exposed standalone (`@bifold/core/hardware-signing`, Patterns item 2); what remains is the demo UI and a relying party to present to |
| 3 | More Factors, Fewer Taps | 🧩 rides on #1 | Same gap as #1 (registry + UI, not the engine); evidence already supports multiple factor types |
| 4 | The Agent Leash | ⛔ greenfield in this repo | No PNM/VTA client exists here at all (it's a Rust ecosystem plan, not ported) |
| 5 | Prove You're Human, or an Honest Agent | 🧩 half-partial | "Human" half rides `verifier` + OCA; "honest agent" half needs a new credential type |
| 6 | Recovery From People, Not Your Inbox | ⛔ greenfield | No social-recovery or multi-party vouching code anywhere in the repo |
| 7 | An Invite Nobody Can Forward | ⛔ blocked externally | Anti-forwarding depends on VTC roster/membership infra outside this repo's control |
| 8 | The Quorum | ⛔ no code, but composable | Witness protocol is single-witness only; would be orchestration on top of existing primitives, not new wire protocol |
| 9 | Human Factor Authentication | 🧩 partial | Rides #1's gap + Trust Task `exposure` field (framework 0.3+), not yet used for redaction in UI. §6 vignette: "AI-written commits signed only after phone approval" |
| — | Trading-card exchange | ✅ mostly ready | Skins existing RCard exchange + OCA display registry; smallest new-code footprint of anything on this list |

Legend: ✅ ready today · 🧩 partial (real primitives exist, assembly/decoupling needed) · ⛔ greenfield or externally blocked.

---

## The developer path, treated as a requirement

Rather than starting from "what infra is missing" and hoping the result is easy to package, this section walks the actual path a developer takes trying one use case for themselves, and derives requirements from the friction that walkthrough finds. The **Patterns and core requirements** section further down (the "what to build" infra list) exists to satisfy the requirements found here — read this section first.

### Generic template — every use case shares steps 1–3, diverges from step 4

1. **Clone + install.** `yarn install` at repo root (runs `ensure-bifold-ready` as preinstall — inits/builds the bifold submodule). Identical for every use case.
2. **Stand up a mediator.** Copy `app/.env.sample` → `app/.env`. `MEDIATOR_URL` must be a live, reachable DIDComm mediator carrying an embedded connection invitation — the checked-in sample value is one specific ngrok tunnel + invitation from whenever it was captured, not a working default for a new developer. Nothing in the app boots usefully without this, regardless of use case.
3. **Build and run.** `yarn ios:setup && yarn ios` or `yarn android` — one native scheme (`AriesBifold`), no per-demo build flavor. "Try use case X" and "run Keyring itself" are the same build target today.
4. **Skin the app.** Copy `app/src/keyring-theme/` to your own theme directory and edit the plain-TS color/logo/copy objects — no config file, no build step, but it's a file to duplicate and prune, not fill in.
5. **Wire behavior via DI.** Copy `app/container-imp.ts`'s pattern (a child container re-registering `container-api.ts` tokens). The only worked example is 418 lines mixing generic override plumbing with Keyring's own product logic (RCard help text, ledger config, notification wiring, onboarding steps) — a developer has to read the whole thing to find the handful of lines that show *how to override one token*.
6. **Register the use-case-specific content** — a credential type + OCA bundle for something credential-shaped like trading cards; a Trust Task type + payload spec + renderer for anything Approver-shaped, once the registry in requirement R5 below exists.
7. **Exchange / demo it** — two devices, QR/OOB invite, riding whatever protocol the use case needs (VRC exchange today, for anything credential-shaped).

### Concrete walkthrough — trading cards (the one idea that's ✅ ready today, so steps 6–7 need no new engine work)

- **6a. Credential shape.** Extend RCard's `jCard` shape (`bifold/packages/core/src/modules/vrc/types/rcard.ts`) with an avatar/image field (data URI or URL) — this is the "hook for a developer to determine how to make their trading card" the original ask described.
- **6b. Skin the card.** `TOKENS.UTIL_OCA_RESOLVER` is DI-injected (`app/container-imp.ts:286-291`) as `new RemoteOCABundleResolver(Config.OCA_URL, ...)`. `OCA_URL` in the checked-in `.env.sample` defaults to `bcgov/aries-oca-bundles`'s raw-GitHub tree, so adding a branding overlay for a new credential type means adding JSON files to a git-hosted directory — fork that repo, or host your own raw-JSON tree on GitHub, and point `OCA_URL` at it. No server to run, but it does need a public URL: nothing wires up a "read the bundle straight from a file bundled with the app" resolver today, even though the interface is small enough that one would be (`resolve(params): Promise<OCABundle | undefined>`, `bifold/packages/oca/src/legacy/resolver/oca.ts`).
- **6c. Custom rendering**, only if the branding overlay alone isn't expressive enough for a genuinely trading-card-shaped layout: register through the existing credential-display registry (`ICredentialDisplayRegistry`, `map-to-card.ts`, `CredentialCard10.tsx`/`Card11Pure.tsx`).
- **7. Exchange.** Ride the existing RCard/VRC exchange (`RCardOnboarding.tsx`, `rCardCredential.ts`) unchanged.

What this shows: for the one demo needing zero missing engine work, getting a PoC running is still realistically a day or two for someone unfamiliar with the codebase — not because a primitive is missing, but because of copy-and-prune friction at steps 2, 5 and 6b. That's a packaging problem, fixable without touching any protocol code, not a build-more-infra problem.

### Requirements this puts on the packaging plan

- **R1 — a documented, one-command local stack** (mediator, and eventually a local VTA/witness). Checked concretely: the only local-infra spin-up precedent in the repo is for the *witness*, not the mediator — `e2e/lib/witness.js` spawns `bifold/packages/witness-server` locally, opens a `cloudflared` tunnel for HTTPS, and injects the resulting invitation, fully scripted behind one function call. Nothing equivalent exists for the DIDComm mediator itself: `app/.env.sample`'s `MEDIATOR_URL` is a single captured invitation from someone's personal ngrok tunnel, not a live default; the demo runbook (`docs/DEMO_RUNBOOK_WITNESSED_EXCHANGE.md` line 16) assumes the shared production mediator (`credo-mediator.asml.berkmancenter.org`, Berkman Center's own infrastructure, unreachable to an outside developer); and a stale invitation dead-ends with an unhelpful error (`e2e/README.md` line 75: "There is no mediator to pickup messages from"). This blocks step 2 for *every* demo, including the ready-today trading-card one — it is the single most universal piece of friction found. Fix: mirror the witness precedent — a spin-up script (or documented docker image) for a local Aries mediator agent, injecting its invitation the same way `witness.js` does. Purely additive tooling, no protocol code touched.
- **R2 — a trimmed starter container**, not just today's 418-line `AppContainer`. Line-level breakdown of the 340 substantive lines (`app/container-imp.ts:99-407`): **~15 lines** are pure container mechanism (constructor, `resolve`/`resolveAll`) — the only part every demo actually needs, already minimal. **~150+ lines are Keyring/BC-Gov production noise with zero explanatory value for a newcomer**: `CACHE_CRED_DEFS`/`CACHE_SCHEMAS` (lines 231-280, ~50 lines) are hardcoded BC Government Indy credential-definition/schema IDs (`Person`, `SellingItRight`, `lawyer`, `member_card`, specific DIDs like `TeT8SJGHruVL9up3Erp4o`) from a different sponsor's production ledger; `CRED_HELP_ACTION_OVERRIDES` (lines 119-139) is four more hardcoded BC `Person` cred-def IDs; the `CONFIG` block (lines 140-223, ~85 lines) mixes a commented-out Help section, commented-out push-notification wiring, BC-specific URLs, and a long comment explaining a *removed* BC Wallet Traction feature. **~90 lines are real Keyring product features that don't generalize**: the `LOAD_STATE` closure (320-397) hydrates Keyring-specific state slices (`witness`, `dismissPersonCredentialOffer`, developer/remote-debugging state) — the *pattern* (load persisted state, dispatch on boot) is needed, just not at this length — and the `NOTIFICATIONS` config (292-317) wires an entire "PersonCredential" auto-offer business flow. **~30-40 lines are genuinely reusable as example registrations**: the screen/component token overrides (`SCREEN_PREFACE`, `COMPONENT_HOME_HEADER`, etc.) show "here's how you swap a token" and are worth keeping as the template's core. Target for a trimmed starter: **60-80 lines** — mechanism + one screen override + one component override + a minimal `LOAD_STATE` + the OCA resolver registration (annotated toward R3), each commented "this is the pattern, replace the payload." Producing it is subtractive (delete BC-specific registrations, keep the pattern) — no new mechanism needed, since the DI container itself already works exactly as required. This is the single highest-friction item the walkthrough found (step 5), and it blocks every use case equally, not just the credential-shaped ones.
- **R3 — a local/offline OCA resolver option**, registered by default or offered as a documented alternative to `RemoteOCABundleResolver`, so a from-scratch PoC doesn't have to reason about GitHub-raw hosting just to skin one credential.
- **R4 — a scaffolding convention** — a `demo-profiles/`-style directory sibling to `keyring-theme/` (the existing, currently-unbuilt `app/src/workflow-architecture-example/` is the closest precedent) — so "add a new use case" has one obvious place for a theme + container overrides + Trust Task specs, instead of being invented fresh per demo.
- **R5 — the open Trust Task type→handler registry + UI renderer** (Patterns item 1 below), needed by every Approver-shaped idea (#1, #3, #5-human, #9) so that step 6 for those ideas means *registering into* `ceremony.ts`, not editing it.

These five are what "Patterns and core requirements" below is in service of: the infra gaps there only matter to the extent they satisfy R1–R5.

---

## Idea-by-idea notes

### 1. The Approver
"Shows you the real request; never rings for a stranger."

This is the headline PNM capability — `pnm_cnm_subtask.md` §1 calls it out explicitly: *"The highest-value PNM capability — the phone as approver — is gated on none of [TSP/Askar/Credo]."* It's also openvtc-integration-plan.md §6's own MVP: *"browser login via the upstream `demo-rp`; phone shows verified requester, Face ID, in — no password exists. Then an ACL grant attempt from an unverified name → deny → signed refusal in the audit log."*

The message-layer plumbing is real and mature at two levels, not one: `bifold/packages/trust-tasks` (`TrustTaskMessage.ts`, `documentProof.ts`, `validator.ts`) models the transport-neutral document, and — more load-bearing for this idea — `bifold/packages/core/src/modules/trust-tasks/` (the app module current work on `feat/trust-tasks-integration` is actively building) already wraps that in a **generic consume/respond engine**: `TrustTasksService.consume()` takes any `TrustTaskSpecPolicy` (an arbitrary `typeUri` + validation/proof requirements) and a handler callback, runs it through real §7.2 schema validation, proof policy and identity cross-check, and returns via generic `respondWith`/`refuse`. That is not VRC-specific machinery re-purposed — it's already type-agnostic by design.

What *is* still closed and VRC-specific: `setupTrustTasksInbound` in `ceremony.ts` routes an inbound document to a handler via a hardcoded if/else on `document.type` (one branch per known type: `propose`, `propose#response`, `discovery`, `discovery#response`, `issue`, `issue#response`, …), and every existing handler performs automatic protocol business logic rather than surfacing anything to a person. There is no UI anywhere — in this repo or in the §6 brainstorm — that renders an arbitrary incoming Trust Task's payload and lets a user approve/deny it with a signed response.

**Packaging need:** (1) turn `setupTrustTasksInbound`'s if/else into an open registry keyed on `typeUri` (or slug pattern, reusing `slugMatchesPattern` from `ceremony.ts`) that any new demo can add an entry to without touching the ceremony dispatch; (2) a UI-side registry (parallel to `ICredentialDisplayRegistry`) mapping that same `typeUri` to a renderer + approve/deny action. Both sit on top of the existing `TrustTasksService.consume()` engine — no new consumption/response primitive is needed.

### 2. Passkeys Nobody Has to Store
"One passkey, verified anywhere, stored nowhere."

Directly maps to the hardware attestation stack, which is the most mature, most tested piece of infra in the repo (`docs/HARDWARE_ATTESTATION_FLOW.md` — full status table, real-device E2E, native X.509 chain verification on both platforms). `ensureHardwareSigningKey()` / signing live in `vrc-hardware-signing.ts`, evidence assembly in `EvidenceBuilder.ts`, verification in `BiometricSignatureVerifier.ts` → native `verifyHardwareEvidence`. All of it is currently invoked only from inside VRC credential issuance (`vrc-biometric.ts`), gated by the `useHardwareAttestation` preference.

**Packaging need:** extract "create/reuse a hardware key, sign this payload, produce portable evidence" as a standalone service not coupled to VRC's credential-issuance orchestration, so a demo app can do "sign this login challenge with your Secure Enclave key" without instantiating Credo/DIDComm at all.

### 3. More Factors, Fewer Taps
"One tap, several kinds of proof." User's own note: rides on The Approver.

The evidence shape already supports composite factor types — `type: ["DeviceAuthentication", "HardwareKeyAttestation"]` / `["BiometricAttestation", "HardwareKeyAttestation"]` (`HARDWARE_ATTESTATION_FLOW.md`, evidence block). Nothing blocks combining more factor types in the same evidence array; the only real work is UI that composes/displays multiple evidence types in one Trust Task response, which is the same rendering-layer gap as #1.

### 4. The Agent Leash
"An identity and an off switch for any AI agent."

Zero code in this repo, but the concept is already thought through in openvtc-integration-plan.md §6 as **"Meet your Agent"** — the plan's stated post-integration showstopper, not just a name match: *"the LLM never lives inside the VTA — it's a separate process with its own DID, enrolled under a scoped ACL grant (`scopes`, `expiresAt`, `stepUp`, phone holds `approve`)... a prompt-injected agent is rejected/escalated identically — security never depends on the model behaving."* That's the "off switch" (phone-held `approve`/revoke on a scoped grant) and the "identity" (the agent's own DID) both already designed, just not built. §6 estimates "≈1–2 wk on a finished Phase D core."

`auth/sessions/list/0.1`, `auth/revoke-session/0.1`, `vta/credentials/{issue,revoke}` (`pnm_cnm_subtask.md` §11, around line 1143–1227) are **VTA-side operations reached through the PNM client**, and the PNM client itself doesn't exist here — `pnm-cli` / `vta_sdk::client::VtaClient` are Rust, external to this repo, and porting them to RN is exactly what `pnm_cnm_subtask.md` is a *plan* for, not a built thing. Grepping the whole repo for "revoke" turns up only planning documents; there is no "agent" (AI-agent, as opposed to Credo `Agent`) concept anywhere in code.

**Packaging need:** either (a) wait for/build a thin PNM client, or (b) build the demo against a mocked/stub VTA that speaks the same Trust Task document shape (`{id, type, payload}`) so the *wallet-side* approve/revoke UI can be built and demoed now, swapped to a real VTA later. Given the Trust Task envelope is transport-agnostic (`pnm_cnm_subtask.md` §2.1 — REST/DIDComm/TSP all carry the same document), a stub REST VTA is cheap and faithful to the real wire shape.

### 5. Prove You're Human, or an Honest Agent
User's own note: "Agent half ready; human half a bigger swing" (worth checking with the user — my read of the code suggests it may be the *reverse*, see below).

The "human" half can ride `bifold/packages/verifier` (`ProofRequestTemplate`, `request-templates.ts`) — already the machinery for constructing and sending presentation requests — plus RCard/VRC as the "a person vouched for this identity" signal, plus hardware attestation as a liveness/anti-bot proxy. All three pieces exist and are wired together elsewhere in the app. This half also has a named §6 precedent: the vignette "verified-human interaction (PHC personhood without identity disclosure)" — though §6 only names it, with no design detail beyond the label; the machinery argument above is this file's own contribution, not restated from there. The "honest agent" half needs a *new* credential type an AI agent can hold and present that asserts "I am a bot, and here is what constrains me" — nothing like this exists; DTG credential taxonomy (`DTGCredential` → VRC/VMC/VIC/VPC/VEC/VWC, `openvtc-integration-plan.md` line 498) doesn't have an agent-identity subtype today, so this would need its own spec, likely as a private Trust-Task-adjacent credential rather than a `DTGCredential` subtype (compare: RCard itself is "a VDS, not a `DTGCredential` subtype" — same pattern of needing a new structure rather than forcing an existing taxonomy).

**Flag for the user:** worth revisiting which half is actually "bigger" — the human-proving half has the most reusable infra (verifier + OCA + RCard), the agent half has none.

### 6. Recovery From People, Not Your Inbox
User's own note: "our biggest swing."

Confirmed: no code anywhere implements social/multi-party recovery. The only near-neighbor concepts in docs are (a) `pnm_cnm_subtask.md` line ~1174, which warns that a UI literally labeled "your recovery phrase" is dangerous framing for a *different* task (local session/device wipe recovery, not social recovery), and (b) `docs/plans/locality-plan/2026-07-20-bam.md`'s "sparse anchor co-witnessing" — physical-proximity-based co-witnessing between devices, a genuinely different mechanism (physics-backed presence, not social vouching for account recovery).

**What it would need:** (1) a way to designate N trusted contacts from existing VRC relationships as recovery guardians, (2) a threshold ceremony to reconstitute key material or re-bind identity — closest structural fit is generalizing the witness protocol's session/challenge pattern (layer C, single-witness today) to multiple parties, (3) UI for issuing and responding to a vouch request. This is the union of gaps #6 and #8 (quorum) — recovery is arguably "quorum + a destructive/security-sensitive outcome," so it should be sequenced *after* quorum, not built in parallel with a separate ceremony.

### 7. An Invite Nobody Can Forward
User's own note: "waiting on a piece outside our hands."

The OOB invitation/relationship-DID handshake (layer A, `trust_tasks_subtask.md` §2.1) is a `goalCode` + free-text regex negotiation; DIDComm OOB invitations are conventionally single-use, but nothing in this repo enforces "this specific invite was redeemed by the specific person it was meant for" beyond that convention — there's no roster check. That check is described in `pnm_cnm_subtask.md` §1 as living on the **VTC** (Verifiable Trust Community service), not the VTA: *"the join queue, approve/reject, the roster — live on the VTC, not the VTA, and `cnm-cli` cannot reach them."* This matches the user's own assessment — the piece that would make an invite non-forwardable (membership roster + redemption tracking) is server-side infra this repo doesn't own or control.

### 8. The Quorum
"An approval several trusted people must confirm."

Grep + code read confirm the witness protocol is single-witness only: `WitnessedVRCManager.executeWitnessedExchange` takes one `witnessState`, `witnessStatusStore.ts` and `WitnessConnections.tsx` model exactly one witness relationship, and no "quorum"/"N-of-M"/"multiple witness" term appears anywhere in `bifold/packages/core/src/modules/vrc` or `witness-server`. Marked "Ready to build" on the user's list — my read is that's true in the sense that **no new wire protocol is needed**: the Trust Task message shape (generic request/response, proof requirement, outcome-evidence retention per `trust_tasks_subtask.md` §1) is already generic enough to fan out the same request to M trusted contacts and count responses against a threshold N entirely at the app-orchestration layer, without touching the witness-server's per-session protocol. Worth confirming this reading before treating it as a small lift — it's "no new protocol" but still real new orchestration + UI (fan-out, partial-response state, timeout/threshold logic) that doesn't exist yet.

### 9. Human Factor Authentication
"A trusted person confirms, with or without the details."

Close cousin of #1, plus one more piece: Trust Task framework 0.3 added `sideEffects` / `exposure` authoring declarations to a spec's front matter (`trust_tasks_subtask.md` §1, point 3). "With or without the details" maps naturally onto rendering the same Trust Task two ways depending on its declared `exposure` class — full payload for the requester, a redacted summary for the confirming party. The `exposure` field already exists in the framework/spec shape; no UI branches on it yet.

### Trading-card exchange app
Not from the list above, but analyzed the same way.

This is structurally different from the others — not an authorization/approval flow, but a styled credential exchange. It maps almost entirely onto **existing, mature infra**: RCard is already a real credential exchanged over the VRC protocol (`rCardCredential.ts`, `RCardOnboarding.tsx`), and `bifold/packages/oca` ("TypeScript implementation of Overlay Capture Architecture for styling Aries Verifiable Credentials") is already the exact hook the user is describing — a per-credential-type styling/rendering overlay. The credential-display registry (`ICredentialDisplayRegistry`, `map-to-card.ts`, `CredentialCard10.tsx` / `Card11Pure.tsx`) is the existing extension point for "developer decides how their credential/avatar renders." A trading-card demo is very close to: a themed OCA bundle + a custom card renderer registered through that registry, riding the RCard/VRC exchange as transport, plus a profile-picture/avatar field on the credential schema with the "hook for a developer to determine how to make their trading card" being exactly an OCA overlay + display-registry entry. This is the smallest new-code idea on the whole list.

---

## Patterns and core requirements

Cutting across all ten ideas, five infra pieces keep recurring, ranked by how many demos depend on them. Item 1 is R5 from the developer-path section above; items 2–5 are the protocol/credential-layer counterparts to R1–R4's packaging-layer asks — building these is what makes R1–R4's scaffolding have real use-case content to scaffold.

1. **Open Trust Task type→handler registry + a render/approve-deny UI** (needed by #1, #3, #5-human, #8, #9, and useful for #4's stub). This is the single highest-leverage gap, but it is *narrower* than "build a generic consume/respond engine" — that engine (`TrustTasksService.consume()` in `bifold/packages/core/src/modules/trust-tasks/`) already exists, is already type-agnostic, and is being actively built out on `feat/trust-tasks-integration` right now. The two missing pieces are: (a) replacing `ceremony.ts`'s closed if/else dispatch with an open registry keyed on `typeUri`, so a new demo can register a type without touching the ceremony module, and (b) a UI-side registry mapping that same `typeUri` to a renderer + approve/deny action, mirroring the existing `ICredentialDisplayRegistry` pattern. Both are additive on top of live infrastructure, not a parallel system.

2. **Standalone hardware-signing service** (needed by #2, and as a factor inside #3, #5-human). **Built** — `bifold/packages/core/src/hardware-signing/`, entry point `@bifold/core/hardware-signing`: `createHardwareSigningService().signPayload(payload)` returns a self-contained `SignedPayloadAttestation` (`{payload, payloadHash, signedAt, evidence}`) with no Credo or DIDComm instantiated, and `verify()` checks one. The directory imports no `@credo-ts/*`, enforced by a boundary test, so extracting it into its own package later is a directory move; a package is not warranted while its only consumers already bundle Credo. `vrc-hardware-signing.ts` and `EvidenceBuilder.ts` remain as Credo adapters supplying the logger, `utils.uuid` and the Askar-backed attestation cache — VRC issuance is unchanged. See [`2026-09-04-bm.md`](./reference-app-sdk-packaging/2026-09-04-bm.md).

3. **Witness ceremony generalized from 1 to N-of-M** (needed by #6, #8, and arguably a hardened version of #9). Currently hard-coded to exactly one witness at every layer (manager, store, screen). Recovery (#6) is best understood as quorum (#8) plus a higher-stakes outcome — sequence quorum first.

4. **Credential display extensibility (OCA + display registry)** (needed by the trading-card app, and any "prove you're X" UI in #5/#9). This is already mature and the least-blocked piece on the list — it's the existing answer to "give a developer a hook to control how their credential/avatar looks."

5. **A PNM/VTA client, or a faithful stub of one** (needed by #4, and would substantially help #1 and #7). Doesn't exist in this repo; the real one is an external Rust ecosystem plan (`pnm_cnm_subtask.md`), not yet ported. Because the Trust Task envelope is transport-agnostic and identical across REST/DIDComm/TSP, a minimal REST stub VTA that speaks the same `{id, type, payload}` document shape would let wallet-side UI for #4 (and partially #1, #7) be built and demoed now without waiting on the real VTA/VTC infrastructure — and without throwaway work, since the wallet side wouldn't need to change when a real VTA replaces the stub.

**On packaging mechanics** (how a "reference app + SDK" would actually let a developer pick a use case — the mechanism side of R2–R4):

- The existing `container-api.ts` (tsyringe DI: `SCREEN_TOKENS`, `HOOK_TOKENS`, `PROOF_TOKENS`, `ICredentialDisplayRegistry`, etc.) is already the mechanism Keyring uses to let a downstream app override screens/behavior — extending it with a `TRUST_TASK_TOKENS` renderer registry (item 1 above / R5) keeps this consistent with how the app is already built, rather than inventing a parallel plugin system. **R2 is not "invent a new mechanism"** — it's "produce a trimmed instance of this one," since the mechanism itself is already proven by `AppContainer`.
- Adding a new `@bifold/*` package (e.g., a decoupled hardware-signing package, or a stub-VTA client) follows the documented four-entry recipe in the root `CLAUDE.md`: root `portal:` resolution, `app/package.json` dependency, `app/metro.config.js` `packageDirs` entry, and (for dev hot-reload) a `BIFOLD_SOURCE_PACKAGES` entry.
- `app/src/keyring-theme/` is the existing pattern for a full app-identity skin (theme + features); each demo "profile" (Approver demo, trading-card demo, etc.) is naturally a sibling to `keyring-theme/` — a theme + a small set of registered screens/hooks + a handful of Trust Task type specs — rather than a fork of the app. `app/src/workflow-architecture-example/` (currently `.txt`-suffixed, unbuilt reference files for a dynamic-onboarding-workflow pattern) is a precedent for exactly this shape of "example profile" — this is R4's starting point, worth reviewing before designing a new one from scratch.
- Every new use case that isn't pure UI needs its own Trust Task type spec (`payload.schema.json` per `trust_tasks_subtask.md` §1, point 4) — and per that same document, publishing under a private authority we control is fully conforming (§6.5), so none of these demos need to wait on `trusttasks.org` registry work to exist.

**Sequencing implication:** items 1 and 4 above are the cheapest and unlock the most (Approver, Multi-Factor, HFA, trading-card, and a stubbed Agent-Leash all become buildable). Item 3 (quorum) is next — it's genuinely new orchestration but no new protocol. Items 2 and 5 are each a bounded, mostly-mechanical decoupling of infra that already works. Recovery (#6) and the agent-identity half of #5 are the only two ideas that need real new design work beyond assembly of existing pieces — consistent with the user's own "biggest swing" / "bigger swing" framing for both.

---

## Adopted positions — 2026-09-01

Recorded here because the plan holds current design; the argument and the
evidence for each of these is in
[`2026-09-01-al.md`](./reference-app-sdk-packaging/2026-09-01-al.md), which
should be read before revisiting any of them.

**Framing.** Mobile-first, and the SDK is the deliverable — the reference app is
what proves it. The notes above are a reference-app packaging analysis and stay
valid as such; the SDK half is stated in the companion and adds requirements
**R6–R17**: versioning and publishing; the package inventory with dependency
direction drawn before extraction; an error taxonomy as a product surface; a VTC
administration reference app (Wikimedia Foundation as the named client);
documentation in multiple languages; a compatibility matrix; supply-chain
posture; a documentation stack, stable hosted address and agent-readable
index; SDK conventions borrowed from mature SDKs — of which a **sandbox makes R1
table stakes rather than polish**; an intake channel for builders; a showcase
surface kept separate from the docs; and a multi-language strategy built on
**published conformance vectors** rather than OpenAPI generators, which cannot
carry the canonicalization and signature verification that make a response
checkable.

Two acceptance criteria are stated so they can fail: the reference app consumes
the **published** SDK rather than the source, and "stupid easy" is a timed
walkthrough by someone who has not seen the repo, not an assertion.

Three upstream overlaps to check before building anything: `@openvtc/rp-sdk`
(the relying-party surface), `@openvtc/pnm-core` (the passkeys-to-VTA bridge,
which is substantially the slate's passkey product), and `vtc-service`'s
existing administrative routes. Two risks in the product slate are recorded in
the companion — an identity model that conflicts with the correlation-scope
position we argued upstream this week, and three "ready to build" items whose
infrastructure is not in this repo.

**Trust Tasks: consume upstream, own the orchestration.**
`@openvtc/trust-tasks` is generated bindings for the whole registry plus a
zero-dependency runtime, and it *injects* cryptography rather than implementing
it (`proofPolicy`, `payloadPolicy`). We adopt its types and machinery and own
what it deliberately leaves blank — a concrete `eddsa-jcs-2022` signer and
verifier including hardware-backed signing, a payload validator, and the
binding-0.2 DIDComm carriage.

**Two JCS canonicalizers are already in the bundle, and nothing measures
them.** We do consume upstream — `@openvtc/trust-tasks` is a declared dependency
of `@bifold/core` and `@bifold/witness-server` at `^0.9.0`. What is duplicated
is the canonicalization: our `documentProof.ts` uses the `canonicalize` package
while upstream's runtime implements RFC 8785 itself, and both ship today. If
they disagree on any input, a digest computed by one path fails against the
other — intermittently, per document, with no build error. Separately we are
pinned `^0.9.0` against **0.16.8**, spanning framework 0.5.0 (the two named
digests, the lifecycle table, the freshness rules), and `pnm-core` will require
a newer one, so Prague forces the bump. The companion sequences remediation
**T0–T4**; **T1 — measure whether the two canonicalizers actually diverge,
before changing any code — is the cheapest step and applies to the bundle as it
stands**, independent of any packaging decision.

**The package splits on two axes, not one.** Platform-neutral is not enough:
`@bifold/trust-tasks` depends on Credo, so a relying party embedding the SDK to
request an approval would be made to install an agent framework. A Credo-free
**pure layer** (documents, proofs, digests) is shared by the wallet, the
witness-server, the VTA and any relying-party service; a **Credo adapter**
(askar keys, DIDComm carriage) is wallet-and-witness only. There is no separate
"Trust Tasks backend" to build — there are services that embed the pure layer.

**R5 is restated.** An open `typeUri` → handler registry is necessary but not
sufficient. Registration carries `{ spec, orchestration, renderer }`, because
the framework is document-level and says nothing about what `ceremony.ts`
already does: proposer selection (`isDeterministicProposer`), peer capability
discovery (`peerSupportsTaskType`), version gating
(`TRUST_TASKS_MIN_RCE_VERSION`), idempotence on redelivery (documents queried by
`{typeUri, connectionId}`), and the `vrcFlowStore` interlock. That orchestration
— a session over a relationship — is the SDK's product surface, and it is the
reason wrapping is worth doing at all.

**R1 becomes the VTA Farm.** Upstream's own guidance is Path A (the managed
Farm: VTA hosting, DID hosting, mediator connection management, no server and no
public domain) for newcomers, with self-hosting as Path B where
`tsp-reference/ref-05-local-vta` is the precedent. Open question that gates the
Agent Leash: Path A's prerequisites are a Farm account, passkey support and
locally installed PNM software — i.e. the browser plugin — so whether a React
Native wallet can authenticate to a Farm-hosted VTA is unanswered.

**The critical-path experiment is `ref-08-pnm-core-hermes`.**
`@openvtc/pnm-core` carries a complete TypeScript VTA client under `src/vta/`
on an RN-viable dependency stack (noble, scure, cfworker/json-schema, cbor-x)
that is nonetheless described as browser-side and mentions neither React Native
nor Hermes anywhere. Proving it under Hermes answers three questions this plan
is currently guessing at: whether Keyring can talk to a Farm VTA, whether the
Agent Leash is a port or a rewrite, and whether the SDK owns a VTA client or
consumes one.

**Out of scope here.** Prague (which connects Keyring directly to the Farm and
is parallel, not downstream); OCA in the SDK core (confirmed absent from the
Trust Task path — it stays in the reference app for credential-shaped demos); a
full UI kit (`keyring-theme/` plus two screens is version zero).

---

## Phasing and priorities — 2026-09-03

Recorded here because the plan holds current design; the argument, the
evidence, and the items to raise with `feat/trust-tasks-over-didcomm-v1` are in
[`2026-09-03-bm.md`](./reference-app-sdk-packaging/2026-09-03-bm.md), which
should be read before revisiting any of them.

**Driver.** Packaged, spin-up-and-use demos are needed in the short term for
fundraising — real, customizable tasks a person outside the team can run and
extend, not a slide deck. That puts this phase entirely on the reference-app
track (R1–R5); the SDK track (R6–R17) is deferred, not reversed or
reprioritized down — nothing above changes because of this section.

**The two demos.** Trading-card exchange (✅ ready — rides the existing
RCard/VRC exchange, no new engine) and The Approver (🧩 partial — the
consume/respond engine already exists; the gap is the registry plus a
render/approve-deny UI). Both are already scored this way in the checklist
above; this phase adds no new ideas to that list.

**One app, additive registries, a picker — not per-demo forks.** Both demos
register into the same running build through the existing `container-api.ts`
token pattern (`TRUST_TASK_TOKENS`, `ICredentialDisplayRegistry`) rather than
being separate builds or an env flag swapped before rebuild. A home-screen
chooser lists installed demo profiles (`demo-profiles/`, R4); adding a third
demo later is dropping in a profile module, no rebuild and no shared-code
change. This is also the first working instance of this document's proposed
`registerTrustTask({ spec, orchestration, renderer })` surface — built and
exercised by our own two demos before any outside developer sees it.

**Sequencing.**
1. R1 (mediator spin-up script) + R2 (trimmed starter container) — universal
   blockers for every demo, done once, first.
2. R3 (local/bundled OCA resolver) + the trading-card demo — smallest new-code
   footprint on the idea list, ships first.
3. Hardware-signing decoupling (Patterns item 2 above) — pulled forward from
   its original sequencing because it is dual-purpose: it lets the approval
   demo show hardware-backed signing directly, and it is independently one of
   the SDK's own identified extraction targets. One task instead of two.
4. R5 (open `typeUri` registry + a generic render/approve-deny screen) — the
   Approver demo. Built **Carriage-shaped from day one**: the registry's
   dispatch takes an injected `send`/`onDocument`-style dependency rather than
   calling `agent.modules.didcomm` directly, even though that is what
   `ceremony.ts` does today. See the companion for why.

**Pre-demo-day insurance, not a blocker.** T1 (measure whether
`@bifold/trust-tasks`'s canonicalizer and `@openvtc/trust-tasks`'s diverge) is
worth running before either demo is shown publicly, since `ceremony.ts`
genuinely invokes both today. This is the only piece of the T0–T4 remediation
pulled into this phase; T0, T2, T3, T4 stay deferred.

**Coordination required with `feat/trust-tasks-over-didcomm-v1`.** That
branch is independently building a `Carriage` port
(`bifold/packages/trust-tasks/src/carriage.ts`) that abstracts `ceremony.ts`
away from Credo/DIDComm specifics — the same discipline this phase's R5 work
needs, arrived at from a different direction (TSP transport pluggability, not
SDK packaging). It is not yet on `main`. See the companion for what should be
communicated to whoever owns that branch before R5 starts.

**Out of scope for this phase, restated.** All of R6–R17, and T0/T2–T4 of the
trust-tasks remediation. They proceed on their own timeline once the
fundraising demos ship — nothing here re-opens or re-sequences them.
