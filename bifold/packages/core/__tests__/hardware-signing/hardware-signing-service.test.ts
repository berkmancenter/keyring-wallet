/**
 * The standalone hardware-signing service, exercised through its public
 * interface only — `createHardwareSigningService()` and the object it returns.
 * No Credo agent is constructed anywhere in this file; that is half the point.
 */

const mockNativeCreateKey = jest.fn()
const mockNativeHasKey = jest.fn()
const mockNativeGetPublicKey = jest.fn()
const mockNativeSign = jest.fn()
const mockNativeGetKeyInfo = jest.fn()
const mockNativeDeleteKey = jest.fn()
const mockGetHardwareKeyAttestation = jest.fn()
const mockIsHardwareAttestationAvailable = jest.fn()
const mockVerifyHardwareEvidence = jest.fn()

jest.mock('@bifold/react-native-attestation', () => ({
  createSecureEnclaveKey: (...args: unknown[]) => mockNativeCreateKey(...args),
  hasHardwareSigningKey: (...args: unknown[]) => mockNativeHasKey(...args),
  getHardwarePublicKey: (...args: unknown[]) => mockNativeGetPublicKey(...args),
  signWithHardwareBiometricAuth: (...args: unknown[]) => mockNativeSign(...args),
  getHardwareKeyInfo: (...args: unknown[]) => mockNativeGetKeyInfo(...args),
  deleteHardwareSigningKey: (...args: unknown[]) => mockNativeDeleteKey(...args),
  getHardwareKeyAttestation: (...args: unknown[]) => mockGetHardwareKeyAttestation(...args),
  isHardwareAttestationAvailable: (...args: unknown[]) => mockIsHardwareAttestationAvailable(...args),
  verifyHardwareEvidence: (...args: unknown[]) => mockVerifyHardwareEvidence(...args),
}))

jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}))

import {
  createHardwareSigningService,
  createInMemoryAttestationCache,
  type AttestationCache,
  type HardwareSigningLogger,
  type SignedPayloadAttestation,
} from '../../src/hardware-signing'

const PUBLIC_KEY_B64 = 'cHVibGljS2V5'
const CERT_CHAIN = ['-----BEGIN CERTIFICATE-----\nleaf\n-----END CERTIFICATE-----']

const silentLogger: HardwareSigningLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() }

const publicKeyBuffer = { toString: (enc?: string) => (enc === 'base64' ? PUBLIC_KEY_B64 : 'publicKey') }

function givenAnExistingKey() {
  mockNativeHasKey.mockResolvedValue(true)
  mockNativeGetPublicKey.mockResolvedValue(publicKeyBuffer)
  mockNativeGetKeyInfo.mockResolvedValue({ storage: 'SecureEnclave', supportsDeviceCredential: true })
}

function givenASuccessfulSignature(overrides: Record<string, unknown> = {}) {
  mockNativeSign.mockResolvedValue({
    success: true,
    signature: Buffer.from('raw-signature'),
    algorithm: 'ECDSA-SHA256',
    clientDataHash: 'aGFzaA==',
    authenticationMethod: 'FaceID',
    ...overrides,
  })
}

function givenAvailableAttestation() {
  mockIsHardwareAttestationAvailable.mockResolvedValue(true)
  mockGetHardwareKeyAttestation.mockResolvedValue({
    success: true,
    certificateChain: CERT_CHAIN,
    format: 'apple-appattest-v1',
    platform: 'ios',
    securityLevel: 'SecureEnclave',
    rawAttestationObject: 'raw',
  })
}

