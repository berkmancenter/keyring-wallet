# Build and test acceleration — ten times faster without proving less

**Status:** Proposed. No code written. Phase 0 needs no purchase and no decision beyond this plan; the infrastructure tiers (§8) need a budget decision.
**Scope:** how long it takes to go from a commit to a trustworthy verdict: native builds for both platforms, the jest suites in `app/` and `bifold/packages/*`, and the Appium two-device e2e, on emulators, simulators and physical phones. It covers where each check should run, what it must prove, and what infrastructure it runs on.
**Siblings:** [`release-flow-plan.md`](./release-flow-plan.md) owns the branches, channels and store tracks the builds feed. This plan changes how fast those builds and gates run, not the flow. [`openvtc-interop-harness-plan.md`](./openvtc-interop-harness-plan.md) owns the interop bot. The Node two-agent harness in §6 is a different, wallet-internal layer, and the two share no code by design. `docs/RELEASE_GATE.md` stays the release procedure; §7's attended gate is a slimmer version of its device leg.
**Reasoning:** [`build-test-acceleration-plan/2026-09-29-bam.md`](./build-test-acceleration-plan/2026-09-29-bam.md) holds the measurements, the device and vendor research with prices and sources, the cost-of-ownership tables, and the biometric code survey. This document states current design only; see [`CLAUDE.md`](./CLAUDE.md).
**Baseline:** CI durations are from GitHub Actions run history as of 2026-09. Unit-test timings were measured on a developer workstation, with cold and warm jest caches, on a feature-branch tree (bifold `9a008d7b5`). Prices are as of 2026-09-28. Code references are at `main` `908a64ba` and bifold `ce35c7b8`.

---

## 1. Goal, and where the time goes

The goal is a **~10x shorter commit-to-verdict time** on the common path, with **no weaker guarantee** at release. Every check that is moved, cached or relaxed must still prove what it proved before, or the thing it no longer proves must be proven by a named run elsewhere (§7, §8).

Almost all of the time today is spent repeating setup, not doing the work under test:

| Stage | Today | What dominates |
|---|---|---|
| Native test builds (both platforms, per push to `main`) | 39–54 min | The iOS compile rebuilds React Native core from source, taking 34–41 min. Android builds four ABIs from a deliberately emptied Gradle cache, taking 27–34 min. |
| Bifold CI | ~18 min | `yarn coverage` runs the packages one after another and takes 10.5 min. |
| Core jest suite | 280 s cold, 181 s warm | Every test file pays a 5.8 s setup floor. About 5,000 dependency modules are transformed. A dozen files wait on real timers. |
| App jest suite | 141 s cold, 20 s warm | CI never keeps the transform cache, so it always pays the cold cost. |
| One VRC e2e run | ~7 min | Each run does a fresh install, onboards through the UI, restarts services and sleeps for fixed intervals. **The protocol exchange itself is projected at 10–12 s.** |

The design follows from that table. **Stop repeating work** (§3–§5). **Move each assurance to the cheapest layer that proves it** (§6). **Remove the human from the loop without removing the proof** (§7). **Buy capacity only where the software cannot help** (§8).

## 2. Principles

1. **A check moves down the stack only if the lower layer exercises the same code.** A Node test proves the wallet's protocol logic only if it runs `@bifold/core`'s own VRC and Trust Task modules. `vrc-reference` does not qualify: it has its own Alice and Bob implementations and never imports the wallet's module.
2. **Every relaxation is named and is paid back by a named run.** An e2e-only build, a seeded persona or a skipped prompt each lists what it stops proving and which run still proves it.
3. **Measure before redesigning.** The e2e step costs in §5 are read from code; they have not been timed. Phase 1 opens with per-step timing, and later steps are ordered by what it shows.
4. **Caching must be keyed so a hit cannot be wrong.** A cache that has once served stale codegen output is fixed by correcting its key, not by deleting it on every run.

## 3. Phase 0a — unit tests

