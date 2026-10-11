# Hidden-vetting on the phone — the Keyring implementation

**Owner:** this plan's §4.1 (Track Z1). **Status:** **K0–K3 built, K4 part
built**, on `feat/hidden-vetting-mode` in the `bifold` submodule (worktree
`~/Documents/keyring-hidden-vetting`, six signed commits, **unpushed**, and
nothing in `app/` calls any of it). §7 records what each commit did and what is
left. **Not releasable:** the vendored `[patch.crates-io]` in the native package
cannot ship (§5 B7).
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

## 4. The client: where the named path branches, and what must change

### 4.0 Read this before touching any file: the working tree is 980 commits stale

Verified 2026-10-11 in the main checkout: the outer repository is **1127 commits
behind** `origin/main`, the `bifold` submodule is checked out at `7dc1de2a` and is
**980 behind** its own `origin/main`, and the submodule SHA the outer `origin/main`
pins is **`95371d9f`**. The vetting implementation is not on disk at all —
`grep -ri vett` over `bifold/` and `app/` in the checkout returns nothing.

**Every file and line number below was read from git objects at `95371d9f`** and
must be re-verified after the submodule is updated. Updating it is step K0.

### 4.1 Correction: the client is no longer ignorant of hidden vetting

The parent plan, and a statement I made on 2026-10-10, say there are **zero**
occurrences of `hidden-vetting` in bifold and that `ext` *"exists only in a schema
and is never read"*. That was measured on this stale tree and **is now wrong**. At
`95371d9f`, `packages/core/src/modules/trust-tasks/module/joinManifest.ts`
carries:

- `:156` `export const HIDDEN_VETTING_EXT = 'org.openvtc.hidden-vetting'`
- `:164-170` `HIDDEN_VETTING_OPERATIONAL = ['vetterLabels','tokenLabels','dripPerTick','tickLength','events']`,
  citing **VTI #1977, 2026-10-06**
- `:186-197` `criterionDigest()`, which **does read** `vetting.ext[HIDDEN_VETTING_EXT]`
  and strips the operational members before digesting, with `digestMatches()`
  (`:204-206`) accepting either that rule or the whole-criterion rule a community
  on an older VTI still uses

So the client already knows the namespace, already knows which parameters are
operational, and already computes the digest the way a hidden-vetting community
does. **That is the anchor the rest hangs off, and it did not exist when this plan
was written.**

### 4.2 What is still missing is exactly one thing: the mode is never read

Verified at `95371d9f` across `packages/`:

- **`extCritical` — one hit, and it is a test fixture**
  (`__tests__/fixtures/join-0.3/manifest-response-examples.json:198`). No code
  reads it.
- **`unsupportedExtension` — zero hits.** No such fault, state or string.
- `faultOf()` (`joinManifest.ts:219-244`) judges a criterion usable and its
  `JoinWayFault` union (`:94-102`) has no member for an extension it cannot
  honour.
- `wayOf()` (`:264-298`) flattens `vetting` to `{statements, claims, methods}`
  and **drops `ext`**.
- `VtiApplicant.start()` (`module/vtiVetting.ts:1547-1612`) takes the **first**
  criterion carrying a `vetting` member (`:1557`) and copies seven named fields
  (`:1594-1606`). It never looks at `ext` or `extCritical`.
- `VettingRequirements` (`packages/trust-tasks/src/vetting/evaluate.ts:32-44`)
  has **no `ext` and no index signature**, so hidden parameters cannot reach the
  evaluator without a type change.
- `vettingRequirements` schema (`module/vettingSchemas.ts:242-245`) is
  `additionalProperties: true`, so `ext` and `extCritical` pass validation
  silently. The shared `Ext` definition already exists at `:85-92`.

**So the silent downgrade is real and precisely located**, and it is one decision
(`read_mode`) rather than a diffuse gap. A criterion marked
`extCritical: ['org.openvtc.hidden-vetting']` is read today as ordinary named
vetting with a `minStatements` count, and the person is sent to the ticket flow.

