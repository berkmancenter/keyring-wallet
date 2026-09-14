# Embedded VTA — operating without a hosted server

**Status:** Draft for discussion. Not a commitment to implement.
**Scope:** on-device VTA-*equivalent* capability (key custody already held by
Keyring, plus ACL evaluation and Trust Task dispatch) so a phone can act as its
own personal VTA and never enroll against a hosted `vta-service` — reachable
only via a push-woken mediator fetch, never an inbound listener.
**Parent:** [`openvtc-integration-plan.md`](../openvtc-integration-plan.md) —
extends §5 (target architecture) with a topology the parent does not currently
describe; not yet listed in the parent's subtask index or roadmap (§7).
**Sibling:** [`pnm_cnm_subtask.md`](./pnm_cnm_subtask.md) — **assumes the
opposite topology.** That document's Strategy C (§3.2) ports `@openvtc/pnm-core`
to React Native specifically because `pnm-core` is a *client* that holds "an
authenticated session with a VTA" (its own §1) and drives `~79 spec/vta/*` ops
against one. Nothing in it embeds VTA-side custody, ACL evaluation, or task
dispatch on the phone — by design, PNM assumes the VTA is somewhere else. §4.5
below states exactly where the two meet: VTC (community) participation still
needs a real, separately-hosted VTA+VTC pair regardless of what this document
builds, because ["a VTC always sits on top of a VTA"](https://github.com/OpenVTC/verifiable-trust-infrastructure#which-service-do-you-need)
is an architectural constraint, not an implementation choice.
**Sibling:** [`vta-carriage_subtask.md`](./vta-carriage_subtask.md) — the other
half of "operating without a hosted VTA," from the opposite direction. That
document establishes (its §2) that **fully decentralized relationship
negotiation — PNM/Credo agent, own keys, no VTA at all — is already Keyring's
shipping behavior today**, "first-class by construction, not by fallback."
What it adds on top is a *remote, hosted* VTA optionally answering
`propose` for a counterparty who has enrolled one (its "VTA-mediated
negotiation" mode) — the mirror image of this document, which is about
Keyring's *own* phone gaining VTA-grade policy/consent evaluation
(that document's [[DTTE]] — task-consent + approvals — and its Policy
Decision Point) without delegating custody or decisioning to any remote
party, hosted or not. This document borrows that sibling's vocabulary (PDP,
DTTE, default-deny-with-notify) throughout rather than inventing parallel
terms for the same concept. Read together, the two documents say: decentralized
negotiation needs no VTA today; auto-decisioning (grants, consent, ACL) exists
nowhere except inside a hosted `vta-service`; this document is the on-device
answer to that second gap specifically.
**Reasoning:** [`2026-09-14-bam.md`](./2026-09-14-bam.md) — the investigation
this plan is built on. (The **2026-09-04** slot in this directory was already
taken by an unrelated same-day entry from a different, concurrently-running
line of work — `credential-exchange/query` — by the time this document's
`main` was pulled; this document's own investigation is dated to when it was
actually written up, 2026-09-14.)
**Baseline:** originally measured against `verifiable-trust-infrastructure` at
`d294ecb` (live clone, 2026-09-01) — re-verify anything version-specific.
`keyring-on-the-vta-farm.md` §3.5 (measured 2026-09-03) records all four
`@openvtc` npm tripwires in this repo's `PINS.json` as tripped
(`trust-tasks` 0.9.0→0.16.8, `pnm-core` 0.4.0→0.7.0, `vti-didcomm-js`
0.6.2→0.7.0) and the `dtgwg-trust-tasks-tf` pin 68 commits behind; as of this
pull (2026-09-14) the pins in `PINS.json` have **not** been advanced yet — that
plan's F0 phase proposes to do so. Nothing in this document depends on the
specific pinned SHA (it draws on the Rust VTA's *shape*, not its wire version),
but re-verify file paths/LOC counts after any advance, per
[`scripts/openvtc/README.md`](../../../scripts/openvtc/README.md).

---

## 1. What this is, and how it differs from PNM/CNM

The ecosystem's standing shape is: a **VTA** is a server-side custodian
(`vta-service`) that holds keys/DIDs/ACLs for one identity, reachable over
REST/DIDComm/TSP; a **PNM** client (phone, browser extension, CLI) drives it
remotely, holding no keys of its own beyond a session credential. Every
existing plan in this repo — the parent, `pnm_cnm_subtask.md` — builds Keyring
as that second thing: a remote client of somebody's VTA.

This document is about a third shape the ecosystem doesn't name: **the phone
holds its own keys and DIDs already** (Keyring does this today, via Askar and
Secure Enclave/StrongBox) and can therefore *be* its own VTA for personal use —
evaluate its own ACL, dispatch its own Trust Tasks, sign its own auth documents
— with no remote custodian at all. What it cannot do is run a persistent
network listener; a phone is woken by push and fetches from a mediator, it
doesn't accept inbound connections. So "embedded VTA" means: **VTA-equivalent
logic running on-device, triggered by a push-woken mediator fetch instead of an
HTTP/DIDComm/TSP listener.**

**Stated precisely, given `vta-carriage_subtask.md`'s §2, so the two documents
don't read as overlapping when they aren't:** the peer-to-peer relationship
exchange itself — `propose`/`issue`, witnessing — already runs with no VTA of
any kind involved, and has for as long as Keyring's VRC module has existed;
that document calls this "decentralized mode... first-class by construction."
Nothing here changes that or needs to. What has no on-device equivalent
anywhere — not in this repo, not upstream except inside `vta-service` itself —
is a **policy-evaluation layer**: the ability to auto-decide some class of
inbound request (a scoped ACL grant, a consent decision) according to a
standing rule, rather than always popping a modal and waiting for a tap. Every
Trust Task handler that exists in this codebase today (the witness ceremony,
`credential-exchange/query`, the `approver/access-request` demo — see §2.4)
follows the same shape: consume, check proof, **always** show a consent
prompt, sign the reply on "yes." That is a complete and correct design for
those cases. It is not a substitute for what a VTA's DTTE/PDP gives a *remote*
party — a standing rule a device can act on without a human present at all —
and that capability is what this document actually adds.

This is not "port `vta-service` to TypeScript and run it as a server." That
framing was the starting point for this investigation and turned out to be
wrong on inspection — see §2 for why, and the companion document for the full
reasoning.

## 2. What the investigation found

### 2.1 The Rust VTA's logic is not a clean, separable core

`vta-service/src/trust_tasks/` (25,060 LOC across ~50 files) is not a generic
dispatch layer with pluggable handlers — each file *is* a specific task type's
business logic (`ceremony.rs`, `consent.rs`, `backup.rs`, `vault.rs`,
`webvh.rs`, `credential_exchange.rs`, `passkey_vms.rs`,
`provision_integration.rs`, `did_templates.rs`, `policy.rs`, …). There is a
genuine carriage-agnostic layer — `messaging/router.rs` + `messaging/registry.rs`
(part of `messaging/`'s 9,154 LOC) demux an inbound frame to a handler
regardless of transport — but "the dispatch spine" and "the full feature
surface" are the same module. There is no shortcut to "port the spine, skip the
features"; scoping has to happen task-type by task-type (§3).

`vta-service/src/operations/` (47,155 LOC: `did_webvh/`, `protocol/`,
`provision_integration/`, `vault/`, `passkey_vms/`) skews heavily toward
server/admin/multi-tenant hosting concerns that have no natural analog for a
single-user embedded agent at all.

By contrast, `vta-service/src/acl/mod.rs` is one line —
`pub use vti_common::acl::*` — and the real ACL model lives in `vti-common`,
shared across `vta-service`, `vtc-service`, `vta-sdk` and the CLIs. It's small,
self-contained, and genuinely portable *as logic to reimplement in TS*
(nothing here suggests transpiling Rust). It is factored apart from the
multi-tenant "Context" layer (`docs/02-vta/provision-integration.md`: contexts,
admin-labels, context-scoped bearer tokens) — that layer is server-operator
machinery with no counterpart in a single-user on-device agent and should be
dropped, not ported.

### 2.2 The wake mechanism is a named upstream spec already, not a gap to invent

The exact pattern this document needs — contentless "doorbell" push wakes the
client, which then does an ordinary mediator pickup to fetch the real Trust
Task — already exists as `binding/push/0.1` in the Trust Tasks framework, and
`vta-mobile-core::push` is a real shipped Rust module implementing the sending
side. This is the thing to adopt, not reinvent; §4.2 below.

### 2.3 `did:webvh` self-hosting is avoidable, with a working precedent

Self-hosting a `did:webvh` document needs an HTTPS-reachable log endpoint and
its own rotation machinery (`docs/02-vta/did-webvh-update.md`,
`didwebvh_rs::update_did`) — real server infrastructure a phone doesn't have.
But `vta-mobile-core/src/resolver.rs` states the resolver split plainly:
`did:key`/`did:peer` resolve offline; `did:web`/`did:webvh` need the network.
The existing iOS reference agent doesn't self-host a webvh document — it's a
mediator-connected member identity using an offline-resolvable method. Keyring
already defaults to `did:peer` for its own DIDComm identity. **Decision: the
embedded agent's own identity stays `did:peer`; webvh is out of scope entirely**
(§3), not deferred-with-intent-to-revisit.

### 2.4 Keyring's side of the wake path is entitled but unwired

- Push registration exists (`@react-native-firebase/messaging`,
  `app/src/utils/PushNotificationsHelper.ts`) and iOS is entitled to wake on
  remote notification (`UIBackgroundModes: [remote-notification, ...]` in
  `app/ios/AriesBifold/Info.plist`).
- Nothing consumes a silent/data-only push once it arrives: no
  `messaging().setBackgroundMessageHandler` anywhere in `app/src`, and Credo's
  own `@credo-ts/push-notifications` module is a declared dependency whose
  device-registration classes are imported on a **commented-out line**
  (`bifold/packages/core/src/utils/agent.ts:30`).
- Mediator pickup today is foreground-only:
  `DidCommMediatorPickupStrategy.PickUpV2LiveMode` (a persistent websocket
  while the app is open) or `Implicit`, configured in `useBCAgentSetup.ts` /
  `bc-agent-modules.ts`. There is no poll-on-wake / background-pickup path.
- No background-execution machinery exists at all: no
  `react-native-background-fetch`, no `notifee`, no headless-JS task, no
  `BGTaskScheduler`/`WorkManager` wiring. The iOS background mode is present
  but nothing is registered to use the window it grants.
- `AgentBridge` (`bifold/packages/core/src/services/AgentBridge.ts`) is real
  and already load-bearing — a generic pub/sub wrapper around the live Credo
  agent — and is a reasonable integration point for whatever this document
  builds.
- `@bifold/trust-tasks` is real and has grown substantially since this was
  first written (2026-09-04 → 2026-09-14, ~240 commits landed in between):
  `TrustTaskMessage.ts`, `validator.ts`, `documentProof.ts`, and now also
  `carriage.ts` — a real `Carriage` port (`send`/`onDocument`) matching the
  parent plan's §5.2 design exactly, currently implemented by
  `packages/core`'s DIDComm v1 carriage — plus a `tsp/` namespace and
  `TspEnvelopeMessage.ts`. This package is now the established, natural home
  for the dispatch/policy work in §4, more so than when this document was
  first drafted.
- **`bifold/packages/credo-tsp-adapter` is now a real, built package** —
  `package.json`, `src/`, `__tests__/`, shipped in PR #27 — not the dead build
  output this document originally found. Correcting that here because it was
  wrong, not because it changes this document's scope: the adapter is Credo's
  DID/key-custody binding for the TSP wire, orthogonal to the policy layer
  this document is actually about.
- **Still true, checked again on this pass:** no background push consumer
  exists anywhere in `app/` or `bifold/packages/core` (`setBackgroundMessageHandler`,
  `react-native-background-fetch`, `notifee`, headless-JS, `BGTaskScheduler`/
  `WorkManager` all still absent), and mediator pickup is still
  foreground-only — confirmed by 2026-09-13's `467a6ea` fix, which addresses a
  *foreground* double-pickup bug (two `AppState` handlers racing on
  resume), not a background path. §4.2/§5 Phase 0 stand as originally scoped.
- **A working precedent for the "consume → prompt → signed reply" half now
  exists on real devices**, which this document did not have to point to
  before: the `approver/access-request/0.1` demo profile
  (`app/src/demo-profiles/approver/`) runs exactly that shape — a private-
  authority Trust Task type, dispatched through `ceremony.ts`'s existing
  handler table, proof-verified against an established VRC relationship,
  answered through a consent modal — as does the shipped (non-demo)
  `credential-exchange/query` handler in the same dispatch table. Neither
  does what §1 says is actually missing: both *always* prompt a human: there
  is no standing-rule/auto-decide path in either. They're the best evidence
  yet that the dispatch/carriage half of this document's Phase 1 (§4.3) is
  largely already built; what remains novel is the policy-evaluation layer
  (§4.4) and the wake path (§4.2).
- `vti-client` still does not exist anywhere under `bifold/packages/`.

**Verdict on the wake path specifically, unchanged: partially wired
(entitlement + registration exist), but wake→fetch→process-without-UI is
entirely new work.**

### 2.5 The e2e test suite splits cleanly along the topology line

Of the 10 files in `vta-service/tests/e2e/tests/`, **8 exercise the
mediator-relayed DIDComm/TSP path** a push-woken phone could actually
participate in (`mediator_smoke`, `transient_handshake`, `didcomm_session`,
`session_hub`, `tsp_dual_leg`, `tsp_ping_correlation`, `tsp_round_trip`,
`client_didcomm` — several explicitly noted as hermetic/CI-run, no inbound
listener involved). **2 don't apply**: `rollback_dispatch` and
`state_op_matrix` test the VTA's *own* admin lifecycle (transport
enable/disable/rollback across REST vs. DIDComm dispatch routes) — server
operator concerns, not something a personal on-device agent does to itself.

## 3. Scope

**In scope (Phase 1, this document):**

- Wake pipeline: silent push → background execution → on-demand mediator
  pickup, adopting `binding/push/0.1`.
- Carriage-agnostic dispatch core (informed by `messaging/router.rs` +
  `registry.rs`'s shape, not transpiled) extending `@bifold/trust-tasks`.
- ACL evaluation (informed by `vti-common::acl`'s shape) as a single-context
  degenerate case — no multi-tenant Context layer.
- `messaging/ping/0.1` (the doorbell/health probe Phase 0 needs to prove
  anything at all).
- `task-consent/request|decision/0.1` — approve-on-second-device, already
  precedented on the iOS reference agent.
- `acl/grant/0.1` — the concrete "sister gets the photos context for a week"
  scenario the parent plan names as a vignette.
- `auth/authenticate/0.1` as an *outbound* signer (JCS, per the parent's §4.5
  scope) for when the embedded agent needs to assert its own identity to a
  peer — not an inbound bearer-token session model, which has no meaning
  without a network listener.

**Explicitly out of scope, not deferred-with-a-date:**

- `vta-enclave` (AWS Nitro TEE) — meaningless outside Rust/AWS hardware.
- `bbs-2023` credential support — a separate crypto lift already tracked
  elsewhere (parent §4.6); orthogonal to this document.
- `vtc-service` / `cnm-cli` / community administration — architecturally
  requires a real hosted VTA+VTC pair (§4.5); belongs to `pnm_cnm_subtask.md`
  P6, not here.
- `did:webvh` hosting and rotation — avoided by design (§2.3), not a gap.
- `operations/vault`, `operations/provision_integration`, `passkey_vms` as
  *services* — these are multi-tenant/hosting concerns; whatever personal
  analog Keyring needs (e.g. its own vault) is already Keyring's existing
  credential-store problem, not new VTA-port work.
- The VRC/witness recast itself — that's `trust_tasks_subtask.md`'s job; this
  document only has to make sure its dispatch core is the *same* spine that
  recast eventually rides, not a competing one (§4.5).

**Explicitly a phased plan, more functionality later:** the roadmap above is
Phase 1 only. Later phases (not designed here) would extend the task-type set
task-by-task the same way, each one costed and acceptance-criteria'd on its own
—  following the same posture the parent takes toward its own phases.

## 4. Architecture

### 4.1 Identity

`did:peer`, generated and custodied exactly as Keyring's DIDComm identity is
today (Askar + Secure Enclave/StrongBox). No new custody work; this reuses what
already exists rather than adding a VTA-specific key.

### 4.2 Wake path

Adopt `binding/push/0.1` + the shape of `vta-mobile-core::push` on the sending
side (whatever peer is trying to reach the embedded agent sends a contentless
doorbell). On the Keyring side, new work, in order:

1. Wire the dead push consumption: a background message handler
   (`messaging().setBackgroundMessageHandler` on Android; the iOS
   `remote-notification` background mode via a native handler) that runs
   without opening the UI.
2. Give it something to run: a background-execution mechanism (headless JS
   task, or `notifee`, or native `BGTaskScheduler`/`WorkManager` — pick one
   during implementation, not here) with a bounded time budget.
3. Inside that budget: an **on-demand** mediator pickup (Aries pickup v2
   explicit mode, not `LiveMode`'s persistent socket, which a
   background-woken process can't hold open) — fetch, decrypt, hand to the
   dispatch core (§4.3).
4. If the task needs user attention (a consent card), surface a local
   notification and let the reply happen when the user opens the app; if it's
   auto-answerable per ACL (§4.4), reply through the mediator before the
   background window closes.

### 4.3 Dispatch core — largely already built

`@bifold/trust-tasks`'s `carriage.ts` + `ceremony.ts`'s handler table (§2.4)
already do the job §4.3 originally scoped here: demux inbound document by
`type` URI + thread correlation, invoke a handler, build the reply — the same
job `messaging/router.rs`/`registry.rs` do server-side. What none of the
existing handlers do is gate on anything *other than* "is there a signature I
trust" before prompting a human. This document's actual remaining work at this
layer is adding a gate *before* the existing prompt-and-reply path: for a task
type this document lists as auto-decidable, consult §4.4's policy evaluator
first, and only fall through to a human prompt when the standing policy
doesn't resolve it (default-deny-with-notify, matching the sibling's own
default disposition for its unconfigured case).

### 4.4 Policy evaluation (this document's PDP)

A TS reimplementation of `vti-common::acl`'s grant/scope/approve model, sized
for one identity with no Context wrapping — informed by the same source the
sibling subtask cites for the VTA's own decision loop
([[VTA-OVERVIEW]]'s "signing oracle with policy," [[DTTE]]'s task-consent +
approvals mechanism). This is still real logic, not a stub — the "sister gets
the photos context for a week" scenario needs actual scoped, expiring grants —
it's just not multi-tenant, and it runs on the phone that holds the keys
instead of inside a remote `vta-service`. Default disposition for anything
with no matching rule: **default-deny-with-notify**, same as the sibling's
recommendation for a fresh VTA's PDP (its §5) — surface it to the user, never
silently accept or silently reject.

### 4.5 Where a real hosted VTA is still needed

VTC (community) membership is architecturally a separate service that sits on
top of a VTA (§ header). If Keyring ever needs to join a community, that still
requires a real, externally-hosted VTA+VTC pair and `pnm_cnm_subtask.md`'s
client work — this document does not and cannot substitute for that. The two
are not mutually exclusive: an embedded personal VTA (this doc) and a PNM
session against someone else's hosted VTA (`pnm_cnm_subtask.md`) can coexist in
the same app for different relationships. Whichever team picks this plan up
should treat `@bifold/trust-tasks`'s dispatch core as the single shared spine
both consume, so `trust_tasks_subtask.md`'s VRC/witness recast, this document,
and `pnm_cnm_subtask.md` are three consumers of one thing rather than three
parallel task-dispatch implementations.

## 5. Phased delivery plan

| Phase | Delivers | Acceptance criteria |
|---|---|---|
| **0. Wake pipeline** | Silent push consumed in background; on-demand mediator pickup fetches a queued message with no UI open | A test push wakes the app (device, not simulator — background execution is not reliably testable on simulators), a queued DIDComm message is fetched and decrypted, verified via device logs/telemetry, within the platform's background-execution budget |
| **1. Policy evaluator + ping** | The new PDP-equivalent (§4.4) lands beside the existing dispatch/carriage layer (§4.3, already built); `messaging/ping/0.1` round-trips end to end (push → pickup → dispatch → reply) as the first thing proving the wake path (§5 Phase 0) actually reaches a handler | ping/0.1 fixture (§6) passes against both the real `vta-service` (single-context config, as ground truth) and the on-device path |
| **2. Consent + grant** | `task-consent/request\|decision/0.1` and `acl/grant/0.1` wired to the policy evaluator: auto-reply where a standing rule allows it, fall through to the existing consent-modal pattern (§2.4) where it doesn't | Both task types' fixtures (§6) pass; a scoped, expiring grant (the sister/photos vignette) is issuable and enforced, and enforcement is verified to actually expire, not just accept an `expiresAt` field |
| **3. Auth signer** | `auth/authenticate/0.1` outbound, `eddsa-jcs-2022` | Reuses the JCS signer already scoped in the parent's Phase D (§4.5); shared, not reimplemented twice |
| **4+. Task-by-task expansion** | Not designed here | Each new task type gets its own fixture set and acceptance criteria before it's added, matching this table's shape |

## 6. Conformance strategy — "passing the same automated tests"

**What this can and can't mean, stated precisely:** the ~287 in-process Rust
unit tests in `vta-service`/`vti-common` test Rust internals directly and
cannot be run against a TS implementation from outside the process at all — a
TS port needs its own parallel unit tests, only *informed* by the Rust ones,
not literally executing them. The **8 relevant black-box e2e tests** (§2.5)
are the real target, and the repo already has an established pattern for
exactly this: the two-adapter rule (parent §4.4/§5.2) — one frozen fixture
suite, run against every adapter, proving the ports don't leak backend
behavior.

**Concretely:** for each of the 8 relevant e2e tests, extract its behavioral
contract as a frozen fixture (given this inbound Trust Task document + prior
thread state, expect this outbound document / this ACL decision / this
dispatch behavior) — the same shape `tsp-reference` already uses. Build a small
Node-side conformance harness that runs each fixture against two targets: the
real `vta-service` binary (in a single-context config, as ground truth) and the
new on-device TS dispatch core. A new rung under `tsp-reference/` — matching
the existing naming convention (next free number after `ref-09`) — is the
right home for this harness, not a bespoke test file buried in
`bifold/packages/trust-tasks`, so it stays runnable standalone and visible in
the same phasing map as everything else.

The wake/doorbell path (§4.2, §5 Phase 0) has **no existing Rust e2e test to
extract a fixture from** — it's infrastructure-level on the Rust side, not
something `vta-service`'s own test suite exercises end-to-end the way a client
would experience it. This needs a new rung written from scratch, proving the
push→pickup→dispatch round trip against the real upstream mediator +
`vta-mobile-core::push`-shaped sender, before it's built into the app.

## 7. Staying aligned with upstream — the hooks

This repo already has the mechanism the user is asking for; it's not fully
wired on, which is the actual gap.

- **`scripts/openvtc/PINS.json`**'s `verifiable-trust-infrastructure` entry
  already has a `watch` list (currently `CHANGELOG.md`, `docs/02-vta/`,
  `docs/05-design-notes/`, `vta-sdk/src/protocol/`,
  `vta-service/src/messaging/`, `vta-service/Cargo.toml`). **Extend it** with
  the specific paths this document depends on:
  `vti-common/src/acl/`, `vta-service/src/trust_tasks/` (at least the files
  behind the task types in §3's "in scope" list), and, in the
  `dtgwg-trust-tasks-tf` pin, `bindings/push/` if/when that binding gets its
  own file (today it's spec-only, worth watching for a dedicated spec file
  landing).
- **`scripts/openvtc/sync-external.mjs`** already fetches, diffs against the
  watch list, and **exits non-zero on a tripwire** — its own header comment
  says "usable in CI later." That "later" is the gap: **no `.github/workflows/`
  file calls it today.** Finishing that wiring — a scheduled Action that runs
  `sync-external.mjs` and reports (never advances) — is most of what "hooks to
  listen for changes" means here, and it's completing an already-flagged TODO,
  not inventing new machinery.
- **Never auto-advance.** The existing policy — fetching is free, advancing is
  a decision, a companion document records why — stays exactly as is. A CI job
  reporting drift is not authorization to move a pin; that stays a human
  decision at a boundary, per `scripts/openvtc/README.md` and
  `docs/plans/CLAUDE.md`. Note the pins are already overdue for that decision
  independent of this document — `keyring-on-the-vta-farm.md` §3.5 recorded all
  four `@openvtc` npm tripwires tripped as of 2026-09-03, and its own F0 phase
  is where that advance is proposed to happen; this document doesn't need to
  trigger it, only to re-verify its own claims once it does.
- **The real drift detector is the reference ladder, not the CI job.** The CI
  job says "these files changed"; re-running the ladder bottom-up (parent's
  existing rule) after any advance is what tells you whether it *broke*
  anything this document built. The new rung from §6 becomes part of that
  ladder, so upstream drift in the push binding or the ACL model shows up as a
  specific red rung, not a vague CHANGELOG diff.

## 8. Repo placement

**Everything in this document lives inside `keyring-wallet`, not a new repo,
not upstream, not `external/`.** The motivating goal (operate without a hosted
server, as Keyring product functionality) has no upstream-donation angle the
way the parent plan's other contributions do (§7 of the parent) — this is
Keyring-specific behavior, not a portable library the ecosystem needs. `external/`
is exclusively for read-only pinned upstream clones and is gitignored; this
document's code is ours, so it does not belong there.

Concretely:

- The dispatch core + ACL evaluator (§4.3, §4.4): extend
  `bifold/packages/trust-tasks` in place, since it already holds the primitives
  this needs (`TrustTaskMessage`, `validator`, `documentProof`) — lower
  friction than standing up a new package, and avoids a second place that
  needs to agree on the wire shape. Revisit only if the package's scope grows
  enough that "carriage message model" and "dispatch + ACL" clearly want to be
  separate publishable units — not a decision to make speculatively now.
- The push/background-fetch wiring (§4.2): app-level, in `app/`, since it
  touches native platform config (`Info.plist`, `AndroidManifest.xml`) that has
  no place in a portable bifold package.
- The conformance harness (§6): a new numbered rung under `tsp-reference/` at
  the repo root, matching every existing rung's placement rule.

## 9. Open questions and risks

- **Multi-device custody.** If a user has two phones, which one is "the VTA"?
  Today's Keyring wallet-backup/restore story is the closest existing answer,
  but it's a credential backup story, not an ACL-grant/audit-trail one — grants
  issued and consent history recorded on-device have no sync/backup story yet.
  Not designed here; flagged because §3's "acl/grant" scope makes it real.
- **Background execution budgets.** iOS gives a silent push a short
  (historically ~30s, platform-versioned, not to be hardcoded into this
  document) background window; Android's Doze/battery-optimization can delay
  or drop background work entirely on some OEM skins. Phase 0's acceptance
  criteria (§5) deliberately require a real device, not a simulator, because
  this constraint doesn't show up any other way.
- **Dropping the Context layer — worth a second look before committing.**
  §2.1/§4.4 treat `vti-common::acl`'s Context wrapper as pure multi-tenant
  cruft to discard, but it's worth explicitly checking whether "Context" also
  carries any per-relationship or per-persona separation Keyring's VRC model
  would want (e.g. keeping grants issued to different relationships from
  leaking into each other) before assuming a single flat ACL namespace is
  correct — not resolved in this document.
- **This document was not cross-checked against `pnm_cnm_subtask.md`'s
  custody-tier discussion (P0–P6, ~1600 lines) in full** — only §3.1–3.3 and
  §7 were read closely enough to establish the topology distinction in §1 and
  the boundary in §4.5. Before this plan is acted on, someone should read that
  subtask's remaining custody/backup sections in full to confirm no additional
  overlap or contradiction exists. (`vta-carriage_subtask.md` has since been
  read in full and is cross-referenced throughout — that gap specifically is
  closed; `pnm_cnm_subtask.md`'s P0–P6 detail is the one still open.)
- **Whether this document's PDP and `vta-carriage_subtask.md`'s PDP should be
  one implementation or two.** That sibling's §5 designs a PDP living inside
  `vta-service`, for a VTA operator deciding whether to accept a stranger's
  `propose`. This document's §4.4 designs a PDP living on the phone, for the
  phone's own operator deciding whether to auto-grant a peer's request. They
  evaluate different rule sets against different trust boundaries and there is
  no reason to assume the shapes converge — flagged here only so nobody
  assumes a shared implementation is possible without checking.

## Sources

- `verifiable-trust-infrastructure` (this repo's pinned/live clone) —
  `vta-service/src/{trust_tasks,messaging,acl,auth,setup}/`,
  `vta-service/tests/e2e/tests/*.rs`, `docs/02-vta/*.md`
- `vta-mobile-core/src/{resolver,push}.rs` and
  `docs/05-design-notes/mobile-agent-architecture.md` (the [[MOBILE-ARCH]]
  reference `pnm_cnm_subtask.md` already cites)
- This repo: `app/src/utils/PushNotificationsHelper.ts`,
  `bifold/packages/core/src/utils/agent.ts`,
  `bifold/packages/core/src/services/AgentBridge.ts`,
  `bifold/packages/trust-tasks/src/{carriage,TrustTaskMessage,validator,
  documentProof}.ts`, `bifold/packages/credo-tsp-adapter/`,
  `app/src/demo-profiles/approver/{ApproverProfile,accessRequestSpec,
  ceremony}.ts`, `scripts/openvtc/{PINS.json,sync-external.mjs,README.md}`
- Sibling subtasks: [`pnm_cnm_subtask.md`](./pnm_cnm_subtask.md) §3.1–3.3, §7;
  [`vta-carriage_subtask.md`](./vta-carriage_subtask.md) (read in full) §1–§6,
  §11; [`trust_tasks_subtask.md`](./trust_tasks_subtask.md) (not yet
  cross-checked in this pass — see §9)
- [`keyring-on-the-vta-farm.md`](../keyring-on-the-vta-farm.md) §3.5 — current
  pin/tripwire state
