/**
 * Tests for VRC Hardware Signing Service
 *
 * Covers:
 * - ensureHardwareSigningKey: key existence, recovery, creation, error paths
 * - signVrcWithHardwareKey: success, failure, cancellation, retryable errors
 * - prepareHardwareKeyForSigning: readiness check with attestation cache
 * - isHardwareSigningAvailable: availability detection without side-effects
 * - preWarmAttestation (indirect): retry behavior via ensureHardwareSigningKey recovery
 */

const mockNativeCreateKey = jest.fn()
const mockNativeHasKey = jest.fn()
const mockNativeGetPublicKey = jest.fn()
const mockNativeSign = jest.fn()
const mockNativeGetKeyInfo = jest.fn()
const mockNativeDeleteKey = jest.fn()
const mockGetHardwareKeyAttestation = jest.fn()
const mockIsHardwareAttestationAvailable = jest.fn()

jest.mock('@bifold/react-native-attestation', () => ({
  createSecureEnclaveKey: (...args: unknown[]) => mockNativeCreateKey(...args),
  hasHardwareSigningKey: (...args: unknown[]) => mockNativeHasKey(...args),
  getHardwarePublicKey: (...args: unknown[]) => mockNativeGetPublicKey(...args),
  signWithHardwareBiometricAuth: (...args: unknown[]) => mockNativeSign(...args),
  getHardwareKeyInfo: (...args: unknown[]) => mockNativeGetKeyInfo(...args),
  deleteHardwareSigningKey: (...args: unknown[]) => mockNativeDeleteKey(...args),
  getHardwareKeyAttestation: (...args: unknown[]) => mockGetHardwareKeyAttestation(...args),
  isHardwareAttestationAvailable: (...args: unknown[]) => mockIsHardwareAttestationAvailable(...args),
}))

jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}))

jest.mock('buffer', () => ({
  Buffer: {
    from: jest.fn((data: string, _encoding?: string) => {
      const str = typeof data === 'string' ? data : String(data)
      return {
        toString: (enc?: string) => (enc === 'base64' ? Buffer.from(str).toString('base64') : str),
        length: str.length,
      }
    }),
  },
}))

jest.mock('../../../src/modules/vrc/services/EvidenceBuilder', () => ({
  createEvidenceBuilder: jest.fn().mockReturnValue({
    hasCachedAttestation: jest.fn().mockResolvedValue(true),
    prefetchAttestation: jest.fn().mockResolvedValue(true),
  }),
}))

jest.mock('../../../src/modules/vrc/services/BiometricSignatureVerifier', () => ({
  verifyVrcHardwareEvidence: jest.fn(),
}))

import {
  ensureHardwareSigningKey,
  signVrcWithHardwareKey,
  prepareHardwareKeyForSigning,
  isHardwareSigningAvailable,
} from '../../../src/modules/vrc/vrc-hardware-signing'
import { Platform } from 'react-native'

const createMockAgent = () =>
  ({
    config: {
      logger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      },
    },
    context: { contextCorrelationId: 'test-context' },
    dependencyManager: { resolve: jest.fn() },
  }) as any

