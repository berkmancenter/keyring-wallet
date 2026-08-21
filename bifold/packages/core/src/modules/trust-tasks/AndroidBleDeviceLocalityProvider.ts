/**
 * The wallet-side `DeviceLocalityProvider` implementation that would wrap
 * `@bifold/react-native-locality-peripheral` (locality-plan.md §10.3 item 9)
 * — DESIGN SKETCH, not wired into `ceremony.ts`'s real
 * `runWitnessSession(...)` call site, which stays on `NullDeviceLocalityProvider`
 * until a real native module exists. See that package's README.md and
 * `docs/plans/locality-plan/2026-08-21-bam.md` for why.
 *
 * `NativeLocalityPeripheralBridge`/`NativeRespondToSensorParams`/
 * `NativeLocalityTranscriptResult` below are a HAND-KEPT copy of
 * `@bifold/react-native-locality-peripheral`'s `NativeLocalityPeripheral.ts`
 * Spec, not an import — that package is not a dependency of `@bifold/core`
 * yet (its own README explains why: nothing to depend on until native code
 * exists to back it). Keep the two in sync until it is wired in for real.
 */

import { deriveEid, serviceUuidFromEid, LOCALITY_CHARACTERISTIC_UUID, LOCALITY_BINDING_CONTEXT } from './deviceLocality'
import type { DeviceLocalityProvider, LocalitySensorDirective, LocalityTranscript, HardwareAttestationState } from './deviceLocality'

// ---- hand-kept copy of the native Spec (see file header) -------------------

export type NativeRespondToSensorParams = {
  serviceUuid: string
  characteristicUuid: string
  contextString: string
  taskDigestMultibase: string
  challenge: string
  sensorDid: string
  hardwareAttestation: HardwareAttestationState
  windowSeconds: number
}

export type NativeLocalityTranscriptResult = {
  sensorNonceHex: string
  devicePublicKeyBase64: string
  signatureBase64Url: string
}

/** What this provider needs from the native module — satisfied today only by a mock; no real bridge exists. */
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

export class AndroidBleDeviceLocalityProvider implements DeviceLocalityProvider {
  readonly name = 'android-ble-peripheral'

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

    const result = await this.bridge.respondToSensor({
      serviceUuid,
      characteristicUuid: LOCALITY_CHARACTERISTIC_UUID,
      contextString: LOCALITY_BINDING_CONTEXT,
      taskDigestMultibase: params.taskDigestMultibase,
      challenge: params.challenge,
      sensorDid: params.directive.sensorDid,
      hardwareAttestation,
      windowSeconds: params.directive.windowSeconds,
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
