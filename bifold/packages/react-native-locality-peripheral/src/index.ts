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
 * NATIVE MODULES: Android is real — `LocalityPeripheralModule.kt` compiles
 * against real TurboModule codegen and autolinks into the app (verified
 * 2026-08-21). Two things remain unverified on a real device before this
 * should be trusted in production: whether the authorized `CryptoObject`
 * genuinely survives being held across an entire advertising window (see
 * that file's own doc comment), and a live round trip against
 * witness-server's real `BleLocalityProvider`. iOS has no native
 * implementation (out of scope for now — no Xcode available to build or
 * verify it in this environment).
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

/** True only once a real native module answers — never true today. */
export const isNativeModuleLinked = (): boolean => LocalityPeripheralModule != null;

/** Whether this platform/OS version can run the peripheral role at all — always false until the native side exists. */
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
 * Throws `LINKING_ERROR` today, always — there is no native side to call.
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

/** iOS is out of scope for now (locality-plan.md §10.3 — deferred, no Xcode available to build/verify it). */
export const isSupportedPlatform = (): boolean => Platform.OS === 'android';

/**
 * The three functions above, bundled as one object matching the shape
 * `@bifold/core`'s `AndroidBleDeviceLocalityProvider` (and its
 * `NativeLocalityPeripheralBridge` injection port) expects — so that class
 * can take this module as a single import rather than three named ones.
 */
export const bridge = { isSupported: isPeripheralSupported, respondToSensor, stopAdvertising };
