# OpenVTC interop harness

Every Keyring release candidate proves that Keyring works with upstream's
reference implementations, and not only with another copy of Keyring.

**Companions** (`openvtc-interop-harness-plan/`):
- [2026-09-24-d3.md](./openvtc-interop-harness-plan/2026-09-24-d3.md): why
  this plan exists, the two false greens that motivated it, and the options
  rejected along the way.
- [2026-09-24-cd.md](./openvtc-interop-harness-plan/2026-09-24-cd.md): why
  pnm calls are serialized per slug rather than isolated by `HOME`.

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

Both were found only when an openvtc vetter and the community's own records
were in the loop. This harness keeps them in the loop on every release
candidate. **Its assertions read the other party's state and the community's
records, never only Keyring's screen.**

Public sources only: upstream repositories, published specs, and the Farm's
public endpoints and admin API.

## 2. Scope: flows × roles

Each row runs in both directions where both roles exist. "Driver" says
whether upstream already drives the openvtc side headlessly (so our bot wraps
existing code) or whether we write new code.

| # | Flow | Keyring role | openvtc role | Upstream headless driver at openvtc `177a218` | New code |
|---|---|---|---|---|---|
| F1 | Vetting ceremony: ticket, request, session, card, statement | applicant | vetter | `openvtc-core/tests/vetting_e2e.rs` walks it over an in-process mediator; `vetter.rs` `open_session`, `receive_card` | Bot vetter: issue a ticket, print the ticket URI, open a session on request, verify the card, issue the statement. The TUI's `issue_ticket` lives in the TUI crate (`openvtc/src/state_handler/vetting_actions.rs`), so the bot calls openvtc-core directly |
| F2 | Vetting ceremony | vetter | applicant | `vetting_e2e.rs` (applicant half); `applicant.rs` | Bot applicant: take our ticket URI, request, compare the code, send its card, receive our statement |
| F3 | Statement acceptance | both | both | the applicant checks inside `applicant.rs` | Assert that each side accepts the other's statement by its own check, and that the community counts it at intake |
| F4 | Reopen or replace a session | both | both | `vetter.rs` `open_session` (*"Reopening replaces an earlier session, whose card will no longer be accepted"*) | A card on the replaced session is refused. Keyring shows the new code and nothing hangs |
| F5 | Refusal paths: expired card, card for a replaced session, ticket for another community, wrong audience | both | both | the refusal branches of `verify_card` (VTI `vta-sdk/src/vetting/card.rs`) | Stage each one and assert the refusal on the receiving side. Today openvtc refuses silently (VTI-Q24), so until that is answered the bot reads its own log and state |
| F6 | Join by invitation, and join status | applicant | none (the VTC is the party) | `openvtc-core/tests/join_lifecycle_e2e.rs` (in-process mediator) | Against the real Farm VTC: the outcome Keyring shows equals the community's record (`join-list`, `members`). This already runs through `run-vti-invite.js` `EXPECT_JOIN` |
| F7 | Leave (`members/self-remove`) | member | member | `openvtc-core/src/join.rs` sends `MEMBER_SELF_REMOVE` | Keyring leaves, and the community's member list agrees. The bot leaves the same way, as a cross-check that both clients produce the same record |

**Out of scope:** the openvtc TUI itself (see §3), and flows neither side
implements today, such as VRC exchange with openvtc. Those are added when
openvtc ships them, as new rows here.

## 3. Architecture

```
  e2e runner (Node) ──── Appium ────▶ Keyring on a sim / phone
        │
        ├── HTTP (localhost) ─────────▶ openvtc bot (Rust, on openvtc-core)
        │                                 persona on the Farm's openvtc runner agent
        │
        └── vtc-admin (read-only) ────▶ the community's admin API (truth)
```

- **A headless bot on openvtc-core, never the TUI.** Driving the TUI means a
  pseudo-terminal and keystrokes, which break on ratatui redraws, and a
  screen-scrape is exactly the kind of evidence §1 rejects. The bot links
  openvtc-core at the pin (§4) and uses the same `VettingBook`, `handle` and
  transport code the TUI uses. It is the TUI's engine without its face.
- **The bot is a small local HTTP service** on `127.0.0.1`, one port per run.
  Its endpoints are steps and reads:
  - steps: `POST /ticket`, `POST /session/{request}/open`,
    `POST /statement/{request}`, `POST /apply`, `POST /leave`;
  - reads: `GET /state` (its book: requests, sessions, cards received and
    refused, with the refusal reason), and a log stream.
  The runner calls a step, drives the phone, then polls the other side. A CLI
  would fork the process per step and lose the in-memory session state the
  vetting book holds between steps.
- **Lockstep.** The runner owns the sequence. Each step has one actor. The
  runner waits for the observable effect on the other side before moving on:
  a request appears in `GET /state`, a testID appears on the phone. It never
  sleeps to guess. A step that times out fails with both sides' state
  attached.
- **Where truth is read.** Every assertion comes from at least one of:
  - the bot's `GET /state`, which is what openvtc concluded;
  - the community's admin API (`members`, `join-list <status>`), read-only;
  - the Farm's public endpoints.

  The phone's screen is asserted too, but only against one of those. The
  comparison pattern is `e2e/lib/joinOutcome.js` (screen vs community vs
  expectation).
