/**
 * Tests the JS-side glue only — param marshaling, EID/UUID derivation, and
 * transcript reassembly — against a mocked native bridge. There is no real
 * native module yet (locality-plan.md §10.3 item 9; see this class's own
 * header and `@bifold/react-native-locality-peripheral`'s README), so this
 * cannot and does not prove anything about real BLE, real signing, or real
 * biometric authorization.
 */
import { AndroidBleDeviceLocalityProvider, type NativeLocalityPeripheralBridge } from '../AndroidBleDeviceLocalityProvider'
import { deriveEid, serviceUuidFromEid, LOCALITY_CHARACTERISTIC_UUID, LOCALITY_BINDING_CONTEXT } from '../deviceLocality'
import type { LocalitySensorDirective } from '../deviceLocality'

const DIRECTIVE: LocalitySensorDirective = {
  policy: 'required',
  method: 'ble-challenge-response/0.1',
  sensorDid: 'did:peer:4witness-sensor',
  windowSeconds: 30,
}

function makeBridge(overrides?: Partial<NativeLocalityPeripheralBridge>): {
  bridge: NativeLocalityPeripheralBridge
  respondToSensor: jest.Mock
} {
  const respondToSensor = jest.fn()
  const bridge: NativeLocalityPeripheralBridge = {
    isSupported: jest.fn(async () => true),
    respondToSensor,
    stopAdvertising: jest.fn(async () => undefined),
    ...overrides,
  }
  return { bridge, respondToSensor }
}

describe('AndroidBleDeviceLocalityProvider (design sketch — locality-plan.md §10.3 item 9)', () => {
  test('marshals the native params correctly, including the derived service UUID', async () => {
    const { bridge, respondToSensor } = makeBridge()
    respondToSensor.mockResolvedValue({
      sensorNonceHex: 'aa'.repeat(32),
      devicePublicKeyBase64: 'ZmFrZS1wdWJsaWMta2V5',
      signatureBase64Url: 'ZmFrZS1zaWduYXR1cmU',
    })
    const getHardwareAttestationState = jest.fn(async () => 'verified' as const)
    const provider = new AndroidBleDeviceLocalityProvider(bridge, getHardwareAttestationState)

    await provider.respondToSensor({
      taskDigestMultibase: 'sha256:deadbeef',
      challenge: 'a-fresh-challenge',
      directive: DIRECTIVE,
    })

    expect(respondToSensor).toHaveBeenCalledTimes(1)
    const nativeParams = respondToSensor.mock.calls[0][0]
    expect(nativeParams.serviceUuid).toBe(serviceUuidFromEid(deriveEid('a-fresh-challenge', 'sha256:deadbeef')))
    expect(nativeParams.characteristicUuid).toBe(LOCALITY_CHARACTERISTIC_UUID)
    expect(nativeParams.contextString).toBe(LOCALITY_BINDING_CONTEXT)
    expect(nativeParams.sensorDid).toBe(DIRECTIVE.sensorDid)
    expect(nativeParams.windowSeconds).toBe(DIRECTIVE.windowSeconds)
    expect(nativeParams.hardwareAttestation).toBe('verified')
  })

  test('assembles a full LocalityTranscript from the native result', async () => {
    const { bridge, respondToSensor } = makeBridge()
    respondToSensor.mockResolvedValue({
      sensorNonceHex: 'bb'.repeat(32),
      devicePublicKeyBase64: 'ZGV2aWNlLXB1YmxpYy1rZXk',
      signatureBase64Url: 'ZGV2aWNlLXNpZ25hdHVyZQ',
    })
    const provider = new AndroidBleDeviceLocalityProvider(bridge, async () => 'present-unverified')

    const transcript = await provider.respondToSensor({
      taskDigestMultibase: 'sha256:cafebabe',
      challenge: 'another-challenge',
      directive: DIRECTIVE,
    })

    expect(transcript).toEqual({
      method: 'ble-challenge-response/0.1',
      taskDigestMultibase: 'sha256:cafebabe',
      challenge: 'another-challenge',
      sensorNonce: 'bb'.repeat(32),
      sensorDid: 'did:peer:4witness-sensor',
      devicePublicKey: 'ZGV2aWNlLXB1YmxpYy1rZXk',
      signature: 'ZGV2aWNlLXNpZ25hdHVyZQ',
      hardwareAttestation: 'present-unverified',
    })
  })

  test('passes null straight through on window-lost/declined, matching NullDeviceLocalityProvider\'s contract', async () => {
    const { bridge, respondToSensor } = makeBridge()
    respondToSensor.mockResolvedValue(null)
    const provider = new AndroidBleDeviceLocalityProvider(bridge, async () => 'absent')

    const transcript = await provider.respondToSensor({
      taskDigestMultibase: 'sha256:00',
      challenge: 'challenge',
      directive: DIRECTIVE,
    })

    expect(transcript).toBeNull()
  })

  test('a native rejection (genuine implementation error, not a normal outcome) propagates rather than being swallowed', async () => {
    const { bridge, respondToSensor } = makeBridge()
    respondToSensor.mockRejectedValue(new Error('no hardware key exists yet'))
    const provider = new AndroidBleDeviceLocalityProvider(bridge, async () => 'absent')

    await expect(
      provider.respondToSensor({ taskDigestMultibase: 'sha256:00', challenge: 'c', directive: DIRECTIVE })
    ).rejects.toThrow('no hardware key exists yet')
  })
})
