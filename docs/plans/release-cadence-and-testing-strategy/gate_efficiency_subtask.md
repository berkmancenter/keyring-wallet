# Gate efficiency and test strategy

Subtask of `../release-cadence-and-testing-strategy.md` (a local export; see
`2026-10-08-al.md` for how it was produced). Companions: `2026-10-14-al.md`
holds the measurements, the coverage map and the sources this plan rests on;
`ota_updates_subtask.md` owns the OTA rings this plan uses as a trial channel.
The project lead approved the design on 14 October 2026 (the decisions are
in `2026-10-14-al.md` §5); each phase below names what it still waits on.

## What the gate is for

Five things people use Keyring for today stay end to end, on a device, on
every release, whatever else moves down the pyramid:

1. Keyring-to-Keyring vetting (a Keyring applicant vetted by a Keyring vetter).
2. Joining a community (plain join with admin review, and join by vetting).
3. Connecting an agent on the VTA Farm (one-scan setup, and linking).
4. The mediator carrying messages between the phone and its agent.
5. Website sign-in with a community.

Everything else is judged by cost: a device row exists only where the check
crosses a boundary a Jest test cannot (DIDComm to a live agent, an OS
permission or notification, background and foreground, an install over an
older build, the Keystore, a second device). A row that asserts words or the
presence of an element after a local interaction is a component test.

## Where the time goes today

Measured on the 248 gate (run `1014-1857-e3c24358-gate`, 14 October 2026;
the full tables are in `2026-10-14-al.md`):

- 16 legs, 3 h 42 m wall-clock, 4 h 06 m summed over legs. Only 24 minutes
  were saved by running legs side by side; after the first three legs every
  Android leg runs alone on one emulator, because one Farm identity can hold
  one live mediator connection at a time.
- 27 onboard-and-link flows, each 3 to 5 minutes: between 80 and 110 minutes
  of the summed time. 19 of them are the subject of their row (the link
  itself, a resume, a refusal, an update over a linked app); 8 are setup for
  rows about something else.
- `linkwait` is 45 minutes, of which 35 are scripted waiting on the app's real
  clocks (a 15-minute background pause, a 10-minute "didn't answer" window, a
  7-minute no-lock wait). `linkfail` is 29 minutes: five fresh installs, each
  with a 3-minute hold on the agent's side.
- Two legs, `update-android` and `relaunch-android`, run the same 15-minute
  setup (link, approved join, second agent, PIN) before their own rows.
- Across the week of 8 to 14 October the Mac spent 15.9 hours in first runs
  and 16.3 hours in reruns of every name (an aborted overnight run of 17.4
  hours is excluded from both). The reruns were caused by the environment
  (Farm link failures, a DIDComm outage, a travel network, swap over 8 GB, the
  Mac asleep), by the harness (a wrapper that returned 127, locators, two
  cleanups that hung for an hour) and by one TUI-side timing (six reds and two
  greens of `p1-tui-vets` on the same pins). One application row failed on
  every run: `pnmlink`'s `link-again-rescan`, which waited 180 s for a
  removal the app only detects on its 5-minute presence tick. That is slow
  behaviour the row exposed, not a broken feature: #454 raised the row's
  wait, and detecting the removal sooner is queued for 242
  (REMOVAL-DETECT-LAG).
- `gate.sh changed`, the per-fix check, has no run record in the week. Fixes
  were checked by re-running whole legs as partial gates (23 such runs).

## Design

### 1. Rows grow, legs do not

