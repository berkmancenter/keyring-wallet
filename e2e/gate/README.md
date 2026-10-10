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
| `legs/<name>.sh` | One leg each: `kk` (K↔K and id305), `p1` (P1 and approvals), `testreq`, `agents`, `waiting`, `smoke-ios`, `smoke-android`, `devices` |
| `lib.sh` | Shared shell: emulator and simulator slots, runner-key cleanup, the build cache, row parsing |
| `watch.sh` | The auto-start poller: one pin PR (`gate.plist.example`) or main for ever (`gate-main.plist.example`) |
| `green.mjs` | Is a commit's test build green? The one tested answer every watcher uses (`node --test e2e/gate/green.test.mjs`) |
| `sleeps.mjs` | Did the Mac sleep during a leg? Read from `pmset -g log` (`node --test e2e/gate/sleeps.test.mjs`) |

The drivers stay where they are (`e2e/run-*.js|mjs`) and use the shared helpers in `e2e/lib/`: `rows.js`,
`steady.js`, `pnm.js` and `runDir.js`.

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
HEADS <leg> wallet=<sha8> bifold=<sha8> build=<sha12> harness=<sha8>
ROW <name> PASS|FAIL|SKIP — <detail>
LEG <leg> BROKEN — <first line>
LEG <leg> DONE <exit> pass=<n> fail=<n> skip=<n> <seconds>s
```

| Exit | Meaning | What the runner does |
|---|---|---|
| 0 | Every row passed, or was skipped as asked | Moves on |
| 3 | A row failed; the leg carried on | Moves on, and records the row for `--only-failed` |
| 1 | The leg itself broke (setup, link, crash) | Moves on, and reruns the whole leg in `--only-failed` |

A failing row never stops its leg. A row that needs another (`{ needs: [...] }`) reports SKIP with the reason
when that one failed. `--only-failed` passes the names through `E2E_ONLY_ROWS`.

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

- **The full gate runs on the Mac, through the watcher, while the Mac is stable**: the lid is open, or an
  external display is attached. The watcher checks this before every start (`mac_stable` in `gate.sh`) and skips
  the cycle otherwise, with the reason in its log. There is no power-adapter condition.
- **When the Mac is not stable, the CI smoke workflow is the signal** (`gate-smoke.yml`, on its own branch): it
  runs on every main build, on GitHub's runners, with no Farm rows and no secrets. It is a smoke, not a gate.
- **A full gate is not started on a laptop in a bag.** A closed lid with no display sleeps the Mac, every leg stalls,
  and the rows that time out say nothing about the build. A run that spans a sleep is reported as interrupted (below),
  not as red.
- The watcher's plist is read once, at bootstrap: an edit needs `launchctl bootout` and then `bootstrap`, and never
  during a run, because the run is a child of the watcher. The same goes for `gate.sh` itself: the loop is a bash
  process that has already read it, so a change there (this guard included) is live only after that restart. The
  fast-forward before each run refreshes what a run spawns (the legs, `lib.sh`, the drivers), not the loop.

## Continuous gating on main

`gate.sh watch --main` runs for ever: every five minutes (`GATE_WATCH_INTERVAL`) it asks `green.mjs` for the newest
main commit with a green push build. If no gate run exists for that commit, it requests the commit's push-on
Android build once, waits up to an hour for it, and runs the gate. A commit that was gated, green or red, is not
gated again by the loop; reruns stay a person's call (`rerun <id> --only-failed`).

- **Not while the Mac is busy.** The loop skips a cycle while another gate holds a live lock, while an xcodebuild,
  cargo, docker build or emulator process is running (executable names), while a Gradle build runs (its wrapper
  client; idle Gradle daemons, which stay up for hours, do not count),
  or while any simulator is booted (Simulator.app being open is not a signal).
- **Not while the Mac is not stable.** The loop also skips a cycle while the lid is closed and no external display is
  attached (`mac_stable`). The lid is read from `ioreg -r -k AppleClamshellState -d 4` (`Yes` = closed); the displays
  from `system_profiler SPDisplaysDataType`, counting every `Connection Type` other than `Internal`, about 0.2 s.
  `ioreg -l | grep -c IODisplayConnect` is not a count on Apple silicon: it matches a class table and reads 1 with
  nothing attached.
- **A run that spans a sleep has no verdict.** After each run the watcher reads `pmset -g log` for a `Sleep` entry
  between the run's `started=` and `ended=` (the log is in local time with its zone; each entry is converted with
  that zone). One found, it appends `interrupted=sleep <when>` to the run's `meta` and says so; `report` then prints
  `INTERRUPTED (sleep)` first. The legs ran as they always do; only the reading of their rows changes. Rerun by hand.
- **One push-on build per gated commit.** Each new green main commit gets one Android push-on dispatch (about 40
  minutes of a free public-repository runner), so the push legs have a build; `watch-requested-<sha8>` records it.
- **Its own checkout.** The watcher runs from a checkout nobody edits (`~/.keyring-fleet/gate/wt-main`, on main),
  fast-forwarded to `origin/main` before each run when it is clean; a lane's working checkout never feeds an auto-run.
  Like any gate worktree it needs `e2e/node_modules` (`npm ci` in `e2e/`) and a root `node_modules` link.
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
  cannot stop a lid closing mid-run, which the sleep marking below then reports. The owner can also run once:
  `sudo pmset -a disablesleep 1` (and `sudo pmset -a disablesleep 0` to undo). Check with `pmset -g | grep -i sleep`.
- **A sleep is marked, not judged.** After each leg the gate reads `pmset -g log`. A sleep inside the leg adds an
  `ENV Mac slept …` line to its `leg.log`, shown in the report above the rows: those rows are no verdict on the app.
  (Auto-run 1009-1608: a 682 s clamshell sleep ended both kk iOS sessions by Appium's 300 s `newCommandTimeout`,
  which stays at 300 s so a real hang still shows.)
