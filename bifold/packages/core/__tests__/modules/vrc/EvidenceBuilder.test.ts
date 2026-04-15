/**
 * Tests for EvidenceBuilder - W3C Evidence Block Construction
 *
 * Tests the creation of W3C-compliant evidence blocks for VRC credentials
 * with hardware attestation and biometric signatures.
 */

import { Agent, utils } from '@credo-ts/core'

import { EvidenceBuilder, createEvidenceBuilder } from '../../../src/modules/vrc/services/EvidenceBuilder'
import { AttestationStorageRepository } from '../../../src/modules/vrc/services/AttestationStorageRepository'
import type { HardwareSigningResult, VrcHardwareSignature } from '../../../src/modules/vrc/vrc-hardware-signing'
import type { HardwareAttestationEvidence } from '../../../src/modules/vrc/types/evidence'

// Mock @bifold/react-native-attestation
jest.mock('@bifold/react-native-attestation', () => ({
  getHardwareKeyAttestation: jest.fn(),
  isHardwareAttestationAvailable: jest.fn(),
}))

// Mock @credo-ts/core utils.uuid for predictable IDs
jest.mock('@credo-ts/core', () => {
  const actual = jest.requireActual('@credo-ts/core')
  return {
    ...actual,
    utils: {
      ...actual.utils,
      uuid: jest.fn(),
    },
  }
})

import {
  getHardwareKeyAttestation,
  isHardwareAttestationAvailable,
} from '@bifold/react-native-attestation'

const mockGetHardwareKeyAttestation = getHardwareKeyAttestation as jest.Mock
const mockIsHardwareAttestationAvailable = isHardwareAttestationAvailable as jest.Mock
const mockUuid = utils.uuid as jest.Mock