Every tester fix still adds a row (the project lead's rule). Its home follows
the boundary test above: the default home is a Jest test in bifold or the
app; a device row only when the check crosses a boundary, and then it joins
an existing leg's phone rather than a new leg. A new leg needs a new boundary
(a second build, a rooted emulator, a second device, a shared-runner rule).

A coverage manifest, generated from the legs (`rows × flows`, the table in
`2026-10-14-al.md` §2 kept current by a script), is the record of what the
gate proves. A pull request that removes a row, or adds a leg, changes the
manifest in the same diff.

### 2. Legs to merge, legs to keep

| Change | Why | What it saves | What changes in what is proven |
|---|---|---|---|
| `linkresume` joins `linkwait` as more `LINK_CASES` | Same script shape, split only by duration and slot | One boot and one slot; 1 min | Nothing |
| `relaunch-android` joins `update-android`: link the previous build, join, add the second agent, install the candidate over it, run the after-update rows, force-stop, run the relaunch rows | 15 minutes of identical setup | About 12 min | The relaunch is proven on an app updated in place, with data the previous build wrote. The plain-relaunch case of bifold #336 keeps a Jest guard (`relaunch-keys-fetched-on-use` as a unit test on the use-time key fetch) |
| `testreq`'s rows and `devices`' three screen rows (`in124`, rename, scan-beside) run on the shared linked phone (§4) | Each paid a fresh onboarding and link for a row about a later screen | Two links and two boots; about 10 min | Nothing; the #306 refusal row keeps its own link, as the refusal is the subject |
| `lostreq`'s offline error becomes a component test; the device row runs nightly, not per release | The row asserts the app's words when the host is cut; the recorded-then-lost case is already `joinLostRequest.test.tsx` | 10 min per gate | The device row still exists, once a night |
| `p2` runs nightly, not per release | Keyring as vetter is proven per release by `kk`; `p2` adds cross-implementation interop with the TUI applicant, which broke last on upstream skew, not on Keyring | 6 min | Interop is checked daily instead of per pin |
| Everything else keeps its leg | `kk`, `p1`, `agents`, `waiting`, both smokes, both updates, `linkfail`, `pnmlink` each own a boundary | | |

Not eliminated: no leg is a strict subset of another. The overlaps are in
setup, which §4 removes, not in verdicts.

### 3. Shortened clocks in test builds

The three `linkwait` cases wait on three app-side clocks: the grant window
(`GRANT_POLL_WINDOW_MS`, 10 minutes, `VtaCreateAgent.tsx`), the inactivity
lock (`defaultAutoLockTime`, 5 minutes, `constants.ts`), and the lock hold
while waiting (`holdLock`, bifold #396). Test builds carry one build-time
switch, `E2E_CLOCKS=short`, set by `test-builds.yml` and by nothing else; the
staging (store) build never sets it. With the switch on, the window is 60 s,
the lock 60 s, and the no-lock wait is read before 50 s. The rows read the
effective values from the Developer screen rather than hard-coding them, so
the same driver runs on either build.

Two things keep this honest:

- Unit tests pin the real durations: `GRANT_POLL_WINDOW_MS === 600000`,
  `defaultAutoLockTime === 5`, the window pausing in the background
  (IN-135) and resuming on return, and the hold keeping the lock off. Fake
  timers; no device.
- The nightly run (§6) runs `linkwait` with real clocks on the shipped build.

`linkfail`'s hold is the agent's consent wait (about 181 s, on the VTA), not
the app's; nothing in the app shortens it. The lab's enrol page offer TTL
(`OFFER_TTL`, 300 s) is an environment variable and is set short for the
host-code cases when they return to the default list.

The store build is unchanged: a test build differs from it by configuration
only, as it already does for the push-off and push-on variants, and
`tier.mjs`'s fingerprint sees no native change.

### 4. One linked phone per lane

The Android group runs on one emulator, cold-booted with `-no-snapshot`
(neither loaded nor saved; a quickboot snapshot discards the session's state
on shutdown, which ate a gate's preparation on 28 September) and kept running
for the whole lane. The lane installs the candidate once and onboards and
links once, to the lane's main runner, on the push-on build when there is
one. The phone's state is a ledger in the run directory (`phone-<port>.json`:
linked agent, persona, PIN set, memberships, second agents), written by each
leg that changes it.

Each leg declares what it needs:

- `fresh`: an uninstall and a cold install (the smokes; every case where the
  link at onboarding is the subject: `linkwait`, `linkfail`, `pnmlink`;
  `push2`'s decline at onboarding; `waiting`'s relink of a wiped app).
- `prev-build`: the previous release installed first (`update-*`).
- `linked`: the shared phone, linked and PIN-locked (`p1`'s approvals,
  `testreq`, `devices`' screen rows, `waiting`'s join rows).
- `linked, unjoined`: the shared phone with no membership (`waiting` runs
  after any leg that joins and removes its membership on exit; `agents`, whose
  last row unlinks everything, runs last or fresh).

Phone keys on the runners are removed once at the lane's end
(`GATE_DEFER_KEYS`, which phase 1 of the gate already uses), never between
legs of the same lane. iOS already works this way for the seated vetter
simulator; the applicant and smoke simulators stay fresh.

Not used: emulator snapshots (above), `adb backup` (Keystore keys do not
travel with app data), cloning an AVD mid-run.

### 5. Three lanes

A lane is one machine, one Farm identity, one set of runners, one Appium
port range. Legs of one lane run one after another; lanes run side by side.

| Lane | Machine | Identity | Runners | Legs |
|---|---|---|---|---|
| mac | the MacBook | the gate's | prague (main), uiux (A), openvtc (B), the community's agent | iOS: `kk`, `smoke-ios`, `update-ios`; Android: `agents` (needs all three runners), `waiting`, `p1`, `devices`' refusal row (it links to the community's agent and cleans its keys) |
| mini | the Mac mini | `keyring-mini-gate` (pending) | its own main runner | `update-android` (merged), `smoke-android`, `devices`' screen rows, `lostreq`'s nightly twin, the layout sweep |
| ci | GitHub runners | `keyring-ci-gate` | its own main runner (an existing runner's DID serves as `linkfail`'s approver, with no admin on it) | `linkwait` (merged), `linkfail`, `pnmlink`, `testreq`'s twin when the shared phone is not available |

Two lanes on one runner collide on its ACL and its rate limit (the
coordinator's rule of 14 October), so the mini and ci lanes need runner VTAs
of their own on the Farm: two more "main" runners, and nothing else, since
only `agents` needs A and B, and the mini lane needs no entry on the
community's agent. **Decided, waiting on creation**: the project lead creates
them in the Farm console (the specification is in `2026-10-14-al.md` §5).
Until they exist, two lanes share the Farm by turns (ci runs while the Mac
is idle), which is the ordering the coordinator set.

Computed from the 248 durations, after §2 to §4: the mac lane is about 70
minutes (iOS 26 beside Android 65), the mini lane about 45, the ci lane about
55 with short clocks. **Target: a release gate in 75 minutes wall-clock on
three lanes; 2 h 15 m when only the Mac is available.** Both are estimates
from measured legs, to be replaced by a measured run in phase 3.

### 6. Cadence

| When | What runs | Where | Time |
|---|---|---|---|
| Every pull request | lint, types, Jest (app 325 tests; bifold's 406 files in its own CI), the harness's node tests, the testID manifest check, and `changed.mjs --dry` printing which legs the diff maps to | GitHub | 10 min (wallet); 22 min (bifold) |
| Every main build | the CI smoke on both platforms; `gate.sh changed` for the mapped legs on the first free lane; for an OTA-tier change, the bundle to ring 0 on the project lead's device as an optional trial | GitHub, then a lane | 15 min smoke; changed legs 5 to 25 min |
| Every release pin | the full gate on three lanes; one `--only-failed` rerun of environment rows without a person; a verdict counts application rows only | all lanes | 75 min target |
| Nightly | `dry --golden` on the shipped build (driver drift); `linkwait` with real clocks; `p2`; `lostreq`'s device twin; the physical-phone attested exchange when a phone is attached; the small-screen, large-text layout sweep | mini, then mac | runs unattended |
| Weekly | the full gate against the lab at the pinned VTI release; the VTA contract fixtures (§7) re-recorded and diffed against the Farm; the flakiness ledger reviewed | mac | |

A per-fix check is `gate.sh changed` plus the CI smoke: about 30 minutes for
an OTA-tier change (no native build; the bundle is built in 4 minutes and the
rows run on the shipped build), about 90 minutes when a native build is
needed (45 for the build). Measured parts: the CI smoke leg is 15 minutes;
`changed` has no record yet and is measured in phase 0.

The VRC suites (`e2e:vrc` and its witnessed and device variants) run on local
debug builds, never on the CI test builds. Their drivers read the relationship
invitation from an element only a debug build renders (`InvitationUrl`, under
`__DEV__` in bifold's `QRScanner.tsx`), and the test builds are release builds.
A release pin's VRC run is therefore a debug build of the pinned commit, with
Metro from the same checkout, on a lane machine with room for it (about 16 GB of
build output). It is scheduled with the release pin, not taken from the pin's
CI artifacts.

### 7. Moving checks down the pyramid

Google's guidance is 70/20/10 (unit, integration, end to end) or 80/15/5,
with large tests flaky at 14% against 0.5% for small ones and the Android
emulator the flakiest tool it measured; React Native's own guidance is to
keep end-to-end tests for "the vital parts of your app" and use "faster JS
tests for the non-vital parts" (sources in `2026-10-14-al.md` §4). Keyring's
unit and component layer already exists (bifold core: 406 test files, 205 of
them in the trust-tasks module; the app: 62 files, 325 tests; the harness:
47 node tests), and upstream's own SDK already judges Keyring's vetting card
and statement in CI (`vti-conformance.yaml`). What moves:

**Component tests (React Native Testing Library, Jest), per pull request.**
Rows that assert words or an element after a local interaction: the
approval card's words and its technical-name toggle (`p1`), the wrong-PIN
clear and the sign-in code naming the community (both smokes), the refusal
words on Your agent (`agents` R5, R8), the join-way words (`waiting`,
IN-149), the "no lock: refusal shown" row (`testreq`), the swap held and
refused words (`linkfail`). Each keeps its device row for two releases after
its component test lands, then the device row is dropped from the per-release
gate and kept in the nightly `dry --golden`.

**Timer tests with fake timers.** The grant window, the inactivity lock, the
background pause, the Try-again clocks (`link-try-again`, 18 minutes on a
device, seconds in Jest), the VTA reconnect back-off.

**Contract tests against the VTA and the community VTC.** The client code
that talks to an agent (link, grant, consent held and refused, swap-key, ACL,
join requests, sign-in) runs in Jest against recorded responses: a fixture
set recorded from the Farm's runner by a script (pnm and the community's
REST, no phone), checked into the harness with the Farm's version. Two
directions, as Pact describes: the consumer tests run on every pull request
against the recordings; the provider check runs weekly, replaying the
recorded requests against the live runner and diffing the answers, so a Farm
upgrade shows as a fixture diff before it shows as a red gate. `farm-drift`
already names the version; the fixtures carry it.

**Stays on a device.** Install and cold launch, Firebase silence,
notifications and the wake channel, background and foreground, install over
an older build, the Keystore and PIN, the two-simulator vetting ceremony, a
real link to a live agent, the layout rules (they need native layout).

**Driver tooling: Appium stays.** Detox needs a Detox-built binary, and the
gate installs the artifact testers get; Maestro has no physical iOS and would
be a second toolchain beside the 57 drivers; Appium with testIDs is what
Shopify took to 98% stability. The investment goes into the page objects and
independent rows of proposal B, not a migration.

### 8. Flakiness policy

- Every red row carries a verdict: app, harness or env (the run summary
  already does this). Only app rows count for a release verdict. Env rows
  trigger one `--only-failed` rerun without a person, after the Farm health
  and version check passes. Harness rows are fixed and proven by `dry
  --golden` before any rerun.
- A ledger of pass rates per row over the last 14 days, built from
  `runs/*/summary.json`. A row under 90% is quarantined: it runs and reports,
  it does not fail the gate, and it has a bug with an owner. A quarantined
  row returns to the verdict after 10 consecutive passes.
- Admission: a new row fails a gate only after three consecutive passes in
  `dry --golden` on the shipped build.
- Cleanup is capped at five minutes per leg; a cleanup past the cap is
  reported as env and finished by the lane's end sweep.
- Legs that failed only on the TUI side (`p1-tui-vets`) report the TUI's
  screen-read timeout as env until the TUI driver waits on state rather than
  on a 3-second read.

### 9. Coverage gaps against the five anchors

Three of the five anchors have no row today:

| Anchor | Today | Row to add | Needs |
|---|---|---|---|
| Farm one-scan setup (vta-claim) | `run-farm-onescan.mjs` exists, attended (a person presses "Codes match" on the Farm page); every gate link is the manual enrol-page link | none automated: the project lead runs the one-scan setup himself once per release, on the TestFlight build, and his result is a row in the release report | nothing; the attended run is the check. A harness-driven row would need the Farm page's confirmation pressed from the harness, which is not worth building while the Farm page changes |
| Mediator | implicit in every link; blocked, never measured | a round-trip row in each smoke: a message from the runner reaches the phone, with its time, flagged over 2× the last release's | nothing new; the runner can message the phone today |
| Website sign-in | the unjoined negative case only | a member phone claims a sign-in code from the community's site and the site shows it signed in | a sign-in page the harness can drive, in the local VTI stack or on the Farm community. **Design needed; owned by the application lane** |

## Phases

Each phase ends with a measured run on one pin, reported with heads, and a
line in the coverage manifest's diff. No phase changes what a tester gets.

**Phase 0: measure, change nothing in verdicts.** Every leg writes
`steps.tsv` (start, end, step name) as `smoke-ci` does; `gate.sh report`
shows per-step time; the coverage manifest is generated and committed; the
flakiness ledger script runs over the last 14 days of runs; `gate.sh
changed` is run once on a real fix and its time recorded.
*Done when* a 248-pin run shows per-step times for all 16 legs, the manifest
lists every row with its flow and leg, the ledger prints pass rates, and one
`changed` run has a record with its wall time.

**Phase 1: clocks.** `E2E_CLOCKS=short` in test builds; the four unit tests
pinning the real durations and the pause; the Developer screen shows the
effective values; the `linkwait` rows read them.
*Done when* `linkwait` passes under 15 minutes on a short-clock test build,
the same rows pass overnight on the shipped build with real clocks, and the
store build's fingerprint is unchanged.
Approved 14 October.

**Phase 2: shared phone and merges.** The phone ledger; `needs=` per leg;
`testreq` and `devices`' screen rows on the shared phone; `linkresume` into
`linkwait`; `relaunch-android` into `update-android`; `lostreq`'s offline
row as a component test with the device twin nightly; `p2` nightly.
*Done when* the summed leg time on one pin drops by at least 40 minutes
against the 248 baseline, the manifest diff removes no row except the ones
named here, and every merged row's evidence path is unchanged in the report.
Approved 14 October.

**Phase 3: lanes.** The mini's identity and the ci identity on their own
runners; `gate.sh run --lanes mac,mini,ci` scheduling by `needs` and runner
set; one report across lanes.
*Done when* one pin's full gate completes in 75 minutes or less across three
lanes with the same rows as a Mac-only run, three times.
**Waits on** the two runner VTAs, approved 14 October, created by the project lead.

**Phase 4: down the pyramid.** The component tests in §7, each landing with
its device twin kept for two releases; the timer tests; the VTA contract
fixtures recorded, with the weekly provider check.
*Done when* each named row has a Jest test that fails on a known-bad case
(replayed offline, as `RELEASE_GATE.md` §0 requires), the fixtures carry the
Farm version, and the weekly diff has run twice.

**Phase 5: cadence and policy.** The schedule in §6 in the watcher; the
automatic env rerun; quarantine and admission in the ledger; the three gap
rows of §9 once their designs are chosen.
*Done when* a week passes with every release gated by the full gate, every
main build by the smoke plus `changed`, and the nightly and weekly runs
reported without a person starting them.

## Work order

The phases above in pull requests, smallest first, each reviewed by the
research lane and merged on green by the coordinator. "Harness" is the gate
lane; "app" is whichever application lane the coordinator assigns.

| # | Change | Owner | Depends on |
|---|---|---|---|
| 1 | The CI cleanup deletes the phone key the link driver keeps (`keys_since` in CI covers `keyring-admin` keys made after the leg start) | harness | nothing |
| 2 | Phase 0: a `step` helper writing `steps.tsv` in every leg, per-step time in `gate.sh report`, the coverage manifest generator with its committed manifest, the flakiness ledger over `runs/*/summary.json`, each with a node test | harness | nothing |
| 3 | `E2E_CLOCKS=short`: the switch read by bifold's clock constants, the Developer screen showing the effective values under testIDs, the unit tests pinning the real durations and the background pause; `test-builds.yml` sets it | app, then harness for the workflow line | nothing |
| 4 | `linkwait` reads the effective clocks from the Developer screen; `linkresume`'s cases join it; the nightly real-clock run in the watcher's schedule | harness | 3 built |
| 5 | The Jest guard for #336's plain relaunch (keys fetched on use) | app | nothing |
| 6 | `relaunch-android` merged into `update-android` | harness | 5 merged |
| 7 | The phone ledger and `needs=` per leg; `testreq` and `devices`' screen rows on the shared phone; keys deferred per lane | harness | 2 |
| 8 | `lostreq`'s offline error as a component test | app | nothing |
| 9 | `lostreq`'s device row and `p2` in the nightly schedule | harness | 8 merged |
| 10 | Lanes: `gate.sh run --lanes`, runner sets per lane from the environment, the mini's identity on its runner | harness with the mini lane | the two runner VTAs |
| 11 | The ci lane on its own runner: the environment and the identity's session updated, `linkfail`'s approver DID from an existing runner | research (CI) | the two runner VTAs |
| 12 | The component tests of §7, one PR per screen, each keeping its device twin for two releases | app | nothing |
| 13 | The timer tests of §7 | app | 3 |
| 14 | The VTA contract fixtures: the recorder, the consumer tests, the weekly provider diff | app with research | nothing |
| 15 | Policy in the watcher: the automatic env rerun, quarantine and admission from the ledger, the cleanup cap | harness | 2 |
| 16 | The mediator round-trip row in both smokes | harness | nothing |
| 17 | The website sign-in row, once its page exists | app | its design |

## What this plan does not do

It does not shorten the test builds (45 minutes per platform), which bound
the per-fix check for native changes; the OTA tier is the answer for
JavaScript changes. It does not prove hardware attestation, which stays on
physical phones, nightly when one is attached. It does not change what
testers receive.

## Review index

- `2026-10-14-al.md`: the measurements, the coverage map, the week's rerun
  classification, the sources, and the positions this plan rejected.
- `2026-10-15-al.md`: the VRC suites need debug builds (found on the 241
  re-pin, run 249).