### 4.3 Two API corrections for the evaluator

The parent plan and my earlier notes get this wrong in a way that would have
produced code that does not compile:

- **There is no `satisfied()` method.** `evaluateStatements(statements,
  requirements, joinDid, at?)` is a **pure function** returning
  `VettingEvaluation`, and the boolean is a **field named `meets`**, computed as
  `needs.length === 0` (`evaluate.ts:121-126`, `:196`).
- **`needs` is `{ kind: 'statements' | 'method'; method?: string; n: number }[]`**
  (`:74`), built at `:175-181`. `independenceOk` is deliberately **not** folded
  into `meets` (`:76-81`): a blown relationship cap is a referral, not a refusal.

### 4.4 The ten seams, in the order to touch them

| # | Seam | Change |
|---|---|---|
| 1 | `joinManifest.ts:219-244` `faultOf()` | scan `extCritical`; add `unsupportedExtension` to `JoinWayFault` (`:94-102`) |
| 2 | `joinManifest.ts` (new) `readMode()` | port upstream's `read_mode` three-outcome semantics (§1.3) |
| 3 | `joinManifest.ts:264-298` `wayOf()` | carry a hidden-mode discriminator instead of dropping `ext` |
| 4 | `screens/joinWays.ts:31-77` | `JoinCannotUse` gains the "this build cannot do hidden vetting" word; `canStartVetting` (`:63`) accounts for the mode |
| 5 | `module/vtiVetting.ts:1547-1612` `VtiApplicant.start` | **do not branch here** — see 4.5 |
| 6 | `screens/VtiVetting.tsx:273-285` | where `applicantRef` is constructed: select named or hidden |
| 7 | `screens/vettingPrimary.ts:20` `ApplicantStep` + `VtiVetting.tsx:1179-1196` | the member step machine; hidden mode has no per-voucher ticket/match/card sequence |
| 8 | `module/vtiVetting.ts:2322-2404` `checklist()` | widen its contract (§4.6) |
| 9 | `packages/trust-tasks/src/vetting/evaluate.ts:32-44` | `VettingRequirements` needs the hidden parameters to be reachable |
| 10 | `module/vettingSchemas.ts:242-245` | declare `ext`/`extCritical` against the existing `Ext` def for shape enforcement |

### 4.5 A sibling class, not a branch — and the first DI seam in this module

`VtiApplicant` is `module/vtiVetting.ts:1524-2405` — ~880 lines whose every step
(`requestVetter`, `confirmMatch`, `sendCard`, `receiveStatement` with its
fourteen-gate acceptance path) is about a **named** voucher. Hidden mode keeps the
ceremony and replaces only what the voucher returns and how progress is counted,
so branching inside those methods would thread a mode flag through all of them.

**Build `HiddenApplicant` as a sibling** implementing the subset of the interface
`VtiVetting.tsx` actually uses, and select it where the screen constructs
`applicantRef` (`:273-285`).

**Note what that costs, because it is not free.** The trust-tasks module is **not
DI-wired today**: `VtiApplicant`, `VtiVetterDesk` and all three stores are `new`'d
directly in the screen (`:273-285`), and the screen is imported statically by
`navigators/MyAgentStack.tsx:23` rather than resolved from a `SCREEN_*` token. So
registering the selection behind a token would be **the first DI seam in
`modules/trust-tasks`** — a new pattern for this module, not an extension of one.
The container mechanics are ready for it (`container-api.ts:186-205` `TOKENS`,
`:216-285` `TokenMapping`, `container-impl.ts:131-292` `init`, child-container
override as in `app/src/demo-profiles/starter/StarterContainer.ts:49-54`), and
**D6 below records the choice** rather than taking it silently.

### 4.6 The progress surface is the hard part, and §4.1.3 is why