describe('VRC Hardware Signing', () => {
  let mockAgent: ReturnType<typeof createMockAgent>

  beforeEach(() => {
    jest.clearAllMocks()
    mockAgent = createMockAgent()
    ;(Platform as any).OS = 'ios'
  })

  describe('ensureHardwareSigningKey', () => {
    it('should return existing key with cached public key', async () => {
      const pubKeyBuffer = { toString: (enc?: string) => (enc === 'base64' ? 'cHVibGljS2V5' : 'publicKey') }
      mockNativeHasKey.mockResolvedValue(true)
      mockNativeGetPublicKey.mockResolvedValue(pubKeyBuffer)
      mockNativeGetKeyInfo.mockResolvedValue({ storage: 'SecureEnclave' })

      const result = await ensureHardwareSigningKey(mockAgent)

      expect(result).toEqual({ publicKey: 'cHVibGljS2V5', storage: 'SecureEnclave' })
      expect(mockNativeCreateKey).not.toHaveBeenCalled()
    })

    it('should recover via attestation when key exists but public key not cached', async () => {
      const pubKeyBuffer = { toString: (enc?: string) => (enc === 'base64' ? 'cmVjb3ZlcmVkS2V5' : 'recoveredKey') }
      mockNativeHasKey.mockResolvedValue(true)
      mockNativeGetPublicKey
        .mockRejectedValueOnce(new Error('Public key not found'))
        .mockResolvedValue(pubKeyBuffer)
      mockIsHardwareAttestationAvailable.mockResolvedValue(true)
      mockGetHardwareKeyAttestation.mockResolvedValue({
        success: true,
        certificateChain: ['cert1'],
      })
      mockNativeGetKeyInfo.mockResolvedValue({ storage: 'SecureEnclave' })

      const result = await ensureHardwareSigningKey(mockAgent)

      expect(result).toEqual({ publicKey: 'cmVjb3ZlcmVkS2V5', storage: 'SecureEnclave' })
      expect(mockAgent.config.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Key exists but public key not cached')
      )
      expect(mockNativeCreateKey).not.toHaveBeenCalled()
    })

    it('should delete and recreate when key recovery fails', async () => {
      const newPubKeyBuffer = { toString: (enc?: string) => (enc === 'base64' ? 'bmV3S2V5' : 'newKey') }
      mockNativeHasKey.mockResolvedValue(true)
      mockNativeGetPublicKey.mockRejectedValue(new Error('Public key not found'))
      mockIsHardwareAttestationAvailable.mockResolvedValue(true)
      mockGetHardwareKeyAttestation.mockResolvedValue({ success: false, certificateChain: [] })
      mockNativeDeleteKey.mockResolvedValue(undefined)
      mockNativeCreateKey.mockResolvedValue({
        success: true,
        publicKey: newPubKeyBuffer,
        storage: 'SecureEnclave',
      })

      const result = await ensureHardwareSigningKey(mockAgent)

      expect(mockNativeDeleteKey).toHaveBeenCalled()
      expect(mockNativeCreateKey).toHaveBeenCalled()
      expect(result).toEqual({ publicKey: 'bmV3S2V5', storage: 'SecureEnclave' })
    })

    it('should create new key when none exists', async () => {
      const pubKeyBuffer = { toString: (enc?: string) => (enc === 'base64' ? 'bmV3UHViS2V5' : 'newPubKey') }
      mockNativeHasKey.mockResolvedValue(false)
      mockNativeCreateKey.mockResolvedValue({
        success: true,
        publicKey: pubKeyBuffer,
        storage: 'TEE',
      })

      const result = await ensureHardwareSigningKey(mockAgent)

      expect(result).toEqual({ publicKey: 'bmV3UHViS2V5', storage: 'TEE' })
      expect(mockNativeCreateKey).toHaveBeenCalled()
    })

    it('should propagate error when key creation fails', async () => {
      mockNativeHasKey.mockResolvedValue(false)
      mockNativeCreateKey.mockRejectedValue(new Error('Hardware not supported'))

      await expect(ensureHardwareSigningKey(mockAgent)).rejects.toThrow('Hardware not supported')
      expect(mockAgent.config.logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Key creation failed')
      )
    })
  })

  describe('signVrcWithHardwareKey', () => {
    const vrcContent = JSON.stringify({
      '@context': ['https://www.w3.org/2018/credentials/v1'],
      type: ['VerifiableCredential'],
      issuer: { id: 'did:peer:2.Ez6LStest' },
    })

    beforeEach(() => {
      const pubKeyBuffer = { toString: (enc?: string) => (enc === 'base64' ? 'dGVzdFB1YktleQ==' : 'testPubKey') }
      mockNativeHasKey.mockResolvedValue(true)
      mockNativeGetPublicKey.mockResolvedValue(pubKeyBuffer)
      mockNativeGetKeyInfo.mockResolvedValue({ storage: 'SecureEnclave' })
    })

    it('should return successful signing result', async () => {
      const sigBuffer = { toString: (enc?: string) => (enc === 'base64' ? 'c2lnbmF0dXJl' : 'signature'), length: 64 }
      mockNativeSign.mockResolvedValue({
        success: true,
        signature: sigBuffer,
        algorithm: 'ECDSA-SHA256',
        clientDataHash: 'aGFzaGJhc2U2NA==',
      })

      const result = await signVrcWithHardwareKey(mockAgent, vrcContent)

      expect(result.success).toBe(true)
      expect(result.reason).toBe('signed')
      expect(result.signature).toBeDefined()
      expect(result.signature?.type).toBe('HardwareBackedBiometric')
      expect(result.signature?.algorithm).toBe('ECDSA-SHA256')
      expect(result.signature?.platform).toBe('ios')
      expect(result.signature?.keyStorage).toBe('SecureEnclave')
      expect(result.signature?.publicKey).toBeDefined()
      expect(result.signature?.signature).toBe('c2lnbmF0dXJl')
      expect(result.signature?.clientDataHash).toBe('aGFzaGJhc2U2NA==')
    })

    it('should return error when signing returns success=false', async () => {
      mockNativeSign.mockResolvedValue({ success: false })

      const result = await signVrcWithHardwareKey(mockAgent, vrcContent)

      expect(result.success).toBe(false)
      expect(result.reason).toBe('error')
    })

    it('should handle user cancellation', async () => {
      mockNativeSign.mockRejectedValue(new Error('User cancelled biometric'))

      const result = await signVrcWithHardwareKey(mockAgent, vrcContent)

      expect(result.success).toBe(false)
      expect(result.reason).toBe('cancelled')
    })

    it('should mark iOS assertion failure as retryable', async () => {
      (Platform as any).OS = 'ios'
      mockNativeSign.mockRejectedValue(new Error('generate assertion failed'))

      const result = await signVrcWithHardwareKey(mockAgent, vrcContent)

      expect(result.success).toBe(false)
      expect(result.reason).toBe('error')
      expect(result.retryable).toBe(true)
    })

    it('should not mark Android errors as retryable', async () => {
      (Platform as any).OS = 'android'
      mockNativeSign.mockRejectedValue(new Error('signing failed unexpectedly'))

      const result = await signVrcWithHardwareKey(mockAgent, vrcContent)

      expect(result.success).toBe(false)
      expect(result.reason).toBe('error')
      expect(result.retryable).toBeFalsy()
    })

    it('should log VRC content before signing', async () => {
      const sigBuffer = { toString: () => 'c2ln', length: 3 }
      mockNativeSign.mockResolvedValue({
        success: true,
        signature: sigBuffer,
        algorithm: 'ECDSA-SHA256',
      })

      await signVrcWithHardwareKey(mockAgent, vrcContent)

      expect(mockAgent.config.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('VRC to sign')
      )
      expect(mockAgent.config.logger.info).toHaveBeenCalledWith(
        expect.stringContaining(vrcContent.substring(0, 80))
      )
    })
  })

  describe('prepareHardwareKeyForSigning', () => {
    it('should return ready when key and attestation are available', async () => {
      const pubKeyBuffer = { toString: (enc?: string) => (enc === 'base64' ? 'cHJlcEtleQ==' : 'prepKey') }
      mockNativeHasKey.mockResolvedValue(true)
      mockNativeGetPublicKey.mockResolvedValue(pubKeyBuffer)
      mockNativeGetKeyInfo.mockResolvedValue({ storage: 'SecureEnclave' })

      const result = await prepareHardwareKeyForSigning(mockAgent)

      expect(result.ready).toBe(true)
      expect(result.publicKey).toBe('cHJlcEtleQ==')
    })

    it('should return not ready without throwing when key preparation fails', async () => {
      mockNativeHasKey.mockRejectedValue(new Error('Hardware unavailable'))

      const result = await prepareHardwareKeyForSigning(mockAgent)

      expect(result.ready).toBe(false)
      expect(result.publicKey).toBeUndefined()
    })
  })

  describe('isHardwareSigningAvailable', () => {
    it('should return true when key exists', async () => {
      mockNativeHasKey.mockResolvedValue(true)

      const result = await isHardwareSigningAvailable()

      expect(result).toBe(true)
      expect(mockNativeCreateKey).not.toHaveBeenCalled()
    })

    it('should return true when no key but attestation available', async () => {
      mockNativeHasKey.mockResolvedValue(false)
      mockIsHardwareAttestationAvailable.mockResolvedValue(true)

      const result = await isHardwareSigningAvailable()

      expect(result).toBe(true)
      expect(mockNativeCreateKey).not.toHaveBeenCalled()
    })

    it('should return false when no key and attestation unavailable', async () => {
      mockNativeHasKey.mockResolvedValue(false)
      mockIsHardwareAttestationAvailable.mockResolvedValue(false)

      const result = await isHardwareSigningAvailable()

      expect(result).toBe(false)
    })
  })

  describe('preWarmAttestation (indirect via ensureHardwareSigningKey recovery)', () => {
    beforeEach(() => {
      mockNativeHasKey.mockResolvedValue(true)
      mockNativeGetPublicKey.mockRejectedValueOnce(new Error('Not cached'))
      mockIsHardwareAttestationAvailable.mockResolvedValue(true)
    })

    it('should succeed when attestation succeeds on first attempt', async () => {
      mockGetHardwareKeyAttestation.mockResolvedValue({
        success: true,
        certificateChain: ['cert1'],
      })

      const pubKeyBuffer = { toString: (enc?: string) => (enc === 'base64' ? 'cmVjb3ZlcmVk' : 'recovered') }
      mockNativeGetPublicKey.mockResolvedValue(pubKeyBuffer)
      mockNativeGetKeyInfo.mockResolvedValue({ storage: 'SecureEnclave' })

      const result = await ensureHardwareSigningKey(mockAgent)

      expect(result.publicKey).toBe('cmVjb3ZlcmVk')
      expect(mockGetHardwareKeyAttestation).toHaveBeenCalledTimes(1)
    })

    it('should retry attestation on failure before succeeding', async () => {
      jest.useFakeTimers()

      mockGetHardwareKeyAttestation
        .mockResolvedValueOnce({ success: false, certificateChain: [] })
        .mockResolvedValueOnce({ success: false, certificateChain: [] })
        .mockResolvedValueOnce({ success: true, certificateChain: ['cert1'] })

      const pubKeyBuffer = { toString: (enc?: string) => (enc === 'base64' ? 'cmV0cmllZA==' : 'retried') }
      mockNativeGetPublicKey.mockResolvedValue(pubKeyBuffer)
      mockNativeGetKeyInfo.mockResolvedValue({ storage: 'SecureEnclave' })

      const promise = ensureHardwareSigningKey(mockAgent)

      // Advance through the retry delays
      for (let i = 0; i < 10; i++) {
        await Promise.resolve()
        jest.advanceTimersByTime(10000)
        await Promise.resolve()
      }

      const result = await promise

      expect(result.publicKey).toBe('cmV0cmllZA==')
      expect(mockGetHardwareKeyAttestation).toHaveBeenCalledTimes(3)

      jest.useRealTimers()
    })
  })
})
