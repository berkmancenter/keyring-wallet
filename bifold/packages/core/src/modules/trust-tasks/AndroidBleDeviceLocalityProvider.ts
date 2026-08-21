/**
 * The wallet-side `DeviceLocalityProvider` implementation wrapping
 * `@bifold/react-native-locality-peripheral` (locality-plan.md §10.3 item 9).
 *
 * The native module is real now — Kotlin that compiles against real
 * codegen and autolinks into the app (verified 2026-08-21, see
 * `docs/plans/locality-plan/2026-08-21-bam.md`) — but two things are still
 * unverified on a real device: whether the authorized `CryptoObject`
 * genuinely survives being held across an entire advertising window
 * (`LocalityPeripheralModule.kt`'s own doc comment flags this), and a live
 * round trip against witness-server's real `BleLocalityProvider`. Until
 * both are confirmed, `ceremony.ts`'s real call site deliberately stays on
 * `NullDeviceLocalityProvider` — this class is real and tested but not yet
 * the production path.
 */

import { bridge as realNativeLocalityPeripheralBridge, type NativeRespondToSensorParams, type NativeLocalityTranscriptResult } from '@bifold/react-native-locality-peripheral'

import { deriveEid, serviceUuidFromEid, LOCALITY_CHARACTERISTIC_UUID, LOCALITY_BINDING_CONTEXT } from './deviceLocality'
import type { DeviceLocalityProvider, LocalitySensorDirective, LocalityTranscript, HardwareAttestationState } from './deviceLocality'

export type { NativeRespondToSensorParams, NativeLocalityTranscriptResult }
export { realNativeLocalityPeripheralBridge }

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
      method: params.directive.method,
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
