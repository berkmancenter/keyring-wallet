# OpenVTC interop harness

Every Keyring release candidate proves that Keyring works with upstream's
reference implementations, and not only with another copy of Keyring.

**Companions** (`openvtc-interop-harness-plan/`):
- [2026-09-24-d3.md](./openvtc-interop-harness-plan/2026-09-24-d3.md): why
  this plan exists, the two false greens that motivated it, and the options
  rejected along the way.
- [2026-09-24-cd.md](./openvtc-interop-harness-plan/2026-09-24-cd.md): why
  pnm calls are serialized per slug rather than isolated by `HOME`.
- [2026-09-25-cd.md](./openvtc-interop-harness-plan/2026-09-25-cd.md):
  Alberto's go; the real TUI instead of a bot; conformance vectors in every PR;
  what the release waits for; the third self-agreeing defect.

**Related:** [openvtc-integration-plan.md](./openvtc-integration-plan.md)
(what Keyring implements), [release-flow-plan.md](./release-flow-plan.md)
(where the release-candidate gate sits),
[keyring-on-the-vta-farm.md](./keyring-on-the-vta-farm.md) (the Farm
resources used here). Findings are filed in
[`docs/VTI_UPSTREAM_FINDINGS.md`](../VTI_UPSTREAM_FINDINGS.md).

## 1. Goal

A Keyring harness that only ever meets Keyring proves that Keyring agrees
with itself. It cannot catch a Keyring defect that Keyring makes on both
sides. On 2026-09-24 two such defects shipped to testers:

