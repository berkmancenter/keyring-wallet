# iOS builds for a Linux-first team — a dedicated Mac, plus the cloud Macs we already use

> **Status: Draft.** A recommendation, not a decision. Nothing has been bought
> or set up, and the one remaining measurement (§4 step 3) has not been run.

**Scope.** How people who develop Keyring on Linux get iOS builds, iOS
simulator runs and attended iPhone runs without each needing a Mac: what runs
on GitHub's hosted macOS runners, what needs a Mac we control, and which
Linux-only routes do not work.

**Companions** (in [`ios-builds-on-linux-plan/`](./ios-builds-on-linux-plan/)):

| Document | Author | What it holds |
|---|---|---|
| [`2026-10-05-bam.md`](./ios-builds-on-linux-plan/2026-10-05-bam.md) | BAM | The original research: xtool, macOS-Simple-KVM, OSX-KVM on a laptop and on AMD and NVIDIA desktops, the Intel shelf life, the licensing point, and the first recommendation |
| [`2026-10-13-bam.md`](./ios-builds-on-linux-plan/2026-10-13-bam.md) | BAM | The research re-checked against `main`: versions, pod count, the e2e script names, and the finding that cloud Mac CI already exists |

**Related plans.** [`release-flow-plan.md`](./release-flow-plan.md) owns how a
build reaches TestFlight. This plan does not change it: store builds stay on
GitHub-hosted `macos-26` runners. The release gate's runner is documented in
[`../../e2e/gate/README.md`](../../e2e/gate/README.md) ("Where a gate runs");
this plan proposes the machine it runs on.

---

## 1. What Keyring needs from a Mac

Keyring is React Native 0.81.5 (patched, `.yarn/patches/react-native-npm-0.81.5-*.patch`),
React 19.1.0 and Expo SDK 54 (`expo ~54.0.31`), built through CocoaPods into
`app/ios/AriesBifold.xcworkspace`, scheme `AriesBifold`. `app/ios/Podfile.lock`
lists 144 distinct pods (CocoaPods 1.15.2), 15 of them Expo's, plus
`react-native-attestation`, `react-native-locality-peripheral`, Askar and
Hermes.

