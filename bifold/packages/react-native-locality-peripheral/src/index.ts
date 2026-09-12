/**
 * React Native Locality Peripheral.
 *
 * locality-plan.md §10.3 item 9: advertise the device's rendezvous EID as a
 * service UUID, serve one GATT characteristic (write nonce, then read the
 * signed transcript), all inside the ceremony window and foreground only.
 * See this package's README.md for what's here, and
 * `docs/plans/locality-plan/2026-08-21-bam.md` for the reasoning trail
 * (why the hardware-attestation key's per-operation biometric auth needs to
 * be split from the actual signing operation, why this had to be its own
 * package rather than an addition to `@bifold/react-native-attestation`).
 *
 * NATIVE MODULES: both platforms are now real.
 *
 * Android — `LocalityPeripheralModule.kt`, real TurboModule codegen,
 * autolinks into the app (verified 2026-08-21). Still unverified on a real
 * device: whether the authorized `CryptoObject` survives being held across an
 * entire advertising window (see that file's doc comment), and a live round
 * trip against witness-server's real `BleLocalityProvider`.
 *
 * iOS — `ios/LocalityPeripheral.swift`, a legacy-style bridge module reached
 * through RN's interop layer rather than TurboModule codegen (see the
 * podspec for why). Type-checked against the iOS 14 SDK; NOT yet run on a
 * device. Two things differ from Android and both need a live run to settle:
 * the biometric prompt cannot pre-authorize the signature the way a
 * `CryptoObject` can, so `generateAssertion` runs inside the RTT-bound window
 * (the Swift logs `signingElapsedMs` for exactly this), and the signature is
 * a CBOR App Attest assertion rather than bare DER — which witness-server
 * learned to verify in `trustTasks/appAttest.ts`. Read that file's header
 * and `docs/plans/locality-plan/2026-09-12-al.md` before changing either
 * side.
 */

import { NativeModules, Platform } from 'react-native';

import NativeLocalityPeripheralSpec, {
  type NativeRespondToSensorParams,
  type NativeLocalityTranscriptResult,
} from './NativeLocalityPeripheral';

export type { NativeRespondToSensorParams, NativeLocalityTranscriptResult };

const LINKING_ERROR =
  `The package '@bifold/react-native-locality-peripheral' is not linked on this platform/build ` +
  `(no native module answered 'LocalityPeripheral') — this call cannot succeed here. ` +
  `Use NullDeviceLocalityProvider instead.`;

// @ts-expect-error TurboModule proxy check, same pattern as react-native-attestation's index.ts
const isTurboModuleEnabled = global.__turboModuleProxy != null;

const LocalityPeripheralModule = isTurboModuleEnabled ? NativeLocalityPeripheralSpec : NativeModules.LocalityPeripheral;

/** True only once a real native module answers on this platform. */
export const isNativeModuleLinked = (): boolean => LocalityPeripheralModule != null;

/** Whether this platform/OS version can run the peripheral role at all. */
export const isPeripheralSupported = async (): Promise<boolean> => {
  if (!LocalityPeripheralModule) return false;
  return LocalityPeripheralModule.isSupported();
};

/**
 * Run the whole advertise → GATT-serve → sign → resolve lifecycle for one
 * sensor directive. Mirrors `@bifold/core`'s `DeviceLocalityProvider.respondToSensor()`
 * contract exactly (resolve with the transcript fields, or `null` on
 * window-lost/declined) so the wrapping implementation in core stays thin.
 *
 * Throws `LINKING_ERROR` when no native module answers — a build without the
 * pod/Gradle module linked, or a platform this package does not implement.
 */
export const respondToSensor = async (
  params: NativeRespondToSensorParams
): Promise<NativeLocalityTranscriptResult | null> => {
  if (!LocalityPeripheralModule) throw new Error(LINKING_ERROR);
  return LocalityPeripheralModule.respondToSensor(params);
};

/** Best-effort cleanup; safe to call even if nothing is running. Never throws. */
export const stopAdvertising = async (): Promise<void> => {
  if (!LocalityPeripheralModule) return;
  try {
    await LocalityPeripheralModule.stopAdvertising();
  } catch {
    // Best-effort by contract (see NativeLocalityPeripheral.ts) — nothing to recover from here.
  }
};

/**
 * The platforms this package ships a peripheral implementation for. Says
 * nothing about whether the device can actually do it — that is
 * `isPeripheralSupported()`, which asks the native side (BLE advertising
 * support on Android; App Attest plus Bluetooth authorization on iOS, where
 * the simulator answers false because it has no App Attest).
 */
export const isSupportedPlatform = (): boolean => Platform.OS === 'android' || Platform.OS === 'ios';

/**
 * The three functions above, bundled as one object matching the shape
 * `@bifold/core`'s `BleDeviceLocalityProvider` (and its
 * `NativeLocalityPeripheralBridge` injection port) expects — so that class
 * can take this module as a single import rather than three named ones.
 *
 * A FUNCTION, not a plain exported value — found live (2026-08-21) that
 * mocking this module under Jest (`jest.mock('@bifold/react-native-locality-peripheral', ...)`)
 * makes named *function* exports resolve correctly through the mock but
 * silently returns `undefined` for named *plain-value* exports, even
 * though the mock registers the property (it shows up in `Object.keys`,
 * just not as a readable value) — a ts-jest/Babel ESM-interop quirk, not
 * specific to the name `bridge`. Calling this returns a fresh object each
 * time, sidestepping it.
 */
export const getBridge = () => ({ isSupported: isPeripheralSupported, respondToSensor, stopAdvertising });
