# Keyring Wallet — Upstream Sync & Upgrade Progress

> **Purpose of this file**: hand-off document so any agent/human can resume the upgrade
> effort with zero conversation context. Update it at every phase gate and whenever a
> significant decision or discovery is made. Keep it factual and current.

Last updated: 2026-07-08 (Phase 5 COMPLETE: DTG spec alignment + VC 2.0 — RCard separated from VRC, JCS digest, credo VCDM 2.0 patch, issuance flipped to VC 2.0 with RCE v2 negotiation; all gates green incl. two-device E2E and Phase-4-baseline backward-compat E2E; upstream credo issue filed)

---

## 1. Goal

Bring Keyring Wallet (fork of bcgov/bc-wallet-mobile + openwallet-foundation/bifold-wallet)
as close to upstream as possible: React Native, React, native toolchains, credo-ts, and all
major dependencies. The VRC (Verifiable Relationship Credential) module is Keyring's unique
contribution and must keep working (its tests are the contract). Proof of success = app
bundles AND runs on both platforms, verified by an Appium E2E script that does full
onboarding + a VRC exchange between two devices/emulators.

Secondary goal (last phase): move VRC issuance to W3C VC Data Model 2.0.
DIDComm v2 is **out of scope** — not shipped in any stable credo release (PR
openwallet-foundation/credo-ts#2704 still open as of 2026-06).

## 2. Decisions already made (by Alberto, 2026-07-04)

| Topic                             | Decision                                                                                                                                                                                                    |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App upstream reference            | `bcgov/bc-wallet-mobile` (NOT BC-Wallet-Demo, that's a web demo)                                                                                                                                            |
| BCSC (BC Services Card) code      | **Drop it** (`react-native-bcsc-core` pkg, bcsc API code) — but **keep the Keyring theme** (`app/src/keyring-theme/`, which lives alongside the bcsc-theme scaffolding it was derived from)                 |
| Storybook                         | Drop it (Storybook 5.3 won't survive React 19; user doesn't care)                                                                                                                                           |
| VC 2.0 old-credential migration   | Not needed (~0 users). Bump RCE protocol version so old/new wallets fail cleanly                                                                                                                            |
| E2E devices                       | Emulators/simulators first; fall back to real devices (user has both) if attestation/biometrics block simulators                                                                                            |
| Mediator + witness-server for E2E | Already hosted; endpoints configured in `app/.env`                                                                                                                                                          |
| Bifold sync strategy              | "Branch swap": new branch in `berkmancenter/keyring-bifold` starting from upstream 3.0.16 content, port Keyring delta onto it. Same repo, no new repo. Gives shared git history with upstream going forward |
| RN upgrade path                   | Two hops: 0.73→0.77 (last React-18 RN) first, then 0.81+React 19 together with bifold 3.x/credo 0.6                                                                                                         |

## 3. Current versions vs upstream targets

| Component           | Current                                       | Target (upstream, 2026-07)                                                                               |
| ------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `@bifold/*`         | 2.7.4 (fork, portal: to `bifold/packages/*`)  | 3.0.16                                                                                                   |
| credo-ts            | 0.5.17 (+ yarn patches)                       | 0.6.3 (DIDComm split into `@credo-ts/didcomm`; agent API moves to `agent.modules.*` / `agent.didcomm.*`) |
| React Native        | 0.73.11                                       | 0.81.5                                                                                                   |
| React               | 18.3.1                                        | 19.1.0                                                                                                   |
| askar               | `@hyperledger/aries-askar-react-native` 0.2.3 | renamed `@openwallet-foundation/askar-*` 0.6.0                                                           |
| anoncreds RN        | 0.2.4                                         | check upstream bifold 3.0.16 resolutions                                                                 |
| indy-vdr RN         | 0.2.2 (patched)                               | 0.2.4 (upstream carries its own patch)                                                                   |
| VRC signature suite | Ed25519Signature2018 (VCDM 1.1)               | Phase 5: DataIntegrityProof / eddsa-rdfc-2022 (VCDM 2.0) — verify credo JSON-LD VCDM 2.0 support first   |

Upstream bifold 3.0.16 root resolutions worth copying: react 19.1.0, react-native 0.81.5,
react-native-vision-camera 4.7.3, expo ~54 (they added expo modules!), plus their patch set
(`.yarn/patches` upstream): credo-ts-react-native biometrics patch, indy-vdr-react-native 0.2.4
patch, animo pex + sphereon pex patches (same ones we carry).

## 4. Repo topology & baselines

- Parent repo: `berkmancenter/keyring-wallet` (this repo). Yarn 4 workspaces: `app`, `packages/*`
  (only `packages/bcsc-core` — to be dropped). `bifold/` is a nested git repo
  (gitlink in parent) → `berkmancenter/keyring-bifold`.
- `@bifold/*` deps resolve via `portal:bifold/packages/*` in root package.json resolutions.
- Branches at baseline: parent on `feat/configurable-mediator-v2-batch-pickup`; bifold on
  `fix/disable-native-build-triggers` (1 commit ahead of its origin/main).
- **Baseline tags created (Phase 0): `upgrade-baseline-p0` in BOTH repos.**
- Upstream remote added inside `bifold/`: `upstream` → openwallet-foundation/bifold-wallet
  (tag `v2.7.4` fetched; upstream/main fetched).
- bc-wallet-mobile reference clone: `/tmp/bc-wallet-mobile` (full clone; re-clone if gone).

## 5. Delta extraction results (Phase 0)

### 5.1 keyring-bifold vs upstream `v2.7.4` (exact diff: `git diff v2.7.4 HEAD` inside `bifold/`)

Fork point is exact: upstream tag `v2.7.4`. 457 files changed (excl. lockfiles):
290 added / 158 modified / 9 deleted.

**Added (the Keyring contribution — ports cleanly, upstream never touches these paths):**

- `packages/core/src/modules/vrc/` — 67 files, the VRC module (managers, protocol, types, tests)
- `packages/witness-server/` — 66 files (server component; not an RN package)
- `packages/vrc-reference/` — 46 files (reference implementation + conformance)
- `packages/vrc-shared/` — 7 files (documentLoader etc.)
- `packages/vrc-contexts/` — 5 files (JSON-LD contexts)
- Non-VRC additions to core: Messages/chat screens (`Messages.tsx`, `MessageStack.tsx`,
  `useUnreadMessages`, `activeChatTracker`, `InAppMessageNotifier`, `MessageNotificationToast`),
  wallet Export/Import screens, `About.tsx`, Toggle screens (HardwareAttestation, Witnessing,
  WitnessReporting), `BiometricConfirmationModal` + `biometric-confirmation` context,
  `QRCodeExchangeSlider`, pseudonym utils, seedTestCredentials, ~18 SVG assets, 39 test files
- Docs: `docs/VRC_*.md`, `docs/WITNESSED_EXCHANGE_FLOW.md`, etc.

**Modified (158 files — must be re-applied by hand onto 3.0.16 where upstream moved):**

- Heaviest churn (ins/del): `hooks/chat-messages.tsx` (803/84), `screens/CredentialOffer.tsx`
  (476/61), `screens/Settings.tsx` (351/78), `components/chat/ChatMessage.tsx` (258/82),
  `navigators/SettingStack.tsx` (216/133), `navigators/TabStack.tsx` (133/132),
  `screens/Onboarding.tsx`, `contexts/reducers/store.ts` (+148), `index.ts` (+91 exports),
  `container-api.ts` / `container-impl.ts`, `theme.ts` / `theme.interface.ts`,
  localization en/fr/pt-br, `utils/agent.ts`, `hooks/useBifoldAgentSetup.ts`
- Native: `packages/react-native-attestation/` — heavily customized
  (`AttestationModule.kt` ~1.5k lines, `Attestation.mm` ~1.5k lines, build.gradle, podspec,
  `NativeAttestation.ts`) — hardware-backed VRC signing lives here. Treat as Keyring-owned;
  diff upstream's 3.0.16 version for template changes (New Arch!) and port ours onto it.
- Total modified-src churn: ~5.2k insertions / 1.3k deletions across 80 core src files.

**Deleted upstream files (9)**: `ListContacts.tsx`, `ContactDetails.tsx` (+ their tests/snaps),
`InfoIcon.tsx`, CODEOWNERS, MAINTAINERS.md — Keyring replaced contacts UI with its own.

Full list: regenerate anytime with
`cd bifold && git diff --name-status v2.7.4 HEAD -- . ':!yarn.lock' ':!package-lock.json'`

### 5.2 app/ vs bc-wallet-mobile fork point

Fork point: bc-wallet-mobile commit **`f628bb23`** (2025-09-17, "feat: update address #2452",
bifold 2.7.4 / credo 0.5.17 era; `e12ca6d1` scores identically — either works as reference).

**Keyring-only (added) in `app/`:**

- `src/keyring-theme/` — THE KEEPER (user decision)
- `src/types/`, `src/components/SetupCard.tsx`, `src/screens/Biometry.tsx`
- Keyring branding assets (fonts GT-America/SourceSans3, Keyring/ASML logos, onboarding/tab SVGs)
- `universal-link-site/`, `witness-link-site/`, `patches/` (jsonld-signatures, rdf-canonize),
  `__mocks__/@bifold`, `.jest/`, extra tests (`__tests__/navigation`, `__tests__/utils`)

**Modified vs fork point (~45 files):** `App.tsx`, `container-imp.ts`, `index.js`,
`src/store.tsx`, `src/constants.ts`, `src/theme.ts`, `src/onboarding.ts`,
`src/hooks/useBCAgentSetup.ts`, `src/utils/bc-agent-modules.ts`, `src/utils/mediator.ts`,
`src/components/OnboardingPages.tsx`, localization index files, several screens
(Splash, Terms, Preface, Developer, PINExplainer, RemoteLogWarning), `bcsc-theme/` scaffolding
(MainStack, RootStack, Settings, theme, navigators types), Podfile, build.gradle,
gradle.properties, settings.gradle, AppDelegate.mm, Info.plist, entitlements, app.json,
babel/metro/jest configs, `.env.sample`.

**bcwallet-only (we deleted):** `src/bcwallet-theme/`, BCSans fonts, android release.keystore.

### 5.3 Yarn patches carried (root `.yarn/patches` + `app/patches`)

- credo 0.5.17: anoncreds, core, indy-vdr → **die with credo 0.6.3** (re-derive only if the
  underlying fix is still missing; check upstream 3.0.16 patch set first — they carry
  equivalents for pex/indy-vdr)
- `@animo-id/pex`, `@sphereon/pex` → upstream 3.0.16 carries the SAME patches; adopt theirs
- indy-vdr-react-native / indy-vdr-shared 0.2.2 → upstream patches 0.2.4 instead
- app/patches (patch-package): `@digitalcredentials/jsonld-signatures@9.4.0`,
  `rdf-canonize@5.0.0` → VRC-related, keep and re-verify

## 6. Phase plan & status

- [x] **Phase 0 — Baseline & delta extraction** (this document; tags `upgrade-baseline-p0`)
  - [x] Delta bifold vs v2.7.4
  - [x] Delta app vs bc-wallet-mobile f628bb23
  - [x] Baseline test run recorded (§7 — all green)
- [x] **Phase 1 — Appium E2E harness on CURRENT app** — COMPLETE 2026-07-04.
      **Green run**: `node e2e/run-vrc-exchange.js` → full two-wallet exchange
      (Android emulator Pixel_6_API_33 ↔ iOS simulator iPhone 17) in ~7 min:
      both onboardings → invitation → paste → connection → bidirectional VRC offers →
      manual accepts → "added to your wallet" ×2 → peer R-card names visible in Contacts ×2.
  - Environment verified 2026-07-04: Appium 3.5.0 with xcuitest 11.10.0 + uiautomator2 7.6.1
    installed; iOS 26.3 simulators (iPhone 17 etc.); AVDs `Pixel_6_API_31`, `Pixel_6_API_33`.
  - Harness lives in `e2e/` (plain node + webdriverio, no test-runner framework):
    `run-onboarding-smoke.js` (single device) and `run-vrc-exchange.js` (two devices).
    Artifacts (screenshots + page-source XML) land in `e2e/artifacts/`.
  - [x] Android debug APK builds (`cd app/android && ./gradlew assembleDebug`)
  - [x] iOS simulator app builds (`cd app/ios && xcodebuild -workspace AriesBifold.xcworkspace
-scheme AriesBifold -configuration Debug -sdk iphonesimulator -derivedDataPath build/e2e-dd build`)
        → product is `KeyRing.app`. DO NOT pass CODE_SIGNING_ALLOWED=NO: it strips the keychain
        entitlements and the app fails onboarding with "Error code 1001 … required entitlement".
  - [x] **Android onboarding smoke passes** (fresh install → GetStarted → PIN explainer →
        PIN → biometry Continue → wallet naming → R-Card form → main tabs).
  - [x] iOS onboarding smoke passes (rebuilt without CODE_SIGNING_ALLOWED=NO; numeric-keypad
        dismissal = tap neutral content area x:235,y:240; `appium:platformVersion` must match an
        installed simctl SDK, currently 26.3).
  - [x] Two-device VRC exchange (Android emulator ↔ iOS simulator) PASSES.
        Flow facts the harness encodes (don't rediscover):
    - VRC offers are NOT auto-accepted. Each wallet gets a chat message "Credential offer
      received — Would you like to accept it? YES/NO" (`ChatMessage.tsx`
      CredentialOfferActions; YES has NO testID → find by text) → CredentialOffer screen →
      `AcceptCredentialOffer` → `ContactAddedToYourWallet` (VRC flow shows the Contact
      variant, not `CredentialAddedToYourWallet`) → `Done`.
    - VRCs are HIDDEN from the Wallet credential list by design
      (`ListCredentials.shouldHideFromWallet` filters RelationshipCredential/DTGCredential).
      Success signal = peer's R-card name in the Contacts list (proves credential content
      arrived, not just the connection).
    - Wallet auto-locks after 5 min inactivity; mediator round-trips can exceed it —
      harness has `unlockIfLocked` (PIN re-entry) woven into every wait loop.
    - Mediator delivery is slow (pickup polling); full run ≈ 9–10 min.
    - A redelivered duplicate offer-credential message logs "Error handling message …
      offer-credential" + "Failed to process message" with empty error `{}` — benign,
      exchange still completes.
  - Simulator/emulator hardware-signing caveats (logged by [VRC:Sign], NON-fatal — flow falls
    back to software keys): iOS sim "App Attest not supported"; Android emulator "Secure lock
    screen must be enabled" (no lock screen configured on AVD); embedded Google root CA expired.
  - Known red-box noise on both devices: unhandled rejection `IndyVdrError … did
'TeT8SJGHruVL9up3Erp4o' … Pool timeout` (indy ledger DID lookup from container-imp.ts
    OCA/ledger config; unrelated to VRC, but it paints a dev-mode toast over the UI).
  - IMPORTANT (harness ops): metro must NOT be piped through `tail`/`grep` when started — it
    swallows all RN JS console logs. Start plainly: `cd app && npx react-native start`.
    Both apps' JS logs stream into the metro terminal; that's the primary debugging signal.
  - Learnings encoded in the harness (don't rediscover these):
    - Debug builds need metro on the host (`cd app && npx react-native start`) and, for
      Android, `adb -s <emulator> reverse tcp:8081 tcp:8081` BEFORE first app launch —
      caps use `appium:autoLaunch:false`, harness runs reverse then `activateApp`.
    - Two adb devices may be attached (user's physical phone) — always pass `-s <udid>`.
    - Appium needs ANDROID_HOME exported; start:
      `ANDROID_HOME=$HOME/Library/Android/sdk appium --port 4723 --relaxed-security`.
    - Invitation URL is read from a `__DEV__`-only hidden ThemedText with
      testID `InvitationUrl` added to `bifold/.../components/misc/QRScanner.tsx`
      (accessibilityLabel = invitation URL). Receiver uses the stock PasteUrl screen
      (`PasteUrlButton` → `PastedUrl` input → `ScanPastedUrl`).
    - A feature-tour popup ("Contact requests") shows over the Contacts screen after
      onboarding; dismiss via testID `Close` before doing anything.
    - testID prefix is `com.ariesbifold:id/` (bifold `testIdWithKey`); Android → resource-id,
      iOS → accessibility id.
  - Fresh install (uninstall first) → onboarding → VRC exchange between Android emulator
    and iOS simulator. QR problem solved via invite-link injection, NOT camera. Good news:
    bifold core already ships a `PasteUrl` screen (`packages/core/src/screens/PasteUrl.tsx`,
    reachable from Scan/ConnectStack) — the harness can read the invitation URL from wallet A
    (expose via testID on the QR/connect screen) and paste it into wallet B. A temporary code
    hook may not be needed at all. Uses hosted mediator/witness from `app/.env`.
  - No existing e2e tooling in the repo (no appium/wdio/detox anywhere) — build fresh under
    `e2e/` at repo root.
  - Check first: does hardware attestation/biometry block simulators? If yes, add dev bypass
    flag or use real devices.
- [x] **Phase 2 — RN 0.73.11 → 0.77.x, React 18 kept, credo/bifold untouched** — COMPLETE.
  Branch: `upgrade/phase2-rn77` (root repo). DONE (2026-07-04):
  - RN 0.77.3 template applied (Upgrade Helper diff): Gradle 8.10.2, AGP 8.7.3,
    Kotlin 2.0.21, buildTools 35, NDK 27.1.12297006, iOS deployment target 15.1,
    settings.gradle plugin-based autolinking, `MainApplication.kt` OpenSourceMergedSoMapping,
    `AppDelegate.mm` -bundleURL, Podfile Flipper removal + `$VCEnableLocation=false`.
  - Ecosystem bumps: gesture-handler 2.22, safe-area-context 5.1, screens 4.6, svg 15.11,
    vision-camera 4.7.3, webview 13.13 (13.10 fails Kotlin 2.0 compile). bifold core
    peerDeps loosened to `>=`.
  - `dependenciesMeta.built=false` for @2060.io/ffi-napi+ref-napi (node-gyp/distutils breakage,
    not needed at runtime). Jest mock path: `react-native/src/private/animated/NativeAnimatedHelper`.
  - RN 0.77 BackHandler API: `subscription.remove()` in bifold Onboarding/ProofDetails/
    ProofRequesting. Kotlin 2.0 null-safety fix in react-native-attestation.
  - **RN 0.76+ prefab breakage (KEY LEARNING)**: @hyperledger/{anoncreds,aries-askar,indy-vdr}
    -react-native CMakeLists link `ReactAndroid::reactnativejni`, which no longer exists
    (merged into `ReactAndroid::reactnative` = single libreactnative.so). Fixed via yarn
    patches (indy-vdr patch REPLACES the pre-existing 627d424b96 patch — same filename, now
    also carries the CMake fix). Plus app/build.gradle `packagingOptions.jniLibs.pickFirsts`
    for libreactnative/jsi/fbjni/c++\_shared (libraries copy prefab .so into their AARs).
  - RN 0.77 codegen is stricter: bcsc-core spec couldn't use `Omit<>`, indexer+named props,
    or `any` → replaced JWTClaims with `UnsafeObject` (react-native/Libraries/Types/CodegenTypes).
    Moot once bcsc-core is dropped, but unblocked pod install.
  - iOS pods: full `rm -rf Pods Podfile.lock` needed (boost snapshot conflict from 0.73 lock).
  - GATE STATUS: app jest 23/88 PASS, bifold core jest 134/1242 PASS,
    `assembleDebug` BUILD SUCCESSFUL, iOS simulator `xcodebuild` BUILD SUCCEEDED.
  - BCSC removal DONE (2026-07-04): deleted `packages/bcsc-core` workspace,
    `app/src/bcsc-theme/`, `useSetupSteps`, bcsc tests. `store.tsx` stripped of
    BCSCState/BCSCDispatchAction/Mode (KeyRing is the only mode now; Root always renders
    KeyRingRootStack). Removed `BCSCApiClientProvider` from App, BCSC/KeyRingSC theme
    names + Developer screen theme/mode toggles, `@bcsc-theme` aliases
    (babel/tsconfig/metro), bcsc-core refs in package.jsons. keyring-theme KEPT.
    Unused BCSC localization strings left in place (inert; prune later).
    Post-removal gate: typecheck PASS, eslint PASS, app jest 14 suites/27 tests PASS
    (Developer snapshot updated), Android assembleDebug PASS (gradle locks regenerated),
    iOS pod install + simulator build PASS (RNBcscCore pod gone).
  - E2E VRC exchange rerun DONE (2026-07-04): green on BOTH platforms after two fixes:
    1. `@react-native-firebase` 14.x is incompatible with RN 0.77 (iOS crashed at startup,
       "No Firebase App '[DEFAULT]'"); bumped app+messaging to ~21.14.0, and added
       `RCTAppDependencyProvider` to AppDelegate.mm (required by RN 0.77 for third-party
       Fabric component/module resolution — its absence caused the
       `setSheetLargestUndimmedDetent` unrecognized-selector crash).
    2. **RN 0.77 / safe-area-context 5.x layout regression (KEY LEARNING)**: ScrollView
       with `height:'100%'` inside a SafeAreaView that lacks `flex:1` pushes the
       bottom controls (marginTop:'auto') off-screen. Fixed by `flex:1` on both the
       SafeAreaView and the ScrollView in: CredentialOfferAccept, ProofRequestAccept,
       CameraDisclosureModal, MobileVerifierLoading, CommonRemoveModal (bifold) and
       PersonCredentialLoading (app keyring-theme). Snapshots updated.
  - PHASE 2 GATE PASSED: app jest 14/27 PASS, bifold core jest 134 suites / 1242 PASS,
    Android + iOS build PASS, two-device E2E VRC exchange PASS on Android and iOS.
- [x] **Phase 3 — Big hop: bifold 3.0.16 + credo 0.6.3 + React 19 + RN 0.81**
  - [x] In `bifold/`: branch `upgrade/bifold-3.x` = upstream v3.0.16 content; §5.1 delta ported
        (commit `68d9da80`). Credo 0.6.3 migration done (commit `cdb9289c`): DIDComm APIs under
        `agent.modules.didcomm`, `DidCommModule` carries connections/credentials/proofs/oob/
        mediation config, renamed types/events (`DidCommConnectionRecord` etc.),
        `kms.importKey` + `dids.create createKey` (JWK types) replace `wallet.createKey`,
        askar renamed to `@openwallet-foundation/askar-*`, `W3cCredentialRecord.encoded`
        replaces private `.credential`. witness-server + vrc-reference fully migrated
        (sources AND unit tests — mock agents alias didcomm APIs under `modules.didcomm`;
        jest needs babel-jest ESM transform for credo 0.6 `.mjs` builds, see the two
        jest.config.js files). `receiveInvitationFromUrl` now REQUIRES a `label` in its
        2nd config arg (credo 0.6 moved agent label out of InitConfig).
  - [x] bifold gate: `yarn build` 0 TS errors, lint + prettier clean,
        `yarn coverage` 155 suites / 1398 tests PASS (core 1400 incl. 2 skipped,
        vrc-reference 105, witness-server, vrc-shared). One flaky suite noted:
        CredentialDetails.test.tsx can fail under full-run load (act() timing), passes
        isolated and on rerun.
  - [x] Pushed + PR opened: berkmancenter/keyring-bifold#26 (upgrade/bifold-3.x → main).
        NOTE: branch-swap made history disjoint from fork main; fixed with a signed
        tie-merge commit (`git commit-tree -S` with two parents, tree = Phase 3 tree).
        DO NOT merge without Alberto's approval.
  - [x] Attestation package: rebuilt from upstream 3.0.16 base, Keyring crypto re-applied.
  - [x] App JS layer: RN 0.81.5 + React 19.1.0 wired, bifold 3.0.16 portals (incl. new
        `@bifold/react-hooks` — `@credo-ts/react-hooks` is gone), credo 0.6.3 deps,
        askar → `@openwallet-foundation/askar-react-native` 0.6.0, Storybook dropped
        (dir + AppStorybook.tsx removed), branch `upgrade/phase3-bifold3`. Highlights:
    - `bc-agent-modules.ts` rewritten for credo 0.6 (`DidCommModule` config,
      `Kms.KeyManagementModule` with askar + expo secure-environment services,
      explicit JSON-LD/AnonCreds DIDComm format services, VRC document loader).
    - `useBCAgentSetup.ts`: wallet id/key now live in `AskarModule` store config —
      no more `agent.wallet.open()`; transports register via
      `agent.modules.didcomm.registerOutboundTransport`; indy-vdr pool warm-up
      guards the BC-patch-only methods (`refreshPoolConnections`).
    - DRPC-based BC attestation flow REMOVED (`@credo-ts/drpc` has no stable 0.6.x;
      Keyring doesn't run BC's attestation service). `AttestationMonitor` keeps the
      bifold interface; `requestAttestationCredential` now emits FailedRequestCredential.
      `app/src/utils/drpc.ts` deleted.
    - proofs/credentials API options renamed: `proofRecordId`→`proofExchangeRecordId`,
      `credentialRecordId`→`credentialExchangeRecordId`.
    - jest: transformIgnorePatterns synced with bifold core (credo .mjs, @noble,
      @stablelib, expo...); `@bifold/*` mapped to bifold SOURCES (lib/commonjs build
      has a circular-require bug under jest); reanimated mocked via official mock;
      RN 0.81 Keyboard/BackHandler mocks ported from bifold jestSetup.
    - babel: module-resolver `root: ['.']` REMOVED (it rewrote `from '.'` imports
      inside node_modules to app root index.js under jest); added
      `@babel/plugin-transform-export-namespace-from` + reanimated plugin.
    - Fixed upstream bug in bifold `store.ts` (absolute `components/views/Banner`
      import breaks consumers compiling core from source).
  - [x] App gate (JS): typecheck 0 errors, eslint clean, jest 14 suites / 27 tests PASS
        (6 snapshots updated for RN 0.81 Pressable/style flattening).
  - [x] Android native build GREEN with **New Architecture enabled** (`newArchEnabled=true`),
        `assembleDebug` passes. Changes: compileSdk/targetSdk 36, buildTools 36.0.0,
        kotlin 2.1.20, gradle 8.14.3, AGP version now supplied by RN gradle plugin;
        expo autolinking added to settings.gradle (`useExpoModules()`) and
        MainApplication wrapped in `ReactNativeHostWrapper` + `loadReactNative(this)`;
        `react.internal.disableJavaVersionAlignment=true` + subprojects Java-17
        compileOptions block (both from bifold samples/app — RN plugin vs expo
        toolchain conflict); kotlin-stdlib force-resolutions and app java toolchain
        block REMOVED (broke under AGP 8.12); gradle lockfiles regenerated
        (`--write-locks`). Attestation module: Android now implements the 5 iOS-only
        spec methods as UNSUPPORTED-reject stubs (New-Arch codegen makes them
        abstract on both platforms) — bifold commit.
  - [x] iOS native build GREEN (`xcodebuild` Debug, simulator). Podfile gained expo
        autolinking (`use_expo_modules!` + `expo_patch_react_imports!`), pods
        reinstalled (RN 0.81.5, hermes, 140 pods). AppDelegate.mm (RCTAppDelegate)
        still compiles on 0.81 — migration to RCTReactNativeFactory deferred.
  - [x] Release JS bundles green for BOTH platforms. metro.config fixes:
        exclusionList import moved to `metro-config/private/...` (metro 0.83 exports),
        `unstable_enablePackageExports` + conditions `['react-native','browser','require']`
        (nanoid etc. need browser builds), bifold/node_modules added to
        watchFolders/nodeModulesPaths, react-native-svg-transformer 0.14→1.5.1.
        New app deps surfaced by bifold 3.x code paths: zustand ~4.5.4 (core has it
        only as devDep), @expo/app-integrity ^55.0.9.
        PATCH: react-native-document-picker 9.3.1 uses GuardedResultAsyncTask
        (removed in RN 0.81) — yarn patch swaps it to GuardedAsyncTask.
  - [x] Runtime smoke test GREEN on both platforms: Android emulator (Pixel 6 API 33)
        boots to onboarding, iOS simulator (iPhone 17) boots to PIN unlock (existing
        wallet opened — askar 0.6 store loads). Runtime fixes:
    - metro resolveRequest singleton guard: imports of react/react-native/react-dom/
      @credo-ts/{core,didcomm,anoncreds} from OUTSIDE app/ re-resolve from the app
      root, otherwise bifold/node_modules' second react copy loads in dev bundles
      and hooks crash ("dispatcher.useContext of null" in bifold Button).
    - '@bifold/react-hooks' added to BIFOLD_SOURCE_PACKAGES (verifier src imports it).
    - react-native-date-picker REMOVED (unused; 5.0.13 breaks RN 0.81 iOS:
      "RNDatePickerManager does not conform to RCTModuleProvider").
    - GOTCHA: killing the `yarn start` wrapper leaves the node metro child alive
      holding :8081 — a stale metro served the old config for a while. pkill
      'cli.js start' or kill the listener pid from lsof.
  - [x] Two-device E2E VRC exchange GREEN (2026-07-06): Android emulator ↔ iOS simulator,
        full flow (onboarding → invitation → chat → bidirectional VRC issuance → contact
        visible on both). Five fixes to get there:
    - credo 0.6 event payload rename: `payload.credentialRecord` →
      `payload.credentialExchangeRecord` in `app/src/services/attestation.ts`
      (threw "Cannot read property 'id' of undefined" on every credential event;
      proof events still use `payload.proofRecord`).
    - Credo 0.6 event NAME rename (earlier fix, same class of bug): vrc-manager +
      InAppMessageNotifier listen on `DidCommBasicMessageEventTypes.…` not the old
      0.5 string.
    - Chat YES/NO + details links: RN's TouchableOpacity misses taps inside
      GiftedChat's inverted list on Android with New Architecture — swapped to
      `react-native-gesture-handler` touchables (gifted-chat already wraps in
      GestureHandlerRootView). E2E also retries the YES tap.
    - INFINITE RENDER LOOP ("Maximum update depth exceeded", both platforms, fired
      after accepting an offer): `useCredentialByState`/`useProofByState` in
      @bifold/react-hooks memoized `states` on ARRAY IDENTITY; app's
      `useNotifications` passes fresh array literals each render → new array each
      render → downstream effect loop (Connection screen via useNotifications).
      React 19 surfaces this hard. Fixed by keying the memo on `state.join(',')`.
    - Clock skew: holder rejected issued VC ("current date time is before
      issuanceDate") because emulator/simulator clocks differ by a few seconds —
      vrc-manager now backdates issuanceDate/validFrom by 5 min.
    - LogBox: dev banners cover bottom-of-screen buttons (Done) and eat E2E taps —
      `LogBox.ignoreAllLogs()` in dev (app/index.js).
    - E2E harness gotchas: stale `IOS_APP`/`ANDROID_APK` env vars make Appium
      install OLD builds (RN version-mismatch redbox); `enforceAppInstall: true`
      added for iOS; unset the env vars before runs.
  - [x] Askar 0.2→0.6 store migration check GREEN (2026-07-07): `e2e/run-store-migration.js`
        installs the baseline apk (credo 0.5.17/askar 0.2.3, built from `upgrade-baseline-p0`
        worktree as a RELEASE build with debug signing — a debug build would load the NEW
        JS from metro and crash on the askar native mismatch), populates the old-format
        store with a real VRC exchange against the new iOS build, then `adb install -r`
        the new apk over it. Wallet opens with the same PIN, contact + VRC survive.
    - MIGRATION BUG found+fixed: R-Card template records stored by credo-0.5 builds
      have NO `proof`; credo 0.6 parses stored credentials as
      W3cJsonLdVerifiableCredential (proof required), so `record.getTags()` threw and
      OpenIDCredentialRecordProvider crashed with a render error on first launch after
      upgrade. `migrateRCardTemplateProofs()` (vrc/services/rCardCredential.ts) adds the
      same placeholder proof new templates get; runs in `useBCAgentSetup.ts` right after
      `agent.initialize()`, before any provider reads W3C records.
    - E2E harness: old release build's QR bottom-sheet ignores appium synthetic taps —
      invitation delivered via deep link (`adb shell am start -a VIEW -d <url>`), which
      is also the real-user path. iOS `simctl privacy grant camera` kills the app;
      terminate + sleep + activate avoids a black-screen race. Runtime permissions
      granted via `adb shell pm grant` (manual installs skip autoGrantPermissions).
  - [x] Gate: VRC conformance tests green (bifold side done), two-device E2E green.
- [x] **Phase 4 (lite) — App-layer upstream sync** (2026-07-07). Analysis first: most
      upstream churn since the fork is BCSC product work (bcsc-theme/, variants build
      system, dual-mode store) that Keyring does NOT adopt. Ported the generic pieces:
  - [x] Error-handling framework (`app/src/errors/`): AppError + ErrorRegistry
        (registry trimmed to Keyring-relevant codes, ranges kept aligned with upstream
        so support references stay comparable) + errorHandler utils + ErrorInfoCard/
        AppErrorModal/ErrorBoundary components + `ErrorAlertProvider`/`useErrorAlert`
        context. Upstream's Snowplow analytics coupling DROPPED — errors report to
        Loki via the remote logger instead (`reportProblem()` in utils/logger.ts
        returns a human-readable reference code, shown+copyable in the modal).
        App.tsx now uses OUR ErrorBoundaryWrapper (was bifold's) and mounts
        ErrorAlertProvider inside TourProvider. AppEventCode enum in
        `app/src/events/appEventCode.ts` (trimmed from upstream's ~200 codes).
        Ported jest suites: appError/errorRegistry/errorHandler (49 tests).
  - [x] `PressableOpacity` (`app/src/components/`): Pressable-based TouchableOpacity
        replacement (New-Arch touch reliability); used by ErrorInfoCard.
  - [x] Small hooks: `usePreventGestureBack`, `useDeclineCredentialOffer`,
        `useDeclineProofRequest` (adapted to `useAgent` from @bifold/react-hooks —
        upstream uses their BCSC agent context), `useAutoRequestPermission`.
        `useAlerts` NOT ported (hard-wired to BCSC stacks/screens/factory-reset).
  - [x] Mediator pickup simplified to upstream's approach: unconditional
        `PickUpV2LiveMode` (WebSocket push) in useBCAgentSetup; REMOVED the legacy
        batch-pickup double-tap + 5s trust-ping polling loop (utils/mediator.ts
        deleted, `MEDIATOR_USE_V2_BATCH_PICKUP` env flag retired). Verified against
        our hosted mediator (credo-mediator.aaleon.com advertises wss) by the
        two-device E2E — message delivery works on socket push alone.
  - [x] Test-harness fix (bifold core jestSetup): RNGH's own jest mocks render
        buttons without children, blanking gesture-handler touchable labels —
        ChatMessage YES/NO tests failed. jestSetup now maps RNGH touchables to RN
        equivalents (4 previously-failing tests green).
  - [x] Gate GREEN (2026-07-07): app jest 16 suites/70 tests PASS; bifold core
        155 suites/1398 tests PASS; app+bifold typecheck PASS; two-device VRC
        exchange E2E (Android emulator ↔ iOS simulator) PASS on live-mode-only
        pickup — full flow inc. bidirectional VRC + contacts.
- [x] **Phase 5 — DTG spec alignment + VC 2.0 for VRC** — COMPLETE 2026-07-08.
      Credo 0.6.3 verified (source-read): JSON-LD Data Integrity signing is **VCDM 1.1-only**.
      The DIDComm jsonld format parses into `W3cCredential`, whose validators require
      (a) first `@context` = the v1.1 URL and (b) a mandatory `issuanceDate`. The
      `W3cV2CredentialService` (VCDM 2.0) only does vc+jwt / vc+sd-jwt (OpenID4VC stack,
      not wired to DIDComm). DIDComm itself and Ed25519Signature2018 are version-agnostic.
  - [x] **Task 1 — RCard/VRC separation**: VRC `issuer` is now a bare DID string for v2
        peers (PII out of the pseudonymous edge credential). RCard is an exchanged VDS
        (`type: ["VerifiableCredential","RelationshipCard"]`, subject = counterparty DID,
        `credentialSubject.card` = jCard) built from the local template
        (`services/rCardCredential.ts buildRCardCredential`) and offered right after the
        VRC (`issueRCardCredential` in vrc-manager, best-effort/non-blocking, deduped per
        connection). Receiver AUTO-ACCEPTS RelationshipCard offers (tagged
        `rcardExchange` metadata); RCard exchanges are filtered from chat bubbles,
        notifications, wallet list, and VRC-flow overlay state. Contact display resolves
        via `utils/rcardDisplayUtils.ts resolveContactDisplayInfo`: newest received RCard
        first, fallback to legacy VRC issuer objects (sorted most-recent-first). New
        RCard JSON-LD context in vrc-contexts (`https://www.firstperson.network/rcard/v1`)
        with `@type: @json` for the jCard (JCS-canonicalized as a JSON literal, structure
        survives RDF canonicalization).
  - [x] **Task 2 — VWC digest via JCS (RFC 8785)**: pure-TS `jcsCanonicalize` in
        `@bifold/vrc-contexts/src/jcs.ts` (recursive UTF-16 key sort, ECMAScript number
        serialization, undefined handling); witness-server + vrc-reference Witness now
        hash `jcsCanonicalize(vrcJson)` (was top-level-only key sort). Encoding stays
        `sha256:<hex>`. Wallet doesn't verify digests today; the helper is exported for
        when it does.
  - [x] **Task 3 — VC 2.0 verification (credo patch)**: yarn patch
        `.yarn/patches/@credo-ts-core-npm-0.6.3-28b59086b0.patch` applied in BOTH trees
        via the `resolutions` entry itself (GOTCHA: a second broader `"@credo-ts/core":
        "0.6.3"` resolution silently wins over a `@credo-ts/core@npm:0.6.3: patch:...`
        entry — put the `patch:` ref directly on the main resolution). Patch: (a)
        `IsCredentialJsonLdContext` also accepts `https://www.w3.org/ns/credentials/v2`
        first; (b) `W3cCredential.issuanceDate` optional. VCDM 2.0 context document
        bundled (`vrc-contexts/src/credentialsV2Context.ts`) + served by all three
        document loaders. `cachedStandardContexts.ts` pins credo's DEFAULT_CONTEXTS
        (security/ed25519 suites etc.) into the vrc-shared loader so Node-side
        sign/verify never fetches from w3.org. Conformance: `vc20Validation.test.ts`
        (model-level) + `vrc-reference vc20Conformance.test.ts` (full sign/verify
        round-trip on a bare credo agent, v2 and v1.1).
  - [x] **Task 4 — VC 2.0 issuance flip + RCE v2 negotiation**: handshake message now
        carries `vrc:rceVersion:2` (old parsers ignore the suffix); peer's version stored
        on `RelationshipDidRecord.counterpartyRceVersion` (absent = 1). For v2 peers:
        VRC/RCard/VWC are VCDM 2.0 (v2 context first, `validFrom`/`validUntil`, no
        issuanceDate). Witness-server mirrors the observed VRC's data model for the VWC
        and its freshness check reads `validFrom || issuanceDate` (window widened to
        10 min = 5 min clock-skew backdate + 5 min margin); announcement now
        `version: '2.0'`, capability `vc-2.0`.
        **KEY LEARNING (cost a failed E2E)**: the v2 base context does NOT define the
        Ed25519Signature2018 proof terms (v1.1 did), so jsonld-signatures APPENDS
        `https://w3id.org/security/suites/ed25519-2018/v1` to `@context` during signing —
        the signed credential then fails credo's holder-side deep-equality check against
        the offer ("Received credential does not match credential request"). Fix: include
        `ED25519_2018_SUITE_CONTEXT_URL` in `@context` at BUILD time in every v2 builder
        (vrc-manager, rCardCredential, WitnessService, vrc-reference Participant/Witness).
  - [x] **Backward compat with pre-Phase-5 peers (v1 path)** — found+fixed by the
        backward-compat E2E: a v1 peer (no rceVersion announced) must get the FULL legacy
        exchange, not just a 1.1-shaped VRC. Two fixes in vrc-manager:
        (a) legacy VRCs embed the old issuer OBJECT `{id, name, email?, organization?}`
        from the R-Card template (`buildLegacyIssuerObject`) — old apps read the contact
        name from it; (b) RCard issuance is SKIPPED for v1 peers — they can't resolve the
        RCard context (verification fails) and the unexpected offer surfaces as a second
        actionable chat bubble that broke the old app's accept flow.
  - [x] **Gates (all green 2026-07-08)**:
    - bifold core jest 159 suites / 1434 passed (2 skipped); vrc-reference +
      witness-server suites green; app jest/typecheck/lint green; core tsc + eslint clean
      (witness-server has PRE-EXISTING `Timeout` tsc errors from baseline — not a regression).
    - Two-device E2E VRC exchange (new↔new, Android emulator ↔ iOS simulator) PASS:
      RCE v2 negotiated both ways, VC 2.0 VRCs verified, RCards auto-accepted, contact
      names from RCards visible both sides.
    - Backward-compat E2E PASS: Phase-4 baseline RELEASE apk (commit `dc944fd`, worktree
      `/tmp/kw-p4-baseline` — build needs `yarn workspace @bifold/<pkg> build` for
      app-consumed packages, skip witness-server which fails its build on baseline, plus
      `./gradlew :bifold_react-native-attestation:generateCodegenArtifactsFromSchema`
      before assembleRelease) ↔ NEW iOS build: old wallet receives a legacy 1.1 VRC with
      issuer object, no RCard offered, contact visible on both; then `adb install -r`
      the new apk over the old store → PIN unlock, agent init, contact + VRC survive.
  - [x] **Task 6 — upstream credo contribution**: issue filed:
        https://github.com/openwallet-foundation/credo-ts/issues/2864 (VCDM 2.0 in the
        DIDComm JSON-LD credential format; offers our patch as a PR). When credo accepts,
        our yarn patch dissolves at the next upgrade.
  - **Deliberately deferred**: custom → official context URL switch (waiting on ToIP WG;
    draft in `dtg-context-v1.draft.jsonld`, git-excluded); DataIntegrityProof/
    eddsa-rdfc-2022 (when spec examples updated); BBS+/ZKP (separate future project);
    wallet-side VWC digest verification (jcsCanonicalize exported and ready).

## 7. Baseline test results (Phase 0 gate — all green, recorded 2026-07-04)

- `app`: `yarn test` → **PASS** (23 suites, 88 tests, 13 snapshots)
- `bifold` (all workspaces): `yarn test` → **PASS**; `packages/core` alone:
  **134 suites, 1242 passed / 2 skipped, 137 snapshots** (includes VRC module tests)
- `app`: `yarn typecheck` → **PASS**
- `bifold`: `yarn typecheck` (all workspaces) → **PASS**

Note: sandboxed shells can't reach watchman (`Operation not permitted` on its socket);
run jest outside sandbox or with `--watchman=false`.

## 8. How to resume (for the next agent)

1. Read this file top to bottom.
2. `git -C . status` and `git -C bifold status` — check for WIP beyond `.codegraph/.cursor`.
3. Find the first unchecked box in §6; that's the active phase. Respect the gates.
4. Baseline tags `upgrade-baseline-p0` exist in both repos if you need to diff/rollback.
5. Conventions: bifold commits need `Signed-off-by: Alberto L <aleon@law.harvard.edu>` as the
   last line; never add Cursor co-author trailers. Don't push without being asked.
6. Regenerate deltas with the commands in §5 if trees have moved.
7. Update §6 checkboxes, §7 results, and the "Last updated" line before you stop.
