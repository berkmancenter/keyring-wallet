# Test acceleration — fewer runs on devices, faster loops, nothing proved less

**Status:** Proposed. No code written. Phase T0 needs no purchase and no decision beyond this plan.
**Scope:** how fast and how cheaply a change gets a trustworthy verdict, from commit to result: native builds, the Jest suites, the e2e harness, a Node protocol tier that does not exist yet, the emulator and simulator runs, and the physical-phone runs. It covers where each assurance is proved, what it runs on, and the order the work happens in. It is the one plan that sequences testing-speed work.
**Siblings:** [`release-cadence-and-testing-strategy/gate_efficiency_subtask.md`](./release-cadence-and-testing-strategy/gate_efficiency_subtask.md) owns the release gate: lanes, cadence, component-test moves, VTA contract fixtures, the flakiness policy and the coverage manifest. [`ios-builds-on-linux-plan.md`](./ios-builds-on-linux-plan.md) owns where iOS builds and gates run and the Mac purchase. [`openvtc-interop-harness-plan.md`](./openvtc-interop-harness-plan.md) owns interop with upstream's reference implementations. [`release-flow-plan.md`](./release-flow-plan.md) owns the branches and channels the builds feed; this plan changes how fast builds and checks run, not the flow.
**Reasoning:** [`test-acceleration-plan/2026-10-22-bam.md`](./test-acceleration-plan/2026-10-22-bam.md) holds the sources, what was adopted and dropped, the cross-reference findings, the unverified claims and the vendor and price research. This document states current design only; see [`CLAUDE.md`](./CLAUDE.md).
**Review:** [`test-acceleration-plan/2026-10-24-al.md`](./test-acceleration-plan/2026-10-24-al.md) — a review against what is built, with gate and CI numbers measured since 2026-10-22, conflicts with decisions already made, what the plan misses, and a careful rollout order (cheapest and most valuable first, one measured step at a time, nothing that works today broken). This plan adopts its rollout rules and order (§5, Rollout) and its stale-fact corrections; [`2026-10-25-bam.md`](./test-acceleration-plan/2026-10-25-bam.md) records the disposition of each proposal.
**Baseline:** repository facts are at `main` `4c78a1cf`, which pins bifold `7d668cd04`, checked by `ls`, `grep` and `git` on 2026-10-22. CI and gate durations are the figures measured 2026-10-22 to 2026-10-24 and recorded in the review; §2 says what is and is not measured.

---

## 1. Goal and boundary

**Goal.** A change gets its verdict from the cheapest layer that exercises the code it changed. Layers that need a person or a physical phone run only for what no lower layer can prove. Almost all of the time today is spent repeating setup (compiling React Native, onboarding a fresh app, waiting on fixed sleeps), not exercising the code under test. Success is measured: T0 produces the baseline and every later phase quotes its before and after against it.

**Owned elsewhere (this plan links and does not restate):**

| Item | Owner |
|---|---|
| Release-gate lanes, shared linked phone, cadence, nightly and weekly runs | gate efficiency subtask §§2–6 |
| Component tests with device twins kept two releases, fake-timer tests, VTA contract fixtures | gate efficiency subtask §7 |
| Flakiness ledger, quarantine, admission, verdict classes (app, harness, environment) | gate efficiency subtask §8 and `e2e/gate/ledger.mjs`; this plan **extends** them to runners and suites the gate does not see (§4.6) |
| Shortened clocks in test builds (`E2E_CLOCKS`) | gate efficiency subtask §3; on `main` |
| Where iOS builds and gates run, the Mac mini | ios-builds-on-linux plan |
| Interop with upstream's reference implementations | openvtc-interop-harness plan |
| Whether the Node tier retires runners from the release gate | gate efficiency subtask (§6) |

**Owned here:** measurement of what no gate leg measures; build and Jest speed (§5, U and B steps); e2e harness speed (§5, E steps); ports, fakes and contract suites (§4.1); the Node protocol tier (§4.3); the hardware canary and unattended biometrics (§4.2, §5 A steps); the retirement rule (§4.7); the dev loop (§4.5); the infrastructure tiers (§8).

## 2. What is measured today, and what is not

**Measured, on `main`.** The gate legs write `steps.tsv` (`e2e/gate/steps.mjs`); `ledger.mjs` reads each row's pass and fail record over recent runs; `coverage.mjs` keeps the committed manifest `e2e/gate/coverage.tsv`; `changed.mjs` maps a diff to legs. Durations measured 2026-10-22 to 2026-10-24 from the gate run records and the GitHub Actions API: wallet Testing 6–7 min; bifold Testing 22–27 min; `test-builds` median 47 min (range 32–58, p90 about 56), of which the iOS simulator build is 48–58 min and the Android build 37–43 min; the iOS store build is 24–33 min, so the simulator build takes about twice as long as the store build, a gap B2 explains before it is designed; `gate-smoke` median about 18 min (9–35). The release gate takes about 5 h start to end for a full run (candidates 269 and 270: 5 h 00 m and 4 h 56 m; 3 h 42 m at the 16-leg baseline), against the 75-minute target in the gate efficiency subtask. Summed leg time roughly equals wall-clock, because there is one Farm turn and the two halves run one after the other. Onboarding and linking (`run-vta-link.js`) is 36% of the summed time of candidate 270. The gate run records `summary.json`, `legs.tsv` and per-leg `steps.tsv` already exist for every gate run (T0.1 collects them; it does not create them).

**Not measured.**

- **The VRC runner family.** No `run-vrc-exchange*` runner is in the release gate, and `e2e:vrc` cannot run on Release builds, so the Node tier (T2) and the VRC retirements (T4) remove no minutes from the gate as it runs; the gate's time is the Farm-backed onboarding and linking and the serial Farm turn, which the gate efficiency subtask's items 6 and 7 and its phase 3 own. 21 of the 66 `e2e/run-*` files are `run-vrc-exchange*`. 44 of the 66 are named by no leg script (`e2e/gate/legs/*.sh`), no `e2e/gate/*.sh` and no workflow; `run-ota.mjs` is reached only by `gate-ota.yml`. So the gate's step times and ledger do not see those 44. No VRC runner reaches `runStep` (defined in `e2e/lib/keyringRoles.js`; 29 other runners call it indirectly through that file's helpers), and `docs/RELEASE_GATE.md` §5, which says every runner logs it, does not describe the VRC family.
- **Per-runner duration and flake rate across the 66 files.** No file in the repository records them. The gate Mac's `~/.keyring-fleet/gate/runs/*/summary.json` and the GitHub run artifacts hold part of the answer and are not collected where a plan can cite them.
- **The protocol-exchange share of a VRC run.** The exchange is projected at 10–12 s of a run of about 7 minutes (the polling comment in `app/src/utils/bc-agent-modules.ts`); the run total is read from code, not timed.
- **Jest wall time per file in CI.** Only suite totals exist.
- **Node against React Native parity** for AnonCreds, indy-vdr and the Askar binding layer: the versions match; core has run one Node test of the Askar binding since 2026-10-23, and none runs the AnonCreds or indy-vdr bindings (§4.3).