| Need | Where it runs today | Needs a Mac we control? |
|---|---|---|
| Store builds and TestFlight upload | `staging.yaml` `build-ios-staging` on `macos-26`. *"App Store Connect only accepts uploads built with Xcode 26 / the iOS 26 SDK since 2026-04-28"* (the job's own comment) | No |
| Simulator test builds | `test-builds.yml` `ios-simulator` on `macos-26`, Xcode 26.3 | No |
| Simulator smoke | `gate-smoke.yml` on `macos-26`: the SMOKE rows with no Farm and no secrets — *"a smoke, not a gate"* (`e2e/gate/README.md`) | No |
| The full release gate (Farm rows, K↔K, iOS and Android legs side by side) | "The Mac", through the `launchd` watcher, only while `mac_stable` says yes | **Yes** |
| Attended physical iPhones (`yarn e2e:vrc:devices`, `e2e:vrc:witnessed:ios-devices*`) — the only proof of hardware attestation | A Mac with the phones on USB | **Yes** |
| Day-to-day iOS debugging (`yarn ios:setup && yarn ios`) | A developer's Mac | **Yes**, or remote access to one |

Cloud Mac CI — the second half of the 2026-10-05 recommendation — is already in
place. What remains is the Mac we control.

## 2. Recommendation: one dedicated Apple Silicon Mac mini

A used M1/M2 Mac mini with 16 GB or more, kept on a desk, headless, reached over
SSH with VNC for the screen.

- **It is the gate's natural runner.** The gate's stability rule treats a Mac
  with *"no lid at all and no battery"* as a desktop that *"is always stable
  … so a headless mini still gates"* (`e2e/gate/README.md`). A laptop is
  stable only with the lid open or a display attached, and *"a full gate is
  not started on a laptop in a bag"*. A mini removes the main reason a gate
  does not start.
- **It holds the attended phones.** Physical iPhones stay plugged in for
  `e2e:vrc:devices` and the `ios-devices` legs.
- **It gives Linux developers an iOS simulator** over VNC, and a place to run
  `yarn ios` for debugging.
- **It is legal and survives the Intel cutoff**, unlike any KVM route (§3).

Sharing it uses the gate's existing convention: a lane about to run a heavy
job creates `~/.keyring-fleet/gate/hold-start`, and a gate waits for it
(`e2e/gate/README.md`, "Sharing the Mac").

## 3. Rejected routes, as standing rationale

- **xtool** (Linux Xcode replacement). It builds SwiftPM packages only, with no
  simulator. Keyring's 144 pods, the Xcode build phases (RN codegen, Metro
  bundling, Expo autolinking, `react-native-config`'s generated header), and
  `actool`/`ibtool` for `Media.xcassets`, the launch storyboard and the privacy
  manifest have no SwiftPM equivalent. Every RN or Expo upgrade would break a
  hand port again.
- **macOS-Simple-KVM.** It stops at Catalina; Keyring's Xcode 26 needs a far
  newer macOS.
- **OSX-KVM as the main route.** It emulates an Intel Mac. The 2026-10-05
  research records Apple's statement that macOS 26 Tahoe is the last release
  for Intel Macs, which gives the route one to two years at most. It also runs
  macOS on non-Apple hardware, which Apple's licence does not permit — a real
  cost for an institutional open-source project. It remains a possible
  **stopgap** only, and only if §4 step 3 passes.
- **EAS Build instead of GitHub Actions.** Not needed: the GitHub-hosted
  `macos-26` workflows above already build, sign and upload.

## 4. Steps

| # | Step | Owner | Done when |
|---|---|---|---|
| 1 | **Decide and buy** — a used M1/M2 Mac mini, 16 GB or more, 512 GB or more (the gate needs about 15 GB free to run its iOS and Android legs side by side) | **Not decided; waiting on whoever holds the budget** | A machine is ordered, and where it sits and who can reach it is written down |
| 2 | **Stand it up as the gate's runner** — Xcode 26.3 to match CI; the watcher installed from `gate-main.plist.example` | Whoever runs gates | The watcher log says `desktop: no lid, no battery`, and a full gate on `main` completes with no `ENV Mac slept` mark |
| 3 | **Optional: the OSX-KVM measurement** — only if a stopgap is wanted before step 1, or for anyone on Linux who wants a local simulator. In a macOS VM on an NVIDIA desktop with Xcode 26 and an iOS 26 runtime: `xcrun simctl boot` a device, install a `test-builds.yml` simulator artifact, then run `PLATFORM=ios yarn e2e:smoke` | Anyone with the hardware | Recorded in a dated companion: passes (with time taken) or hangs / renders black. If it fails, OSX-KVM is dropped as a stopgap |
| 4 | **Attended phones on the mini** | Whoever runs device legs | `yarn e2e:vrc:devices` passes on the mini with an iPhone attached |

**Note on step 3.** `yarn e2e:smoke` runs `e2e/run-onboarding-smoke.js`, which
defaults to Android (`PLATFORM || "android"`). The iOS run needs
`PLATFORM=ios`. If the smoke passes, the iOS half of `yarn e2e:vrc`
(Android emulator + iOS simulator) is likely to work too, with the Android
emulator on the Linux host and only the simulator in the VM.

## 5. Open questions

1. **Who pays for the Mac mini, and where does it live?** Not decided; waiting
   on the budget holder. Blocks step 1.
2. **Does one shared mini satisfy both the gate and interactive use**, or does
   interactive use need its own? Ours; answer after step 2, from how often
   `hold-start` blocks a gate.
3. **Is the OSX-KVM stopgap wanted at all?** Ours. With hosted-runner smoke
   already in CI, step 3 matters only if step 1 is slow.
