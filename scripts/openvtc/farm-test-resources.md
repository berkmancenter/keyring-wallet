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
| Runner VTAs (all four) | VTA 0.39.0 | 2026-09-23 |
| `keyring-test-vtc` | VTC 0.11.58 | 2026-09-23 |
| Shared mediator and `keyring-stack-mediator` | 0.28.36 | 2026-09-23 |
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