Therefore **T0 opens the plan**, and a later phase is ordered by what T0 shows.

## 3. Principles

1. **A check moves down the stack only if the lower layer exercises the same code.** A Node test proves the wallet's protocol logic only if it runs the wallet's own VRC and Trust Task modules. `@bifold/vrc-reference` does not qualify: its `package.json` has no `@bifold/core` dependency, and its Alice and Bob are its own implementations.
2. **Every relaxation is named and is paid back by a named run.** An e2e-only build, a seeded persona, a fake port or a skipped prompt each lists what it stops proving and which run still proves it.
3. **A fake is bound by a contract suite that also runs against the real adapter.** Mocks drift: `app/jestSetup.js` replaces `@bifold/react-native-attestation` and `@openwallet-foundation/askar-react-native` with `{}`, which proves no behaviour.
4. **A green emulator or fake run is never read as hardware evidence.** Each fake and each environment reports the key tier it provides (software, TEE, StrongBox, Secure Enclave), and a contract test asserts it.
5. **No test that gates a pull request touches a live service.** The Farm and the local VTI stack belong to the gate and the nightly runs.
6. **Measure, then change; retire only on evidence.** Step costs read from code are hypotheses until T0 times them, and a device runner is retired only under §4.7.
7. **A cache is keyed so a hit cannot be wrong.** A cache that once served stale codegen output is fixed by correcting its key, not by deleting it on every run.
8. **Nothing that works today breaks.** Required checks, store builds and the release gate keep behaving exactly as they do until a step is proved; a step changes one thing and reverts on its own.
9. **Prove on the test path before the release path.** Build and caching changes land in `test-builds.yml` and run green several times before any store or release workflow takes them. A push to a branch that ships to testers is never used to try something: it ships the code to every tester.
10. **Shared machines take one heavy job at a time.** Jest, builds and gate legs take a slot on the shared Macs, Jest runs with `--maxWorkers=2`, and each step that adds caches, snapshots or build trees states its disk use and its cleanup rule (an iOS Release simulator build is about 8.4 GB; the gate Mac has a 256 GB disk).
11. **Tests are found by CI, not listed.** A hand-kept list left 34 harness tests running nowhere until #586; `e2e/runners.tsv` is generated or checked against the tree, and a Node harness in a new package carries its own CI job.
12. **Build identity on every device.** Every canary, snapshot or frozen-artifact run checks each device's bundle hash against the candidate; a device left on the previous build once gave a false pass (#596).
13. **Native changes need a compile check.** B2–B4 and A2 change native configuration and wait for the native-path test builds by name (`test-builds.yml` path filters, #572, #602); B1 never bypasses them.

## 4. Design

### 4.1 Ports, fakes and contract suites at the native seam

One typed interface per native or hardware capability; the wallet's code depends only on the interface.

| Port | Real adapter today | First fake |
|---|---|---|
| Hardware signing and attestation | `createHardwareSigningService()` in `bifold/packages/core/src/hardware-signing/service.ts` over `@bifold/react-native-attestation` | Software signer with a test-CA attestation chain |
| User authentication (biometric, passcode) | The biometric confirmation modal and the hardware-signing prompt path | Scriptable: succeed, cancel, lock out, key invalidated |
| Key management | The Askar, ephemeral and `SecureEnvironmentKeyManagementService` backends in `core/src/utils/agent.ts` | The Askar backend in a Node process (it already exists) |
| Local radio transport (co-presence) | `@bifold/react-native-locality-peripheral` | In-memory transport pair |
| Push, camera and QR, permissions | their libraries | Deferred; added only when a retired runner needs one |

`createHardwareSigningService()` is the seed: the interface (`isAvailable`, `prepare`, `signPayload`, `verify`) exists and takes an injectable logger, attestation cache and id generator, but its native calls are not injectable and `isAvailable` binds to the native module.

Each port has **one contract suite**, written against the interface. It runs against the fake on every pull request, in Node and Jest. It runs against the **real** native adapter through one mechanism: an in-app contract screen, present only in test builds and guarded out of store builds the way `E2E_CLOCKS` is (§4.5), that runs the suite in the app's own JS engine and shows each result as text under a testID; Appium reads it. The same screen runs on an emulator (software Keystore) and on the canary phones. Fakes carry fault injection for what a device cannot stage on demand: lockout, key invalidation, attestation rejected, radio disconnect, permission denied.

The contract harness is ours to write. TurboModule codegen checks signatures and Expo's generated Jest mocks check nothing behavioural; neither stands in for it.

**Conditional.** Which seams can be made injectable without disturbing the roughly one hundred `Platform.OS` and `Platform.select` sites is unmeasured. P1–P4 start with the two own native packages and the key-management seam, where an interface exists, and stop there until a contract suite has caught a real divergence or run clean for a release.

### 4.2 Hardware canary and unattended biometrics

Only assertions no lower layer can make run on physical phones: StrongBox and Secure Enclave key creation, the Google-rooted and Apple attestation chains, the biometric prompt, the BLE radio, and the React Native binding layer under the same exchange the Node tier runs. They run nightly when a phone is attached and once per release candidate, on frozen artifacts, never per pull request.

**Canary content** (three runs, each with a fixed pairing):

1. **Android and Android**, attested and biometric: a witnessed exchange, with the in-app contract screen (§4.1) run on each phone before it. The screen includes one **AnonCreds issue-hold-present and one Askar store round trip** through the React Native bindings, so the Node tier's parity hypothesis (§4.3) is checked on the device's own engine every time.
2. **iPhone and Android**, attested: the iOS side of App Attest and the Secure Enclave, paired with an Android phone so a second iPhone is not required. (`e2e/run-vrc-exchange-witnessed-devices.js` already runs this pairing.) The same exchange the Node harness runs also runs here, on Hermes.
3. **BLE co-presence**, required and confirmed, on two phones with a real Bluetooth adapter on the host.

Carriage variants of those runs (DIDComm v2, TSP, witness mediator mode) prove protocol, not hardware, and belong to §4.3.

Unattended biometrics (steps A1–A4, §5) remove the person from runs 1 and 2. A short **attended release gate** on production-configured builds, with a real biometric on each platform, remains the only run that proves the prompt appears and that a biometric method is recorded; it runs once per release candidate.

**Android, no app change.** The attestation key is bound to user authentication for 300 s (`USER_AUTH_REUSE_WINDOW_SECONDS` in `AttestationModule.kt`) with `AUTH_BIOMETRIC_STRONG or AUTH_DEVICE_CREDENTIAL` through `setUserAuthenticationParameters`. Signing tries `initSign` without a prompt and asks only on `UserNotAuthenticatedException`. Before each signing step the harness unlocks the secure lock screen with the device PIN over adb, which per the platform's `KeyGenParameterSpec.Builder` documentation authorises keys with a validity duration for that duration. If that proves insufficient, the fallback is typing the PIN into the prompt's "Use PIN" screen over adb. This still proves a StrongBox-backed key, a Google-rooted chain, the attested auth type and timeout, and a minted user-authentication token. It does not prove that a biometric matched or that the prompt rendered.

**iOS, e2e-only build configuration.** WebDriverAgent cannot drive Face ID or the passcode sheet on a physical device, and no API fakes Face ID there. An e2e build configuration, selected at compile time and never present in Release, skips `evaluatePolicy` in `Attestation.mm` (the call is at the `laContext evaluatePolicy:` site) and in `LocalityPeripheral.swift`, and records `authenticationMethod: "E2EBypass"`. It still proves the Secure Enclave key, the Apple attestation chain, the counter and the assertion over the content hash. It does not prove that the app gated signing on LocalAuthentication. The bypass flag and string exist on `main` nowhere today (`grep` for `LA_BYPASS` and `E2EBypass` finds nothing).

**Conditional.** The Android design depends on the keyguard unlock opening the key's authorisation window on current Pixel firmware, which is unmeasured (step S1). If it does not, the "Use PIN" fallback applies; if that is unreachable too, Android stays attended, like iOS without the bypass.

PR #238 (`worktree-e2e-devices-runner-unify`) folds nine physical runner files behind `DEVICE_PLATFORMS`. That changes the file count and no scenario; §4.7 counts scenarios and evidence, not files.

### 4.3 Node protocol tests off-device

**Conditional design.** This tier depends on spike T1.2 showing that the wallet's own protocol code runs outside React Native; principle 1 rules out settling for the existing reference agents.

The harness is two real `@bifold/core` agents, over `askar-nodejs`, against a local mediator and the real witness-server, running the wallet's own VRC and Trust Task modules end to end with no UI. Native-only modules (secure environment, attestation) are replaced by the §4.1 fakes.

What already runs in Node, on the same patched `@credo-ts/*` `0.7.1-pr-2704-20260909134930`: `credo-tsp-adapter` (three Jest files over `@credo-ts/node` and `askar-nodejs`), `vrc-reference` (13 integration test files over real HTTP on localhost, plus unit tests), `witness-server` (24 test files) and the `tsp-reference` rungs. In CI `vrc-reference` runs only `__tests__/unit`: its `test` and `coverage` scripts run unit tests only, and `test:ci` adds the integration runner (`scripts/run-integration.mjs --ci`) but no workflow calls `test:ci`.

What is missing, and which step adds it:

- **A Node version** (T1.1). `package.json` and `bifold/package.json` say `>=20.19.2 <21.0.0` and `.nvmrc` says 20.19.2; the `vrc-reference` README asks for Node 22+.
- **Native bindings** (T2.2). `askar-nodejs` is in `bifold/yarn.lock`; `@hyperledger/anoncreds-nodejs` and `@hyperledger/indy-vdr-nodejs` are in neither lockfile. Matching Node versions exist on npm and are understood to fetch the same Rust release tags as the React Native wrappers; the FFI layer differs (koffi against JSI), so parity there is a hypothesis, checked on a device by canary run 1.
- **An in-memory DIDComm transport** (T2.1). Credo's inbound and outbound transport interfaces are small (`start`/`stop`, `sendMessage`); a local pair removes port allocation. Whether Credo publishes one is unverified.
- **A hermetic fixture set** (T2.1): a local mediator, the witness-server, a software issuer and seeded personas, with no Farm and no tunnel.
- **The `ui`/`node` Jest split** (U5), so Node-environment tests importing wallet modules do not pay React Native setup.

**Cannot move off-device:** hardware-backed keys and biometric signing, attestation beyond offline verification, the BLE radio, camera and QR, push, lifecycle and background behaviour, the React Native binding layer, **the Hermes engine** (§7) and the UI. These stay in §4.2 and the emulator smoke.

**Store migration.** The wallet's migration orchestration (`bifold/packages/core/src/utils/migration.ts`) goes to Node, tested against an Askar 0.2 store fixture, provided `askar-nodejs` exposes the migration the wallet calls (unverified). The in-place Askar 0.2 to 0.6 migration through the React Native binding stays on a device as emulator smoke (`run-store-migration*`); no Node test replaces it.

### 4.4 UI tiers

| Tier | Proves | Where | Owner |
|---|---|---|---|
| Component tests (React Native Testing Library) against fake ports | Words and elements after a local interaction; screen logic | Every pull request | gate efficiency subtask §7 |
| Fake-timer tests | Clock-driven behaviour: grant window, auto-lock, back-off | Every pull request | gate efficiency subtask §7 |
| Layout rules by rectangle | Clipping, wrapping, button against keyboard | Emulator, in the gate | `e2e/lib/layoutRules.js` |
| Journey smoke on an emulator or simulator | Install, onboarding, link, update over an old build, lock, push permission, deep links, store migration | Gate and CI smoke | gate efficiency subtask; this plan keeps it to roughly 15 to 17 runners (§4.7) |

A web-rendered tier (react-native-web with Storybook screenshots) is **not part of this plan**: §9 records the constraint.

### 4.5 Dev loop

- **Fake-ports dev mode.** A development build whose hardware ports are the §4.1 fakes, so UI and flow work needs no phone, no attestation and no biometric. It is selected by a build-time switch and refused in store builds by the same kind of check that guards `E2E_CLOCKS` (`.github/workflows/quality.yml`, step "Only test builds set E2E_CLOCKS"). The in-app contract screen (§4.1) is guarded the same way. A store build that carries a fake port or the screen is a release defect.
- **Fail early on a bad checkout** (D2). A preflight reports, before any build or run, the inputs a worktree lacks (`e2e/README.md`, "Running from a second worktree"): the initialised submodule, `app/.env`, `app/android/local.properties` and `e2e/node_modules`, and a stale `bifold` build output. Each fails late and differently today.
- **Warm Metro before the first session.** PR #483 (`fix/e2e-metro-warm`, draft) fetches each platform's dev bundle before the first Appium session.
- **Source hot-reload stays.** `@bifold/*` packages resolve to source in dev through `BIFOLD_SOURCE_PACKAGES` in `app/metro.config.js`; no step adds a build between an edit and a reload.
- **`jest --changedSince` is not part of the design** (§9).

D2 and PR #483 depend on nothing else in this plan and can start at any time.

### 4.6 Flake and speed discipline

Gate rows have a ledger, a verdict per red (app, harness, environment), quarantine under 90% over 14 days, and admission after three green runs (gate efficiency subtask §8). This plan extends the same rules unchanged to what the gate does not see:

- **Non-gate runners** report per-step duration and a pass or fail record in the `steps.tsv` and ROW-line formats the ledger reads.
- **Jest** uploads `--json` per-file results from CI as artifacts, so the wall time of every file is readable without re-running.
- **`tracked:` rows** (`e2e/lib/rows.js`) carry a reason and nothing else. Each gains an owner and an expiry date, and the ledger lists the expired ones.
- **PR-gating tests have fixed clocks, seeded keys and no live network** (principle 5).

### 4.7 Disposition of the 66 runners, and the retirement rule

**Estimate, not measurement.** Counted by `e2e/run-*` file, each classified once by its dominant assertion from its header and flow, not from run data. T0.3 replaces this table with a committed manifest and T0.1 supplies measured figures.

| Class | Files (approx.) | Destination |
|---|---|---|
| Protocol: VRC exchange family on emulators (plain, TSP, DIDComm v2, witnessed, approver, credential-exchange query) | 9 | Node harness; one journey stays as emulator smoke. Existing Node precedent covers the same flows |
| Protocol: VTI, Farm, agent, approval and vetting runners | 16 | Node harness where the wallet-side logic runs headless; **medium confidence**, depends on T1.2. They need the Farm or the local VTI stack today, so the gate keeps them until the Node tier covers them |
| UI and journey | 21 | About 10 stay as emulator smoke; the rest become component tests (§4.4) |
| Hardware, physical and attended | 12 | The three canary runs; carriage variants go to Node |
| Store migration and push probes | 4 | Emulator or simulator smoke; no fake validates them |
| Not yet classified (`run-ota`, `run-pair-ios`, `run-agent-refused`, `run-signin-member`) | 4 | Classified in T0.3 |

If the estimate holds, about 15 to 17 Appium runners remain, a cut in runner count of roughly four to one. The count is a proxy: it moves risk only when a retirement meets the rule below.

**A runner retires only when all of these hold:**

1. **Every ROW and log marker the runner asserts** is listed in `e2e/runners.tsv` and asserted by a Node test, the canary, a retained smoke or a component test.
2. Reverting one known fix in the covered path makes the covering Node test fail (the check of step N2, shown once and recorded).
3. Any hardware claim the runner carried is named in the canary.
4. Any React Native binding, Hermes or UI claim the runner carried is named in a retained emulator smoke.
5. The change to the coverage manifest in the same diff removes no row except the ones named.
6. The device row leaves the per-release gate only **two releases** after its covering test lands, and then stays in the nightly run (gate efficiency subtask, decision 5 of `release-cadence-and-testing-strategy/2026-10-14-al.md`). Until then both run.

**The core journeys never retire from the per-release gate**, whatever covers them elsewhere: vetting (including hidden vetting), joining, agent link, the mediator, and sign-in. A feature with two phones in it keeps a two-phone run on the Release build.

## 5. Phases

Each phase ends with a measured before and after in a dated companion. Step identifiers group by family: `T` (phase steps), `U` (unit-test speed), `B` (builds), `N` (Node harness, inside T2), `P` (ports), `E` (e2e harness), `S`, `A` and `V` (biometrics and verification), `D` (dev loop).

### Rollout

Each step records the baseline it starts from and the number it produced (job minutes, gate minutes, flake rate) in its PR; a step that does not move its number is reverted or rethought, not stacked upon. A step starts only after the previous step's numbers are recorded. The dependencies below still bind inside this order.

| Step | Items | Measure |
|---|---|---|
| 1. Measure only, no behaviour change | T0.1 (export the existing gate and CI records once, with the 2026-10-14 method); a corrected automatic verdict that separates harness, environment and app causes (it labelled 10 of 13 reds as app failures when 1 was); T0.4 | A published baseline; verdict accuracy against a hand classification |
| 2. CI-only test speed | T1.1; U2; U1; then U6 | bifold `Testing` from 22–27 min; wallet `Testing` from 6–7 min |
| 3. Test-build speed, test path only | B6; B4 (with the codegen key); the simulator-versus-store investigation, then B2; B3 after deciding what store parity it gives up | `test-builds` median from 47 min |
| 4. Gate items already owed | gate efficiency subtask item 6 (merge relaunch into update); E3; build identity checked inside the gate; the TUI driver waiting on state; new harness code proved first (`dry --golden`, the gate's tests in CI) | Gate wall-clock from about 5 h; red legs by cause |
| 5. Larger work, each gated by a spike | T1.2, then T2; the shared linked phone (subtask item 7) and separate runner lanes (subtask phase 3); A1 | Gate wall-clock toward 75 min; device runs per release. Each starts only when steps 1–4 show it is still the bottleneck |

Not taken: B7 and E5 (§9), E6 and Tier 3 for Farm-backed suites (§8), and the retirement of any core journey (§4.7).

### T0 — measure

| # | Step | Acceptance |
|---|---|---|
| T0.1 | Collect the gate Mac's `summary.json` files and the GitHub `gate-ci` and `gate-smoke` run artifacts for the last 30 days; run `ledger.mjs --json`. Re-time the quality workflow, bifold Testing, core Jest cold and warm, and the Android and iOS test builds | A dated companion table: median and 90th-percentile duration and pass rate per leg, row and CI job, or "no data" per runner. Every U and B acceptance below is re-expressed against these figures |
| T0.2 | Give the VRC family per-step timing and a ROW record in the `steps.tsv` and ledger formats (the `runStep` pattern of `e2e/lib/keyringRoles.js`); output a JUnit file and a per-step duration table | One timed run each of `e2e:vrc`, `e2e:vrc:witnessed` and one device pair; the split of setup against protocol exchange is a recorded figure; every `run-vrc-exchange*` runner emits step durations |
| T0.3 | Commit `e2e/runners.tsv`, one line per runner and asserted marker, with class, device count, backend, destination and status. It stays separate from `coverage.tsv`: that file keys leg by row for what a gate run proves, this one keys runner file by marker for what retirement needs. A `quality.yml` check keeps them from drifting | Every `e2e/run-*` file has at least one line. The check fails on a runner file with no line, on a line naming a file that does not exist, and on a leg in `coverage.tsv` that runs a runner with no line; each failure is demonstrated once |
| T0.4 | Time one run each of `vrc-reference`'s integration suite, `credo-tsp-adapter`, and `tsp-reference` `ref-06v1b` and `ref-06w` (`nice -n 10`, memory checked first) | Seconds recorded, with the Node version; the result decides T1's scope |

### U — unit-test speed

Figures in parentheses are from a developer workstation on a feature-branch tree on 2026-09-29, bifold `9a008d7b5`; T0.1 re-measures them.

| # | Step | Acceptance |
|---|---|---|
| U1 | Remove the per-test `require('./src/hooks/notifications')` from `bifold/packages/core/jestSetupAfterEnv.js` (line 8 today). Move the exclusion set into a dependency-free module that the hook and the setup file both import, or clear it only if the module is already in `require.cache` | All core suites pass. An empty test file runs in under 2.5 s warm (5.8 s measured). Core warm CPU time drops by at least 25% |
| U2 | Persist the Jest transform cache in CI for `app/` and every bifold package, keyed on `yarn.lock`, the Babel and Jest configs and the Node version. Today CI caches only `.yarn/cache` | A second CI run with an unchanged lockfile shows app Jest under 30 s (141 s cold, 20 s warm) and the smaller bifold packages within 20% of their warm local times |
| U3 | Replace real-timer waits with injectable timeouts or fake timers in the core files T0.1 shows over 10 s warm. Where the timeout is the behaviour under test, keep one test at the real value and pass a small value everywhere else | No core test file takes over 10 s warm; each file's assertions are unchanged |
| U4 | Transform `node_modules` with `@swc/jest` or esbuild, covering the `@credo-ts` ESM builds and `.mjs` files. Keep Babel for first-party source, which needs the reanimated plugin and the module-resolver aliases | The cold core run is at least 40% faster, with all suites passing and identical snapshot output |
| U5 | Split core's Jest config into two projects: `ui`, keeping the React Native preset, and `node`, using the node environment and minimal setup for files that never render | Every file runs in exactly one project; `node`-project files each take under 1 s of setup |
| U6 | Shard core across four CI jobs. Run the bifold package suites and their coverage in parallel (`foreach -p`), merging coverage afterwards | Bifold Testing wall time is under 4 min (22 min today), and merged coverage matches the serial run |

### B — builds

Build and caching steps land on the test path (`test-builds.yml`) first (principle 9). B2–B4 wait for the native-path checks by name (principle 13). B2 starts by explaining why the iOS simulator build takes about twice as long as the iOS store build (§2). B3 starts by deciding what store parity it gives up.

| # | Step | Acceptance |
|---|---|---|
| B1 | **JS-only fast path in CI.** Run `scripts/ci/js-only.mjs` against the last native build's commit; when it answers *js-only*, reuse that native build and swap the new bundle in with `scripts/ci/js-swap.sh`. Both scripts exist and no workflow calls them. B1 shares its change detection with the OTA path: `scripts/release/tier.mjs`, `ota-fingerprint.yml` and `e2e/gate/changed.mjs` already exist and #602 added native-path build triggers, so B1 adds no fourth detector; the decision is made once, with the OTA subtask (§6) | A JS-only change to `main` produces both test artifacts in under 8 min. A native change still triggers a full build. The artifact manifest records which path ran |
| B2 | **iOS:** enable prebuilt React Native core and dependencies (`RCT_USE_PREBUILT_RNCORE=1`, `RCT_USE_RN_DEP=1`) in the Podfile and CI, add ccache, and cache DerivedData keyed on `Podfile.lock` plus the native fingerprint. Neither setting is in the Podfile today. Whether RN 0.81 supports the prebuilt path is unverified, and B2 starts by checking | The Release simulator build takes under 12 min cold and under 6 min on a cache hit (42–55 min today). The app launches and the attestation and keychain paths pass the smoke e2e |
| B3 | **Android:** test and e2e builds compile `arm64-v8a` and `x86_64` only; store builds keep all four ABIs. `gradle.properties` already carries `reactNativeArchitectures`, but `defaultConfig` in `app/android/app/build.gradle` hard-codes all four `abiFilters`; one property must control both. Drop `bundleRelease` from test builds, since nothing uploads the AAB (`test-builds.yml` runs `bundleRelease assembleRelease`) | The test-build APK contains exactly the two ABIs; the staging and release AABs contain all four |
| B4 | **Gradle:** enable the daemon in CI (`org.gradle.daemon=false` today), parallel builds and configuration cache; lower logging from `info` to `lifecycle`. Restore `~/.gradle/caches` with a key that includes the codegen inputs (every `package.json` under `node_modules/*/android` and the native fingerprint), and remove the unconditional `rm -rf ~/.gradle/caches` before the build in `test-builds.yml` | Configuration takes under 60 s on a cache hit; three consecutive cached builds succeed with no missing-codegen failure |
| B5 | **Bifold builds once and incrementally.** `scripts/ensure-bifold-ready.js` skips the build when a content hash of `bifold/packages/*/src`, the configs and the bifold pin matches the last build's stamp (it keeps no stamp today). The per-package `build` scripts stop running `clean` first, and CI builds bifold in one step that the root install reuses | A second `yarn install` with no bifold change skips the build; each CI job builds bifold at most once |
| B6 | Cache `.yarn/cache` and `bifold/.yarn/cache` in every workflow. Stop resetting Metro's cache in CI (`--reset-cache` in `test-builds.yml`), and bundle once rather than both by hand and inside Gradle | `Install dependencies` takes under 60 s on a hit in every workflow; the Android build log shows one bundling step |

### T1 — Node foundation

| # | Step | Acceptance |
|---|---|---|
| T1.1 | Choose one Node version; run `vrc-reference` integration (through `test:ci`) and `credo-tsp-adapter` in CI on it | Three consecutive green CI runs; wall time recorded |
| T1.2 | **Spike.** Run one VRC exchange through the wallet's own `modules/vrc` services and Trust Task module in Node, native-only modules stubbed behind interfaces | A written answer in a dated companion: which wallet files import React Native packages (22 files in `modules/trust-tasks/module/` match the string `react-native`, which includes `@credo-ts/react-native`; how many are real dependencies is unmeasured) and the smallest seam that removes them. §4.3's conditional resolves here |

### T2 — two-agent harness

| # | Step | Acceptance |
|---|---|---|
| T2.1 | In-memory DIDComm transport and the hermetic fixture set | Two agents complete a connection in a test with no port and no network |
| T2.2 | `anoncreds-nodejs` and `indy-vdr-nodejs` as dev dependencies; one issue, hold, present test with no ledger | The test passes on the chosen Node version; if not, the failure is recorded and §4.3 narrows to DIDComm and Trust Tasks |
| T2.3 | **N1.** Two agents with the same agent-module configuration the app uses, native-only modules replaced by the P-step fakes, in Jest (node project) or plain Node | A VRC exchange between the two agents completes in under 15 s |
| T2.4 | **N2.** Cover the protocol surface the device runners cover: DIDComm v1 and v2, TSP carriage, the Trust Task propose, issue and receipt markers, the witness ceremony and VWC issuance, mediator fallback, and store-migration orchestration (§4.3) | Each area has a Node test that fails when the corresponding wallet module is broken, shown by reverting one known fix per area and watching the test fail |
| T2.5 | **N3.** Run the harness on every pull request in the quality workflow | The harness takes under 3 min in CI |

### P — ports and fakes

| # | Step | Acceptance |
|---|---|---|
| P1 | Make the hardware-signing service's native calls injectable; software fake with fault injection and tier reporting | Contract suite green on the fake in Jest and Node |
| P2 | **Real-adapter half.** The in-app contract screen (§4.1) in test builds, with the store-build guard, running the P1 suite and the AnonCreds and Askar round trip; an Appium driver reads its result | On an emulator the suite is green against the software Keystore and reports the software tier; the `quality.yml` guard fails on a fixture store configuration that carries the screen |
| P3 | User-authentication and key-management ports and suites | Contract suites green; a test asserts the reported tier is never StrongBox or Secure Enclave on an emulator |
| P4 | Replace the `{}` mocks of the two own native packages in `app/jestSetup.js` with the fake | `app/jestSetup.js` carries no `{}` mock of `@bifold/react-native-attestation` |

### E — e2e harness speed

| # | Step | Acceptance |
|---|---|---|
| E2 | **Persona state instead of onboarding, for the hermetic VRC family only.** Golden personas per app build: an Android emulator snapshot saved explicitly (`adb emu avd snapshot save`, modification time checked) with the app installed and onboarded, and an iOS simulator cloned from an onboarded golden one (`xcrun simctl clone`). Physical phones reinstall over existing data (`E2E_KEEP_STATE`). One onboarding smoke per pipeline run keeps covering onboarding. The gate keeps its own shared-phone design (gate efficiency subtask §4). **Conditional** on T0.2 showing onboarding is a large share of a VRC run; if T2 retires the family, E2 is dropped | The VRC flow reaches Contacts on both devices within 30 s of session start; the onboarding smoke still runs on every pipeline execution |
| E3 | **Event-driven waits.** Replace fixed sleeps and poll floors with waits on the log markers the harness already reads, or on element presence: `unlockIfLocked`, `handleBiometricConfirmIfPresent`, `dismissTourIfPresent`, `acceptRelationshipProposalIfPrompted`, the `assert*Markers` polls, the tunnel settle in `e2e/lib/witness.js` and the iOS camera-grant sleeps. Onboarding detects the current screen with one query instead of trying each screen with a 2 s timeout | No unconditional `sleep` of 1 s or more remains outside a documented exception; every step T0.2 shows dominated by waiting halves or better |
| E4 | **Shared services for a suite.** Appium, Metro or the embedded bundle, the witness, the mediator and the tunnel start once per suite, not once per scenario | A three-scenario suite's startup cost is paid once, as shown in the T0.2 table |
| E5 | **Not taken.** Exposing the invitation in release test builds was rejected on 2026-10-15; see §9 | — |
| E6 | **Parallel pairs, for hermetic suites only.** Two Farm-backed lanes on one Farm runner collide on its access list and rate limit (decided 2026-10-14), so each Farm-backed lane keeps its own runner and the gate's halves run one after the other. The runner takes a device-pair pool and spreads scenarios across it; Android pairs run on Linux KVM hosts, pairs including iOS on Mac hosts | With N pairs, suite wall time is within 1.3 times (longest scenario × ceil(scenarios / N)) |

### A — unattended biometrics

The two verification gaps found beside these steps (Android `noAuthRequired` and the iOS `authenticationMethod` label) concern security behaviour, not test speed, and are not steps of this plan; they are tracked separately (§6).

| # | Step | Acceptance |
|---|---|---|
| S1 | **One-day spike**, answering: on a current Pixel, does a keyguard PIN unlock over adb let the prompt-free `initSign` succeed, and what method does the evidence record? Does `adb shell input text` reach the "Use PIN" screen, and does UiAutomator2 see its elements? What does `setInvalidatedByBiometricEnrollment(true)` do on a test phone with no fingerprint enrolled? Is a compile-time build configuration enough to keep the iOS bypass out of every shipped binary, TestFlight builds, which are dispatched on `release/*` branches, included? | Each question answered in a dated companion |
| A1 | A harness helper `unlockKeyguardWithPin(device)` (wake, `keyevent 82`, `input text`, enter), called before each Android signing step | An Android witnessed exchange on a physical Pixel completes with no operator, 10 times in a row |
| A2 | An iOS e2e build configuration with a compile-time `KEYRING_E2E_LA_BYPASS` flag, plus a CI check that the Release binary contains neither the symbol nor the `E2EBypass` string | The check fails if the flag leaks into Release; an iOS physical-device exchange completes with no operator |
| A3 | Production verifiers treat `E2EBypass` evidence as a verification failure | A unit test in `core/src/hardware-signing` covers it |
| A4 | Rewrite the device leg of `docs/RELEASE_GATE.md` as the attended gate (§4.2) | The gate lists exactly the claims only it proves |

### T4, T5, T6 — retirement, canary, dev loop

| # | Step | Acceptance |
|---|---|---|
| T4.1 | Retire runners from the per-change path in the order: emulator VRC family, then carriage variants of the physical runners, then VTI runners as T1.2 permits. A gate row leaves the per-release gate only under §4.7 condition 6, and never a core journey | Each retirement meets all six conditions of §4.7; `e2e/runners.tsv` and the coverage manifest change in the same diff |
| T5.1 | Reduce the physical runs to the three in §4.2, coordinated with PR #238 | Three physical runners remain; each hardware claim of a retired runner appears in the canary; the Android-and-Android run includes the in-app AnonCreds and Askar binding round trip; the iPhone-and-Android run includes the exchange the Node harness runs. The iPhone run waits on §6 |
| T6.1 | Fake-ports dev mode and its store-build guard | The attested and witnessed path completes on an emulator with the fake signer, and the evidence reports the software tier; the `quality.yml` guard fails on a fixture store configuration that carries the switch |
| D2 | Checkout preflight | Reports each missing input in under five seconds on a bare worktree |
| T6.3 | Extend the ledger to non-gate runners and Jest; owner and expiry on `tracked:` rows | The ledger prints Jest and non-gate pass rates; no `tracked:` row lacks an owner and an expiry |

**Dependencies.** T0 first; it orders everything after it. U, B, T1 and P are independent of each other and can run side by side. T2 needs T1 and U5. E needs T0.2. T4 needs T2 and T0.3. T5 needs T4's carriage-variant retirements and A1–A2 for an unattended canary. D2 and PR #483 need nothing and can start any time.

## 6. Blocked, and on whom

**Not decided, owned elsewhere:**

- **A Mac with a paired iPhone and an iOS signing identity, for the iPhone canary run and for attended iOS gates.** The Mac mini already runs gate legs (since 2026-10-15) and has been a full gate machine since 2026-10-20; what it lacks is disk headroom (256 GB, 16.8 GB free on 2026-10-24), a paired phone and an iOS signing identity. Any purchase is the ios-builds-on-linux plan's decision, waiting on whoever holds the budget (its step 1). The canary's iPhone run (T5.1) and A2's physical-device acceptance wait on it.
- **Whether the Node tier retires the VRC emulator runners from the release gate or only from the per-change path.** Owned by the gate efficiency subtask; T4.1 retires from the per-change path first and leaves the gate's membership to that document.
- **A hermetic backend for the VTI, agent, approval and vetting runners.** The local VTI stack builds six Rust services from upstream; running it in CI is a separate decision, not taken here, and T4.1's VTI step stays gated on it.
- **Hardware beyond the existing phones** (§8, Tiers 1–3) waits on a budget decision by the project leads.

**Open items with no owner found:**

- **V1 and V2 tracking.** The two verification gaps (Android `noAuthRequired` is not enforced; iOS `authenticationMethod` is device-reported and shown on `CredentialOffer.tsx`) were removed from this plan because they are security behaviour, not test speed. No tracking issue or plan carrying them with an owner was found in the repository. Until one is named, they are unowned: someone names the owner and links the tracking from here.
- **P2 against the 2026-10-15 rejection (§9, E5).** P2's in-app contract screen in test builds sits close to the rejected invitation exposure. The nearest precedent in its favour is `E2EClockRows`, shown in test builds only. Whether that distinction holds is a product-owner call; P2 does not start before it is made.

**Decided, waiting on someone:**

- **Gate Mac run history (T0.1).** The data is on the machine that runs the gate; it waits on whoever operates it to export it.

**Not decided, owned here:**

- Where Node harness tests live: the `node` project of core's Jest configuration (U5), or a new package. T1.2 informs the choice.
- Which Node version (T1.1).
- B1's JS-only test-artifact path and the OTA bundle path share their change detection (decided, §5); the remaining question is with the OTA subtask.

## 7. Risks

- **Fakes diverge from the real adapters.** Mitigated only by the contract suites being mandatory (principle 3); a fake without a suite does not merge.
- **The wallet's own modules may not run headless.** Their React Native imports could be deep. T1.2 is a spike with a written answer; if it is no, §4.3 stays on `vrc-reference` and `credo-tsp-adapter`, retirement is limited to protocol the wallet shares with them, and this plan says so.
- **Hermes and V8 differ.** The app runs on Hermes and the Node tier on V8. The cryptography is byte-identical for the probes `tsp-reference/ref-03b-hermes-identity` measures (HPKE, transcript hashes equal on both engines), and `ref-03d-bls12-381-hermes` shows the same bytes at roughly 17 to 18 times the cost on Hermes, so correctness probes carry over and timing, BigInt and runtime-surface behaviour do not. A green Node exchange is therefore not an on-device result; the canary runs the same exchange on Hermes (§4.2) and the retirement rule's fourth condition names any Hermes claim a runner carried.
- **Node and React Native bindings differ at the FFI layer.** Same Rust cores, different loaders (koffi, JSI). Canary run 1 carries the on-device AnonCreds and Askar round trip.
- **Retiring a runner removes a check nobody listed.** Rule 1 of §4.7 lists every asserted marker first, and the coverage manifest diff and rule 3 exist for the same reason.
- **Runner-count reduction overstates the gain.** PR #238 removes nine files and no scenario; retirement is counted by evidence.
- **A cache that hits wrong.** B4 and U2 are keyed on their inputs (principle 7); the staleness fix is the key, not deletion.
- **Measured numbers may not support the premise.** If T0 shows device runs are not where the time goes, the phases after it are reordered.

## 8. Infrastructure tiers

Each tier includes the ones before it. The software work above delivers most of the speed and needs no purchase. Cash figures are in the companion with their dates and sources.

| Tier | Adds | What it unlocks |
|---|---|---|
| **0 — software only** | Everything in §5 on existing GitHub-hosted runners | Most of the build and Jest gain and most of the per-run e2e gain; fewer macOS runner minutes, since each push to `main` runs a 48–58 min iOS simulator build today |
| **1 — one attestation pair** | One current Pixel and one current iPhone on an existing Mac | Hardware attestation proven on current hardware nightly and at release, one pair at a time |
| **2 — emulators on hosted runners** | Android emulators on hosted runners, nightly or on request. Already running at no cost in `gate-smoke.yml` and `gate-ci.yml` | Emulator e2e in CI without a local host |
| **3 — full hybrid** | A second device pair, a self-hosted iOS runner beyond the Mac mini's current gate role, emulator e2e on every pull request. Cost is about USD 5k against a stated budget of USD 50 now and up to USD 400 later, so it is not funded. It suits hermetic suites only: Farm-backed suites cannot run in parallel lanes on one Farm runner (E6) | Two hardware runs at once, and e2e per pull request on both platforms |

Device rules: **buy devices provisioned with remote key provisioning (2023 or later)**, since the legacy Google attestation root expired on 2026-05-24 and a pre-RKP device can show only the tolerated "Hardware Verification Issue" state (`docs/HARDWARE_ATTESTATION_FLOW.md`, known limitation 5); **buy devices supported through at least 2030**; **buy devices that can stay on the charger** (a charge limit or bypass charging), and supervise iPhones with Apple Configurator.

The starting point is **Tier 0 plus one attestation pair**. Move up only when one-pair-at-a-time hardware runs, or iOS e2e off the pull-request path, becomes the measured bottleneck.

## 9. Options considered and not chosen

- **A bake-off of Maestro, Detox and Appium.** The project lead decided on 2026-10-14 that Appium stays (`release-cadence-and-testing-strategy/2026-10-14-al.md` §5, decision 8). The constraints hold: Detox needs a Detox-built binary while the gate installs the artifact testers get; Maestro has no physical iOS support and no scenario spanning two devices; two-device and hardware scenarios have no alternative to Appium's two-session model. Reopen only if T0's ledger shows driver-attributable flake above the quarantine threshold.
- **A web-rendered UI tier (react-native-web, Storybook screenshots) as a device-run replacement.** The repository has no web target and no Storybook story (`app/indexStorybook.js` exists; `find` finds no `*.stories.*`), and an estimated 40–45% of the product's risk surface needs a real device regardless (attestation, Askar, BLE, push, biometrics). A web render proves web layout, not Yoga or native text metrics, so it cannot retire a device row. Layout is checked by rectangle on a device (`e2e/lib/layoutRules.js`).
- **Making the reference agents the Node tier.** `vrc-reference` imports no `@bifold/core` module (principle 1); a passing run proves the reference, not the wallet.
- **Emulator snapshots as the gate's shared-state mechanism.** Ruled out by the gate efficiency subtask §4 and `e2e/README.md`, "Keeping an AVD's state across a restart": an emulator booted with `-no-snapshot-save` discards the session's disk writes. E2 uses an explicitly saved snapshot, and only outside the gate.
- **`jest --changedSince` as the main unit-test lever.** The import graph is dense: five commits' worth of changes selected 61% of core's test files when measured on 2026-09-29. It stays available locally.
- **Four ABIs in test builds.** `armeabi-v7a` and `x86` are not used by any test target, and four ABIs roughly double native compile time for no assurance. Store builds keep them (B3).
- **Deleting the Gradle cache on every run.** It was introduced because a restored cache once left library codegen folders missing. That is a cache-key defect, fixed by B4's key.
- **Public real-device clouds (BrowserStack, Sauce Labs, LambdaTest, Kobiton public devices) as the canary.** They re-sign iOS apps under their own team, which changes the App ID: `bifold/packages/witness-server/src/trustTasks/appAttest.ts` compares the App Attest `rpIdHash` to a hash of the team and bundle identifiers and returns `appIdMismatch` on a difference. None offers BLE between two devices or two devices in one session.
- **AWS Device Farm private devices.** Not chosen now, and not ruled out forever. Private iOS devices can skip re-signing, so it is the one hosted option that could prove App Attest under our own team. We do not choose it because it still has no BLE between devices and no documented biometric injection (both unverified against current AWS documentation), so it could not carry canary runs 1 to 3 and would add a vendor beside the lab for no new claim. Reopen if lab upkeep becomes the bottleneck and a one-iPhone pilot shows App Attest verifying.
- **Firebase Test Lab.** It runs instrumented tests in isolation with no external Appium driving and no coordination between devices, so it cannot run a two-device exchange.
- **Self-run AWS or GCP for the whole pipeline.** EC2 Mac is a dedicated host with a 24-hour minimum allocation, so it cannot scale to zero per pull request, and GCP has no macOS offering. Spot Linux KVM instances inside Tier 2 are fine.
- **A robotic tapper with a fingerprint replica.** It works only on Touch ID devices, Face ID cannot realistically be automated, and the passcode path in §4.2 proves the same key properties.
- **Simulated biometrics as a substitute for the canary.** `adb emu finger touch` and `mobile: sendBiometricMatch` are not enough: emulators and simulators cannot do hardware attestation, and the Android emulator cannot complete sign-in, because the user-verification prompt is biometric-only and the emulator's fingerprint token reads as expired (`e2e/gate/gate.sh`, the comment above `LEGS_ANDROID`). A1 reaches the attestation key only. They stay for prompt-UX checks only.
- **Staging builds that stop waiting on tests (the former B7).** The `staging` branch is being retired, and a push to it ships its code to every tester, so a change there cannot be tried safely. The saving was small, about 5–6 minutes of about 51. Whatever replaces staging's build ordering belongs to the release-flow plan.
- **Making the invitation readable in e2e builds (the former E5).** Exposing the invitation in release test builds was rejected on 2026-10-15. This is a product-owner call and is not reopened by this plan. The release-build alternative is the share-link path (`run-pair-ios.mjs`, the `pair-ios` gate leg), whose iOS clipboard read is still open (#605). The consequence is known: the gate has no Release-build exchange evidence today, and the gate lane rates that gap as the most valuable thing a reopened decision would buy. Only the product owner reopens it.
- **Retiring protocol runners without the mutation check.** A Node test that has never failed proves nothing about the runner it replaces; §4.7 rule 2 is the constraint.

## 10. Review index

| Companion | Author | What it settles |
|---|---|---|
| [2026-10-24-al.md](./test-acceleration-plan/2026-10-24-al.md) | Alberto | A review against what is built: gate and CI numbers measured since 2026-10-22, conflicts with earlier decisions, what the plan misses, stale facts, and a rollout order |
| [2026-10-25-bam.md](./test-acceleration-plan/2026-10-25-bam.md) | Brendan | Disposition of each proposal in the 2026-10-24 review: what was adopted, dropped or left to the product owner, and what position each supersedes |
| [2026-10-22-bam.md](./test-acceleration-plan/2026-10-22-bam.md) | Brendan | Sources; what was adopted, dropped and merged, including the earlier build-and-test acceleration plan this one absorbs; the cross-reference with the gate efficiency subtask, PR #238, PR #483 and the sibling plans, with conflicts and resolutions; review corrections; unverified claims; vendor and price research; open decisions |