| # | Step | Acceptance |
|---|---|---|
| U1 | Remove the per-test `require('./src/hooks/notifications')` from `bifold/packages/core/jestSetupAfterEnv.js`. Move the exclusion set into a dependency-free module that the hook and the setup file both import, or clear it only if the module is already in `require.cache`. | All core suites pass. An empty test file runs in under 2.5 s warm, down from 5.8 s. Core warm CPU time drops by at least 25%. |
| U2 | Persist the jest transform cache in CI for `app/` and every bifold package. Key it on `yarn.lock`, the babel and jest configs and the Node version. | A second CI run with an unchanged lockfile shows app jest under 30 s and the smaller bifold packages within 20% of their warm local times. |
| U3 | Replace real-timer waits with injectable timeouts or fake timers in the slowest core files: `vtiAgentLegs`, `vtiAgentAnswers`, `EvidenceBuilder`, `vtaOwnAgent`, `vrc-hardware-signing`, `vtiTsp`, `tspCapability`, `vrc-manager-error-handling` and `witnessStatusStore`. Where the timeout is itself the behaviour under test, keep one test at the real value and pass a small value everywhere else. | No core test file takes over 10 s warm. Each file's assertions are unchanged; only the timeout values move. |
| U4 | Transform `node_modules` with `@swc/jest` or esbuild, covering the `@credo-ts` ESM builds and `.mjs` files. Keep babel for first-party source, which needs the reanimated plugin and the module-resolver aliases. | The cold core run is at least 40% faster, with all suites passing and identical snapshot output. |
| U5 | Split core's jest config into two projects: `ui`, which keeps the React Native preset, and `node`, which uses the node environment and minimal setup for the files that never render. | Every file runs in exactly one project. `node`-project files each take under 1 s of setup. |
| U6 | Shard core across four CI jobs. Run the bifold package suites and their coverage in parallel (`foreach -p`), merging coverage afterwards. | Bifold `Testing` wall time is under 4 min, and merged coverage matches the serial run. |

`--changedSince` is not part of this design (§10).

## 4. Phase 0b — builds

| # | Step | Acceptance |
|---|---|---|
| B1 | **JS-only fast path in CI.** Run `scripts/ci/js-only.mjs` against the last native build's commit. When it answers *js-only*, reuse that native build and swap the new bundle in with `scripts/ci/js-swap.sh` instead of recompiling. Both scripts exist today, but no workflow calls them. | A JS-only change to `main` produces both test artifacts in under 8 min. A native change still triggers a full build. The artifact manifest records which path was taken. |
| B2 | **iOS:** enable prebuilt React Native core and dependencies (`RCT_USE_PREBUILT_RNCORE=1`, `RCT_USE_RN_DEP=1`) in the Podfile and CI. Add ccache. Cache DerivedData keyed on `Podfile.lock` plus the native fingerprint. | The Release simulator build step takes under 12 min cold and under 6 min on a cache hit. The app launches, and the attestation and keychain paths pass the smoke e2e. |
| B3 | **Android:** test and e2e builds compile `arm64-v8a` and `x86_64` only. Store builds keep all four ABIs. Replace the hard-coded `abiFilters` with the `reactNativeArchitectures` property so one flag controls it. Drop `bundleRelease` from test builds, since nothing uploads the AAB. | The test-build APK contains exactly the two ABIs. The staging and release AABs contain all four. |
| B4 | **Gradle:** enable the daemon in CI, parallel builds and configuration cache. Lower logging from `info` to `lifecycle`. Restore `~/.gradle/caches` with a key that includes the codegen inputs (every `package.json` under `node_modules/*/android` and the native fingerprint), so a hit can never pair stale codegen with new libraries. Remove the unconditional cache deletion before the build. | Configuration takes under 60 s on a cache hit. Three consecutive cached builds succeed with no missing-codegen failure. |
| B5 | **Bifold builds once and incrementally.** `scripts/ensure-bifold-ready.js` skips the build when a content hash of `bifold/packages/*/src`, the configs and the bifold pin matches the last build's stamp. The per-package `build` scripts stop running `clean` first. CI builds bifold in one step and the root install reuses it. | A second `yarn install` with no bifold change skips the bifold build. Each CI job builds bifold at most once. |
| B6 | Cache `.yarn/cache` and `bifold/.yarn/cache` in every workflow. Stop resetting Metro's cache in CI, and bundle once rather than both by hand and inside Gradle. | `Install dependencies` takes under 60 s on a hit in every workflow. The Android build log shows a single bundling step. |
| B7 | Staging builds stop waiting on `needs: test`. They start in parallel with the tests, and the upload step is what depends on the tests passing. | Staging wall time is at most the slower platform build plus the upload. |

## 5. Phase 1 — the e2e harness

