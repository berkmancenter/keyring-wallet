/**
 * Tests the JS-side glue only — param marshaling, EID/UUID derivation, and
 * transcript reassembly — against a mocked native bridge injected directly
 * into the class's constructor. The real native module (Android Kotlin,
 * locality-plan.md §10.3 item 9) compiles and autolinks (verified
 * 2026-08-21), but this suite proves none of that — no real BLE, no real
 * signing, no real biometric authorization, no live device. It also can't
 * even import `@bifold/react-native-locality-peripheral` for real under
 * Jest (no RN bridge in this environment — `TurboModuleRegistry.get()`
 * throws), hence the module mock below, matching this codebase's own
 * existing convention for `@bifold/react-native-attestation`.
 */
const mockBridge = { isSupported: jest.fn(), respondToSensor: jest.fn(), stopAdvertising: jest.fn() }
const mockIsSupportedPlatform = jest.fn(() => true)
const mockIsNativeModuleLinked = jest.fn(() => true)
// NOTE: `getBridge` is a function, not a plain re-exported value, on
// purpose — found live (2026-08-21) that mocking a named *plain-value*
// export from this module resolves to `undefined` through the mock even
// though the property is registered (ts-jest/Babel ESM-interop quirk,
// not specific to any one export name); named *function* exports mock
// correctly. See `@bifold/react-native-locality-peripheral`'s `getBridge`
// doc comment for the same note from the other side of this boundary.
jest.mock('@bifold/react-native-locality-peripheral', () => ({
  getBridge: () => mockBridge,
  isSupportedPlatform: () => mockIsSupportedPlatform(),
  isNativeModuleLinked: () => mockIsNativeModuleLinked(),
}))

const mockEnsureHardwareSigningKey = jest.fn()
jest.mock('../../vrc/vrc-hardware-signing', () => ({
  ensureHardwareSigningKey: (...args: unknown[]) => mockEnsureHardwareSigningKey(...args),
}))

const mockHasCachedAttestation = jest.fn()
jest.mock('../../vrc/services/EvidenceBuilder', () => ({
  createEvidenceBuilder: () => ({ hasCachedAttestation: (...args: unknown[]) => mockHasCachedAttestation(...args) }),
}))

const mockIsHardwareAttestationAvailable = jest.fn()
jest.mock('@bifold/react-native-attestation', () => ({
  isHardwareAttestationAvailable: (...args: unknown[]) => mockIsHardwareAttestationAvailable(...args),
}))

import {
  AndroidBleDeviceLocalityProvider,
  createDeviceLocalityProvider,
  determineHardwareAttestationState,
  type NativeLocalityPeripheralBridge,
} from '../AndroidBleDeviceLocalityProvider'
import { NullDeviceLocalityProvider } from '../deviceLocality'
import {
  deriveEid,
  serviceUuidFromEid,
  LOCALITY_CHARACTERISTIC_UUID,
  LOCALITY_SIGNATURE_CHARACTERISTIC_UUID,
  LOCALITY_BINDING_CONTEXT,
} from '../deviceLocality'
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
    expect(nativeParams.signatureCharacteristicUuid).toBe(LOCALITY_SIGNATURE_CHARACTERISTIC_UUID)
    expect(nativeParams.contextString).toBe(LOCALITY_BINDING_CONTEXT)
    expect(nativeParams.method).toBe(DIRECTIVE.method)
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

const FAKE_AGENT = {} as import('@credo-ts/core').Agent

describe('determineHardwareAttestationState', () => {
  beforeEach(() => jest.clearAllMocks())

  test('verified — a cached attestation exists for this exact key', async () => {
    mockEnsureHardwareSigningKey.mockResolvedValue({ publicKey: 'abc123', storage: 'StrongBox' })
    mockHasCachedAttestation.mockResolvedValue(true)

    await expect(determineHardwareAttestationState(FAKE_AGENT)).resolves.toBe('verified')
    expect(mockHasCachedAttestation).toHaveBeenCalledWith('abc123')
  })

  test('present-unverified — the key exists in hardware but no attestation is cached yet', async () => {
    mockEnsureHardwareSigningKey.mockResolvedValue({ publicKey: 'abc123', storage: 'StrongBox' })
    mockHasCachedAttestation.mockResolvedValue(false)
    mockIsHardwareAttestationAvailable.mockResolvedValue(true)

    await expect(determineHardwareAttestationState(FAKE_AGENT)).resolves.toBe('present-unverified')
  })

  test('absent — no cached attestation and the platform reports none available', async () => {
    mockEnsureHardwareSigningKey.mockResolvedValue({ publicKey: 'abc123', storage: 'Software' })
    mockHasCachedAttestation.mockResolvedValue(false)
    mockIsHardwareAttestationAvailable.mockResolvedValue(false)

    await expect(determineHardwareAttestationState(FAKE_AGENT)).resolves.toBe('absent')
  })

  test('absent — falls back safely if the hardware key flow throws rather than propagating', async () => {
    mockEnsureHardwareSigningKey.mockRejectedValue(new Error('no key and creation failed'))

    await expect(determineHardwareAttestationState(FAKE_AGENT)).resolves.toBe('absent')
  })
})

describe('createDeviceLocalityProvider', () => {
  beforeEach(() => jest.clearAllMocks())

  test('returns the real Android provider when the platform is supported and the native module is linked', () => {
    mockIsSupportedPlatform.mockReturnValue(true)
    const provider = createDeviceLocalityProvider(FAKE_AGENT)
    expect(provider).toBeInstanceOf(AndroidBleDeviceLocalityProvider)
  })

  test('falls back to NullDeviceLocalityProvider when the platform is not supported (iOS)', () => {
    mockIsSupportedPlatform.mockReturnValue(false)
    const provider = createDeviceLocalityProvider(FAKE_AGENT)
    expect(provider).toBeInstanceOf(NullDeviceLocalityProvider)
  })
})