- **The cheap layer stays.** `scripts/openvtc/card-verify` (keyring-wallet#146)
  runs the VTI SDK's `verify_card` on a card the shipping `sendCard` produces:
  seconds, no simulator, no network. It is the first gate step and catches
  card-shape regressions before any device run starts.

## 4. Pinning

openvtc is added to `scripts/openvtc/PINS.json`, at `177a218` today, with the
same discipline as the VTI pin:

- It is advanced only through `sync-external.mjs --advance openvtc --why …`,
  as its own pin-only PR written against origin/main's `PINS.json`.
- The bot builds only from the pinned `external/openvtc`. Its build script
  refuses a clone that is off the pin or has local changes, as
  `check-keyring-card.sh` does for VTI.
- The openvtc pin and the VTI pin move together when openvtc's `vta-sdk`
  dependency moves. At `177a218`, openvtc builds against the published
  vta-sdk 0.42.1 and trust-tasks-rs 0.21.3, while our VTI pin is vta-sdk
  0.46.0. The bot records both versions in every result.

Every result states four heads: wallet, bifold, openvtc and VTI. A red run
at the same pins as the last green one is ours. A red run straight after a
pin advance is upstream's until shown otherwise.

## 5. Where and when it runs

| Layer | When | Blocks |
|---|---|---|
| card-verify (Phase 0) | Every release-candidate gate. Also on demand, since it takes seconds | the release |
| Bot flows F1–F7 (Phases 1–3) | Every release-candidate gate, before the TestFlight push | the release, for the flows marked required in §8 |
| Scheduled drift run (Phase 4) | Nightly against the Farm, at the current pins **and** at upstream `main`, on a host with no gate running | nothing; it reports |

**Not on every PR.** A bot run needs a Farm community, a runner agent and two
Keyring builds or a device. It costs minutes to tens of minutes and holds the
Farm test community's criteria and the compile slot, which one Mac shares
between sessions. PR CI stays unit-level. The interop defects in §1 came from
behaviour that unit tests on one side cannot see, and the release-candidate
gate is the last point before testers where that behaviour is checked.

## 6. Infrastructure

- **Farm runner agent for the bot:** `keyring-runner-openvtc`, a VTA Only on
  the Platform stack, with pnm slug `farm-runner-openvtc`. **Alberto creates
  it** in the Farm portal. It holds the bot's personas: one vetter and one
  applicant, minted by the bot through openvtc's own bootstrap.
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
- **Persona and grant setup.** The bot's vetter joins by invitation (the
  invitation-only community), or by vetting from a seeded vetter
  (`keyring-test-vtc`), and gets `vetter-grant` from the community admin.
  Setup is a script. Its state (persona DIDs, grant endorsement ids) is written
  to `artifacts/interop-setup.json`, and teardown reads it back to revoke and
  leave.
- **Machine rules.**
  - One heavy cargo build at a time on the Mac, announced first. The bot's
    build reuses `external/openvtc/target`, 3.8 GB at `177a218`.
  - The bot and card-verify get a disk budget: `target/` directories are
    capped at 20 GB in total, and a stale build is cleaned before a pin
    advance.
  - **One pnm call per runner at a time.** pnm keeps each runner's admin key
    in the login keychain, keyed by slug (`pnm-cli` / `vta:<slug>`), and never
    reads `PNM_HOME`. So every session on the Mac is the same admin DID for a
    given runner. The mediator keeps one socket per DID by design (VTI
    `vta-sdk/src/acl_setup.rs`, `a96fe02f`), so two concurrent calls on one
    slug drop one of them. Every harness pnm call goes through
    `scripts/openvtc/pnm-locked` (keyring-wallet#154), which serializes
    calls per slug across sessions; different slugs, such as the bot's
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

**Phase 1: an openvtc vetter against a Keyring applicant (F1, F3, F4).**
About 3–4 days. Needs `keyring-runner-openvtc`.
- Acceptance:
  - the bot builds from the pinned openvtc;
  - one command drives a full ceremony, with the bot as vetter and Keyring on
    a simulator as applicant, ending in the community's `join-list` showing
    the applicant approved and `members` listing it;
  - the bot's `GET /state` shows the card accepted;
  - a reopened session makes the old card refused in the bot's state, while
    Keyring shows the new code;
  - rerun on the pre-#108 bifold, the ceremony fails at the card with the
    bot's refusal reason attached.

**Phase 2: the reverse direction (F2, F3).** About 2–3 days.
- Acceptance:
  - with the bot as applicant and Keyring as vetter, the bot's state shows
    Keyring's statement accepted by its own check;
  - the community counts the statement at intake, and the bot is admitted.

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

1. **Create `keyring-runner-openvtc`** on the Farm (VTA Only, Platform
   stack), and confirm the pnm slug `farm-runner-openvtc`.
2. **The invitation-only test community.** **Recommended:** claim the admin
   of the existing, unused Farm Full Stack #22 `keyring-vetting` (VTC
   `keyring-vetting-vtc`) by passkey, and set its criteria to invitation only.
   Nothing new is created, and its stack VTA is already correct. The
   alternatives are a new Full Stack, or a second community on an existing
   stack.
3. **Which flows block a release from day one.** §8 proposes Phase 0, F1, F6
   and anything that is ours. The alternative is to start everything as
   advisory.
4. **Where the nightly drift run lives:** this Mac (it needs the compile slot
   and a simulator), or a CI runner with a macOS simulator. Upstream's
   openvtc-core tests run headless on Linux, but the Keyring side needs iOS or
   Android.
5. **Whether to offer the bot upstream** once it works, as a headless vetter
   and applicant for openvtc's own CI. Nothing in it is Keyring-specific.
