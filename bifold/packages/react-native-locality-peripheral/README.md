# @bifold/react-native-locality-peripheral

**Design sketch only. No native implementation exists.** This package is
`src/NativeLocalityPeripheral.ts` (the TurboModule `Spec`) and `src/index.ts`
(the JS wrapper) — written first, and written to be reviewed, before any
Android Kotlin or iOS Swift exists to satisfy them. There is no `android/`
or `ios/` directory here yet, unlike this monorepo's other native packages
(`@bifold/react-native-attestation` is the template this one's TS-facing
shape mirrors).

## What this is for

`docs/plans/locality-plan.md` §10.3 item 9 — the device's BLE **peripheral**
role in the locality co-presence ceremony: advertise the rendezvous EID as a
128-bit service UUID, serve one GATT characteristic (the sensor writes a
nonce, then reads back a signed transcript), sign that transcript with the
same hardware-attestation key the device already uses for VRC evidence, all
inside the ceremony window and foreground-only. The wallet-side consumer is
`@bifold/core`'s `DeviceLocalityProvider` interface
(`src/modules/trust-tasks/deviceLocality.ts`) — this package exists so a real
implementation of that interface has a native module to call through.

## Why this is its own package

Not an addition to `@bifold/react-native-attestation`: that package's
concern is hardware-key attestation and signing; BLE
advertising/GATT-server APIs are a different Android/iOS surface with their
own manifest permissions and lifecycle rules. It does need read access to
the *same* KeyStore alias that package's `AttestationModule.kt` creates —
see the design note in `NativeLocalityPeripheral.ts` and
`docs/plans/locality-plan/2026-08-21-bam.md` for why, and for the specific
conflict this whole package exists to resolve (the hardware key's
per-operation biometric authorization cannot happen inside a live BLE GATT
round trip — authorization and signing have to be split in time).

## What building the native side actually requires

Not attempted here — this pass stopped at the interface. In order, roughly:

1. **Android manifest**: `BLUETOOTH_ADVERTISE` (API 31+, dangerous, runtime-
   requested) is not declared anywhere in `app/`'s manifest today, and there
   is no existing Bluetooth runtime-permission-request flow in the app to
   extend — this is greenfield permission UX, not a rewire.
2. **The KeyStore alias needs to move somewhere shared** between this
   package and `@bifold/react-native-attestation`'s `AttestationModule.kt` —
   currently a private constant in that one file.
3. **The biometric-authorization split**: obtain an authorized `Signature`
   via `BiometricPrompt` + `CryptoObject` when `respondToSensor` is called,
   *before* advertising starts; hold it in native memory; sign synchronously
   inside the GATT write callback once the sensor's nonce arrives.
4. **The GATT server + advertiser**, as one internal state machine —
   `BluetoothLeAdvertiser` + `BluetoothGattServer`, one characteristic,
   write-then-read, matching `ref-06p2-ble-observation`'s protocol (that
   rung's README documents the phone-side shape this needs to have, since it
   stood in a phone running nRF Connect for exactly this role).
5. **The binding assembly is a third deliberate duplicate.** Only the native
   side ever learns `sensorNonce` (the sensor writes it over BLE), so it
   must assemble the same JCS-canonicalized five-value binding
   `deviceLocality.ts`'s `bindingFor()` computes, itself, in Kotlin — a
   third copy of that one algorithm alongside the wallet (Hermes) and
   witness-server (Node) copies, for the same cross-runtime reason those two
   already are. Check it against the same frozen fixture
   `__tests__/deviceLocality.test.ts` in `@bifold/core` uses
   (`CHALLENGE`/`TASK_DIGEST`/`SENSOR_NONCE`/`SENSOR_DID` → the exact
   `bindingUtf8`/`bindingHex` values there) — don't just eyeball agreement
   with the other two copies.
6. **Validation**: point witness-server's real `BleLocalityProvider`
   (already built, §10.2 item 2 — not a reference-rung stand-in) at this
   native peripheral on a physical device, before reaching for the full
   `e2e:vrc:devices` suite (item 12).

## Not wired into the workspace

This package is not a dependency of `@bifold/core` or `app/` yet, and
nothing in this pass ran `yarn install` against it. It also deliberately
has no `scripts` entry — `bifold`'s root `build`/`test`/`typecheck`/
`coverage` all run via `yarn workspaces foreach run <script>`, which skips
any workspace member missing that script rather than erroring, so this
package won't break those until it actually has something for them to run.
(Its own TypeScript was still checked directly — `tsc --noEmit` against a
temporary symlink to `@bifold/core`'s `node_modules`, removed immediately
after — it's just not wired into the shared scripts.) Wiring it in for real
is a decision for whoever picks up the native implementation, not something
to do speculatively ahead of there being a native module to actually call.
