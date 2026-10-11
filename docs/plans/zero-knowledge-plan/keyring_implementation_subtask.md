# Hidden-vetting on the phone — the Keyring implementation

**Owner:** this plan's §4.1 (Track Z1). **Status:** analysis complete for the
protocol and the native-module shape; **no app code written yet.**
**Parent:** [`../zero-knowledge-plan.md`](../zero-knowledge-plan.md) — §3.1 and D4
decided on 2026-10-11 that the applicant proves on the phone; this document is
how that is built in this repository.
**Evidence it rests on:** the rung ladder `tsp-reference/ref-24-pcs-host` …
`ref-32-pcs-android` (parent §6.0). Nothing here is speculative about the
cryptography: it is measured, on both phone platforms.

## 1. The protocol is specified, and the plan was wrong to say it was not

**Correction to the parent's §8 B2.** That blocker reads *"Every one is
community-side (`vtc/`) or member-to-member … so none of them is an agent task"*,
and concludes the applicant's messages are unpublished. **The `vtc/` prefix names
the responder, not the caller.** Read at `dtgwg-trust-tasks-tf` **7b6bb488**:

- `specs/vtc/vetting/pcs-challenge/0.1/spec.md` front matter — `role: applicant,
  member: issuer` and `role: community, member: recipient`. The **applicant** is
  the caller.
- `specs/vtc/vetting/vetters/pcs-root/0.1` and `…/pcs-tokens/0.1` — likewise the
  **vetter** is the caller.

So the member-side message set is published, versioned, and carries payload
schemas and invalid-example fixtures. **ZK1 is not blocked.**

### 1.1 The applicant's four exchanges, in order

| # | Task | Who calls | What the client does with it |
|---|---|---|---|
| 1 | `vtc/join-requests/manifest/0.3` | applicant → community | Read `criteria[].vetting.ext["org.openvtc.hidden-vetting"]` and `vetting.extCritical`; decide the mode (§1.3) |
| 2 | `vtc/vetting/pcs-challenge/0.1` | applicant → community | Get a 16-byte lowercase-hex nonce and `expiresAt`; bind it into the proof |
| 3 | `vetting/attestation/0.1` | voucher → applicant | One per voucher, through the **existing, unchanged** vetting ceremony; hand each to the engine |
| 4 | `vtc/join-requests/submit/0.3` | applicant → community | Carry the proof in `ext["org.openvtc.hidden-vetting"]` |

**The published `ext` block maps exactly onto the bridge we already built**
(`manifest/0.3/spec.md:437-450`): `suite`, `helperKey`, `tokenKey`,
`vetterLabels`, `tokenLabels` — and `dripPerTick`, which the spec's example omits
but upstream's own client writes (`openvtc/src/state_handler/vetting_actions.rs:6827`).
That is `Params.fromManifest`'s signature, parameter for parameter, so the
mapping layer is a JSON read and not a translation.

**The proof rides in `ext`, not `extensions`.** `submit/0.3`'s schema offers both:
`extensions` is *"an opaque applicant-supplied bag with no schema, stored
verbatim"* (`spec.md:157`), while `ext` is the framework's namespaced extension
with criticality semantics. Upstream's integration test asserts
`raw["ext"][HIDDEN_VETTING_NS]["id"]`
(`openvtc-core/tests/hidden_vetting_onboarding.rs:346`), which settles it: a
community that acts on the proof reads `ext`.

### 1.2 Two things the challenge imposes on the UI

- **One open challenge per applicant**, replaced on re-ask (`pcs-challenge/0.1/spec.md`,
  Response). A client that asks twice has silently invalidated its first proof.
