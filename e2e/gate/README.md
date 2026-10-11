# Release gate runner

`e2e/gate/` runs a release candidate's gate: every leg, on one pinned build, with one report. It replaces the
per-release wrappers that lived outside the repo (`gate2NN*.running.sh`). It is written for the person, or the
session, that runs gates.

What it is for, measured on release 236 (10-06): the gate took about 10 hours, of which about 2 were testing.
The rest went on four things:

- driver bugs found on the candidate;
- legs that stopped at their first failing row;
- 74 minutes idle between the builds finishing and the gate starting;
- legs that ran one after another when they could have run side by side.

Each part below removes one of those.

## Layout

| Path | What |
|---|---|
| `gate.sh` | The runner: `gate.sh <command> [options]` |
| `legs/<name>.sh` | One leg each: `kk` (K↔K and id305), `p1` (P1 and approvals), `testreq`, `agents`, `waiting`, `lostreq` (a join ask that cannot reach the community shows an error and sends nothing; a request recorded as sent and then lost is bifold's `joinLostRequest.test.tsx`, since no network cut on the phone lands between the record and the send), `smoke-ios`, `smoke-android`, `devices` |
| `lib.sh` | Shared shell: emulator and simulator slots, runner-key cleanup, the build cache, row parsing, `build_has` |
| `watch.sh` | The auto-start poller: one pin PR (`gate.plist.example`) or main for ever (`gate-main.plist.example`) |
| `green.mjs` | Is a commit's test build green? The one tested answer every watcher uses (`node --test e2e/gate/green.test.mjs`) |
| `sleeps.mjs` | Did the Mac sleep during a leg? Read from `pmset -g log` (`node --test e2e/gate/sleeps.test.mjs`) |
| `tokenlines.mjs` | Keyring's own Firebase / FCM token lines in an Android logcat, by its pids (`node --test e2e/gate/tokenlines.test.mjs`) |
| `stable.mjs` | Is the Mac stable enough to start a gate? Lid, external displays, battery, one verdict (`node --test e2e/gate/stable.test.mjs`, fixtures under `fixtures/stable/`) |

The drivers stay where they are (`e2e/run-*.js|mjs`) and use the shared helpers in `e2e/lib/`: `rows.js`,
`buildHas.js`, `steady.js`, `pnm.js` and `runDir.js`, and the page objects in `e2e/lib/pages/`: `link.js` is the
link's steps (the way in, the code, the key, Linked, the introduction), each asserting the screen it ends on and
failing by name, on the model of `lib/keyringRoles.js`; `run-vta-link.js` runs on it, and a leg that links before its
own rows can too.

## What stays out of the repo

Farm runner identities, admin credentials and the community's REST credential are private. They live in
`~/.keyring-fleet/gate/env/` (`farm.env`, `lab.env`), which `gate.sh` reads. Nothing in `e2e/gate/` names a
Farm DID, slug or secret. A leg reads `RUNNER_A_SLUG`, `C_DID` and the rest from the environment.

## A worktree's packages

The gate runs from a git worktree, which has no installed packages of its own. Two links are needed: `e2e/node_modules`
for the drivers, and `node_modules` at the root for the enrolment page, which loads `qrcode` relative to the repo root
(`scripts/openvtc/local-vti-stack/enrol-page/server.mjs`). Without the root one, every host-code link fails with
"Cannot find module 'qrcode'" and a 500 from `/api/offers` (239 gate, linkwait).

## State

Everything a run makes goes under `~/.keyring-fleet/gate/`, never `/private/tmp`, which a reboot wipes:

- `builds/<wallet-sha>-<bifold-sha>/`: the downloaded candidate (iOS app, push-off and push-on APKs), with its
  manifest. It is downloaded once per SHA and reused by every later run.
- `runs/<run-id>/`: a run's report, each leg's log, and each leg's own `E2E_RUN_DIR` for screenshots and page dumps.

## Commands

```sh
e2e/gate/gate.sh run --pin <wallet-sha>            # every leg, on that pin's CI builds
e2e/gate/gate.sh run --pin <sha> --legs kk,p1      # some legs
e2e/gate/gate.sh rerun <run-id> --only-failed      # only the rows that FAILed or did not run, same builds
e2e/gate/gate.sh dry --golden                      # these drivers against the shipped build, before a candidate
e2e/gate/gate.sh watch --pr <n>                    # start `run` when that pin PR merges and its builds finish
e2e/gate/gate.sh watch --main                      # continuous gating: a run for every new green push build of main
e2e/gate/gate.sh report <run-id>                   # the run's rows, per leg, with wall-clock
```

## Rows and exit codes

A leg prints the lines that `e2e/lib/rows.js` produces, and the runner reads only these:

```
HEADS <leg> wallet=<sha8> bifold=<sha8> build=<sha12> harness=<sha8> … caps=<n>
ROW <name> PASS|FAIL|SKIP — <detail>
LEG <leg> BROKEN — <first line>
LEG <leg> DONE <exit> pass=<n> fail=<n> skip=<n> <seconds>s
```

`caps=<n>` is how many of the manifests' testID keys (`e2e/lib/testids*.json`) the build's JS bundle holds, a
short reading of how far the build is from the drivers' contract (`-` when the leg named no build file).

A driver prints its rows through `rows.js` and a leg folds them in with `take_rows`; a leg that re-derives a
row from a driver's other lines is the older form. Two things make a row independent:

- **`needs`**: a row that depends on an earlier one is SKIPped as `needs "<row>", which was FAIL` instead of
  failing twice. A need that was merely left out of `E2E_ONLY_ROWS` counts as met (it was left out for passing).
- **`buildHas`** (`e2e/lib/buildHas.js`): a row written for a newer feature asks first whether the build's JS
  bundle holds the feature's testID key, and SKIPs as `build lacks <id>` on a build before it (`dry --golden`),
  instead of failing. From a leg, `build_has <key> <apk | .app>` exits 0 when the build holds the key, 1 when not,
  2 when no build is known. The answer is cached per build under `$GATE_HOME/buildhas`.

| Exit | Meaning | What the runner does |
|---|---|---|
| 0 | Every row passed, or was skipped as asked | Moves on |
| 3 | A row failed; the leg carried on | Moves on, and records the row for `--only-failed` |
| 1 | The leg itself broke (setup, link, crash) | Moves on, and reruns the whole leg in `--only-failed` |

A failing row never stops its leg. A row that needs another (the `needs` map given to `createRows`) reports SKIP
with the reason when that one failed. `--only-failed` passes the names through `E2E_ONLY_ROWS`, and a name selects
the rows it needs as well, all the way up: a rerun of the dependent alone runs its needs first, even though they
passed last time and are not on the list.

## Before a candidate: `dry --golden`

New or changed drivers run first against the build testers already have, the last release: same legs, same
Farm runners. A row that fails there is a driver bug, and it gets fixed before it can cost a candidate gate.
On 236, four of the day's reruns would have been caught this way: ticket, owner prompt, tab bar and
`getRect`.

## Auto-start

`watch.sh` polls the pin PR. When it has merged and the merge commit's CI builds (push off and push on) are
green, it downloads them into the cache and starts `run`. launchd runs it, never an agent tool's background
job: one of those was stopped by its 2-hour limit in the 236 download step. It runs the gate in a session of its
own (`setsid`), and a gate started by hand should be too
(`nohup perl -e 'use POSIX qw(setsid); setsid(); exec @ARGV' e2e/gate/gate.sh run … &`): a gate sharing a process
group with an agent tool's job was taken down mid-leg when that job was stopped, before the leg's cleanup ran.

## Sharing the Mac

A lane about to run a heavy job of its own (a device build, say) creates `~/.keyring-fleet/gate/hold-start`, with a
line saying who and why; a run that is about to start its first leg waits until the file is gone.

## Parallel legs

The iOS legs (K↔K, iOS smoke) use simulators. The Android legs (P1 + approvals, agents, waiting card, Android
smoke, device rows) use the emulator. With enough free disk (about 15 GB), the two groups run side by side,
each with its own `E2E_RUN_DIR` and Appium port. Below that, they run one after another.

## Cleanup

Every leg records when it started. On exit it removes the phone keys it made on each runner since then, the
approval rules and approver sets it set, and its test members of the community. The report says what it
removed and what it found left over.

## Where a gate runs

The rule, agreed 10-10:

- **The full gate runs on the Mac, through the watcher, while the Mac is stable.** Stable means: the lid is open,
  or an external display is online. A Mac with no lid at all and no battery is a desktop and is always stable (the log
  says `desktop: no lid, no battery` once per start, so a headless mini still gates). No lid key but a battery is
  unknown, and unknown does not start a gate. There is no power-adapter condition. `mac_stable` in `gate.sh` is the
  one guard, over `stable.mjs`: the watcher asks it before every cycle and skips the cycle otherwise, with the reason
  in its log; `run` and `rerun` (which does not go through `run`) ask it before a build is downloaded or the lock
  taken, and stop with the same reason. `GATE_ALLOW_UNSTABLE=1` starts anyway, with a warning in the log.
- **When the Mac is not stable, the CI smoke workflow is the signal** (`gate-smoke.yml`, below): it
  runs on every main build, on GitHub's runners, with no Farm rows and no secrets. It is a smoke, not a gate.
- **A full gate is not started on a laptop in a bag.** A closed lid with no display sleeps the Mac, every leg stalls,
  and the rows that time out say nothing about the build. The guard cannot stop a lid closing mid-run: a sleep inside
  a leg is marked on that leg (`ENV Mac slept …` in its `leg.log`, from `sleeps.mjs`, wallet #361), not judged, and
  there is no run-level mark besides it.
- The watcher's plist is read once, at bootstrap: an edit needs `launchctl bootout` and then `bootstrap`, and never
  during a run, because the run is a child of the watcher. The same goes for `gate.sh` itself: the loop is a bash
  process that has already read it, so a change there (this guard included) is live only after that restart. The
  fast-forward before each run refreshes what a run spawns (the legs, `lib.sh`, the drivers), not the loop.

## On a hosted runner: the smoke rows (stage A)

`.github/workflows/gate-smoke.yml` runs the SMOKE rows on GitHub-hosted runners, with no Farm and no secrets, and
times every step: a spike to see what a hosted runner can carry of the gate when the Mac is not available. The
leg is `legs/smoke-ci.sh`; it takes the platform, the app or APK and the device, sources nothing private, and
prints the same HEADS, ROW and LEG lines as `smoke-ios.sh` and `smoke-android.sh`. It does the plain-launch rows
exactly as those legs do (install, launch with no Appium attached, screenshots at 20 s and 45 s, crash reports,
the Firebase/FCM log rows; on Android the focus and permission-prompt checks and the token lines in logcat), then
the welcome slides through Appium (`run-welcome.mjs`, which now runs on Android too). The rows that need a Farm
runner (the link, the push probe, the agent header) print `SKIP — no Farm in CI (stage A)`.

- iOS on `macos-26`: the newest iPhone of the newest runtime on the image (`ci/pick-sim.mjs`; the HEADS line
  names it), WebDriverAgent cached at `~/Library/Developer/Xcode/keyring-wda-sim` by driver and Xcode version.
  The iOS runtime is whatever the image carries, not the gate's `IOS_VERSION`: run 38044225803 ran on iPhone 17,
  iOS 26.5 (the image had 26.2, 26.4 and 26.5; the gate pins 26.3), so a CI PASS is on a newer iOS than the gate's.
- Android on `ubuntu-latest` with KVM: `reactivecircus/android-emulator-runner`, API 33 google_apis on x86_64
  with the Pixel 6 profile and 2 GB, the gate's `Pixel_6_API_33` on the one arch the runners accelerate. The AVD
  is new on every run, and Play Services registers itself with GCM during the plain launch (15 GCM-GMS /
  FirebaseInstanceId / BugleNetwork lines on run 38044225803, none from the wallet), so the token row counts only
  lines from the wallet's pid or naming its package. `smoke-android.sh` counts every line; that holds on the gate
  Mac's persistent AVD, which did that registration long ago, and would fail the same way on a re-created one.
  "Boot complete" is not settled: on run 38045665103 System UI hung during a 195 s boot and its "isn't
  responding" dialog covered the app from before the plain launch to the welcome driver (both welcome rows FAIL,
  never seen locally). `ci/android-settle.sh` now waits after the boot (no ANR window, launcher focused, guest
  load at or under its cores, 90 s at most; `ci/android-anr.sh` taps the dialog's Wait), a step of its own in the
  table; the welcome driver waits 45 s for the first slide on Android and once taps Wait itself, and the leg runs
  it a second time when System UI stopped responding during the first, saying so in the rows.
- Timing: every workflow step marks the clock (`ci/mark.sh`), the leg writes its own steps to `steps.tsv`, and
  `ci/summary.mjs` puts one table (and the rows) on the job summary. The leg dir is uploaded as an artifact.
- The job fails only when a ROW says FAIL or the leg broke before its rows; SKIP rows and a driver's exit 3 do not.

```sh
gh workflow run gate-smoke.yml -R berkmancenter/keyring-wallet --ref main -f run-id=<test-builds run id>
gh workflow run gate-smoke.yml -R berkmancenter/keyring-wallet --ref main -f wallet-sha=<sha> -f platform=ios
```

It also runs by itself after every green push test build of main (a push-on build the watcher dispatches carries
only a `-push-on` artifact and does not start it). What does not move to a hosted runner: the
physical-phone legs, the terminal-app fixture, and anything that links a Farm runner (stage B would need the
runner personas provisioned for CI).

## Continuous gating on main

`gate.sh watch --main` runs for ever: every five minutes (`GATE_WATCH_INTERVAL`) it asks `green.mjs` for the newest
main commit with a green push build. If no gate run exists for that commit, it requests the commit's push-on
Android build once, waits up to an hour for it, and runs the gate. A commit that was gated, green or red, is not
gated again by the loop; reruns stay a person's call (`rerun <id> --only-failed`).

- **Not while the Mac is busy.** The loop skips a cycle while another gate holds a live lock, while an xcodebuild,
  cargo, docker build or emulator process is running (executable names), while a Gradle build runs (its wrapper
  client; idle Gradle daemons, which stay up for hours, do not count),
  or while any simulator is booted (Simulator.app being open is not a signal).
- **Not while the Mac is not stable.** The loop also skips a cycle while `mac_stable` says no (the rule is under
  "Where a gate runs"). `stable.mjs` reads the lid from `ioreg -r -k AppleClamshellState -d 4`, the exact key
  `"AppleClamshellState" = Yes|No` (`Yes` = closed; absent = no clamshell); the displays from
  `system_profiler SPDisplaysDataType -json`, where an external display is an `spdisplays_ndrvs` entry whose
  `spdisplays_connection_type` is not `spdisplays_internal` and whose `spdisplays_online` is `spdisplays_yes`
  (a bare count of entries would count a panel that is listed but asleep); and the battery from an `InternalBattery`
  line in `pmset -g batt`. About 0.2 s when the lid is closed (the displays are read only then; an open lid is the
  answer by itself). `ioreg -l | grep -c IODisplayConnect` is not a count on Apple silicon: it matches a class table
  and reads 1 with nothing attached. `node e2e/gate/stable.mjs --stable` prints the verdict and its reason
  (`--lid`, `--displays`, `--battery` print one reading each).
- **One push-on build per gated commit.** Each new green main commit gets one Android push-on dispatch (about 40
  minutes of a free public-repository runner), so the push legs have a build; `watch-requested-<sha8>` records it.
- **Its own checkout.** The watcher runs from a checkout nobody edits (`~/.keyring-fleet/gate/wt-main`, on main),
  fast-forwarded to `origin/main` before each run when it is clean; a lane's working checkout never feeds an auto-run.
  Like any gate worktree it needs `e2e/node_modules` (`npm ci` in `e2e/`) and a root `node_modules` link.
- **A clean start, and a clean stop.** After it takes the run lock, every `run` and `rerun` sweeps the runners
  (`gate_sweep`), limited to what the gate itself creates: the rules for acl/swap-key/0.1 and vta/contexts/get/1.0,
  the members of approver sets named `gate-*` or `e2e-approvals`, and policies whose id starts `gate-`. Each removal
  is logged; any other rule or set (runner A is also used by hand) is logged as "foreign … left in place" and kept. A stop (a bootout, a ctrl-C) is passed to the legs, whose trap runs their cleanup, and
  the runner waits up to `GATE_STOP_WAIT` seconds (150) for them; the plist gives launchd 180 s (`ExitTimeOut`). A
  hard kill or a power loss cannot clean up, which is what the sweep is for: run 1009-1608 was killed in linkfail
  and left an acl/swap-key consent rule on the main runner for a day, and the next links were held with
  `auth:consent_required`.
- **One gate at a time.** `run` and `rerun` take `~/.keyring-fleet/gate/run.lock.d` (the running shell's pid inside)
  and wait while another gate holds it; a lock whose owner is gone is taken over by an atomic rename, and a lock
  with no pid yet counts as live for its first minute. `hold-start` still pauses a run for another
  lane's device build.
- **Green means green.** `green.mjs` accepts a run only when its head commit is the one asked about, its status is
  `completed` and its conclusion is exactly `success`. An empty conclusion is pending. Two hand-written watchers
  read these wrong in one week (an empty check taken as done; a job name split on a space).
- **Downloads retry** five times a minute apart; the 239 auto-start lost its gate to two transient download failures.
- **PATH is yours to set.** launchd starts the watcher with almost no PATH. The example names the node that runs
  the drivers (appium is installed under it), homebrew, and the system directories including `/usr/sbin`, where
  `sysctl` lives; without that the first automatic gate (10-09) failed in 24 s with `spawn appium ENOENT`, and the
  memory check read 0 GB so no Android leg started. A plist edit takes effect only after `bootout` and `bootstrap`,
  and never bootout while a run is in progress: the run is a child of the watcher.
- **Install:** fill in `gate-main.plist.example`, copy it to `~/Library/LaunchAgents/org.keyring.gate-watch-main.plist`
  and `launchctl bootstrap gui/$(id -u) <that file>`. The Mac's owner decides; it is a lasting change. Stop with
  `launchctl bootout gui/$(id -u)/org.keyring.gate-watch-main`. The log is `~/.keyring-fleet/gate/watch-main.log`.
- **Keep the Mac awake.** A closed lid put the Mac to sleep for three hours in the middle of the 239 gate, and
  `caffeinate` does not prevent lid-closed sleep. The stable-Mac check keeps a gate from starting in that state; it
  cannot stop a lid closing mid-run, which the per-leg sleep mark (`sleeps.mjs`) below then reports. The owner can
  also run once:
  `sudo pmset -a disablesleep 1` (and `sudo pmset -a disablesleep 0` to undo). Check with `pmset -g | grep -i sleep`.
- **A sleep is marked, not judged.** After each leg the gate reads `pmset -g log`. A sleep inside the leg adds an
  `ENV Mac slept …` line to its `leg.log`, shown in the report above the rows: those rows are no verdict on the app.
  (Auto-run 1009-1608: a 682 s clamshell sleep ended both kk iOS sessions by Appium's 300 s `newCommandTimeout`,
  which stays at 300 s so a real hang still shows.)
