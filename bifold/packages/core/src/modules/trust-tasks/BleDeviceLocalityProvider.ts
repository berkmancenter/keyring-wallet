/**
 * The wallet-side `DeviceLocalityProvider` implementation wrapping
 * `@bifold/react-native-locality-peripheral` (locality-plan.md §10.3 item 9).
 *
 * Platform-neutral: everything below is the same on Android and iOS, because
 * the entire platform difference lives behind the native module's one
 * `respondToSensor` call. Named `Android…` until 2026-09-12 only because
 * Android was the only implementation.
 *
 * Proven live end to end on a physical Android device (2026-08-21, see
 * `docs/plans/locality-plan/2026-08-21-bam.md`): the native peripheral
 * advertised, witness-server's real `BleLocalityProvider` connected, wrote
 * the nonce, read back the signed transcript, and `verifyTranscript()`
 * confirmed it. iOS has not had that run yet — see
 * `docs/plans/locality-plan/2026-09-12-al.md`.
 * `createDeviceLocalityProvider()` below is what `ceremony.ts`'s real call
 * site uses.
 */

import { Platform } from 'react-native'

import { Agent } from '@credo-ts/core'
import type {
  NativeRespondToSensorParams,
  NativeLocalityTranscriptResult,
} from '@bifold/react-native-locality-peripheral'

import { ensureHardwareSigningKey } from '../vrc/vrc-hardware-signing'
import { resolveHardwareSigningAuthMode } from '../vrc/vrc-biometric'
import { createEvidenceBuilder } from '../vrc/services/EvidenceBuilder'
import {
  deriveEid,
  serviceUuidFromEid,
  LOCALITY_CHARACTERISTIC_UUID,
  LOCALITY_SIGNATURE_CHARACTERISTIC_UUID,
  LOCALITY_BINDING_CONTEXT,
  NullDeviceLocalityProvider,
} from './deviceLocality'
import type { DeviceLocalityProvider, LocalitySensorDirective, LocalityTranscript, HardwareAttestationState } from './deviceLocality'

export type { NativeRespondToSensorParams, NativeLocalityTranscriptResult }

/** What this provider needs from the native module — the real Spec's shape, injectable so tests can mock it without a device. */
export interface NativeLocalityPeripheralBridge {
  isSupported(): Promise<boolean>
  respondToSensor(params: NativeRespondToSensorParams): Promise<NativeLocalityTranscriptResult | null>
  stopAdvertising(): Promise<void>
}

/**
 * Determining {@link HardwareAttestationState} is left to the caller rather
 * than computed in here: it doesn't depend on anything BLE-timing-sensitive
 * (it's already known before advertising starts, from the wallet's existing
 * attestation flow — `vrc-hardware-signing.ts`'s
 * `isHardwareSigningAvailable`/`isHardwareAttestationAvailable`), and this
 * class shouldn't need to know how that determination is made to do its own
 * job. A real wiring would likely pass something built from
 * `EvidenceBuilder.hasCachedAttestation` (verified) vs.
 * `isHardwareAttestationAvailable` (present-unverified) vs. neither (absent).
 */
export type GetHardwareAttestationState = () => Promise<HardwareAttestationState>

export class BleDeviceLocalityProvider implements DeviceLocalityProvider {
  /**
   * Carries the platform because this string reaches operator-facing logs and
   * the two platforms fail in genuinely different ways — an iOS ceremony that
   * times out is usually App Attest or foreground advertising, an Android one
   * usually the held `CryptoObject`. A single 'ble-peripheral' would make
   * those indistinguishable in a log from a room you were not in.
   */
  readonly name = `${Platform.OS}-ble-peripheral`

  constructor(
    private readonly bridge: NativeLocalityPeripheralBridge,
    private readonly getHardwareAttestationState: GetHardwareAttestationState
  ) {}

