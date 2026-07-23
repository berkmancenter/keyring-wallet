# E2E tests (Appium)

End-to-end tests that drive the real app UI on two devices at once: fresh
install → onboarding → invitation → bidirectional Verifiable Relationship
Credential (VRC) exchange. They live outside the yarn workspaces on purpose —
this folder is a small standalone npm package.

| Command (repo root) | What it does | Attended? |
| --- | --- | --- |
| `yarn e2e:vrc` | Two-device VRC exchange on the **Android emulator + iOS simulator** | No |
| `yarn e2e:vrc:android-only` | Same exchange on **two Android emulators** (no macOS/Xcode needed; see below for the two-AVD setup) | No |
| `yarn e2e:vrc:devices` | Same exchange on a **physical Android phone + iPhone**, proving hardware attestation + biometric signing | **Yes** — you authenticate on the phones |
| `yarn e2e:migration` | Askar 0.2→0.6 store migration: old app → exchange → in-place upgrade | No |
| `yarn e2e:smoke` | Single device: install → onboarding → main tabs | No |

The same scripts exist inside this folder as `npm run vrc-exchange`,
`vrc-exchange:android-only`, `vrc-exchange:devices`, `store-migration`,
`onboarding-smoke`.

## One-time setup

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

## Build the app binaries first

The tests install pre-built binaries; they don't build the app for you.

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
  attestation roots / Apple roots). The run **fails** unless both offer screens
  show the "Secure Exchange" (`AttestationVerified`) banner.

### Prerequisites

- **Android phone**: plugged in over USB, USB debugging on, screen-lock PIN
  set (fingerprint optional — the prompt falls back to the device PIN), screen
  on and unlocked. Must be the only physical Android device attached (or set
  `ANDROID_UDID`).
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

## Store migration (`yarn e2e:migration`)

Needs a baseline APK built from the `upgrade-baseline-p0` tag — the full
recipe is in the header comment of `run-store-migration.js`. Pass it as
`BASELINE_APK=/path/to/app-release.apk`.

## Troubleshooting

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