- **The Vetting Card's identity commitment.** Keyring's card hashed a member
  the spec leaves out. Keyring's vetters never recompute it, so every Keyring
  run passed. An openvtc vetter recomputes it with the VTI SDK and refused
  every card (keyring-bifold#108).
- **"You're a member" on a deferred join.** Keyring showed membership for any
  answer that was not an error. The harness read the screen, so runs passed
  while the community had admitted no one (keyring-wallet#148).

A third followed on 2026-09-25: **the card digest in a vetting statement.**
Keyring hashed the card with its proof on both sides, while the spec and the
VTI SDK hash it without. Keyring↔Keyring passed, and every openvtc vetter's
statement was dropped by a Keyring applicant without a word
(keyring-bifold#116).

Both were found only when an openvtc vetter and the community's own records
were in the loop. This harness keeps them in the loop on every release
candidate. **Its assertions read the other party's state and the community's
records, never only Keyring's screen.**

Public sources only: upstream repositories, published specs, and the Farm's
public endpoints and admin API.

## 2. Scope: flows × roles

Each row runs in both directions where both roles exist. The upstream driver
column names the openvtc code that already walks each flow headlessly: the
fallback for a step the TUI cannot take (§3), and the reference for what
openvtc concludes.

| # | Flow | Keyring role | openvtc role | Upstream headless driver at openvtc `177a218` | New code |
|---|---|---|---|---|---|
| F1 | Vetting ceremony: ticket, request, session, card, statement | applicant | vetter | `openvtc-core/tests/vetting_e2e.rs` walks it over an in-process mediator; `vetter.rs` `open_session`, `receive_card` | TUI as vetter: issue a ticket (its `vetting-ticket:` link, openvtc-core `vetting/tickets.rs`), accept the request, open a session, verify the card, attest (`openvtc/src/state_handler/vetting_actions.rs`) |
| F2 | Vetting ceremony | vetter | applicant | `vetting_e2e.rs` (applicant half); `applicant.rs` | TUI as applicant: paste our ticket, request, compare the code, send its card, receive our statement |
| F3 | Statement acceptance | both | both | the applicant checks inside `applicant.rs` | Assert that each side accepts the other's statement by its own check, and that the community counts it at intake |
| F4 | Reopen or replace a session | both | both | `vetter.rs` `open_session` (*"Reopening replaces an earlier session, whose card will no longer be accepted"*) | A card on the replaced session is refused. Keyring shows the new code and nothing hangs |
| F5 | Refusal paths: expired card, card for a replaced session, ticket for another community, wrong audience | both | both | the refusal branches of `verify_card` (VTI `vta-sdk/src/vetting/card.rs`) | Stage each one and assert the refusal on the receiving side. Today openvtc refuses silently (VTI-Q24), so until that is answered the runner reads openvtc's log and state |
| F6 | Join by invitation, and join status | applicant | none (the VTC is the party) | `openvtc-core/tests/join_lifecycle_e2e.rs` (in-process mediator) | Against the real Farm VTC: the outcome Keyring shows equals the community's record (`join-list`, `members`). This already runs through `run-vti-invite.js` `EXPECT_JOIN` |
| F7 | Leave (`members/self-remove`) | member | member | `openvtc-core/src/join.rs` sends `MEMBER_SELF_REMOVE` | Keyring leaves, and the community's member list agrees. The TUI leaves the same way, as a cross-check that both clients produce the same record |

openvtc's side of every row is the openvtc TUI, driven as a maintainer drives
it (§3). **Out of scope:** flows neither side implements today, such as VRC
exchange with openvtc. Those are added when openvtc ships them, as new rows
here.

## 3. Architecture

```
  conformance vectors (PR CI) ── upstream Rust ⇄ Keyring TS, both directions

  e2e runner (Node) ──── Appium ────▶ Keyring on a sim / phone   (e4's drivers)
        │
        ├── PTY ──────────────────────▶ openvtc TUI binary (ed13d29 and 177a218)
        │                                 persona on a Farm runner agent
        │
        └── vtc-admin (read-only) ────▶ the community's admin API (truth)
```

- **Conformance vectors first, in every PR.** Every value Keyring exchanges
  with VTI that is hashed, canonicalised, committed or signed has two tests:
  upstream's own function, at the pin, run on Keyring's output; and Keyring's
  function run on an upstream-produced fixture. Each cites the upstream
  file:line it mirrors. `scripts/openvtc/card-verify` is the upstream side: a
  small cargo binary on the pinned vta-sdk and dtg-credentials
  (keyring-wallet#146, #162). The inventory: the card's identity commitment,
  the card digest, card and statement proofs, the statement's bindings, task
  and envelope digests, JCS inputs and multibase encodings.
- **The real openvtc TUI, driven over a pseudo-terminal.** Each step a
  maintainer takes is taken in the TUI binary: the runner reads the screen
  through a vt100 buffer and sends keys. Assertions on the screen use the TUI's
  own strings, cited by file:line. A step that genuinely cannot be driven
  through the TUI falls back to openvtc-core, and every fallback is named in
  the run report. The TUI runs at two versions: the openvtc pin, and the
  upstream `main` that maintainers run.
- **Lockstep.** The runner owns the sequence. Each step has one actor. The
  runner waits for the observable effect on the other side before moving on:
  a TUI screen line, a testID on the phone. It never sleeps to guess. A step
  that times out fails with both sides' state attached.
- **One step log per run.** Both sides append JSONL records: `role`, `step`,
  `ok`, times, `observed`. The TUI side adds `observed.tuiState` (the screen
  line), `observed.tuiSource` (its file:line) and `observed.openvtcVersion`.
  Keyring's side adds `observed.stepId` (the step testID).
- **Where truth is read.** Every assertion comes from at least one of:
  - openvtc's own conclusion: its log and its persisted state, not only its
    screen, because openvtc refuses some things silently (VTI-Q24);
  - the community's admin API (`members`, `join-list <status>`), read-only;
  - the Farm's public endpoints.

  The phone's screen is asserted too, but only against one of those. The
  comparison pattern is `e2e/lib/joinOutcome.js` (screen vs community vs
  expectation).

## 4. Pinning

openvtc is added to `scripts/openvtc/PINS.json`, at `177a218` today, with the
same discipline as the VTI pin. The TUI also runs at upstream `main` (`ed13d29`
on 2026-09-25), the version maintainers run, and both results are reported:

- It is advanced only through `sync-external.mjs --advance openvtc --why …`,
  as its own pin-only PR written against origin/main's `PINS.json`.
- The TUI at the pin builds only from the pinned `external/openvtc`. The
  build script refuses a clone that is off the pin or has local changes, as
  `check-keyring-card.sh` does for VTI. The `main` build is a separate
  checkout, and its commit is recorded.
- The openvtc pin and the VTI pin move together when openvtc's `vta-sdk`
  dependency moves. At `177a218`, openvtc builds against the published
  vta-sdk 0.42.1 and trust-tasks-rs 0.21.3, while our VTI pin is vta-sdk
  0.46.0. Every result records both versions.

Every result states four heads: wallet, bifold, openvtc and VTI. A red run
at the same pins as the last green one is ours. A red run straight after a
pin advance is upstream's until shown otherwise.

## 5. Where and when it runs

| Layer | When | Blocks |
|---|---|---|
| Conformance vectors (Phase 0-bis) | Every PR that touches vetting, Trust Tasks or anything exchanged with VTI | the PR |
| card-verify both directions (Phase 0) | Every release-candidate gate | the release |
| TUI flows F1–F3 (Phases 1–2) | Every release-candidate gate: iOS and Android, at both openvtc versions | the release |
| TUI flows F4–F7 (Phase 3) | Every release-candidate gate | the release, once each has been green twice; advisory until then |
| Scheduled drift run (Phase 4) | Nightly against the Farm, at the current pins **and** at upstream `main`, on a host with no gate running | nothing; it reports |

**End-to-end flows are not run on every PR.** A TUI run needs a Farm
community, a runner agent and a Keyring build on a device or simulator. It
costs minutes to tens of minutes and holds the Farm test community's criteria
and the compile slot, which one Mac shares between sessions. The conformance
vectors are what run on every PR: they are cheap, and each of §1's defects
was a value one of them checks.

## 6. Infrastructure

- **Farm runner agents for the TUI.** The TUI as vetter uses
  `keyring-runner-prague` (`farm-runner-prague`) until a dedicated runner
  exists. Its key sits on that agent's ACL for the run, and is removed at
  cleanup. The TUI as applicant (Phase 2) needs a second agent with a DID host,
  to mint its persona: `keyring-runner-openvtc` (`farm-runner-openvtc`), which
  **Alberto creates** in the Farm portal.
- **Communities.** Two are needed, because of how VTI treats criteria
  (VTI-Q25): a community that publishes any vetting criterion requires vetting
  of everyone, and an admin cannot admit a deferred request.
  - `keyring-test-vtc`, as it is (invitation + vetting criteria): vetting
    flows F1–F5, and F6 with `EXPECT_JOIN=deferred`.
  - **An invitation-only test community:** F6 with `EXPECT_JOIN=member`, F7,
    and seeding a vetter by invitation without touching `keyring-test-vtc`'s
    criteria. Recommended: `keyring-vetting-vtc`, on the existing and unused
    Farm Full Stack #22 (`keyring-vetting`), once its admin is claimed and its
    criteria are set to invitation only (decision 2).

  Until the invitation-only community exists, seeding a vetter uses the
  announced criteria window: snapshot, flip, join, restore, read back.
- **Persona and grant setup.** The TUI's vetter joins by invitation (the
  invitation-only community), or by vetting from a seeded vetter
  (`keyring-test-vtc`), and gets `vetter-grant` from the community admin.
  Setup is a script. Its state (persona DIDs, grant endorsement ids) is written
  to `artifacts/interop-setup.json`, and teardown reads it back to revoke and
  leave.
- **Machine rules.**
  - One heavy cargo build at a time on the Mac, announced first. The TUI
    at the pin reuses `external/openvtc/target`, 3.8 GB at `177a218`; the
    `main` build has its own, cleared when superseded.
  - The TUI builds and card-verify get a disk budget: `target/` directories are
    capped at 20 GB in total, and a stale build is cleaned before a pin
    advance.
  - **One pnm call per runner at a time.** pnm keeps each runner's admin key
    in the login keychain, keyed by slug (`pnm-cli` / `vta:<slug>`), and never
    reads `PNM_HOME`. So every session on the Mac is the same admin DID for a
    given runner. The mediator keeps one socket per DID by design (VTI
    `vta-sdk/src/acl_setup.rs`, `a96fe02f`), so two concurrent calls on one
    slug drop one of them. Every harness pnm call goes through
    `scripts/openvtc/pnm-locked` (keyring-wallet#154), which serializes
    calls per slug across sessions; different slugs, such as the TUI's
    `farm-runner-openvtc` and a gate's runner, run in parallel. Nothing is
    asked upstream: the one-socket rule is deliberate.

## 7. Phases

Estimates are working days for one agent session, excluding waits on Farm
resources.

**Phase 0: card-verify in the gate.** *Done in code; lands with the 220
release PR.*
- Acceptance:
  - `scripts/openvtc/card-verify/check-keyring-card.sh` runs in the
    release-candidate gate and reports its `OK` line;
  - a card from the pre-#108 commitment code is refused (measured
    2026-09-24);
  - the script refuses an off-pin VTI clone.

**Phase 0-bis: conformance vectors in PR CI.** About 1 day.
- Acceptance:
  - each value in §3's inventory has both tests, citing upstream file:line;
  - they run on every PR that touches vetting, Trust Tasks or anything
    exchanged with VTI;
  - the card-digest vector fails on bifold `eaa563d3` (before #116), and the
    commitment vector fails on the pre-#108 code.

**Phase 1: the openvtc TUI as vetter against a Keyring applicant (F1, F3,
F4).** About 2–2.5 days.
- Acceptance:
  - one command drives the ceremony with every step asserted on both sides
    and at the community: a ticket is issued in the TUI → Keyring pastes or
    deep-links it → the request reaches the TUI → a session opens → the same
    match code on both → the card is sent → the TUI shows it verified → the
    TUI attests → Keyring receives AND accepts the statement → Keyring applies
    → the community's own list shows the member;
  - it runs at both openvtc versions, on iOS and on Android;
  - it fails at "statement accepted" on bifold `eaa563d3` and passes with #116;
  - a reopened session makes the old card refused in openvtc's state, while
    Keyring shows the new code.

**Phase 2: Keyring as vetter against the openvtc TUI as applicant (F2,
F3).** About 1.5 days. Needs `keyring-runner-openvtc`.
- Acceptance:
  - the TUI pastes Keyring's ticket → request → session → the same match code
    → the TUI sends its card → Keyring attests → the TUI shows the statement
    received and accepted by its own check → the TUI applies → the community
    lists it as a member;
  - it runs at both openvtc versions, with Keyring on iOS and on Android.

**Phase 3: join, status, Leave and refusals (F5, F6, F7).** About 3 days.
Needs the invitation-only community.
- Acceptance:
  - F6 passes with `EXPECT_JOIN=member` on the invitation-only community and
    `EXPECT_JOIN=deferred` on `keyring-test-vtc`;
  - after Keyring leaves, the community has no member record, and a rejoin
    mints a fresh persona;
  - each F5 refusal is staged and asserted from the receiving side's state.

**Phase 4: scheduled drift run.** About 1–2 days.
- Acceptance:
  - a nightly job runs Phases 0–3 at the current pins and at upstream `main`
    for openvtc and VTI;
  - a failure at `main` but not at the pins opens a triage note (§8) naming
    the first differing upstream commit range;
  - results carry all four heads.

## 8. Failure triage

Every red run is classified before anyone fixes anything:

- **Ours:** a Keyring defect, whichever side exposed it. Fixed in Keyring.
  Both of §1's cases were ours.
- **Upstream defect:** filed as `VTI-NN` in the findings doc, with the
  reproducing run and the source reference.
- **Upstream question or design gap:** filed as `VTI-QN`. VTI-Q24 (silent card
  refusal) and VTI-Q25 (invitation OR vetting) are examples.
- **Environment:** the Farm, a mediator, the Mac. Recorded with the
  farm-health reading, and rerun.

What blocks a release:
- Phase 0;
- F1 (openvtc vetter → Keyring applicant);
- F6 (join outcome agrees with the community);
- any failure classified as ours.

Everything else is advisory until it has been green three release candidates
in a row, and is then promoted to blocking by editing this list. A failure
that is upstream's does not block a release: it is filed, and the release
notes say what testers will meet.

## 9. Open decisions for Alberto

Decided on 2026-09-25: build the harness, covering every step, against the
real TUI; the release waits for Phase 0-bis and Phases 1–2 on both platforms
and both openvtc versions; F4–F7 gate once green twice.

1. **Create `keyring-runner-openvtc`** on the Farm (VTA Only, Platform
   stack), and confirm the pnm slug `farm-runner-openvtc`. Phase 2 needs it.
2. **The invitation-only test community.** **Recommended:** claim the admin
   of the existing, unused Farm Full Stack #22 `keyring-vetting` (VTC
   `keyring-vetting-vtc`) by passkey, and set its criteria to invitation only.
   Until then, `keyring-test-vtc` is used with announced criteria windows.
3. **Where the nightly drift run lives:** this Mac (it needs the compile slot
   and a simulator), or a CI runner with a macOS simulator.
4. **Whether to offer the TUI driver upstream** once it works, for openvtc's
   own CI. Nothing in it is Keyring-specific.
