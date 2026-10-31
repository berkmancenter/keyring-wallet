# @bifold/react-native-locality-peripheral

The device's BLE **peripheral** role in the locality co-presence ceremony
(`docs/plans/locality-plan.md` §10.3 item 9): advertise the rendezvous EID as
a 128-bit service UUID, serve two GATT characteristics (the sensor writes a
nonce, then reads back a signed transcript), sign that transcript with the
same hardware-attestation key the device already uses for VRC evidence — all
inside the ceremony window and foreground-only.

The wallet-side consumer is `@bifold/core`'s `BleDeviceLocalityProvider`,
implementing the `DeviceLocalityProvider` interface in
`src/modules/trust-tasks/deviceLocality.ts`. The other end of the wire is
witness-server's `BleLocalityProvider`.

## Status

|                           | Android                                 | iOS                                        |
| ------------------------- | --------------------------------------- | ------------------------------------------ |
| Native implementation     | `android/…/LocalityPeripheralModule.kt` | `ios/LocalityPeripheral.swift`             |
| Bridge style              | TurboModule codegen                     | legacy `RCT_EXTERN_MODULE`, via RN interop |
| Signature produced        | DER ECDSA over the binding              | CBOR App Attest assertion                  |
| Verified on a real device | **yes**, end to end, 2026-08-21         | **yes**, end to end, 2026-09-13            |

Both platforms have run live on physical phones. Neither has yet run from a
store or TestFlight build; what that leaves open is below.

**Android** has had a real live round trip — advertised, witness-server
connected, wrote the nonce, read back the transcript, `verifyTranscript()`
confirmed it. What is still unproven is whether the authorized `CryptoObject`
reliably survives being held across an entire advertising window; see that
file's own doc comment.

**iOS** first ran live on 2026-09-13 (keyring-wallet
`docs/plans/locality-plan/2026-09-13-al.md`): an iPhone 16 and an Android
phone against a witness on a Mac using the CoreBluetooth/noble sensor, via
`yarn e2e:vrc:witnessed:locality:devices`. Both legs confirmed, and both VWCs
carried `localityConfirmed: true`. It has since passed with the witness
_requiring_ co-presence on an iPhone + iPad pair
(`yarn e2e:vrc:witnessed:ios-devices:didcomm-v2:tsp:locality`, In-Person badge
asserted). The two questions only a live run could answer are settled:

- **`signingElapsedMs`.** iOS cannot pre-authorize the signature the way
  Android's `CryptoObject` can, so `DCAppAttestService.generateAssertion`
  runs _inside_ witness-server's RTT bound (provisionally 400ms). Measured
  77, 63 and 72 ms across three runs. The Swift still logs this number on
  every run, and the e2e harness reports it.
- **Foreground advertising of a 128-bit service UUID.** iOS moves 128-bit
  UUIDs into the advertisement's "overflow" area when the app is
  backgrounded, where only other iOS devices scanning for that exact UUID can
  see them — invisible to the witness's central. The ceremony is
  foreground-only by design, and in the foreground the witness matched the
  iPhone within 1 s of `Advertising started`.

What is still open on iOS: every live run so far used a development build,
whose App Attest environment is `development`. TestFlight and App Store
builds use the `production` environment, and no locality ceremony has yet run
from one. Separately, `witness-server/__tests__/unit/appAttest.test.ts` still
has its `describe.skip` block waiting for a captured device assertion.

`tsp-reference/ref-14-macos-ble-central` exists so this can be exercised from
a Mac acting as the central, without a Linux host.

## The signature is a different shape on each platform

This is the one substantive asymmetry, and it reaches all the way to the
witness.

Android signs the binding directly with `SHA256withECDSA`; the result is a DER
ECDSA signature that witness-server's `p256.verify` reads as is.

iOS cannot do that. The key the VRC evidence already commits to is an App
Attest key, and App Attest keys are reachable only through
`generateAssertion`, which returns a CBOR map `{signature, authenticatorData}`
whose signature covers `SHA256(authenticatorData ‖ SHA256(binding))`. Handed
straight to `p256.verify` that does not throw — it silently returns false.

