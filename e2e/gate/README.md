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
| `watch.sh` | The auto-start poller, run by launchd (`gate.plist.example`) |

The drivers stay where they are (`e2e/run-*.js|mjs`) and use the shared helpers in `e2e/lib/`: `rows.js`,
`steady.js`, `pnm.js` and `runDir.js`.

## What stays out of the repo

Farm runner identities, admin credentials and the community's REST credential are private. They live in
`~/.keyring-fleet/gate/env/` (`farm.env`, `lab.env`), which `gate.sh` reads. Nothing in `e2e/gate/` names a
Farm DID, slug or secret. A leg reads `RUNNER_A_SLUG`, `C_DID` and the rest from the environment.

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

## Parallel legs

The iOS legs (K↔K, iOS smoke) use simulators. The Android legs (P1 + approvals, agents, waiting card, Android
smoke, device rows) use the emulator. With enough free disk (about 15 GB), the two groups run side by side,
each with its own `E2E_RUN_DIR` and Appium port. Below that, they run one after another.

## Cleanup

Every leg records when it started. On exit it removes the phone keys it made on each runner since then, the
approval rules and approver sets it set, and its test members of the community. The report says what it
removed and what it found left over.