| # | Step | Acceptance |
|---|---|---|
| E1 | **Per-step timing in every runner** (the `runStep` pattern in `e2e/lib/keyringRoles.js`). Output is a JUnit file plus a per-step duration table in the transcript. | Every `run-*.js` emits step durations. One baseline is recorded for each of `e2e:vrc`, `e2e:smoke` and one witnessed variant, and it orders E2–E6. |
| E2 | **Persona state instead of onboarding.** Build golden personas once per app build: an Android emulator quick-boot snapshot with the app installed and onboarded, and an iOS simulator cloned from an onboarded golden one (`xcrun simctl clone`). Physical phones reinstall over existing data (`E2E_KEEP_STATE`). The standard runners use personas by default. One onboarding smoke per pipeline run keeps covering onboarding end to end. | The VRC flow reaches Contacts on both devices within 30 s of session start. The onboarding smoke still runs on every pipeline execution. |
| E3 | **Event-driven waits.** Replace fixed sleeps and poll floors with waits on the log markers the harness already reads, or on element presence. Affected: `unlockIfLocked`, `handleBiometricConfirmIfPresent`, `dismissTourIfPresent`, `acceptRelationshipProposalIfPrompted`, the `assert*Markers` polls, the tunnel settle in `e2e/lib/witness.js` and the iOS camera-grant sleeps. Onboarding detects the current screen with one query instead of trying each screen in turn with a 2 s timeout. | No unconditional `sleep` of 1 s or more remains outside a documented exception. Every E1 step that was dominated by waiting halves or better. |
| E4 | **Shared services for a suite.** Appium, Metro or the embedded bundle, the witness, the mediator and the tunnel start once per suite, not once per scenario. Scenarios run as cases of one runner that shares the setup. | A three-scenario suite's startup cost is paid once, as shown in the E1 table. |
| E5 | **Embedded bundle builds for e2e.** E2e runs against a build with the JS bundled in, so they do not depend on Metro or a cold 54 s bundle. The invitation URL moves from `__DEV__`-only hidden text to a test-readable element present in e2e builds. | The standard e2e runners pass against the CI artifact from B1 with no Metro running. |
| E6 | **Parallel pairs.** The runner takes a device-pair pool and spreads scenarios across it. Android–Android pairs run on Linux KVM hosts, and pairs that include iOS run on Mac hosts. | With N pairs available, suite wall time is within 1.3× of (longest scenario × ceil(scenarios / N)). |
| E7 | Wallet mediator pickup polling stays at its measured 1 s in e2e builds (`app/src/utils/bc-agent-modules.ts`), and is documented as an e2e constant rather than tuned per run. | A single definition, with its measurement cited in the code comment. |

## 6. Phase 2 — the Node two-agent harness

A Node test harness drives **two real `@bifold/core` agents**, using `askar-nodejs`, against a local mediator and the real witness-server. It runs the wallet's own VRC and Trust Task modules end to end, with no UI.

| # | Step | Acceptance |
|---|---|---|
| N1 | Stand up two agents in one Jest (node environment) or plain Node process. They use the same agent-module configuration the app uses, with native-only modules (secure environment, attestation) replaced by software key fakes behind their existing interfaces. | A VRC exchange between the two agents completes in under 15 s. |
| N2 | Cover the protocol surface the device e2e covers today: DIDComm v1 and v2, TSP carriage, the Trust Task propose/issue/receipt markers, the witness ceremony and VWC issuance, mediator fallback and store migration. | Each has a Node test that fails when the corresponding wallet module is broken. Show this by reverting one known fix per area and watching the test fail. |
| N3 | Run on every PR. | The harness runs in the quality workflow and takes under 3 min. |

With N1–N3 in place, UI e2e shrinks to the onboarding smoke, the exchange smoke on each platform pairing, and the hardware lane (§7). Protocol regressions are caught on every PR by N3.

## 7. Phase 3 — unattended biometrics, and the attended release gate

Production code already allows the device passcode as a fallback on both platforms, and iOS never proves user presence cryptographically. So a script can satisfy the gate without faking a biometric match.

**Android (no app change).** The attestation key is bound to user authentication for 300 s, with `AUTH_BIOMETRIC_STRONG or AUTH_DEVICE_CREDENTIAL` (`bifold/packages/react-native-attestation/android/.../AttestationModule.kt`, `setUserAuthenticationParameters`). Signing first tries `initSign` without a prompt and asks only on `UserNotAuthenticatedException`. Before each signing step, the harness unlocks the secure lock screen with the device PIN over adb. Per the platform's `KeyGenParameterSpec.Builder` documentation, keys with a validity duration are authorised for that duration after the user unlocks the secure lock screen. If that proves insufficient, the fallback is typing the PIN into the prompt's "Use PIN" screen over adb.

- *Still proves:* the key is StrongBox-backed, the chain is Google-rooted, the attested auth type and timeout are present, and a real user-authentication token was minted.
- *Does not prove:* that a biometric matched, or that the prompt rendered.