Minting a second, ordinary Secure Enclave key on iOS _would_ produce
Android-shaped bytes. It would also produce a public key that differs from the
one in the VRC evidence, so `transcriptKeyMatchesVrcSigner` on the witness
would never match — discarding the single check that ties the device on the
radio to the device in the credential. So the witness learns App Attest
instead: `witness-server/src/trustTasks/appAttest.ts`. The full reasoning is
in `docs/plans/locality-plan/2026-09-12-al.md`.

`verifyTranscript` tells the two apart from the first byte — DER is always
`0x30`, a CBOR map is `0xa0|n` — so the wire format is unchanged and Android
transcripts take the path they always did.

## Why this is its own package

Not an addition to `@bifold/react-native-attestation`: that package's concern
is hardware-key attestation and signing; BLE advertising and GATT-server APIs
are a different platform surface with their own permissions and lifecycle
rules.

It does need to reach the _same_ key that package manages, which is the
package's most fragile property:

- **Android** reads the same KeyStore alias `AttestationModule.kt` creates,
  duplicated as a private constant in both files.
- **iOS** reads the same keychain items `Attestation.mm` writes — service
  `AriesAttestation`, accounts `<bundleId>.AttestationKey` and
  `<bundleId>.AppAttestPublicKey`.

Reading a _different_ key would not fail loudly. It would sign successfully,
produce a public key the witness cannot match, and report
`localityKeyMatchesCredentialSigner: false` on every ceremony while everything
else looked healthy. `src/jcsBindingParity.test.ts` asserts the iOS strings
against `Attestation.mm` for this reason; the Android alias is still checked
by convention only.

## The binding is duplicated four times, on purpose

Only the native side ever learns `sensorNonce` — the sensor writes it over
BLE — so only the native side can assemble the JCS binding once it arrives.
That puts the same five-value algorithm in four places:

1. `@bifold/core`'s `deviceLocality.ts` (wallet, Hermes)
2. `witness-server`'s `trustTasks/locality.ts` (Node)
3. `LocalityPeripheralModule.kt` (Android)
4. `ios/LocalityPeripheral.swift` (iOS)

Both native copies hand-write the canonical JSON rather than canonicalizing at
runtime. `src/jcsBindingParity.test.ts` reads both native sources as text and
asserts their key order matches RFC 8785 and each other — because the failure
mode is a signature the witness rejects with no hint as to why, on a path that
only runs on real hardware in a room with two people in it.

## Running the tests

```sh
yarn test        # jest — the JS bridge and the cross-language parity assertions
yarn typecheck   # tsc --noEmit
```

The Swift has no test target of its own. To type-check it against the real
SDK without a full app build:

```sh
xcrun swiftc -typecheck -sdk "$(xcrun --sdk iphoneos --show-sdk-path)" \
  -target arm64-apple-ios14.0 ios/LocalityPeripheral.swift
```

That needs the two React promise typedefs stubbed, since they normally arrive
through `ios/LocalityPeripheralBridge.h`:

```swift
typealias RCTPromiseResolveBlock = (Any?) -> Void
typealias RCTPromiseRejectBlock = (String?, String?, Error?) -> Void
```

## Permissions

**Android**: `BLUETOOTH_ADVERTISE` and `BLUETOOTH_CONNECT` are API 31+ runtime
permissions. The native side only _checks_ whether they are already granted
and resolves `null` if not — a normal ceremony outcome, not an error. The OS
request dialog is a JS-level, pre-ceremony UX decision (§10.3 item 8's
pre-flight sheet), deliberately not a bare popup mid-ceremony.

**iOS**: `NSBluetoothAlwaysUsageDescription` in `app/ios/AriesBifold/Info.plist`.
The prompt appears the first time a `CBPeripheralManager` is constructed,
which this module defers until the user has already authorized the ceremony —
so the purpose string needs to describe co-presence, not Bluetooth in general.
