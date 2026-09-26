# Keyring's test resources on the VTA Farm

What Keyring's harness runs against on the VTA Farm, so that a run can name
what it used and nobody "fixes" a resource that is deliberately odd. **Public
identifiers only.** Admin keys live in `pnm` profiles and credential files on the
machine that runs the harness, never here.

Standing rule for vetting and VTI runs: test against the Farm's test community
with a runner VTA, not the local lab and not a shared community. The Farm moves
to new upstream versions almost daily, so **every Farm result states the
versions it hit** — `farm/farm-health.sh` reads them.

## Runner VTAs

Each harness has its own runner VTA, so two runs never share one agent's ACL.
All are VTA Only, Platform stack, on the Farm's shared mediator
(`firstperson-mediator`, `mediator.ic3.dev`).

| VTA | DID | `pnm` slug | Used by | DID host |
|---|---|---|---|---|
| `keyring-runner-prague` | `did:webvh:Qmf6vgGqjWAVn1RveovRfbndpFFo4kV1nMqsvYRgcXUKMM:dids.ic3.dev:keyring-runner-prague-vta` | `farm-runner-prague` | the Prague / VTI harness | `dids.ic3.dev` |
| `keyring-runner-uiux` | `did:webvh:QmVMwnx5JRyfCrX4h8QnVaA2s4XjBPF4wmBGgKf7CUPWBA:dids.ic3.dev:keyring-runner-uiux-vta` | `farm-runner-uiux` | the UI/UX harness | `dids.ic3.dev` |
| `keyring-runner` | `did:webvh:QmS4PpPKqSrSTUjinSf8Dv5SDay4FNrs7p2w4deJiUm5BV:dids.ic3.dev:keyring-runner-vta` | `farm-runner` | spare; the first runner (2026-09-22) | `dids.ic3.dev` |
| `keyring-runner-openvtc` | `did:webvh:QmQFFkXYBzo5d6imJwGNpE2jGMgcjA1DC6fMBwqGcPzuWs:dids.ic3.dev:keyring-runner-openvtc-vta` | `farm-runner-openvtc` | the openvtc TUI in the interop harness (created by Alberto, 2026-09-25) | `dids.ic3.dev` |
| `keyring-runner-nohost` | `did:webvh:QmNaKHRQZpe1NJ3SoBaTML6mgZX2woXyuCGwAruk3vKNu8:dids.ic3.dev:keyring-runner-nohost-vta` | `farm-runner-nohost` | the "agent with no DID host" check | **none, on purpose** |

**`keyring-runner-nohost` has no DID host by design.** Its `control` server was
removed after creation (`pnm --vta farm-runner-nohost did-mgmt servers delete
control`), so a persona minted through it has nowhere to be published. It is
the live target for keyring-bifold#79: linking to it works, and joining a
community must stop with *"Your agent has nowhere to publish a new identity"*.
Do not re-add a server to it; use a different runner for ordinary runs.

Each runner is set up with `pnm setup --name <slug>` (which mints the admin
`did:key` pasted at the Farm wizard's *Admin DID* step), then, once the portal
shows *Running*, `pnm setup continue <slug> --vta-did <did>`. The ACL's admin is
then a long-lived key created by the pasted one, which is expected. A runner's
harness environment is `RUNNER_VTA`, `RUNNER_VTA_DID` and `PNM_HOME`.

**One pnm call per runner at a time, machine-wide.** pnm keeps a runner's admin
key in the login keychain (service `pnm-cli`, account `vta:<slug>`), and its
profile list in `~/Library/Application Support/pnm/config.toml`. It never reads
`PNM_HOME`, which isolates nothing and is only a label our scripts still pass.
Every session on this Mac therefore uses the same admin DID for a slug. The
mediator keeps one socket per DID by design (VTI `vta-sdk/src/acl_setup.rs`,
"a second is evicted as `duplicate-channel`"), so two concurrent calls on one
slug drop one of them: *replaced by a newer connection*, or *this DID already
has a live connection* on a mediator with the duel damper. Different slugs
never interfere. Call pnm on a runner through `scripts/openvtc/pnm-locked --vta
<slug> …`, which takes that slug's lock first (`e2e/lib/aclCleanup.js` and
`farm/farm-health.sh` do). A per-runner `HOME` would not help, because the
keychain entry does not move with it.