  async respondToSensor(params: {
    taskDigestMultibase: string
    challenge: string
    directive: LocalitySensorDirective
  }): Promise<LocalityTranscript | null> {
    const eid = deriveEid(params.challenge, params.taskDigestMultibase)
    const serviceUuid = serviceUuidFromEid(eid)
    const hardwareAttestation = await this.getHardwareAttestationState()
    // Same policy VRC content signing uses (vrc-biometric.ts's
    // `resolveHardwareSigningAuthMode`) — the locality-transcript signature
    // authorizes the same hardware key, so it should honor the same
    // biometric/passcode preference rather than deciding independently.
    const authMode = await resolveHardwareSigningAuthMode()

    const result = await this.bridge.respondToSensor({
      serviceUuid,
      characteristicUuid: LOCALITY_CHARACTERISTIC_UUID,
      signatureCharacteristicUuid: LOCALITY_SIGNATURE_CHARACTERISTIC_UUID,
      contextString: LOCALITY_BINDING_CONTEXT,
      method: params.directive.method,
      taskDigestMultibase: params.taskDigestMultibase,
      challenge: params.challenge,
      sensorDid: params.directive.sensorDid,
      hardwareAttestation,
      windowSeconds: params.directive.windowSeconds,
      authMode,
    })
    if (!result) return null

    return {
      method: params.directive.method,
      taskDigestMultibase: params.taskDigestMultibase,
      challenge: params.challenge,
      sensorNonce: result.sensorNonceHex,
      sensorDid: params.directive.sensorDid,
      devicePublicKey: result.devicePublicKeyBase64,
      signature: result.signatureBase64Url,
      hardwareAttestation,
    }
  }
}

/**
 * The mapping this class's own `GetHardwareAttestationState` doc comment
 * proposed: `EvidenceBuilder.hasCachedAttestation` (a verified attestation
 * chain is already on file for this exact key) beats mere key existence,
 * which beats nothing at all. Mirrors `vrc-hardware-signing.ts`'s own
 * `ensureHardwareSigningKey`/`isHardwareAttestationAvailable` pattern
 * rather than introducing a new one — this is the SAME question the
 * existing VRC evidence flow already answers for itself, asked here for
 * the locality transcript's own `hardwareAttestation` field.
 */
export async function determineHardwareAttestationState(agent: Agent): Promise<HardwareAttestationState> {
  try {
    const { publicKey } = await ensureHardwareSigningKey(agent)
    const hasCached = await createEvidenceBuilder(agent).hasCachedAttestation(publicKey)
    if (hasCached) return 'verified'
    // Lazy require: a static import evaluates `TurboModuleRegistry` at
    // module load, which throws outside a real RN bridge (no bridge exists
    // merely by virtue of importing this file's `ceremony.ts` caller) — see
    // the identical concern and pattern below in `createDeviceLocalityProvider`.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { isHardwareAttestationAvailable } = require('@bifold/react-native-attestation') as {
      isHardwareAttestationAvailable: () => Promise<boolean>
    }
    return (await isHardwareAttestationAvailable()) ? 'present-unverified' : 'absent'
  } catch {
    return 'absent'
  }
}

/**
 * What `ceremony.ts`'s real `runWitnessSession(...)` call site constructs.
 * Android or iOS with the native module linked gets the real peripheral;
 * anything else (an unsupported platform, or a build where the Gradle module
 * or pod was not linked) gets the no-op, matching
 * §7.1's `declinedByHolder`/`windowLost` outcome rather than throwing.
 */
export function createDeviceLocalityProvider(agent: Agent): DeviceLocalityProvider {
  // Lazy require: a static import evaluates `TurboModuleRegistry` at module
  // load, which throws outside a real RN bridge — and `ceremony.ts` imports
  // this file at ITS module top level, so every test (or other context)
  // that merely imports `ceremony.ts` would otherwise need a bridge too,
  // regardless of whether it ever calls this factory.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getBridge, isSupportedPlatform, isNativeModuleLinked } = require('@bifold/react-native-locality-peripheral') as {
    getBridge: () => NativeLocalityPeripheralBridge
    isSupportedPlatform: () => boolean
    isNativeModuleLinked: () => boolean
  }
  if (isSupportedPlatform() && isNativeModuleLinked()) {
    return new BleDeviceLocalityProvider(getBridge(), () => determineHardwareAttestationState(agent))
  }
  return new NullDeviceLocalityProvider()
}
