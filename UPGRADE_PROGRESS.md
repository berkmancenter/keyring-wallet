# Keyring Wallet — Upstream Sync & Upgrade Progress

> **Purpose of this file**: hand-off document so any agent/human can resume the upgrade
> effort with zero conversation context. Update it at every phase gate and whenever a
> significant decision or discovery is made. Keep it factual and current.

Last updated: 2026-07-04 (Phase 2 COMPLETE — RN 0.77.3, BCSC dropped, E2E green both platforms)

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
- [ ] **Phase 3 — Big hop: bifold 3.0.16 + credo 0.6.3 + React 19 + RN 0.81**
  - In `bifold/`: new branch `upgrade/bifold-3.x` = upstream v3.0.16 content; port §5.1 delta
    onto it. Mechanical credo API rewrite everywhere: `agent.credentials` →
    `agent.modules.credentials`, explicit DIDComm module registration, askar rename.
  - Attestation package: start from upstream 3.0.16 version, re-apply Keyring crypto/signing.
  - App: RN 0.81 + React 19 (reference: bc-wallet-mobile main), drop Storybook.
  - New Architecture: try `newArchEnabled=true` (upstream default); custom native modules
    (attestation) must be audited; fall back to false if needed, but record it.
  - Adopt upstream patch set; wallet-open/migration smoke test (askar store compat).
  - Gate: VRC conformance tests green, jest green, both bundle, E2E green.
- [ ] **Phase 4 — App-layer upstream sync** (port wanted bc-wallet-mobile improvements;
      containers/DI, screens). Gate: full suite + E2E.
- [ ] **Phase 5 — VC 2.0 for VRC** (secondary goal)
  - FIRST verify credo 0.6.3 supports issuing/verifying JSON-LD Data Integrity VCDM 2.0
    (its VCDM 2.0 support is documented for vc+jwt / dc+sd-jwt; LDP 2.0 unverified).
  - contexts v2 in `vrc-contexts`, documentLoader in `vrc-shared`, witness-server verification,
    conformance tests, RCE protocol version bump. No data migration (user decision).

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