- **It expires** (15 minutes in upstream's own flow). An applicant who misses the
  window *"asks for another and builds another proof"* — so the proof must be
  built near submission, not at collection time, and the screen must be able to
  rebuild rather than only retry a send.

### 1.3 Mode selection: upstream has already written the semantics we need

`openvtc-core/src/vetting/hidden.rs:216-262` (`read_mode`) is the reference, and
it is **three** outcomes, not two:

| Criterion as received | Outcome |
|---|---|
| No `org.openvtc.hidden-vetting` in `ext` | `Named` — the path Keyring has today |
| `ext` present and readable, suite matches | `Hidden(params)` — prove |
| `extCritical` names a namespace this build cannot honour | **Refuse**, with `unsupportedExtension` |
| `ext` unreadable or suite unknown, **not** marked critical | `Named` — *"Unmarked, they are advisory and this client carries on named"* |
| Marked critical but absent from `ext` | Refuse — the community contradicting itself |

**This settles the fallback question in the parent's §4.1.4 in the user's
favour.** Degrading to the named path is not a deviation — it is what the
reference client does whenever the community has not marked the namespace
critical. The only non-conformance in Keyring today is that it ignores
`extCritical` altogether, so it also degrades in the one case where the
specification says a client MUST stop (`manifest/0.3/spec.md:160`: *"an applicant
that ignored a hidden-vetting namespace would gather named statements and submit
them to a criterion whose purpose was that it does not receive them"*).

**Therefore: implement all three outcomes, and put "proceed anyway when marked
critical" behind a flag that defaults to the conformant stop.** A demo can flip
the flag; the shipped default does not carry a deviation.

### 1.4 There is a deterministic reference run to test against

`openvtc-core/examples/zkp_reference_flow.rs` runs the whole ceremony from fixed
seeds — ten vetters holding real community-issued role credentials, three real
vetting sessions with tickets, session match codes and signed Vetting Cards, the
proof, the community's decision, and the admission credentials — and *"every
credential is emitted in full, so the output doubles as a test-vector set"*. Its
steps are `step00_seeds` … `step11_credential_inventory`; steps 04–07 are exactly
the applicant's four exchanges above.

**So Keyring's client does not need invented fixtures.** The ZK1 rung becomes
"reproduce steps 04–07 against that output", which is a far stronger contract
than frozen fixtures of our own making.

## 2. Where the code goes: the native module

Surveyed against the two worked examples in this repo,
`bifold/packages/react-native-attestation` (ObjC++, full TurboModule codegen both
platforms) and `bifold/packages/react-native-locality-peripheral` (Swift +
Kotlin, codegen on Android, legacy `RCT_EXTERN_MODULE` on iOS).

**`locality-peripheral` is the template**, because UniFFI emits Swift and Kotlin
and that is precisely the shape it already solves. Its own podspec says why iOS
skips codegen: a Swift TurboModule needs a C++ shim that buys nothing.

### 2.1 The new package

`bifold/packages/react-native-pcs/`, `@bifold/react-native-pcs`:

| Piece | Copy from | Note |
|---|---|---|
| `package.json` | locality's | raw `src/index.ts` for every entry field, no bob; `codegenConfig: { name: "RNPcsSpec", type: "modules", jsSrcsDir: "src" }`; `installConfig.hoistingLimits: "workspaces"`; a `build` script, because bifold's `yarn build` is topological over every workspace |
| `src/NativePcs.ts` | locality's | `Spec extends TurboModule`, `TurboModuleRegistry.get<Spec>('Pcs')` — the non-enforcing `get`, since iOS has no codegen'd module |
| `src/index.ts` | attestation's `:21-43` | the `global.__turboModuleProxy` dual path and the LINKING_ERROR proxy |
| `ios/Pcs.swift` + `PcsBridge.h` + `PcsBridge.m` | locality's | the `.h` exists only to expose `RCTPromiseResolveBlock`/`RejectBlock` to Swift; the `.m` selectors **must** match the Swift `@objc(...)` annotations exactly or it is a runtime "unrecognized selector", not a compile error |
| `android/build.gradle` | locality's | `Pcs_*` gradle.properties prefix, `namespace "com.pcs"`, newarch/oldarch source sets, `react { jsRootDir; libraryName = "Pcs"; codegenJavaPackageName }` |
| `android/src/main/java/com/pcs/PcsModule.kt`, `PcsPackage.kt` | attestation's | `TurboReactPackage` with `getModule` + `getReactModuleInfoProvider` |
| `android/src/oldarch/PcsSpec.kt` | attestation's | hand-mirrored abstract methods — the maintenance cost of the dual-arch shape. The app is `newArchEnabled=true`, so this is belt-and-braces |

### 2.2 The one thing neither bifold package does: carry a binary

Both bifold native packages compile from source and vendor nothing. The only
prebuilt-Rust precedent in the repository is the Askar/AnonCreds/IndyVDR family
in `node_modules`, and it is the right model:

- `askar.podspec:24` — `s.ios.vendored_frameworks = "native/mobile/ios/aries_askar.xcframework"`
- `android/build.gradle:134-137` — `sourceSets.main.jniLibs.srcDirs = ['../native/mobile/android']`, with one `lib*.so` per ABI
- **the binaries are downloaded at install time, not committed**: a `binary`
  stanza in `package.json` plus an `install` script, and `files` ships sources
  only

**Decision needed (D5, below): where our binaries come from.** We have no release
to download from, and committing ~8 MB of `.so` and an xcframework per bump is
not something to do silently.

### 2.3 Wiring: the four CLAUDE.md entries, plus three the file does not mention

The four (`CLAUDE.md:17`): a root `portal:` resolution, an `app/package.json`
dependency, a `packageDirs` entry in `app/metro.config.js`, and
`BIFOLD_SOURCE_PACKAGES` there. In practice also:

- `bifold/packages/core/package.json` — core is the real consumer, as it is for
  attestation and locality
- `app/jestSetup.js` — attestation is mocked at `:26`; a native module with no JS
  fallback breaks the app suite without the equivalent
- `app/metro.config.js:187-204` `singletonPrefixes` — only if the module
  registers native implementations on a module-level singleton

**Nothing in `MainApplication.kt`, nothing in the `Podfile`, nothing in
`react-native.config.js`:** both platforms autolink, given a podspec at the
package root and the package as an `app/package.json` dependency.

### 2.4 One Android packaging risk, already visible

`app/android/app/build.gradle:123-125` builds four ABIs
(`x86`, `x86_64`, `armeabi-v7a`, `arm64-v8a`), and `:167-172` already
`pickFirsts` the RN/JSI/fbjni/`libc++_shared` sonames. Our `.so` links
`libc++_shared` through the NDK, so the ABI matrix is **four** cross-builds, not
the one `ref-26` measured — and the `pickFirsts` list is where a duplicate
`libc++_shared.so` would have to be resolved.

## 3. Secure storage and the biometric gate

Surveyed across `app/` and `bifold/packages/`. The headline is good: **the
166-byte secret needs no new dependency and no new native code.** The headline
also carries a correction the parent plan must take.

### 3.1 The correction: our hardware key cannot wrap anything

The parent's §3.4 speaks of the applicant's secret being *wrapped by a
hardware-held key*. In this codebase that is not available from the keys we
already have:

- The attestation module's Android key is created `PURPOSE_SIGN or PURPOSE_VERIFY`
  (`react-native-attestation/android/.../AttestationModule.kt:257-259`) — it
  cannot encrypt.
- On iOS the same module is **App Attest**, not a raw Secure Enclave key: the
  only operations exposed are `attestKey` and `generateAssertion`
  (`ios/Attestation.mm:325-331`). There is nothing to wrap with.
- `@animo-id/expo-secure-environment`'s KMS backend **throws** on `encrypt` and
  `decrypt`; its surface is `generateKeypair / getPublicBytes / sign / deleteKey`.
- A repo-wide search for `PURPOSE_ENCRYPT|PURPOSE_WRAP|SecKeyCreateEncryptedData|wrapKey`
  across `app/` and `bifold/packages/` finds **no app-level wrap/unwrap anywhere**.

**So the accurate statement is: the OS holds the wrapping key, not us.**
`react-native-keychain` v10 generates an AES-256-GCM key *inside* AndroidKeyStore
(`CipherStorageKeystoreAesGcm.kt:159-180`, with `setIsStrongBoxBacked(true)`
attempted at `CipherStorageBase.kt:443-454`) and, on iOS, stores the secret under
a Secure-Enclave-enforced `kSecAttrAccessControl` rather than an app-visible
wrapping key. That is the same security property described, reached through the
platform rather than through our attestation key — and the parent should say so
rather than implying we hold the wrapping key.

### 3.2 Where the secret goes

`bifold/packages/core/src/services/keychain.ts` is the single wrapper for every
secret in the wallet, and `optionsForKeychainAccess(service, useBiometrics)`
(`:30-50`) is the one place access control is decided. The work is three small
additions:

1. a `KeychainServices` entry in `bifold/packages/core/src/constants.ts:36-40`
2. `storePcsApplication` / `loadPcsApplication` / `wipePcsApplication` beside
   `storeWalletKey` (`:73-79`) and `loadWalletKey` (`:143-164`);
   `setGenericPassword` takes an arbitrary string and 166 bytes of base64 is far
   inside both platforms' limits
3. the snapshot is written on every state change — the engine's `snapshot()` is
   the whole application, and an application that loses it loses its gathered
   attestations

### 3.3 Two things to do differently from the existing call sites

Both are visible in `optionsForKeychainAccess` and worth not inheriting:

- **`ACCESSIBLE.ALWAYS` for the non-biometric case** (`keychain.ts:32`) means
  readable while the device is locked *and* restorable to another device from
  backup. For this secret prefer `WHEN_UNLOCKED_THIS_DEVICE_ONLY` either way.
  Note what the current code does: only the wallet *key* is ever biometry-gated;
  the salt and the login-attempt counter are written `ALWAYS` (`:82`, `:89`).
- **With biometrics on, Android currently picks `STORAGE_TYPE.RSA`**
  (`keychain.ts:40-47`). For a wrapped blob the auth-required
  `STORAGE_TYPE.AES_GCM` is the better choice and is available in v10.

### 3.4 The biometric gate, and what it can and cannot be

The codebase already has the idiom: `BiometricConfirmationModal.tsx:147-152`
calls `loadWalletKey(title, description)` **purely as a gate** — it does not need
the secret, it needs the OS prompt. Auth mode is chosen at
`modules/vrc/vrc-biometric.ts:46-53` (`biometric` when available and enabled,
else `passcode`).

**What this gate is worth, stated honestly.** Gating the *read* of the snapshot
means a proof cannot be built without a biometric or passcode, which is a real
local control and the right one to offer. It is **not** the agent-side step-up
gate of the parent's §3.2 duty 1: nothing off the device verifies it, and an
attacker with the unlocked device has what they need. The parent already records
that loss as accepted under D4; this is what remains, not a replacement.

Worth knowing for the same reason: iOS App Attest signing already uses
`LAContext evaluatePolicy` as a **policy** gate, with a comment in the native
source saying exactly that it is *"not a cryptographic one"*
(`Attestation.mm:434-437`), because `generateAssertion` cannot be biometry-bound.
And both platforms carry a **300-second auth-reuse window**
(`AttestationModule.kt:79-88`, `Attestation.mm:16-38`), so a second operation
inside five minutes may not prompt at all. A screen must not promise "you will be
asked each time".

## 4. The client contract, the screens, and the phases

*Pending the survey in flight.*