`checklist()` (`:2322-2404`) counts held `'vetting-statement'` credentials whose
subject is `joinDid` and whose `id` a request names (`:2355-2359`), runs
`evaluateStatements` (`:2363-2373`), folds in grant faults (`:2380-2387`) and
returns `{ held, needed, counted, meets, statements, discounted, needs,
independenceOk, exceededCaps, unreadableMaxAge, unchecked }`. The UI contract is
83 testIDs (`VtiVetting.ids.ts`), with `checklist` `:69`, `discounted` `:70`,
`needs` `:73`, `independence` `:74`.

In hidden mode there is **no per-statement fact to count** — that is the point of
the construction — and the parent's §4.1.3 is the governing constraint:
`ref-27` proved the engine accepts a duplicate attestation, builds a proof from
it, and the community counts it once. So:

- `held` = the engine's `held()` count. Honest, and **not** the same as what will
  be counted.
- `counted`, `discounted`, `independenceOk`, `exceededCaps` have **no hidden-mode
  meaning before submission**. They must be absent, not zero: a zero renders as
  "none counted", which is a claim we cannot make.
- `needs` is authoritative **only** from the community's answer. Before submitting
  there is `minStatements` and a holding count, and the screen must word the
  difference — "you hold 3; the community will count distinct vouchers" — rather
  than show a tick.
- `meets` must be **optimistic-only**, matching the existing rule the named path
  already documents: the client may be optimistic where the community is not,
  never the reverse.

### 4.7 One more thing the screen must carry: the challenge's lifetime

From §1.2: one open challenge per applicant, replaced on re-ask, expiring in
minutes. The step machine (`:1179-1196`) currently has no notion of a step that
can go stale while the person looks at it. Hidden mode's `apply` step must be able
to **rebuild** the proof, not merely retry the send, and asking for a second
challenge must be understood as invalidating the first.

## 5. Decisions this work needs

- **D5 — where the native binaries come from.** Askar downloads them at install
  from a GitHub release and ships none in the package (§2.2). We have no release
  to download from. The options are: commit the xcframework plus four `.so` files
  (~8 MB a bump, in a submodule, every bump a binary diff); publish them to a
  release of our own and copy Askar's `install` script; or build from source at
  install time, which puts the Rust toolchain and the NDK on every developer's
  machine and in CI. **Recommendation: a release of our own**, because it is the
  pattern the repository already consumes four times over. Needs Alberto.
- **D6 — the DI seam.** §4.5: introduce `TOKENS` registration for applicant
  selection (first in this module, consistent with the rest of core), or select on
  a plain conditional in the screen. **Recommendation: a plain conditional first**,
  and a token only when a second consumer exists — the module has lived without DI
  and a seam with one caller is speculative.
- **D7 — the demo flag.** §1.3: "proceed even when the namespace is marked
  critical" defaults off (conformant stop) and is flippable for a demo. Needs a
  name and a home — a dev-menu toggle beside the existing ones in
  `app/src/screens/Developer.tsx` is the obvious place.
- **D8 — the four-ABI question.** §2.4: `ref-26` measured one Android ABI; the app
  builds four. Either cross-build all four or restrict the module's ABI set and
  accept that hidden vetting is unavailable on x86 emulators — which would make
  `ref-32`'s own test path unavailable.

## 6. Phases

**K0 — make the tree buildable and current.** Update the outer repository and the
`bifold` submodule to the pinned `95371d9f`, re-verify every line number in §3 and
§4, and re-run the parent's §6.0 ladder against whatever moved. **Nothing else
starts before this.**

**K1 — mode selection, no native code.** `readMode()`, the `extCritical` scan,
`unsupportedExtension` as a fault, the schema declaration, and the Join screen
wording. **This phase alone closes the silent downgrade** and ships without a
single byte of Rust, a binary, or a new package. It is also exactly the parked
app-lane fix from 2026-10-10, now with upstream's semantics to copy rather than
invented ones.