Runs remove the ACL entries they create (`e2e/lib/aclCleanup.js`); a failed run
keeps them as evidence and prints the commands to remove them.

## Communities

| VTC | DID | REST | Admission | Mediator |
|---|---|---|---|---|
| `keyring-test-vtc` (published name *Keyring Lab Community*) | `did:webvh:QmdervYcngPtJnKGuZSzH2tvDe8q274cty8324G4finFnV:dids-keyring-stack.ic3.dev:keyring-test-vtc` | `https://vtc-keyring-test.ic3.dev/v1` | **one vetter's statement** (it also publishes an invitation criterion, which does not admit on its own — see below) | its stack's own (`keyring-stack-mediator`), so a runner reaches it **across mediators** |

**An invitation does not admit to `keyring-test-vtc`.** It publishes two
criteria, `invited-member` and `vetted-member`. On VTI a community that
publishes any vetting criterion requires vetting of every applicant: the
default join policy says an invitation does not bypass it, and the criterion
is picked from the vetting criteria alone. So an invitation join lands
**deferred**, needing `vetting:statements:1`. The admin API's `decide` also
refuses a deferred request (`409 notPending`), so an admin cannot admit it
either. See VTI-Q25 in `docs/VTI_UPSTREAM_FINDINGS.md`.

Earlier results that said otherwise came from the runners changing the
criteria to invitation-only while they ran, until 2026-09-23 (#127). Invitation
joins from 23:14Z that day onwards, the 219 gate's included, were deferred
while the app said "You're a member". That was an app bug, and the harness
trusted the screen. `run-vti-invite.js` now checks the community's own answer
(`EXPECT_JOIN`); on this community an invitation join is
`EXPECT_JOIN=deferred`.

Criteria are fixed (`E2E_CRITERIA` unset). A run that genuinely needs other
criteria opens an announced window: it holds `criteria.lock`, snapshots the
criteria first, and restores them from the snapshot, checking the manifest
reads back the same digests. Two runs never change one community's criteria at
once.

## Versions measured

Read by `farm/farm-health.sh` from each service's own endpoints; no service
exposes a commit.

| Component | Version | Read on |
|---|---|---|
| Runner VTAs (all four) | VTA 0.42.0 (after the Farm's announced upgrade) | 2026-09-25 |
| `keyring-test-vtc` | VTC 0.11.58 | 2026-09-25 |
| Shared mediator (`firstperson-mediator`) | 0.29.4 | 2026-09-25 |
| `keyring-stack-mediator` | 0.28.36 | 2026-09-23 |
| `dids.ic3.dev`, `dids-keyring-stack.ic3.dev` | did-hosting-control 0.8.8 | 2026-09-23 |

## Health check

```sh
scripts/openvtc/farm/farm-health.sh
```

Read-only; changes nothing. For each runner VTA it runs `pnm … health` and
checks whether a DID host is registered (and that `farm-runner-nohost` has
none). For each community it reads `/health`, asks for the join manifest over
REST, and — from vti #1698 on — fetches `/v1/community/did-qr.svg` and checks
that it decodes to exactly the community's DID (with `farm/qr.swift`, which uses
macOS's Vision framework; nothing to install). Run it before reading anything
into a red Farm run.

## The openvtc TUI fixture (interop harness)

The openvtc interop harness drives the real openvtc TUI
(`docs/plans/openvtc-interop-harness-plan.md`). Its vetter is a persistent
fixture, set up once through the TUI's own wizard, as a maintainer's install
would be. Gates reuse it and do not rerun the wizard. The wizard itself is
covered by one from-scratch setup per openvtc version bump
(`e2e/openvtc/setup-fixture.mjs`, which refuses to overwrite an existing
fixture).

The fixture lives on `keyring-runner-openvtc`. It was on
`keyring-runner-prague` for the first hour (06:03–06:15Z, 2026-09-25), before
this runner existed, and was removed from there completely: the persona DID
`…:pattern-useful`, the contexts `openvtc` and `openvtc/keyring-harness-vetter`,
and the ACL entry. An invitation issued to `…:pattern-useful` stays unused on
`keyring-test-vtc` until it expires on 2026-10-25.

**What exists** (set up 2026-09-25 06:16Z, openvtc `ed13d29`):

- **On `farm-runner-openvtc`:**
  - the trust context `openvtc` (`OpenVTC`), and the persona's context
    `openvtc/keyring-harness-vetter`;
  - one ACL entry, role `admin`, label `openvtc`: the TUI's long-lived key,
    which the wizard rotated to from its one-hour setup key, with
    `persona-holder`;
  - the TUI's persona, *Keyring Harness Vetter*, minted by the TUI at 06:18Z:
    `did:webvh:QmebJi2vMYhdevi3y2hLRD8yEyEcXu7MHRG5RAYn6z8v5T:dids.ic3.dev:diagram-process`.
    An invitation for it to `keyring-test-vtc` was issued at 06:18Z (valid until
    2026-10-25). Its join did not reach the community: openvtc sends a join over
    TSP whenever the community advertises `#tsp`, and a TSP message from this
    runner's mediator to `keyring-stack-mediator` is not relayed (VTI-41).
- **On this Mac:**
  - `~/vti-stack/openvtc-harness/config-harness-vetter-ed13d29.json` (600),
    `unlock-code` (600), `vic-diagram-process.json` (600), the debug log and
    step logs; `retired-prague-0925/` keeps the first hour's logs;
  - a login Keychain item: service `openvtc`, account `harness-vetter-ed13d29`.

**Per gate**, the harness removes what the gate created: the persona's
membership in `keyring-test-vtc` (leave with purge), its vetter grant (revoke),
and any applicant ACL entries on the runners.

**Removing the whole fixture:**

```sh
L=scripts/openvtc/pnm-locked
$L --vta farm-runner-openvtc did-mgmt dids delete did:webvh:QmebJi2vMYhdevi3y2hLRD8yEyEcXu7MHRG5RAYn6z8v5T:dids.ic3.dev:diagram-process
$L --vta farm-runner-openvtc contexts delete -y openvtc/keyring-harness-vetter
$L --vta farm-runner-openvtc contexts delete -y openvtc    # also removes the openvtc ACL entry
security delete-generic-password -s openvtc -a harness-vetter-ed13d29
rm -rf ~/vti-stack/openvtc-harness
```

This is the order that worked on prague: `contexts delete openvtc` removes the
TUI's ACL entry with it, so a separate `acl delete` afterwards finds nothing.

## The openvtc TUI fixture on the local lab

Phase 1 runs on the local lab until the Farm relays TSP between its mediators
(VTI-Q26): the lab's services share one mediator. This fixture is separate from
the Farm one and does not replace it. It lives on the lab's runner agent `bob`,
never on `alice`.

**The lab's versions** (measured 2026-09-25 08:19Z, after the upgrade to what
the Farm runs; pins in `PINS.json`):

| Service | Version | Built from |
|---|---|---|
| VTAs `alice`, `community`, `bob` | vta-service 0.42.0 | `verifiable-trust-infrastructure` `ed672fff` (tag `vta-service-v0.42.0`) |
| VTC `keyring-vti-vtc` | vtc-service 0.11.58 | the same commit |
| mediator | affinidi-messaging-mediator 0.29.4 | `affinidi-tdk-rs` `ea5af502` (tag `affinidi-messaging-mediator-v0.29.4`) |
| DID host | unchanged | `affinidi-webvh-service`, as before |
| pnm (lab admin tool) | 0.19.0, kept | a rebuilt pnm is a new binary to the Keychain and waits on an "allow access" dialog per key; see below |

Until 07:58Z the lab ran VTI `a96fe02f` (VTA 0.37.0, VTC 0.11.58) and mediator
0.28.11. The upgrade kept every store (the mediator reported its redis schema
up to date; no service logged an error), and `stack-health.sh` was green
before and after. A rollback kit (the previous binaries, both store archives,
redis snapshots) is in `~/vti-stack/rollback-2026-09-25/`. **pnm:** the lab
keeps the pnm it had, because the rebuilt pnm 0.23.1's first read of each
admin key raised a Keychain dialog that every pnm call then queued behind.
Replace a binary by writing a new file and renaming it; copying over a
running one leaves its processes unkillable.

**The lab's tunnels are a flake source.** Every lab service is reached
through its reserved ngrok domain, from this Mac as much as from a phone, and
those tunnels drop requests now and then. On 2026-09-25 they made a TUI's
listener miss its login budget (08:47Z: TLS "peer closed connection" and
failed requests to four of the six hosts for about four seconds), and are the
likely cause of an iPhone's websocket connect that never reached the mediator
(08:36Z). So a lab failure at a network step (a login, a socket, a first
Trust Task) gets **one rerun before it counts**, and the report says so. A
failure that repeats is a finding. The harness also refuses to run with a TUI
whose persona listener did not come up (`e2e/openvtc/tuiListeners.js`).

**One rate-limit bucket for the whole lab.** The lab community's
unauthenticated limiter (auth, token refresh, the unauthenticated Trust Task
door such as the manifest read) allows a burst of 10, then one request every
5 s, per source address. That's hard-coded at VTI `ed672fff`
(`vtc-service/src/routes/mod.rs:1283-1285`), with no setting to raise it.
Every lab client leaves from this Mac, and `vtc-admin`'s localhost calls share
the same bucket, so two joins or two harness runs in the same minute can get
a `429` (`limiter: unauth`, with `Retry-After`). Run one at a time.

**What exists** (2026-09-25, openvtc `ed13d29`; created on the lab at VTI
`a96fe02f` and carried through the upgrade):

- **On `bob`:** the contexts `openvtc` and `openvtc/keyring-harness-vetter`,
  the TUI's admin key (label `openvtc`), and two personas:
  - `did:webvh:Qmb97Mk6YoB95cLBxeX2zJ8LoKQh6ypipgMpKJB6DeuPW1:keyring-vti-dids.ngrok.app:hope-recycle`
    ("Harness Vetter Two"), **the vetter the runs use**;
  - `did:webvh:Qma92JAy69UxYmcc7dwDhX1Gpk3mFaSfWTrJXFrmYKrNqS:keyring-vti-dids.ngrok.app:draft-ugly`
    ("Keyring Harness Vetter"), **unusable**: see below.
- **In the lab community `keyring-vti-vtc`:** `hope-recycle` is a member,
  joined by invitation during an announced criteria window
  (06:53:03–06:53:58Z, restore verified), and holds a vetter grant
  (endorsement `32af63c7-53c6-42a1-891f-ee49f696e104`, until 2027-03-24).
  The TUI stored its membership at 06:53:52Z (`join.membershipStored`).
- **Residue:** `draft-ugly` is a member at the community (joined 06:37Z),
  but its TUI record is stuck `Pending`: the fixture script closed the TUI
  five seconds after the community's credentials arrived, before openvtc
  stored them. Nothing recovers that at VTI `a96fe02f`: there is no
  member-credential resend, and the id-less status poll finds only open
  requests (`vtc-service/src/routes/join_requests/status.rs:111-126`). Its
  grant `f4598780-631d-41ac-a672-6580105c288b` was revoked at 06:56:31Z.
  `e2e/openvtc/join-fixture.mjs` now waits for the stored membership.
  A deferred join request `cfea2409-66b3-4ef3-9e1a-cbe3e491849e` (persona
  `divide-leaf`, 09:22Z) stays open: the phone that made it was reinstalled, so
  nobody holds the persona to withdraw it, and an admin cannot decide a
  Deferred request (VTI-Q25). The phone had shown "Your agent didn't answer"
  for that submit (keyring-bifold deadline sweep, 2026-09-25).
  Tickets `39TA-2HT0` and `6DBZ-4P55` are live and unused (1 use each, until
  2026-10-09), left by runs that failed on the harness's side.
- **On this Mac:** `~/vti-stack/openvtc-harness-lab/` (profile
  `harness-vetter-lab`: config, `unlock-code`, `vic-draft-ugly.json` and
  `vic-hope-recycle.json` at 600, logs, runs) and a login Keychain item,
  service `openvtc`, account `harness-vetter-lab`.

The lab window script (`scratchpad lab-window.sh`, adapted from the Farm one)
restores `vetted-member` from `~/vti-stack/criterion.json` and checks the digest
`zQmXe6M8…Udw`.

**Removing it:** revoke the grant (`vtc-admin … revoke-endorsement
32af63c7-53c6-42a1-891f-ee49f696e104`), delete the two tickets in the TUI
(Tickets view, `d`), have both personas leave the community (`draft-ugly`
cannot leave from the TUI, which holds it as Pending, so an admin removes it),
then on `bob`: `dids delete` both personas, `contexts delete -y
openvtc/keyring-harness-vetter`, `contexts delete -y openvtc`; on the Mac,
`security delete-generic-password -s openvtc -a harness-vetter-lab` and remove
the directory.