**iOS (e2e-only build).** WebDriverAgent cannot drive Face ID or the LocalAuthentication passcode sheet on a physical device, and there is no API to fake Face ID on one. An **e2e build configuration**, selected at compile time and never present in Release, skips `evaluatePolicy` in `Attestation.mm` and `LocalityPeripheral.swift`, and `Attestation.mm` records `authenticationMethod: "E2EBypass"`. App Attest evidence carries no user-verification bit, so no verifier check changes.

- *Still proves:* the Secure Enclave key, the Apple attestation chain, the counter, and the assertion over the content hash.
- *Does not prove:* that the app gated signing on LocalAuthentication.

**Attended release gate.** A short attended run on production-configured builds on both platforms, with a real biometric. It is the only run that proves the prompt appears and that a biometric method is recorded. It runs once per release candidate.

| # | Step | Acceptance |
|---|---|---|
| A1 | A harness helper `unlockKeyguardWithPin(device)` (wake, `keyevent 82`, `input text`, enter), called before each Android signing step in device runs. | An Android witnessed exchange on a physical Pixel completes with no operator, 10 times in a row. |
| A2 | An iOS e2e build configuration with a compile-time `KEYRING_E2E_LA_BYPASS` flag, plus a CI check that the Release binary contains neither the symbol nor the `E2EBypass` string. | The CI check fails if the flag leaks into Release. An iOS physical-device exchange completes with no operator. |
| A3 | Production verifiers treat `E2EBypass` evidence as a verification failure. | A unit test in `core/src/hardware-signing` covers it. |
| A4 | Rewrite the device leg of `docs/RELEASE_GATE.md` as the attended gate above. | The gate lists exactly the claims only it proves. |

**Conditional:** A1 depends on the keyguard unlock opening the key's authorisation window on current Pixel firmware, which is still unmeasured (§11 Q1). If it doesn't, A1 falls back to the "Use PIN" screen. If that is unreachable too, Android stays attended, like iOS without A2.

## 8. Infrastructure, by tier

Each tier includes the ones before it. The software work in §3–§7 delivers most of the speed and needs no purchase.

| Tier | Adds | Cash, year 1 | What it unlocks |
|---|---|---|---|
| **0 — software only** | §3–§7 on the existing GitHub-hosted runners | $0 | Most of the build and unit-test gain, and most of the per-run e2e gain. It also cuts macOS runner spend, since each push to `main` currently uses about 40 min of macOS time. |
| **1 — one attestation pair** | One Pixel 9a and one iPhone 16e (≈ $710 used), or a Pixel 8a and an iPhone SE 3 (≈ $370), on an existing Mac. Add a Mac mini (from $899) if there is none. | ≈ $370–$1,600 | Hardware attestation proven on current hardware, nightly and at release, one pair at a time. |
| **2 — on-demand cloud emulators** | Android emulator pairs on Linux KVM runners (GitHub larger Linux, Blacksmith, Namespace, or spot `c8i`/`n2` instances), run nightly or on request | ≈ $150–$500/yr | Emulator e2e in CI without a local host. |
| **3 — full hybrid** | A second device pair, the Mac mini as a self-hosted iOS runner (or Cirrus runners), and emulator e2e on every PR | ≈ $5k cash (≈ $16k including engineering time) | Two hardware runs at once, and e2e on every PR on both platforms. |

Device choice has three rules:

- **Buy RKP-era devices** (2023 or later). Google's legacy attestation root expired on 2026-05-24, and a device provisioned before RKP can only show the tolerated "Hardware Verification Issue" state (`docs/HARDWARE_ATTESTATION_FLOW.md`, known limitation 5).
- **Buy devices supported through at least 2030.** Pixel 8a or newer, and an iPhone on the current iOS.
- **Buy devices that can stay on the charger.** Pixel 8/9 bypass charging or the 80% limit, and the iPhone 15-and-later 80% limit. Supervise the iPhones with Apple Configurator.

The recommended starting point is **Tier 0 plus the Pixel 9a + iPhone 16e pair**. Move up only when one-pair-at-a-time hardware runs, or iOS e2e off the PR path, becomes the measured bottleneck.

## 9. Verification gaps this work exposed

These are not caused by automation, but automating around them would hide them.