describe('createHardwareSigningService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('isAvailable', () => {
    it('is true when a key already exists, without creating one', async () => {
      mockNativeHasKey.mockResolvedValue(true)

      const service = createHardwareSigningService({ logger: silentLogger })

      await expect(service.isAvailable()).resolves.toBe(true)
      expect(mockNativeCreateKey).not.toHaveBeenCalled()
    })

    it('is false when there is no key and no attestation support', async () => {
      mockNativeHasKey.mockResolvedValue(false)
      mockIsHardwareAttestationAvailable.mockResolvedValue(false)

      const service = createHardwareSigningService({ logger: silentLogger })

      await expect(service.isAvailable()).resolves.toBe(false)
    })
  })

  describe('signPayload', () => {
    it('returns a self-contained attestation over the exact payload', async () => {
      givenAnExistingKey()
      givenASuccessfulSignature()
      givenAvailableAttestation()

      const service = createHardwareSigningService({ logger: silentLogger, generateId: () => 'fixed-id' })
      const outcome = await service.signPayload('login-challenge-abc123')

      expect(outcome.success).toBe(true)
      expect(outcome.reason).toBe('signed')
      expect(outcome.hasAttestation).toBe(true)

      const attestation = outcome.attestation as SignedPayloadAttestation
      expect(attestation.payload).toBe('login-challenge-abc123')
      expect(attestation.payloadHash).toBe('aGFzaA==')
      expect(attestation.signedAt).toEqual(expect.any(String))
      expect(attestation.evidence.id).toBe('urn:uuid:fixed-id')
      expect(attestation.evidence.type).toEqual(['BiometricAttestation', 'HardwareKeyAttestation'])
      expect(attestation.evidence.hardwareBinding).toMatchObject({
        publicKey: PUBLIC_KEY_B64,
        platform: 'ios',
        keyStorage: 'SecureEnclave',
        keyType: 'EC-P256',
        algorithm: 'ECDSA-SHA256',
      })
      expect(attestation.evidence.attestation).toEqual({
        format: 'apple-appattest-v1',
        certificateChain: CERT_CHAIN,
      })
      expect(attestation.evidence.signature.signedContentHash).toBe('aGFzaA==')
    })

    it('signs the payload bytes it was given, not a credential wrapper', async () => {
      givenAnExistingKey()
      givenASuccessfulSignature()
      givenAvailableAttestation()

      const service = createHardwareSigningService({ logger: silentLogger })
      await service.signPayload('nonce:42')

      const [signedBuffer, authMode] = mockNativeSign.mock.calls[0]
      expect(signedBuffer.toString('utf8')).toBe('nonce:42')
      expect(authMode).toBe('biometric')
    })

    it('passes the requested auth mode through to the native signer', async () => {
      givenAnExistingKey()
      givenASuccessfulSignature({ authenticationMethod: 'DevicePasscode' })
      givenAvailableAttestation()

      const service = createHardwareSigningService({ logger: silentLogger })
      const outcome = await service.signPayload('nonce:42', { authMode: 'passcode' })

      expect(mockNativeSign.mock.calls[0][1]).toBe('passcode')
      expect(outcome.attestation?.evidence.type).toEqual(['DeviceAuthentication', 'HardwareKeyAttestation'])
      expect(outcome.attestation?.evidence.biometricMethod).toBeUndefined()
    })

    it('still succeeds with no certificate chain, and says so', async () => {
      // The emulator/simulator case: signing works, attestation does not.
      givenAnExistingKey()
      givenASuccessfulSignature()
      mockIsHardwareAttestationAvailable.mockResolvedValue(false)

      const service = createHardwareSigningService({ logger: silentLogger })
      const outcome = await service.signPayload('nonce:42')

      expect(outcome.success).toBe(true)
      expect(outcome.hasAttestation).toBe(false)
      expect(outcome.attestation?.evidence.attestation.certificateChain).toEqual([])
      expect(mockGetHardwareKeyAttestation).not.toHaveBeenCalled()
    })

    it('reports cancellation distinctly from failure', async () => {
      givenAnExistingKey()
      mockNativeSign.mockRejectedValue(new Error('The user name canceled the operation'))

      const service = createHardwareSigningService({ logger: silentLogger })
      const outcome = await service.signPayload('nonce:42')

      expect(outcome.success).toBe(false)
      expect(outcome.reason).toBe('cancelled')
      expect(outcome.attestation).toBeUndefined()
    })

    it('flags iOS assertion failures as retryable', async () => {
      givenAnExistingKey()
      mockNativeSign.mockRejectedValue(new Error('failed to generateAssertion'))

      const service = createHardwareSigningService({ logger: silentLogger })
      const outcome = await service.signPayload('nonce:42')

      expect(outcome.success).toBe(false)
      expect(outcome.reason).toBe('error')
      expect(outcome.retryable).toBe(true)
    })
  })

  describe('attestation cache', () => {
    it('uses an injected cache instead of refetching', async () => {
      givenAnExistingKey()
      givenASuccessfulSignature()
      mockIsHardwareAttestationAvailable.mockResolvedValue(true)

      const cache: AttestationCache = {
        find: jest.fn().mockResolvedValue({ certificateChain: CERT_CHAIN }),
        save: jest.fn(),
      }

      const service = createHardwareSigningService({ logger: silentLogger, attestationCache: cache })
      const outcome = await service.signPayload('nonce:42')

      expect(cache.find).toHaveBeenCalledWith(PUBLIC_KEY_B64)
      expect(mockGetHardwareKeyAttestation).not.toHaveBeenCalled()
      expect(outcome.attestation?.evidence.attestation.certificateChain).toEqual(CERT_CHAIN)
    })

    it('writes a fetched chain back to the injected cache with an expiry', async () => {
      givenAnExistingKey()
      givenASuccessfulSignature()
      givenAvailableAttestation()

      const cache: AttestationCache = { find: jest.fn().mockResolvedValue(null), save: jest.fn() }

      const service = createHardwareSigningService({ logger: silentLogger, attestationCache: cache })
      await service.signPayload('nonce:42')

      expect(cache.save).toHaveBeenCalledWith(
        expect.objectContaining({
          publicKey: PUBLIC_KEY_B64,
          certificateChain: CERT_CHAIN,
          format: 'apple-appattest-v1',
          platform: 'ios',
          securityLevel: 'SecureEnclave',
          expiresAt: expect.any(String),
        })
      )
    })

    it('honours the expiry on the default in-memory cache', async () => {
      const cache = createInMemoryAttestationCache()
      await cache.save({
        publicKey: PUBLIC_KEY_B64,
        certificateChain: CERT_CHAIN,
        format: 'apple-appattest-v1',
        platform: 'ios',
        securityLevel: 'SecureEnclave',
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      })

      await expect(cache.find(PUBLIC_KEY_B64)).resolves.toBeNull()
    })
  })

  describe('prepare', () => {
    it('reports the key it warmed up', async () => {
      givenAnExistingKey()
      givenAvailableAttestation()

      const service = createHardwareSigningService({ logger: silentLogger })

      await expect(service.prepare()).resolves.toEqual({ ready: true, publicKey: PUBLIC_KEY_B64 })
    })

    it('reports not-ready rather than throwing when the device has no hardware', async () => {
      mockNativeHasKey.mockRejectedValue(new Error('Hardware unavailable'))
      mockNativeCreateKey.mockRejectedValue(new Error('Hardware unavailable'))

      const service = createHardwareSigningService({ logger: silentLogger })

      await expect(service.prepare()).resolves.toEqual({ ready: false })
    })
  })

  describe('verify', () => {
    it('hands the native verifier the payload the attestation carries', async () => {
      givenAnExistingKey()
      givenASuccessfulSignature()
      givenAvailableAttestation()
      mockVerifyHardwareEvidence.mockResolvedValue({
        valid: true,
        certificateChainValid: true,
        publicKeyMatchesLeafCert: true,
        signatureValid: true,
      })

      const service = createHardwareSigningService({ logger: silentLogger })
      const outcome = await service.signPayload('login-challenge-abc123')
      const result = await service.verify(outcome.attestation as SignedPayloadAttestation)

      expect(mockVerifyHardwareEvidence).toHaveBeenCalledWith(
        CERT_CHAIN,
        expect.any(String),
        'login-challenge-abc123',
        PUBLIC_KEY_B64,
        'apple-appattest-v1',
        'aGFzaA=='
      )
      expect(result.valid).toBe(true)
      expect(result.details.verificationLevel).toBe('cryptographic')
    })

    it('reports an invalid result rather than throwing when native verification fails', async () => {
      mockVerifyHardwareEvidence.mockRejectedValue(new Error('chain broken'))

      const service = createHardwareSigningService({ logger: silentLogger })
      const result = await service.verify({
        payload: 'nonce:42',
        signedAt: new Date().toISOString(),
        evidence: {
          id: 'urn:uuid:x',
          type: ['BiometricAttestation', 'HardwareKeyAttestation'],
          created: new Date().toISOString(),
          authenticationMethod: { type: 'FaceID', authenticatorType: 'platform', userVerification: 'required' },
          hardwareBinding: {
            keyStorage: 'SecureEnclave',
            platform: 'ios',
            keyType: 'EC-P256',
            algorithm: 'ECDSA-SHA256',
            publicKey: PUBLIC_KEY_B64,
          },
          attestation: { format: 'apple-appattest-v1', certificateChain: CERT_CHAIN },
          signature: { value: 'sig', algorithm: 'ECDSA-SHA256' },
        },
      })

      expect(result.valid).toBe(false)
      expect(result.details.verificationLevel).toBe('none')
      expect(result.error).toContain('chain broken')
    })
  })
})
