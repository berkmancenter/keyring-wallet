# E2E tests (Appium)

End-to-end tests that drive the real app UI on two devices at once: fresh
install → onboarding → invitation → bidirectional Verifiable Relationship
Credential (VRC) exchange. They live outside the yarn workspaces on purpose —
this folder is a small standalone npm package.

| Command (repo root) | What it does | Attended? |
| --- | --- | --- |
| `yarn e2e:vrc` | Two-device VRC exchange on the **Android emulator + iOS simulator** | No |
| `yarn e2e:vrc:devices` | Same exchange on a **physical Android phone + iPhone**, proving hardware attestation + biometric signing | **Yes** — you authenticate on the phones |
| `yarn e2e:migration` | Askar 0.2→0.6 store migration: old app → exchange → in-place upgrade | No |
| `yarn e2e:smoke` | Single device: install → onboarding → main tabs | No |

The same scripts exist inside this folder as `npm run vrc-exchange`,
`vrc-exchange:devices`, `store-migration`, `onboarding-smoke` (plus
`vrc-exchange:android-only` for two AVDs).

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

Fully unattended. Defaults (override via env): `ANDROID_AVD=Pixel_6_API_33`,
`IOS_DEVICE_NAME="iPhone 17"`, `IOS_PLATFORM_VERSION=26.3`, `ANDROID_APK` /
`IOS_APP` for binary paths, `PLATFORMS=android,ios`.

Note: emulators/simulators **cannot** do hardware attestation (no App Attest,
no usable TEE attestation) — the app silently falls back to a plain exchange
with no evidence block. That path is only proven by the real-device run below.

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