**K2 — the native module, unwired.** `bifold/packages/react-native-pcs` per §2,
built for both platforms, with the bridge's own tests. Not yet a dependency of
`app/`, so it cannot affect a build.

**K3 — the client.** `HiddenApplicant`, the keychain storage of §3, the challenge
exchange, the submission with the proof in `ext`. Tested against the reference
vectors from `zkp_reference_flow.rs` (§1.4).

**K4 — the screens.** The step machine, the honest progress surface of §4.6, the
refusal and at-capacity wording.

**K5 — the gate.** The e2e path, and the one measurement still missing from the
parent's §6.0: a physical Android device.

**Shipping is blocked on B7 regardless of K-phase progress** — the vendored
`[patch.crates-io]` cannot ship, so K2 onwards is *prepared and proven*, not
releasable, until the upstream feature gate lands.

## 7. What is built, and what is left (2026-10-11)

Six commits on `feat/hidden-vetting-mode`. Every regression claim below is
"identical before and after", **not** green: the worktree borrows `node_modules`
from a checkout 980 commits behind the submodule, so 15 suites in
`packages/core` fail for linker reasons unrelated to these changes (a 4-argument
`signDocumentProof` against a 3-argument build, missing `@bifold/trust-tasks`
exports). Each change was measured against that same baseline.

### K1 — mode selection (`63d96b69`)

`readVettingAsk(criterion)` reads what the community published; `vettingModeFor(ask, capabilities)`
applies what this build can do. Two functions deliberately, because the
community's ask does not depend on our binary. The rules are openvtc's own
`read_mode`, so an applicant here and the reference client agree about what was
asked. A refusal surfaces as a new `unsupportedExtension` fault and a Join row
saying this version cannot vouch the way the community does, in all three
locales. `allowUnsupportedCritical` is off by default and off in a shipped build.

**One existing test asserted the bug**: `joinManifest.test.ts` expected
`usable: true` for the specification's own hidden-vetting criterion, which marks
its namespace critical — the silent downgrade, encoded as desired behaviour. It
now asserts the refusal, with a comment recording the change; the advisory case
keeps the old answer, which is where the fallback lives.

### K2 — the native package (`5ee3ee22`)

`bifold/packages/react-native-pcs`, per §2. **The surface is flat**: every
function takes the application's saved state and returns the new saved state.
An object with methods is the obvious shape and the wrong one — a native object
outlives the JavaScript that made it, so the handle must be tracked,
invalidated on a reload and freed on unmount, the state lives in two places, and
the OS may kill the app between any two calls. Flat, there are no handles,
nothing to leak, and a relaunch is indistinguishable from a continuation. The
cost is re-reading the published parameters per call, against an 8 ms proof.

`rust/tests/flat_surface.rs` drives the whole protocol through that surface — a
real community and three real vouchers from the published engine, three
attestations taken through `receive_attestation`, a proof, and **the community's
own verifier** deciding — passing only `saved` between steps. Plus the two
refusals that matter: another suite declined before an application starts, and
an attestation meant for someone else refused.

**All four Android ABIs build**, including 32-bit ARM, so **D8 needs no
compromise** and `ref-32`'s own emulator path stays available: 2.5 MB
(arm64-v8a), 1.6 MB (armeabi-v7a), 3.4 MB (x86), 2.9 MB (x86_64), linked and
stripped. The iOS xcframework is 285 MB **on disk and that is not an app-size
figure** — a static archive holds every object file before the linker discards
what is unreached, which `ref-26` measured at roughly thirty times. Those sizes
are also from the **unoptimised** profile: the shipping profile (`lto`, `strip`,
`panic = "abort"`) that `ref-26` used was missing from this crate and is now
added, but the rebuild to measure it was killed for disk (§7.1).

