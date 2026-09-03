# E2E tests (Appium)

End-to-end tests that drive the real app UI on two devices at once: fresh
install → onboarding → invitation → bidirectional Verifiable Relationship
Credential (VRC) exchange. They live outside the yarn workspaces on purpose —
this folder is a small standalone npm package.

| Command (repo root) | What it does | Attended? |
| --- | --- | --- |
| `yarn e2e:vrc` | Two-device VRC exchange on the **Android emulator + iOS simulator** | No |
| `yarn e2e:vrc:android-only` | Same exchange on **two Android emulators** (no macOS/Xcode needed; see below for the two-AVD setup) | No |
| `yarn e2e:vrc:tsp` | Same exchange, but the VRC/witness Trust Task documents are carried over the real TSP envelope stack (HPKE-Auth, Askar custody, CESR framing) instead of the default DIDComm-v1 binding — both **Android emulators** (logcat-based marker assertion needs it; see below for the two-AVD setup). Wallet-to-wallet only, not an ecosystem-interop test — see `docs/plans/openvtc-integration-plan/2026-09-02-bam.md` | No |
| `yarn e2e:vrc:devices` | Same exchange on a **physical Android phone + iPhone**, proving hardware attestation + biometric signing | **Yes** — you authenticate on the phones |
| `yarn e2e:vrc:devices:android-only` | Same hardware-attested exchange on **two physical Android phones** (no macOS/Xcode needed; two *physical* phones are required — emulators can't do hardware attestation) | **Yes** |
| `yarn e2e:migration` | Askar 0.2→0.6 store migration: old app → exchange → in-place upgrade (Android emulator + iOS simulator peer) | No |
| `yarn e2e:migration:android-only` | Same migration test, **two Android emulators** (no macOS/Xcode needed) | No |
| `yarn e2e:smoke` | Single device: install → onboarding → main tabs | No |
| `yarn e2e:vrc:witnessed:devices` | Witnessed + hardware-attested exchange on a **physical Android phone + iPhone**, routed through a locally-run witness server — both wallets end up with a Verifiable Witness Credential (VWC) in addition to the peer VRC | **Yes** |
| `yarn e2e:vrc:witnessed:android-only` | Same witnessed + attested exchange on **two physical Android phones** (no macOS/Xcode needed; two *physical* phones are required — emulators can't do hardware attestation) | **Yes** |
| `yarn e2e:vrc:witnessed:android-only:mediator` | Same as above, but the witness runs in **MEDIATOR mode** (through the shared production mediator) instead of the default DIRECT mode — confirms the mediator-mode fallback still works, on demand, without hand-setting an env var. See "Confirming the mediator-mode fallback" below. | **Yes** |

The same scripts exist inside this folder as `npm run vrc-exchange`,
`vrc-exchange:android-only`, `vrc-exchange:tsp`, `vrc-exchange:devices`,
`vrc-exchange:devices:android-only`, `store-migration`,
`store-migration:android-only`, `onboarding-smoke`,
`vrc-exchange:witnessed:devices`, `vrc-exchange:witnessed:android-only`,
`vrc-exchange:witnessed:android-only:mediator`.

Every script above ends by printing a bordered pass/fail banner
(`lib/banner.js`) so a completed run is easy to spot when scrolled back
through the appium/mocha noise:

```
============================================================
✅  E2E PASSED — vrc-exchange
============================================================
```

Failures print the same box with `❌  E2E FAILED — <name>` plus the error
message, in addition to the existing screenshot/log dumps.

## One-time setup

> **After pulling `feat/trust-tasks-integration`:** run `yarn install` at the
> repo root (the lockfile and the `@bifold/*` portals changed — the app now
> bundles `@bifold/trust-tasks`), `git submodule update --init` (the bifold
> pointer advanced), restart Metro with `yarn start --reset-cache`, and
> **rebuild the iOS device app** before any device run (it bundles its JS —
> see "Real devices"). Android debug builds load JS from Metro and need no
> rebuild for JS-only changes.


```bash
cd e2e
npm install                      # webdriverio
npm i -g appium
appium driver install uiautomator2
appium driver install xcuitest
```

You also need the normal app dev environment (Android SDK + an AVD, Xcode + an
iOS simulator runtime) — see the root README "Getting Started".

The harness starts Appium itself if nothing is listening on `:4723`.

**Working in a git worktree?** Every debug build looks for the Metro packager
on host port `:8081` regardless of which checkout it was built from — Android
via a hardcoded `adb reverse tcp:8081`, the iOS simulator directly over
localhost. If a Metro from a DIFFERENT checkout (another worktree, or the
main checkout) is already holding that port, it keeps serving *its own*
checkout's JS with no error at all — the app boots fine, just against the
wrong code, which only surfaces much later as a confusing "element not
found" deep into a run. The harness checks this itself before starting
(`checkMetroIsThisWorktree` in `lib/driver.js`) and fails fast with a clear
message if `:8081` belongs to another checkout; when that happens, stop that
Metro and run `yarn start` from **this** worktree's `app/` before retrying.

## Build the app binaries first

The tests install pre-built binaries; they don't build the app for you.

**`app/.env` changes require a rebuild.** `react-native-config` bakes `.env`
values (`MEDIATOR_URL`, etc.) into the native build at compile time — they are
NOT read at JS runtime. Editing `.env` and re-running the suite against an
already-built APK/`.app` silently keeps using the old values. If you add or
change anything in `.env` (most commonly `MEDIATOR_URL`), rebuild before your
next run — for Android, `cd app/android && ./gradlew assembleDebug` (or just
`yarn android` from `app/`, which builds and installs). Symptom if you skip
this: the app gets through onboarding and agent init fine, then fails with
"There is no mediator to pickup messages from" — the mediator invitation was
never processed because the module config never saw the new URL.

**Android (emulator and real device — same debug APK):**

```bash
cd app/android && ./gradlew assembleDebug
```

**iOS simulator:**

```bash
cd app/ios
xcodebuild -workspace AriesBifold.xcworkspace -scheme AriesBifold \
  -configuration Debug -sdk iphonesimulator -derivedDataPath build/e2e-dd \
  CODE_SIGN_IDENTITY=- CODE_SIGNING_REQUIRED=YES CODE_SIGNING_ALLOWED=YES build
```

(Ad-hoc signing is required — `CODE_SIGNING_ALLOWED=NO` strips the keychain
entitlement and the app can't store the wallet key.)

**iOS real device** (signed with the Berkman team; `FORCE_BUNDLING=1` bakes the
JS bundle in so the phone doesn't need metro):

```bash
cd app/ios
FORCE_BUNDLING=1 xcodebuild -workspace AriesBifold.xcworkspace -scheme AriesBifold \
  -configuration Debug -destination 'generic/platform=iOS' \
  -derivedDataPath build/device-dd \
  DEVELOPMENT_TEAM=947XHQ9DVC -allowProvisioningUpdates build
```

Debug builds for the emulator/Android phone load JS from **metro** — run
`yarn start` in `app/` (the real-device runner starts it for you if it isn't
running; the port is forwarded to the phone over USB with `adb reverse`).

## Simulator/emulator run (`yarn e2e:vrc`)

Fully unattended. Defaults (override via env): `ANDROID_AVD=Pixel_8_API_33`,
`IOS_DEVICE_NAME="iPhone 17"`, `IOS_PLATFORM_VERSION=26.3`, `ANDROID_APK` /
`IOS_APP` for binary paths, `PLATFORMS=android,ios`.

If your AVD is named differently, list what you actually have and point
`ANDROID_AVD` at one of them:

```sh
emulator -list-avds
ANDROID_AVD=Pixel_9_API_35 yarn e2e:vrc   # swap in your AVD's actual name
```

If Appium fails with `Error getting AVD with retry ... Timing out` (~60s),
the emulator's cold boot is slower than Appium's default `avdLaunchTimeout`.
Boot that same AVD yourself first, wait for it to come up, then run the
suite — Appium attaches to the already-running instance instead of trying
to launch one itself:

```sh
emulator -avd Pixel_8_API_33 &      # swap in your AVD's actual name
adb wait-for-device
# poll until this prints "1" (fully booted), then run the suite:
adb shell getprop sys.boot_completed
```

If the emulator segfaults on launch (crash log mentions
`createGlobalVkEmulation` / Vulkan, and dumps to `~/.android/...crash.db`),
the host-GPU/Vulkan renderer is incompatible with your GPU driver. Force
software rendering instead:

```sh
emulator -avd Pixel_8_API_33 -gpu swiftshader_indirect &   # swap in your AVD's actual name
```

Note: emulators/simulators **cannot** do hardware attestation (no App Attest,
no usable TEE attestation) — the app silently falls back to a plain exchange
with no evidence block. That path is only proven by the real-device run below.

### Testing the minSdk floor (API 24)

`Pixel_8_API_33` is API 33; the app's actual `minSdkVersion` is 24
(`app/android/build.gradle`), a real backward-compatibility gap the default
AVD never exercises (same API level as `Pixel_8_API_33`, just a different
device profile). Create a low-API AVD once and point `ANDROID_AVD` at it to
run the suite against the floor:

```sh
$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager \
  --install "system-images;android-24;google_apis;x86_64"
$ANDROID_HOME/cmdline-tools/latest/bin/avdmanager create avd \
  -n Pixel_2_API_24 \
  -k "system-images;android-24;google_apis;x86_64" \
  -d "pixel_2"

emulator -avd Pixel_2_API_24 -gpu swiftshader_indirect &
adb wait-for-device
adb shell getprop sys.boot_completed   # poll until "1"

ANDROID_AVD=Pixel_2_API_24 yarn e2e:vrc
```

### Android-only variant (`vrc-exchange:android-only`) — two emulators

No macOS/Xcode required, but it needs **two** AVDs — two emulator instances
can't share one. Check what you have and create a second if needed (example
names below — swap in your own; `-n` is the new AVD's name):

```sh
emulator -list-avds
$ANDROID_HOME/cmdline-tools/latest/bin/avdmanager create avd \
  -n Pixel_8_API_33_b \
  -k "system-images;android-33;google_apis_playstore;x86_64" \
  -d "pixel_8"
```

Boot **both** before running the suite (add `-gpu swiftshader_indirect` too
if you hit the Vulkan segfault above), and wait for both to finish booting —
swap in your own two AVD names throughout:

```sh
emulator -avd Pixel_8_API_33 -gpu swiftshader_indirect &
emulator -avd Pixel_8_API_33_b -gpu swiftshader_indirect &

adb devices                                          # should list both, as "device"
adb -s emulator-5554 shell getprop sys.boot_completed # repeat per serial until "1"
adb -s emulator-5556 shell getprop sys.boot_completed
```

**Windowed by default.** The commands above open a visible emulator window
so you can watch the suite drive the app — that's the default, and the
right one for local dev (you want to see what broke). Add `-no-window` only
when you deliberately want headless (e.g. a CI box with no display):

```sh
emulator -avd Pixel_8_API_33 -gpu swiftshader_indirect -no-window &
```

**Don't mix a headless and a windowed run on the same AVD via its saved
snapshot.** By default the emulator saves a snapshot (`default_boot`) on
clean shutdown and reloads it on the next boot to save time. If that
snapshot was saved under one display mode (windowed vs. `-no-window`) and
you boot into the other, the two can disagree about GPU/framebuffer state:
observed symptom is `FrameBuffer.cpp:3544] Failed to find ColorBuffer:0`
spamming the emulator's own log, followed by the process wedging (still
running, pegged at high CPU, but its adb/console ports stop responding and
it vanishes from `adb devices`). Fix: kill it and boot that AVD once with
`-no-snapshot-load` to force a clean cold boot before switching modes.

Then run the suite from the repo root, telling it which AVD is which
wallet — `ANDROID_AVD` is wallet A, `ANDROID_AVD2` is wallet B:

```sh
ANDROID_AVD=Pixel_8_API_33 ANDROID_AVD2=Pixel_8_API_33_b \
  yarn e2e:vrc:android-only
```

Appium attaches to the two already-running emulators by matching each
session's `appium:avd` capability to that AVD's instance, rather than
launching its own — so both must already be up before you run the command.

## Real devices (`yarn e2e:vrc:devices`) — attended

Proves the security-critical path end to end:

- each phone signs its VRC with a hardware-backed key (Android TEE key with
  `BiometricPrompt` / iOS App Attest with `LAContext`), and
- each **receiver** chain-validates the peer's evidence on-device (Google
  attestation roots / Apple roots). The run **fails** unless both offer
  screens show evidence was at least attempted — either the "Secure Exchange"
  (`AttestationVerified`) banner or the "Hardware Verification Issue"
  (`AttestationWarning`) banner. The warning is tolerated (not a failure):
  this test proves the exchange flow, not that a given physical device's
  attestation root cert is still within its validity window, which we don't
  control — see "Known limitations" #5 in
  [`docs/HARDWARE_ATTESTATION_FLOW.md`](../docs/HARDWARE_ATTESTATION_FLOW.md).
  Only a banner missing entirely (evidence never attempted) fails the run.

### Prerequisites

- **Android phone**: plugged in over USB, USB debugging on, screen-lock PIN
  set (fingerprint optional — the prompt falls back to the device PIN), screen
  on and unlocked. Must be the only physical Android device attached (or set
  `ANDROID_UDID`). A device provisioned before Google's RKP rollout (~2022)
  may only get the tolerated "Hardware Verification Issue" warning above,
  not full "Secure Exchange" verification — its attestation chain can still
  terminate at Google's legacy root, which expired 2026-05-24; see "Known
  limitations" #5 in
  [`docs/HARDWARE_ATTESTATION_FLOW.md`](../docs/HARDWARE_ATTESTATION_FLOW.md).
  Use a newer device if you specifically need to prove full verification.
- **iPhone**: plugged in, Developer Mode enabled (Settings → Privacy &
  Security), passcode set (Face ID optional), unlocked, trusts this Mac. Must
  be the only iPhone attached (or set `IOS_UDID`).
- Both phones need internet (mediator + Apple/Google attestation servers).
- Signing: `IOS_TEAM_ID` defaults to `947XHQ9DVC`. First run installs a signed
  WebDriverAgent on the iPhone — expect a few minutes, and if the run stalls,
  check the phone for a "trust this developer" prompt under Settings → General
  → VPN & Device Management.

### During the run

Watch the console. When you see:

```
█  OPERATOR: authenticate on the ANDROID PHONE NOW
```

pick up that phone and pass the biometric/PIN prompt. This happens roughly
twice per phone (each side issues once). Everything else is automated.

### Artifacts

On success and failure the runner writes to `e2e/artifacts/`: screenshots of
the Secure Exchange banners, filtered attestation log lines from `adb logcat`
and the iOS syslog (`[VRC:Verify]`, `GoogleAttestation*`, `AppAttest`…). Those
logs are the crypto-level proof of what validated.

### Android-only variant (`yarn e2e:vrc:devices:android-only`)

Same hardware-attested exchange; a second **physical** Android phone stands
in for the iPhone. No macOS/Xcode needed. Two physical phones are required,
not an emulator pair — the whole point of this test is hardware attestation
(TEE-backed keys + `BiometricPrompt` on both sides), and emulators cannot do
hardware attestation (see "Simulator/emulator run" above) — an emulator pair
would silently fall back to a plain, unattested exchange.

Both phones connected over USB are auto-detected (same convention as
`ANDROID_UDID` above); if more or fewer than two are found, set
`ANDROID_UDID` and `ANDROID_UDID2` explicitly:

```sh
adb devices                                      # list connected serials
ANDROID_UDID=<phone-a-serial> ANDROID_UDID2=<phone-b-serial> \
  yarn e2e:vrc:devices:android-only
```

## Store migration (`yarn e2e:migration`)

Needs a baseline APK built from the `upgrade-baseline-p0` tag — the full
recipe is in the header comment of `run-store-migration.js`. Pass it as
`BASELINE_APK=/path/to/app-release.apk`.

### Android-only variant (`yarn e2e:migration:android-only`)

Same migration test; a second Android emulator stands in for the iOS
simulator peer (the peer is only there to have a second wallet to exchange
a VRC with — nothing about the migration itself depends on its platform).
Needs the same second AVD as `yarn e2e:vrc:android-only` (see that section
above for how to create one) and the same `BASELINE_APK`:

```sh
BASELINE_APK=/path/to/app-release.apk ANDROID_AVD2=Pixel_8_API_33_b \
  yarn e2e:migration:android-only
```

## Witnessed exchange (`yarn e2e:vrc:witnessed:devices`) — attended

Same hardware-attested exchange as `yarn e2e:vrc:devices`, but both wallets
first connect to a locally-run witness server (`bifold/packages/witness-server`,
launched automatically), so the exchange auto-routes through the witness and
each wallet ends up with a Verifiable Witness Credential (VWC) in addition to
the peer VRC. See `docs/CRYPTO_SUITE_FOLLOWUP.md` for the DataIntegrityProof/
eddsa-rdfc-2022 cryptosuite work this proves end to end.

Prerequisites beyond the real-device setup above:

- [`cloudflared`](https://github.com/cloudflare/cloudflared) installed — the
  harness spins up a quick HTTPS tunnel to the locally-run witness (mobile
  OSes block cleartext HTTP, and production witnesses are HTTPS).
- `bifold/packages/witness-server` dependencies installed (it's launched via
  `yarn ts-node --transpile-only src/index.ts` from that package).

Same attended flow as `yarn e2e:vrc:devices` — watch for the `OPERATOR`
banners and authenticate on both phones. Override the witness's name with
`WITNESS_NAME`, or its ports with `WITNESS_PORT`/`WITNESS_WEB_PORT`, if the
defaults collide with something else running locally.

**The run is deterministic regardless of your local
`bifold/packages/witness-server/.env`.** That file is gitignored and
per-developer, and can (harmlessly, for interactive/manual witness use) commit
to a mediator or a different transport. The harness always overrides the
witness's transport (`MEDIATOR_INVITATION_URL`, forced to DIRECT unless you set
`WITNESS_MEDIATOR_INVITATION_URL` to deliberately test mediator mode) and gives
it a genuinely fresh, isolated wallet per run (`VRC_WALLET_PATH` inside the
run's own temp dir, torn down with everything else at the end) — so nothing in
your `.env`, and no state left over from a previous run, can change what this
run actually exercises. If the witness's observed transport ever doesn't match
what was requested, the harness fails immediately with a clear error rather
than a mysterious participant-connect timeout minutes later. See
`docs/spikes/e2e-vrc-connect-findings.md` ("fourth failure layer") for the
incident this closes.

**Locality verification is disabled by default.** The harness launches the
witness with `WITNESS_LOCALITY_REQUIRED=false`: Appium-driven phones can't
produce a co-location (BLE proximity) proof, and with the check enforced the
witness rejects the VP and the exchange silently falls back to a plain
unwitnessed VRC. A green witnessed run therefore proves the witnessed exchange
and attestation, **not** the locality leg — a real deployment keeps it
enforced. Export `WITNESS_LOCALITY_REQUIRED=true` to include it in an
attended run.

### Android-only variant (`yarn e2e:vrc:witnessed:android-only`)

Same witnessed + attested exchange; a second **physical** Android phone
stands in for the iPhone. Two physical phones are required, not an emulator
pair — the whole point of this test is hardware attestation (TEE-backed
keys + `BiometricPrompt` on both sides), and emulators cannot do hardware
attestation (see the note under "Simulator/emulator run" above) — an
emulator pair would silently fall back to a plain, unattested exchange.

Both phones connected over USB are auto-detected (same convention as
`ANDROID_UDID` for `yarn e2e:vrc:devices`); if more or fewer than two are
found, set `ANDROID_UDID` and `ANDROID_UDID2` explicitly:

```sh
adb devices                                      # list connected serials
ANDROID_UDID=<phone-a-serial> ANDROID_UDID2=<phone-b-serial> \
  yarn e2e:vrc:witnessed:android-only
```

### Confirming the mediator-mode fallback (`yarn e2e:vrc:witnessed:android-only:mediator`)

DIRECT (the default above) is the recommended architecture for a live
witnessing ceremony — lower latency, and it keeps the witness's traffic off
the same shared mediator that already sees the two wallets' own relationship
(see `docs/plans/openvtc-integration-plan/trust_tasks_subtask.md` for why that
matters). But a witness operator who can't or doesn't want to expose a public
port needs MEDIATOR mode to actually work as a fallback — and it silently
didn't, for over a week, because nothing exercised that path (see
`docs/spikes/e2e-vrc-connect-findings.md`, "fourth failure layer"). This
variant runs the exact same witnessed exchange with the witness deliberately
put into MEDIATOR mode, so that fallback gets confirmed on demand instead of
rotting unnoticed again.

Same devices, same attended flow, same everything as
`yarn e2e:vrc:witnessed:android-only` — the only difference is the witness's
transport. It reuses `app/.env`'s own `MEDIATOR_URL` as the witness's mediator
invitation (same production mediator the wallets already connect to, so this
is a real test of the actual fallback, not a stand-in); override with
`WITNESS_MEDIATOR_INVITATION_URL` if you need a different one. Fails fast,
before touching any device, if neither is available.

There's no periodic/CI job running this automatically yet — it's a manual
confirmation step for now. Worth doing after any change to mediation setup
(`@bifold/vrc-shared` `src/mediation.ts`, `WitnessService.ts`'s
`mediationRecipient` config, or the app's own `configureMessagePickup`), and
periodically otherwise so this doesn't silently break again between real
uses of the fallback.

## The Trust Task dialect (v4) — what the runs assert now

Since the relationship exchange moved onto Trust Tasks (plan: `docs/plans/openvtc-integration-plan/trust_tasks_subtask.md` §9), the VRC runs drive and assert a different flow than the legacy offer/accept one:

- **Consent is the relationship proposal, not per-credential offers.** One bottom-sheet appears on the *non-proposer* wallet (the proposer is deterministic — lower connection DID); `acceptRelationshipProposalIfPrompted` taps it. There is no VRC credential-offer to accept (the R-Card, still on the legacy leg, auto-accepts and is hidden). `acceptCredentialOfferFromChat` remains for legacy runners only.
- **The gates are log markers, read from Android's run-scoped logcat** (`adb logcat -c` at session start; iOS has no logcat, Android's log covers both directions): `assertTrustTaskExchangeMarkers` (discovery → propose → issue sent/stored → receipts), `assertWitnessCeremonyMarkers` (session → challenge → VP → VWC → outcome-evidence self-check), `assertWitnessShareMarkers` (witness-share sent → verified and stored → receipted), and on devices the hardware-evidence marker (`Evidence block added […]` — the run fails loudly if the exchange downgrades to unattested).
- **UI gates:** `assertVrcReceived` (contact with the peer's name — the name comes from the R-Card), and `assertContactShields` (the **Witnessed** indicator, plus Secure Exchange on devices). `openContactDetail` handles both navigation shapes (Contacts row → chat → header `ContactMenu` → View Contact, or straight to Contact Details) and checks ContactDetails' *bare* testIDs (`WitnessSection`, `WitnessedBadge`, `SecureExchangeBadge` — no `com.ariesbifold:id/` prefix).
- **Runners:** `yarn e2e:vrc:witnessed` — simulator + emulator, unattended, the full witnessed exchange with a local witness behind a cloudflared tunnel (run from repo root; `APPIUM_PORT=4750 WDA_LOCAL_PORT=8101 ANDROID_AVD=<your AVD> yarn e2e:vrc:witnessed` is the known-good invocation on a Mac with an iPhone simulator); `yarn e2e:vrc:witnessed:devices` — the attended real-device version (the demo path; see `docs/DEMO_RUNBOOK_WITNESSED_EXCHANGE.md`).
- **Env that matters:** `APPIUM_PORT` (default 4723 — set another port if something else already listens there), `WDA_LOCAL_PORT` (iOS simulator WebDriverAgent; 8101 known good), `ANDROID_AVD` (default `Pixel_8_API_33`), `WITNESS_MEDIATOR_INVITATION_URL` (unset by default, forcing the witness into DIRECT mode regardless of local `.env` — set it to deliberately test mediator mode instead). The Android 16 / API 36 PIN-modal fix (`waitForKeyboardGone` in `enableHardwareAttestation`) is in place and unchanged by the v4 work.
- **Known intermittents on simulators, not regressions:** one wallet occasionally misses the witness connection ("only 1/2 participants connected") or iOS never sends the didexchange request (the open "iOS no-send"); the witness agent init can hang under heavy machine load. Re-run. Distinct from a **deterministic 0/N** failure, seen on real devices through 2026-08-31: the witness silently running in mediator mode with a push-only pickup strategy against a mediator that only queues — fixed (see `docs/spikes/e2e-vrc-connect-findings.md`, "fourth failure layer"), and the harness no longer lets a local `.env` put the witness back into that mode by accident.
- **Between runs:** free ports 4750/9002/9003 and kill stray `cloudflared`; cold-reboot an emulator that has been up for hours (its host network path degrades).

## Troubleshooting

- **Isolating the witness-connect step**: `node debug-witness-connect.js` (run
  from `e2e/`) drives a single Android device through fresh install → onboard →
  connect-to-witness and confirms the "connected to witness" banner. No second
  device or biometrics needed, so it cheaply isolates witness connectivity from
  the rest of the witnessed flow. Diagnostic tool only — not part of the
  maintained suite.
- **Witness fails immediately with "port N is already in use by another
  process on this machine (not one this harness started or can
  identify/kill…)"**: something outside the harness's control already holds
  `WITNESS_PORT`/`WITNESS_WEB_PORT` (default 9002/9003) — possibly invisible
  to `lsof` (e.g. a process this user can't enumerate; `ss -ltn` will still
  show it LISTENing). Pick different ports:
  `WITNESS_PORT=9202 WITNESS_WEB_PORT=9203 yarn e2e:vrc:witnessed:android-only`.
  This check runs before the tunnel or witness process even start, specifically
  so this shows up in seconds instead of as a confusing `EADDRINUSE` stack
  trace at the bottom of the witness's full startup banner ~15s in.
- **Real device: "Unable to launch WebDriverAgent … xcodebuild failed with
  code 65"**: WDA has never been provisioned for the team on this machine
  (appium doesn't pass `-allowProvisioningUpdates`). Prime it once:

```bash
cd ~/.appium/node_modules/appium-xcuitest-driver/node_modules/appium-webdriveragent
xcodebuild -project WebDriverAgent.xcodeproj -scheme WebDriverAgentRunner \
  -destination "id=<IPHONE_UDID>" DEVELOPMENT_TEAM=947XHQ9DVC \
  PRODUCT_BUNDLE_IDENTIFIER=asml.bkc.harvard.WebDriverAgentRunner \
  -allowProvisioningUpdates build-for-testing
```

- **Every Android tap is ~10s apart**: the `waitForIdleTimeout` setting in
  `lib/config.js` should prevent this; if you're overriding caps, keep it.
- **iOS Scan screen comes up blank**: known simulator flake; the flows retry
  by backing out and re-entering.
- **Wallet locks mid-test**: expected — flows call `unlockIfLocked` between
  polls (5-minute inactivity lock).
- **`could not read invitation URL`**: the invitation text is exposed via a
  `__DEV__`-only element — make sure you're using Debug builds, not Release.