1. **Android: user authentication is recorded but never enforced.** `bifold/packages/core/src/hardware-signing/verify.ts` passes `userAuthType` and `authTimeout` through, and `valid` never depends on them. `noAuthRequired` (tag 503) is not parsed at all. A key without user authentication verifies as valid. *Proposed:* reject evidence whose attested auth type is none, or whose `noAuthRequired` is set. Add a unit test for each.
2. **iOS: the displayed method is self-reported.** `authenticationMethod` is whatever `LAContext.biometryType` reports on the signing device (`Attestation.mm`). `CredentialOffer.tsx` displays it as though it were proven. *Proposed:* label it as reported by the device, or stop showing it as part of verification.

## 10. Options considered and not chosen

- **Public real-device clouds (BrowserStack, Sauce Labs, TestMu/LambdaTest, Kobiton public devices) as the attestation lane.** They re-sign iOS apps under their own team, which changes the App ID. `bifold/packages/witness-server/src/trustTasks/appAttest.ts` compares the App Attest `rpIdHash` to SHA-256 of `"<teamId>.<bundleId>"` and returns `appIdMismatch` when they differ. Re-signing also strips the App Attest entitlement. None offers BLE between two devices. None runs two devices in one session, so each pair costs two parallel slots (≈ $350–450 a month). Their biometric support is instrumentation mocking, which does not exercise the hardware-bound path.
- **AWS Device Farm private devices — deferred, not rejected.** Private iOS devices can skip re-signing, which makes this the only SaaS option that could prove App Attest under our own team. It still has no BLE and no documented biometric injection, at about $200 per device per month. It becomes the fallback if lab upkeep turns out to be the bottleneck, after a one-iPhone pilot shows App Attest verifying.
- **Firebase Test Lab.** It runs instrumented tests in isolation, with no external Appium driving and no coordination between devices, so it cannot run a two-device exchange.
- **Self-run AWS/GCP for the whole pipeline.** EC2 Mac is a dedicated host with a 24-hour minimum allocation, a condition of Apple's macOS licence. That rules out scaling to zero per PR, and one always-on `mac-m4.metal` costs about $10.8k a year. GCP has no macOS offering. With the image and snapshot pipeline to maintain, this costs 2–3× the hybrid for the same emulator capacity. Spot Linux KVM instances **inside** Tier 2 are fine.
- **Robotic tapper with a fingerprint replica.** This only works on Touch ID devices such as the iPhone SE 3, and Face ID cannot realistically be automated. Replica reliability on Pixel under-display sensors is unproven. The cost and flakiness exceed those of §7's passcode path, which proves the same key properties.
- **Simulated biometrics as a substitute for devices.** `adb emu finger touch` and `mobile: sendBiometricMatch` are reliable, but emulators and simulators cannot do hardware attestation. They stay in use for prompt-UX checks only.
- **`jest --changedSince` as the main unit-test lever.** The import graph is dense: five commits' worth of changes select 61% of core's test files. It stays available locally but is not in the design.
- **Four ABIs in test builds.** `armeabi-v7a` and `x86` are not used by any test target. Four ABIs roughly double native compile time for no assurance. Store builds keep them.
- **Deleting the Gradle cache every run.** It was introduced because a restored cache once left library codegen folders missing. That is a cache-key defect, fixed by B4's key rather than by never caching.

## 11. Open questions, and who they wait on

Not decided, owned by this workstream (a one-day spike answers Q1–Q4):

1. On a Pixel 8a or 9a on the current Android release, does a keyguard PIN unlock over adb let the prompt-free `initSign` succeed, and what does the evidence record as the method?
2. Does `adb shell input text` reach the prompt's "Use PIN" screen, and can UiAutomator2 see its elements?
3. What does `setInvalidatedByBiometricEnrollment(true)` do to keys on a test phone with no fingerprint enrolled?
4. Is a compile-time build configuration enough to keep the iOS bypass out of every shipped binary, including TestFlight builds from `staging`?
5. Does Pixel 9a or 10a bypass charging behave like the Pixel 8/9 series? Sources name only those series.

Decided, waiting on someone else:

- **Tier 1–3 purchases** wait on a budget decision by the project leads.
- **Self-hosted runners on a lab Mac** need a repository admin to register the runner and approve its use by workflows that hold signing secrets.
- **Cirrus nonprofit pricing** (a 50% discount) waits on the vendor confirming eligibility.

## 12. Review index

| Companion | Author | What it settles |
|---|---|---|
| [2026-09-29-bam.md](./build-test-acceleration-plan/2026-09-29-bam.md) | Brendan | The measurements behind §1, the unit-test and e2e analysis behind §3–§6, the biometric code survey behind §7, the device and vendor research and cost tables behind §8 and §10, and the verification gaps in §9 |