### K3 — storage, the client, and the challenge (`c7c2c407`, `35010322`, `c8847fce`)

- **Storage.** One Keychain item of its own, keyed by community, holding the
  engine's ~166-byte state. Deliberately **not** `optionsForKeychainAccess`: its
  non-biometric branch is `ACCESSIBLE.ALWAYS`, readable while the device is
  locked *and* restorable onto another device from a backup, where this is
  `WHEN_UNLOCKED_THIS_DEVICE_ONLY` either way; and with biometrics on its
  Android branch picks `STORAGE_TYPE.RSA` where an opaque blob wants the
  auth-required `AES_GCM`.
- **The client.** `HiddenProgress` carries `held` and the published `minimum`,
  and `counted`/`stillNeeds` **only once the community has answered** — absent
  rather than zero, because a zero renders as "none counted". The state is
  written back after every step, so a kill between two vouchers loses nothing.
- **The challenge** (`vtc/vetting/pcs-challenge/0.1`). A **write**, never
  retried, never in `VTI_READ_TASKS` — that list's comment now names this task
  as the clearest case for why "anything unlisted is a write" is the right
  default. The reading is a module apart from the transport so it can be tested
  without a connected agent, and it is strict: uppercase, whitespace and a wrong
  length are each refused, because a community compares the challenge byte for
  byte and a value this client "repaired" would bind a proof to something never
  issued. `notHiddenVetting` returns `undefined` rather than throwing — a
  community may have turned the mode off since its manifest was read.
- **The submission.** `submitPayload` carries the `extensions` bag and `apply()`
  threads it; the member name is the engine's, so the bag is passed in rather
  than assembled. An empty bag is not sent.

### K4 — the screen's decisions (`c811c598`), but not its rendering

`hiddenApply.ts` holds the decisions as pure functions, for the same reason
`applicantPrimary` is one: the apply action, the challenge's staleness (a
challenge with seconds left counts as expired — the round trip costs more than
that, and telling someone to hurry against a clock they cannot see is useless),
one button either way, and `hiddenProgressLines`, which never claims a count of
its own.

Copy in all three locales, as i18next plurals: **this package forbids "(s)" in
the vetting copy** and a test enforces it, which caught the first draft.

**Not done: the JSX.** `VtiVetting.tsx` (1796 lines) is untouched, and its screen
test is one of the 15 failing for borrowed-dependency reasons — so wiring it
would mean editing the module's largest file with no feedback loop. **A real
`yarn install` in the worktree comes first**, which is a shared-machine ask
rather than a code task.

### 7.1 One more thing this work cost

The full native matrix left a **~16 GB** cargo target and the rung crates another
9.6 GB, which took the Mac to 6.3 GB free with the gate lane queued behind it.
The cause is `aws-lc-sys` compiling C per target — the same 1.7 MB of AWS crypto
B7 is about. Everything was deleted (38 GB free afterwards) and the standing rule
is now: delete the target as the last step of any build, jest `--runInBand`, and
clear the matrix with the coordinator first.

### 7.2 Two corrections to this document's own earlier claims

- **§5 B7's second ask is withdrawn.** It asked upstream for a wire form for a
  received attestation. `snapshot::HeldAttestation` is public, derives
  `Serialize`/`Deserialize` as camelCase with `deny_unknown_fields`, and carries
  `of()` and `restore()` — and `restore()` yields the `HiddenAttestation` that
  `receive` takes. The path was always complete. What remains is a client's own
  mapping, which `heldAttestationFromPayload` owns.
- **§1.1 had the proof's carrier wrong.** It said `ext['org.openvtc.hidden-vetting']`,
  from upstream's `raw["ext"][HIDDEN_VETTING_NS]["id"]` assertion. That
  assertion is on the **vetting request to a voucher**, carrying the applicant's
  identifier. The submission's carrier is **`extensions.hiddenVetting`**, built
  by the engine's own `to_extensions`.