describe('EvidenceBuilder', () => {
  // Mock data
  const testPublicKey = 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEtest123'
  const testSignature = 'MEUCIQDtest456signature'
  const testCertificateChain = [
    '-----BEGIN CERTIFICATE-----\nMIIBtest1\n-----END CERTIFICATE-----',
    '-----BEGIN CERTIFICATE-----\nMIIBtest2\n-----END CERTIFICATE-----',
  ]

  // Mock repository
  let mockRepository: jest.Mocked<AttestationStorageRepository>

  // Mock agent
  let mockAgent: jest.Mocked<Agent>

  // Evidence builder instance
  let evidenceBuilder: EvidenceBuilder

  beforeEach(() => {
    jest.clearAllMocks()

    // Setup mock repository
    mockRepository = {
      findValidByPublicKey: jest.fn(),
      saveAttestation: jest.fn(),
    } as unknown as jest.Mocked<AttestationStorageRepository>

    // Setup mock agent with dependency injection
    mockAgent = {
      context: { contextCorrelationId: 'test-context' },
      config: {
        logger: {
          info: jest.fn(),
          warn: jest.fn(),
          error: jest.fn(),
        },
      },
      dependencyManager: {
        resolve: jest.fn().mockReturnValue(mockRepository),
      },
    } as unknown as jest.Mocked<Agent>

    // Setup default mock for uuid
    mockUuid.mockReturnValue('test-uuid-12345678')

    // Create evidence builder
    evidenceBuilder = new EvidenceBuilder(mockAgent)
  })

  describe('buildEvidenceFromSignature', () => {
    const createMockiOSSignature = (): VrcHardwareSignature => ({
      type: 'HardwareBackedBiometric',
      publicKey: testPublicKey,
      signature: testSignature,
      algorithm: 'ECDSA-SHA256',
      timestamp: '2025-01-24T12:00:00.000Z',
      keyStorage: 'SecureEnclave',
      platform: 'ios',
    })

    const createMockAndroidSignature = (): VrcHardwareSignature => ({
      type: 'HardwareBackedBiometric',
      publicKey: testPublicKey,
      signature: testSignature,
      algorithm: 'ECDSA-SHA256',
      timestamp: '2025-01-24T12:00:00.000Z',
      keyStorage: 'StrongBox',
      platform: 'android',
    })

    const createMockSigningResult = (
      signature: VrcHardwareSignature | undefined,
      success: boolean = true
    ): HardwareSigningResult => ({
      success,
      signature,
      reason: success ? 'signed' : 'error',
      error: success ? undefined : 'Test error',
    })

    describe('successful evidence building', () => {
      beforeEach(() => {
        // Mock cached attestation found
        mockRepository.findValidByPublicKey.mockResolvedValue({
          certificateChain: testCertificateChain,
        } as any)
      })

      it('should build valid W3C evidence block with all required fields', async () => {
        const signingResult = createMockSigningResult(createMockiOSSignature())
        const result = await evidenceBuilder.buildEvidenceFromSignature(signingResult)

        expect(result.success).toBe(true)
        expect(result.evidence).toBeDefined()

        const evidence = result.evidence as HardwareAttestationEvidence

        // Check all required W3C evidence fields
        expect(evidence.id).toMatch(/^urn:uuid:/)
        expect(evidence.type).toEqual(['BiometricAttestation', 'HardwareKeyAttestation'])
        expect(evidence.created).toBeDefined()
        expect(evidence.biometricMethod).toBeDefined()
        expect(evidence.hardwareBinding).toBeDefined()
        expect(evidence.attestation).toBeDefined()
        expect(evidence.signature).toBeDefined()
      })

      it('should set correct biometric type for iOS (FaceID)', async () => {
        const signingResult = createMockSigningResult(createMockiOSSignature())
        const result = await evidenceBuilder.buildEvidenceFromSignature(signingResult)

        expect(result.success).toBe(true)
        expect(result.evidence?.biometricMethod.type).toBe('FaceID')
        expect(result.evidence?.biometricMethod.authenticatorType).toBe('platform')
        expect(result.evidence?.biometricMethod.userVerification).toBe('required')
      })

      it('should set correct biometric type for Android (Fingerprint)', async () => {
        const signingResult = createMockSigningResult(createMockAndroidSignature())
        const result = await evidenceBuilder.buildEvidenceFromSignature(signingResult)

        expect(result.success).toBe(true)
        expect(result.evidence?.biometricMethod.type).toBe('Fingerprint')
        expect(result.evidence?.biometricMethod.authenticatorType).toBe('platform')
        expect(result.evidence?.biometricMethod.userVerification).toBe('required')
      })

      it('should set correct attestation format for iOS (apple-appattest-v1)', async () => {
        const signingResult = createMockSigningResult(createMockiOSSignature())
        const result = await evidenceBuilder.buildEvidenceFromSignature(signingResult)

        expect(result.success).toBe(true)
        expect(result.evidence?.attestation.format).toBe('apple-appattest-v1')
      })

      it('should set correct attestation format for Android (android-key-attestation-v3)', async () => {
        const signingResult = createMockSigningResult(createMockAndroidSignature())
        const result = await evidenceBuilder.buildEvidenceFromSignature(signingResult)

        expect(result.success).toBe(true)
        expect(result.evidence?.attestation.format).toBe('android-key-attestation-v3')
      })

      it('should include hardware binding information', async () => {
        const signingResult = createMockSigningResult(createMockiOSSignature())
        const result = await evidenceBuilder.buildEvidenceFromSignature(signingResult)

        expect(result.success).toBe(true)

        const hardwareBinding = result.evidence?.hardwareBinding
        expect(hardwareBinding?.keyStorage).toBe('SecureEnclave')
        expect(hardwareBinding?.platform).toBe('ios')
        expect(hardwareBinding?.keyType).toBe('EC-P256')
        expect(hardwareBinding?.algorithm).toBe('ECDSA-SHA256')
        expect(hardwareBinding?.publicKey).toBe(testPublicKey)
      })

      it('should include signature value and algorithm', async () => {
        const signingResult = createMockSigningResult(createMockiOSSignature())
        const result = await evidenceBuilder.buildEvidenceFromSignature(signingResult)

        expect(result.success).toBe(true)
        expect(result.evidence?.signature.value).toBe(testSignature)
        expect(result.evidence?.signature.algorithm).toBe('ECDSA-SHA256')
      })

      it('should report hasAttestation true when certificate chain exists', async () => {
        const signingResult = createMockSigningResult(createMockiOSSignature())
        const result = await evidenceBuilder.buildEvidenceFromSignature(signingResult)

        expect(result.success).toBe(true)
        expect(result.hasAttestation).toBe(true)
        expect(result.attestationSource).toBe('cached')
      })

      it('should report hasAttestation false when no certificate chain', async () => {
        mockRepository.findValidByPublicKey.mockResolvedValue(null)
        mockIsHardwareAttestationAvailable.mockResolvedValue(false)

        const signingResult = createMockSigningResult(createMockiOSSignature())
        const result = await evidenceBuilder.buildEvidenceFromSignature(signingResult)

        expect(result.success).toBe(true)
        expect(result.hasAttestation).toBe(false)
        expect(result.attestationSource).toBe('none')
      })
    })

    describe('error handling', () => {
      it('should return error when signature is missing', async () => {
        const signingResult = createMockSigningResult(undefined, true)
        const result = await evidenceBuilder.buildEvidenceFromSignature(signingResult)

        expect(result.success).toBe(false)
        expect(result.error).toBe('No signature available to build evidence')
        expect(result.hasAttestation).toBe(false)
        expect(result.evidence).toBeUndefined()
      })

      it('should return error when signing result unsuccessful', async () => {
        const signingResult: HardwareSigningResult = {
          success: false,
          reason: 'error',
          error: 'Signing failed',
        }
        const result = await evidenceBuilder.buildEvidenceFromSignature(signingResult)

        expect(result.success).toBe(false)
        expect(result.error).toBe('No signature available to build evidence')
        expect(result.hasAttestation).toBe(false)
        expect(result.evidence).toBeUndefined()
      })

      it('should return error when signing was cancelled', async () => {
        const signingResult: HardwareSigningResult = {
          success: false,
          reason: 'cancelled',
          error: 'User cancelled biometric',
        }
        const result = await evidenceBuilder.buildEvidenceFromSignature(signingResult)

        expect(result.success).toBe(false)
        expect(result.error).toBe('No signature available to build evidence')
        expect(result.hasAttestation).toBe(false)
      })
    })

    describe('attestation fetching', () => {
      it('should use cached attestation when available', async () => {
        mockRepository.findValidByPublicKey.mockResolvedValue({
          certificateChain: testCertificateChain,
        } as any)

        const signingResult = createMockSigningResult(createMockiOSSignature())
        const result = await evidenceBuilder.buildEvidenceFromSignature(signingResult)

        expect(result.success).toBe(true)
        expect(result.attestationSource).toBe('cached')
        expect(result.evidence?.attestation.certificateChain).toEqual(testCertificateChain)
        expect(mockGetHardwareKeyAttestation).not.toHaveBeenCalled()
      })

      it('should fetch attestation when not cached', async () => {
        mockRepository.findValidByPublicKey.mockResolvedValue(null)
        mockIsHardwareAttestationAvailable.mockResolvedValue(true)
        mockGetHardwareKeyAttestation.mockResolvedValue({
          success: true,
          certificateChain: testCertificateChain,
          format: 'apple-appattest-v1',
          platform: 'ios',
          securityLevel: 'SecureEnclave',
        })
        mockRepository.saveAttestation.mockResolvedValue({} as any)

        const signingResult = createMockSigningResult(createMockiOSSignature())
        const result = await evidenceBuilder.buildEvidenceFromSignature(signingResult)

        expect(result.success).toBe(true)
        expect(result.attestationSource).toBe('fetched')
        expect(mockGetHardwareKeyAttestation).toHaveBeenCalled()
        expect(mockRepository.saveAttestation).toHaveBeenCalled()
      })

      it('should handle attestation fetch failure gracefully', async () => {
        mockRepository.findValidByPublicKey.mockResolvedValue(null)
        mockIsHardwareAttestationAvailable.mockResolvedValue(true)
        mockGetHardwareKeyAttestation.mockResolvedValue({
          success: false,
          certificateChain: [],
        })

        const signingResult = createMockSigningResult(createMockiOSSignature())
        const result = await evidenceBuilder.buildEvidenceFromSignature(signingResult)

        // Should still succeed with empty attestation
        expect(result.success).toBe(true)
        expect(result.hasAttestation).toBe(false)
        expect(result.attestationSource).toBe('none')
        expect(result.evidence?.attestation.certificateChain).toEqual([])
      })
    })
  })

  describe('buildEvidenceBlock (via buildEvidenceFromSignature)', () => {
    beforeEach(() => {
      mockRepository.findValidByPublicKey.mockResolvedValue({
        certificateChain: testCertificateChain,
      } as any)
    })

    it('should generate unique URN UUID for evidence ID', async () => {
      mockUuid.mockReturnValue('unique-test-uuid-987654')

      const signingResult: HardwareSigningResult = {
        success: true,
        reason: 'signed',
        signature: {
          type: 'HardwareBackedBiometric',
          publicKey: testPublicKey,
          signature: testSignature,
          algorithm: 'ECDSA-SHA256',
          timestamp: '2025-01-24T12:00:00.000Z',
          keyStorage: 'SecureEnclave',
          platform: 'ios',
        },
      }

      const result = await evidenceBuilder.buildEvidenceFromSignature(signingResult)

      expect(result.success).toBe(true)
      expect(result.evidence?.id).toBe('urn:uuid:unique-test-uuid-987654')
      expect(mockUuid).toHaveBeenCalled()
    })

    it('should generate different UUIDs for different evidence blocks', async () => {
      let callCount = 0
      mockUuid.mockImplementation(() => `uuid-${++callCount}`)

      const signingResult: HardwareSigningResult = {
        success: true,
        reason: 'signed',
        signature: {
          type: 'HardwareBackedBiometric',
          publicKey: testPublicKey,
          signature: testSignature,
          algorithm: 'ECDSA-SHA256',
          timestamp: '2025-01-24T12:00:00.000Z',
          keyStorage: 'SecureEnclave',
          platform: 'ios',
        },
      }

      const result1 = await evidenceBuilder.buildEvidenceFromSignature(signingResult)
      const result2 = await evidenceBuilder.buildEvidenceFromSignature(signingResult)

      expect(result1.evidence?.id).toBe('urn:uuid:uuid-1')
      expect(result2.evidence?.id).toBe('urn:uuid:uuid-2')
      expect(result1.evidence?.id).not.toBe(result2.evidence?.id)
    })

    it('should include correct type array', async () => {
      const signingResult: HardwareSigningResult = {
        success: true,
        reason: 'signed',
        signature: {
          type: 'HardwareBackedBiometric',
          publicKey: testPublicKey,
          signature: testSignature,
          algorithm: 'ECDSA-SHA256',
          timestamp: '2025-01-24T12:00:00.000Z',
          keyStorage: 'SecureEnclave',
          platform: 'ios',
        },
      }

      const result = await evidenceBuilder.buildEvidenceFromSignature(signingResult)

      expect(result.success).toBe(true)
      expect(result.evidence?.type).toEqual(['BiometricAttestation', 'HardwareKeyAttestation'])
      expect(result.evidence?.type).toHaveLength(2)
    })

    it('should include created timestamp in ISO format', async () => {
      const beforeTime = new Date().toISOString()

      const signingResult: HardwareSigningResult = {
        success: true,
        reason: 'signed',
        signature: {
          type: 'HardwareBackedBiometric',
          publicKey: testPublicKey,
          signature: testSignature,
          algorithm: 'ECDSA-SHA256',
          timestamp: '2025-01-24T12:00:00.000Z',
          keyStorage: 'SecureEnclave',
          platform: 'ios',
        },
      }

      const result = await evidenceBuilder.buildEvidenceFromSignature(signingResult)
      const afterTime = new Date().toISOString()

      expect(result.success).toBe(true)
      expect(result.evidence?.created).toBeDefined()

      // Check ISO format
      const createdDate = new Date(result.evidence!.created)
      expect(createdDate.toISOString()).toBe(result.evidence!.created)

      // Check timestamp is within test execution window
      expect(result.evidence!.created >= beforeTime).toBe(true)
      expect(result.evidence!.created <= afterTime).toBe(true)
    })
  })

  describe('hasCachedAttestation', () => {
    it('should return true when valid attestation exists', async () => {
      mockRepository.findValidByPublicKey.mockResolvedValue({
        certificateChain: testCertificateChain,
      } as any)

      const result = await evidenceBuilder.hasCachedAttestation(testPublicKey)

      expect(result).toBe(true)
      expect(mockRepository.findValidByPublicKey).toHaveBeenCalledWith(
        mockAgent.context,
        testPublicKey
      )
    })

    it('should return false when no attestation exists', async () => {
      mockRepository.findValidByPublicKey.mockResolvedValue(null)

      const result = await evidenceBuilder.hasCachedAttestation(testPublicKey)

      expect(result).toBe(false)
    })
  })

  describe('Attestation retry behavior', () => {
    const createMockiOSSignature = (): VrcHardwareSignature => ({
      type: 'HardwareBackedBiometric',
      publicKey: testPublicKey,
      signature: testSignature,
      algorithm: 'ECDSA-SHA256',
      timestamp: '2025-01-24T12:00:00.000Z',
      keyStorage: 'SecureEnclave',
      platform: 'ios',
    })

    it('should retry on fetch failure and succeed on second attempt', async () => {
      mockRepository.findValidByPublicKey.mockResolvedValue(null)
      mockIsHardwareAttestationAvailable.mockResolvedValue(true)
      mockGetHardwareKeyAttestation
        .mockRejectedValueOnce(new Error('Network timeout'))
        .mockResolvedValueOnce({
          success: true,
          certificateChain: testCertificateChain,
          format: 'apple-appattest-v1',
          platform: 'ios',
          securityLevel: 'SecureEnclave',
        })
      mockRepository.saveAttestation.mockResolvedValue({} as any)

      const signingResult: HardwareSigningResult = {
        success: true,
        reason: 'signed',
        signature: createMockiOSSignature(),
      }
      const result = await evidenceBuilder.buildEvidenceFromSignature(signingResult)

      expect(result.success).toBe(true)
      expect(result.attestationSource).toBe('fetched')
      expect(mockGetHardwareKeyAttestation).toHaveBeenCalledTimes(2)
    })

    it('should stop retrying after 3 failed attempts', async () => {
      mockRepository.findValidByPublicKey.mockResolvedValue(null)
      mockIsHardwareAttestationAvailable.mockResolvedValue(true)
      mockGetHardwareKeyAttestation.mockResolvedValue({
        success: false,
        certificateChain: [],
      })

      const signingResult: HardwareSigningResult = {
        success: true,
        reason: 'signed',
        signature: createMockiOSSignature(),
      }
      const result = await evidenceBuilder.buildEvidenceFromSignature(signingResult)

      expect(result.success).toBe(true)
      expect(result.hasAttestation).toBe(false)
      expect(result.attestationSource).toBe('none')
      expect(mockGetHardwareKeyAttestation).toHaveBeenCalledTimes(3)
    })

    it('should include signedContentHash in evidence when provided', async () => {
      mockRepository.findValidByPublicKey.mockResolvedValue({
        certificateChain: testCertificateChain,
      } as any)

      const signingResult: HardwareSigningResult = {
        success: true,
        reason: 'signed',
        signature: createMockiOSSignature(),
      }
      const result = await evidenceBuilder.buildEvidenceFromSignature(signingResult, 'dGVzdC1oYXNo')

      expect(result.success).toBe(true)
      expect(result.evidence?.signature.signedContentHash).toBe('dGVzdC1oYXNo')
    })

    it('should omit signedContentHash from evidence when not provided', async () => {
      mockRepository.findValidByPublicKey.mockResolvedValue({
        certificateChain: testCertificateChain,
      } as any)

      const signingResult: HardwareSigningResult = {
        success: true,
        reason: 'signed',
        signature: createMockiOSSignature(),
      }
      const result = await evidenceBuilder.buildEvidenceFromSignature(signingResult)

      expect(result.success).toBe(true)
      expect(result.evidence?.signature).toBeDefined()
      expect('signedContentHash' in (result.evidence?.signature || {})).toBe(false)
    })
  })

  describe('createEvidenceBuilder factory function', () => {
    it('should create EvidenceBuilder instance', () => {
      const builder = createEvidenceBuilder(mockAgent)

      expect(builder).toBeInstanceOf(EvidenceBuilder)
    })
  })
})
