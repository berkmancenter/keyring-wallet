/**
 * React Native Locality Peripheral — DESIGN SKETCH, no native implementation.
 *
 * locality-plan.md §10.3 item 9: advertise the device's rendezvous EID as a
 * service UUID, serve one GATT characteristic (write nonce, then read the
 * signed transcript), all inside the ceremony window and foreground only.
 * See this package's README.md for what's here and what isn't, and
 * `docs/plans/locality-plan/2026-08-21-bam.md` for the reasoning trail
 * (why the hardware-attestation key's per-operation biometric auth needs to
 * be split from the actual signing operation, why this had to be its own
 * package rather than an addition to `@bifold/react-native-attestation`).
 *
 * NATIVE MODULES: none exist yet. `android/` and `ios/` are intentionally
 * absent — this file and `NativeLocalityPeripheral.ts` are the interface
 * the native implementation needs to satisfy, written first so the shape
 * can be reviewed before any Kotlin/Swift exists.
 */

import { NativeModules, Platform } from 'react-native';

import NativeLocalityPeripheralSpec, {
  type NativeRespondToSensorParams,
  type NativeLocalityTranscriptResult,
} from './NativeLocalityPeripheral';

export type { NativeRespondToSensorParams, NativeLocalityTranscriptResult };

const LINKING_ERROR =
  `The package '@bifold/react-native-locality-peripheral' has no native implementation yet ` +
  `(locality-plan.md §10.3 item 9 is not built) — this call cannot succeed on a real device. ` +
  `Use NullDeviceLocalityProvider until it is.`;

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
