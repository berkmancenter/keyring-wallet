# Release gate

How a Keyring release is gated from 226 on. The aim is one full gate per release, run once on frozen heads, with every change before it smoke-tested in about 20 minutes. Evidence from past gates lives in [gate-evidence/](gate-evidence/).

## 0. Prove the checkers before any device run

- The harness has unit tests. Run them on every harness change:
  - `node --test e2e/lib/*.test.mjs` (filledRule, joinOutcome, testIdKeys)
  - `node --test scripts/ci/js-only.test.mjs`
- A new check lands with a known-bad case it fails on, replayed offline against saved evidence (`e2e/scripts/replay-filled.mjs` is the model).
- A runner change that alters what counts as a pass gets a test first; it is not tried out on a device.

## 1. Freeze and batch

- **Freeze.** The release coordinator names the gate heads (wallet commit, bifold pin) and posts them on the board. Nothing merges to `main` until the gate reports.
- **Build.** The frozen heads are the ones the GitHub test-build workflow builds: the store-config simulator app and the test APK. The gate installs **that artifact**. Before §6 it checks the artifact's manifest: the wallet and bifold commits must equal the frozen heads, and the bundle SHA must equal the installed app's bundle. Every result states the heads and the artifact hashes.
- **Batch.** Fixes found during the gate go into one follow-up batch; the gate isn't restarted per fix. A blocker ends the gate early: it is reported, fixed, and the gate restarts on new frozen heads.

## 2. Per change: the ~20-minute smoke

For each PR or batch before the freeze:

1. `node scripts/ci/js-only.mjs --base <last full build> --head <change> --env-base … --env-head …`
   - **js-only**: `scripts/ci/js-swap.sh` onto that build's .app and APK (about 2 min).
   - **full**: wait for the CI build.
   - **no-app-change**: skip the device leg.
2. Install over the app, with no reinstall, on **one** iOS simulator and **one** Android emulator that already hold an onboarded, linked persona (§3).
3. Walk only the screens the change touched, plus the entry smoke: unlock → tab bar → "Your agent" opens. Use the change's own e2e runner where one exists.
4. Record per-step timings (§5), screenshots, and pass/fail against the PR's stated expectation.

A swapped app is never a release candidate: swaps are for iteration and smoke runs only.

## 3. Reuse onboarded and linked state

- Keep a small set of named personas on fixed devices: **new**, **applicant**, **member**, **vetter**. Each one's state is recorded on the board: device, persona DID, community, grant expiry.
- Installs keep app data (`adb install -r`, `simctl install` over the app). Only a smoke that needs a fresh install uses a throwaway device: an emulator started `-read-only`, or a simulator created for the run and deleted after it.
- Before a run, the runner reads the persona's state (`e2e/read-vetter-state.mjs`) and stops if it isn't the expected one, rather than re-onboarding.
- When the test network's upstream changes identifiers, rebuild the persona set once and record the new DIDs.

## 4. Where it runs

- **Farm first:** the runner community with runner VTAs, never a maintainer's personal agent. Keep traffic light: no tight polling, admin reads spaced out. A `503 no available server` is an **environment failure**: record the time and `cf-ray` and don't debug the app.
- **Lab as fallback,** only when the Farm is down. The report says so, with the time the Farm check failed.
- **Devices:**
  - boot only what a run needs, and shut it down when the run is done (by PID or device id);
  - use the lab's own test phones for the device leg, addressed by UDID;
  - never a maintainer's personal phone.
- **Shared machine:** one heavy build at a time, announced when it starts and when it's done; one jest suite at a time, with `--maxWorkers=2`.

## 5. Per-step timings in every run

- Every runner step logs its start and end (`runStep`). The run ends with a table: step, platform, duration, outcome.
- The report quotes the table. A step taking more than twice its last-release time is flagged, even when it passes.

## 6. The full gate, once, on the frozen build

Run on the GitHub build from §1, never on a swap:

| § | Area | Checks |
|---|---|---|
| 1 | Install and configuration | Release build with the store configuration, nothing baked in. The manifest matches the frozen heads. |
| 2 | Vetting on the Farm | Applicant and vetter, one filled button per step. |
| 3 | "Your agent" | Segments, community cards, holdings. |
| 4 | Invitations | Console push, QR, OS camera. |
| 5 | Small screen and large text | iPhone SE-class (320–375 pt) and a small Android, at the largest text size: segment labels on one line with equal pill heights; the Joined strip wraps with no lone '›'; header, approval banner and community cards readable with no clipped buttons; "Codes match" above the tab bar. |
| 6 | Keyboard and reachability | Every step's button clear of the keyboard, by rectangle. |
| 7 | Words | Paste screen, errors in plain words with Details. |

Each release adds its own checks. For 226:
- the agent name is never a host;
- "Add a device" titles;
- the desk opens on Step 1, moves to sharing after New ticket, with the link behind Details;
- finished requests are folded;
- the paste screen says "link".

## 7. Report

One report to the release coordinator:
- the heads and artifact hashes;
- per-section pass/fail with evidence paths;
- the timing table;
- Farm or lab use, and environment failures (time, `cf-ray`);
- what the gate does not prove, such as hardware attestation on simulators.
