/**
 * Tests for BiometricSignatureVerifier - Native verification wrapper
 *
 * Since verification is now fully delegated to native iOS/Android code,
 * these tests mock the native module and verify the wrapper behavior:
 * - Correct argument forwarding to native
 * - Proper mapping of native results to the wrapper's result format
 * - Edge cases (no evidence, native errors)
 */

// Mock the native attestation module — verification now happens natively
const mockVerifyHardwareEvidence = jest.fn()
jest.mock('@bifold/react-native-attestation', () => ({
  verifyHardwareEvidence: (...args: unknown[]) => mockVerifyHardwareEvidence(...args),
}))

import {
  HardwareSignatureVerifier,
  verifyVrcHardwareEvidence,
} from '../../../src/modules/vrc/services/BiometricSignatureVerifier'
import type { HardwareAttestationEvidence } from '../../../src/modules/vrc/types/evidence'

const testCredential = {
  '@context': ['https://www.w3.org/2018/credentials/v1'],
  type: ['VerifiableCredential', 'RelationshipCredential'],
  issuer: {
    id: 'did:peer:2.Ez6LStest123',
    name: 'Test User',
  },
  issuanceDate: '2025-01-23T12:00:00.000Z',
  credentialSubject: {
    id: 'did:peer:2.Ez6LStest456',
  },
}

const testEvidence: HardwareAttestationEvidence = {
  id: 'urn:uuid:test-evidence-123',
  type: ['BiometricAttestation', 'HardwareKeyAttestation'],
  created: '2025-01-23T12:00:00.000Z',
  biometricMethod: {
    type: 'FaceID',
    authenticatorType: 'platform',
    userVerification: 'required',
  },
  hardwareBinding: {
    keyStorage: 'SecureEnclave',
    platform: 'ios',
    keyType: 'EC-P256',
    algorithm: 'ECDSA-SHA256',
    publicKey: 'dGVzdC1wdWJsaWMta2V5',
  },
  attestation: {
    format: 'apple-appattest-v1',
    certificateChain: ['cert1-base64', 'cert2-base64'],
  },
  signature: {
    value: 'dGVzdC1zaWduYXR1cmU=',
    algorithm: 'ECDSA-SHA256',
    signedContentHash: 'dGVzdC1oYXNo',
  },
}

const credentialWithEvidence = {
  ...testCredential,
  evidence: [testEvidence],
}

describe('BiometricSignatureVerifier', () => {
  beforeEach(() => {
    mockVerifyHardwareEvidence.mockReset()
  })

  describe('Native verification delegation', () => {
    it('should return valid result when native verification passes', async () => {
      mockVerifyHardwareEvidence.mockResolvedValue({
        valid: true,
        certificateChainValid: true,
        publicKeyMatchesLeafCert: true,
        signatureValid: true,
      })

      const verifier = new HardwareSignatureVerifier()
      const result = await verifier.verifyEvidence(testEvidence, 'test-content')

      expect(result.valid).toBe(true)
      expect(result.details.signatureValid).toBe(true)
      expect(result.details.certificateChainValid).toBe(true)
      expect(result.details.publicKeyMatchesCert).toBe(true)
      expect(result.details.verificationLevel).toBe('cryptographic')
    })

    it('should forward correct arguments to native module', async () => {
      mockVerifyHardwareEvidence.mockResolvedValue({
        valid: true,
        certificateChainValid: true,
        publicKeyMatchesLeafCert: true,
        signatureValid: true,
      })

      const verifier = new HardwareSignatureVerifier()
      await verifier.verifyEvidence(testEvidence, 'test-content')

      expect(mockVerifyHardwareEvidence).toHaveBeenCalledWith(
        testEvidence.attestation.certificateChain,
        testEvidence.signature.value,
        'test-content',
        testEvidence.hardwareBinding.publicKey,
        testEvidence.attestation.format,
        testEvidence.signature.signedContentHash,
      )
    })

    it('should return invalid result when native signature check fails', async () => {
      mockVerifyHardwareEvidence.mockResolvedValue({
        valid: false,
        certificateChainValid: true,
        publicKeyMatchesLeafCert: true,
        signatureValid: false,
        errors: ['Signature verification failed'],
      })

      const verifier = new HardwareSignatureVerifier()
      const result = await verifier.verifyEvidence(testEvidence, 'tampered-content')

      expect(result.valid).toBe(false)
      expect(result.details.signatureValid).toBe(false)
      expect(result.details.verificationLevel).toBe('none')
      expect(result.error).toContain('Signature verification failed')
    })

    it('should return invalid result when native certificate chain check fails', async () => {
      mockVerifyHardwareEvidence.mockResolvedValue({
        valid: false,
        certificateChainValid: false,
        publicKeyMatchesLeafCert: false,
        signatureValid: false,
        errors: ['Certificate chain validation failed'],
      })

      const verifier = new HardwareSignatureVerifier()
      const result = await verifier.verifyEvidence(testEvidence, 'test-content')

      expect(result.valid).toBe(false)
      expect(result.details.certificateChainValid).toBe(false)
    })

    it('should handle native module throwing an error', async () => {
      mockVerifyHardwareEvidence.mockRejectedValue(new Error('Native module unavailable'))

      const verifier = new HardwareSignatureVerifier()
      const result = await verifier.verifyEvidence(testEvidence, 'test-content')

      expect(result.valid).toBe(false)
      expect(result.details.verificationLevel).toBe('none')
      expect(result.error).toContain('Native module unavailable')
    })

    it('should include Android attestation extension data when present', async () => {
      mockVerifyHardwareEvidence.mockResolvedValue({
        valid: true,
        certificateChainValid: true,
        publicKeyMatchesLeafCert: true,
        signatureValid: true,
        attestationSecurityLevel: 'StrongBox',
        keymasterSecurityLevel: 'StrongBox',
        verifiedBootState: 'Verified',
        deviceLocked: true,
        userAuthType: 'Fingerprint',
        authTimeout: 0,
        revocationChecked: true,
      })

      const verifier = new HardwareSignatureVerifier()
      const result = await verifier.verifyEvidence(testEvidence, 'test-content')

      expect(result.valid).toBe(true)
      expect(result.attestationExtension).toBeDefined()
      expect(result.attestationExtension?.attestationSecurityLevel).toBe('StrongBox')
      expect(result.attestationExtension?.userAuthType).toBe('Fingerprint')
      expect(result.revocationChecked).toBe(true)
    })

    it('should include platform from evidence in result', async () => {
      mockVerifyHardwareEvidence.mockResolvedValue({
        valid: true,
        certificateChainValid: true,
        publicKeyMatchesLeafCert: true,
        signatureValid: true,
      })

      const verifier = new HardwareSignatureVerifier()
      const result = await verifier.verifyEvidence(testEvidence, 'test-content')

      expect(result.platform).toBe('ios')
      expect(result.securityLevel).toBe('SecureEnclave')
    })
  })

  describe('verifyVrcHardwareEvidence convenience function', () => {
    it('should verify hardware evidence from a full credential', async () => {
      mockVerifyHardwareEvidence.mockResolvedValue({
        valid: true,
        certificateChainValid: true,
        publicKeyMatchesLeafCert: true,
        signatureValid: true,
      })

      const result = await verifyVrcHardwareEvidence(credentialWithEvidence)

      expect(result).not.toBeNull()
      expect(result?.valid).toBe(true)
      expect(result?.details.signatureValid).toBe(true)
    })

    it('should return null for credential without evidence', async () => {
      const result = await verifyVrcHardwareEvidence(testCredential as any)
      expect(result).toBeNull()
      expect(mockVerifyHardwareEvidence).not.toHaveBeenCalled()
    })

    it('should return null for credential with empty evidence array', async () => {
      const result = await verifyVrcHardwareEvidence({ ...testCredential, evidence: [] } as any)
      expect(result).toBeNull()
    })

    it('should return null when no BiometricAttestation evidence found', async () => {
      const nonBiometricEvidence = {
        ...testEvidence,
        type: ['OtherType'],
      }
      const result = await verifyVrcHardwareEvidence({
        ...testCredential,
        evidence: [nonBiometricEvidence],
      } as any)
      expect(result).toBeNull()
    })

    it('should pass extracted content (without evidence) to native verifier', async () => {
      mockVerifyHardwareEvidence.mockResolvedValue({
        valid: true,
        certificateChainValid: true,
        publicKeyMatchesLeafCert: true,
        signatureValid: true,
      })

      await verifyVrcHardwareEvidence(credentialWithEvidence)

      const passedContent = mockVerifyHardwareEvidence.mock.calls[0][2]
      const parsed = JSON.parse(passedContent)
      expect(parsed.evidence).toBeUndefined()
      expect(parsed.issuer).toEqual(testCredential.issuer)
    })
  })

  describe('Cross-platform verification', () => {
    it('should verify iOS evidence (apple-appattest-v1 format)', async () => {
      mockVerifyHardwareEvidence.mockResolvedValue({
        valid: true,
        certificateChainValid: true,
        publicKeyMatchesLeafCert: true,
        signatureValid: true,
      })

      const iosEvidence: HardwareAttestationEvidence = {
        ...testEvidence,
        attestation: { format: 'apple-appattest-v1', certificateChain: ['ios-cert1', 'ios-cert2'] },
      }

      const verifier = new HardwareSignatureVerifier()
      const result = await verifier.verifyEvidence(iosEvidence, 'test-content')

      expect(result.valid).toBe(true)
      expect(mockVerifyHardwareEvidence).toHaveBeenCalledWith(
        ['ios-cert1', 'ios-cert2'],
        expect.anything(),
        expect.anything(),
        expect.anything(),
        'apple-appattest-v1',
        expect.anything(),
      )
    })

    it('should verify Android evidence (android-key-attestation-v3 format)', async () => {
      mockVerifyHardwareEvidence.mockResolvedValue({
        valid: true,
        certificateChainValid: true,
        publicKeyMatchesLeafCert: true,
        signatureValid: true,
      })

      const androidEvidence: HardwareAttestationEvidence = {
        ...testEvidence,
        hardwareBinding: { ...testEvidence.hardwareBinding, platform: 'android', keyStorage: 'StrongBox' },
        attestation: { format: 'android-key-attestation-v3', certificateChain: ['android-cert1'] },
      }

      const verifier = new HardwareSignatureVerifier()
      const result = await verifier.verifyEvidence(androidEvidence, 'test-content')

      expect(result.valid).toBe(true)
      expect(mockVerifyHardwareEvidence).toHaveBeenCalledWith(
        ['android-cert1'],
        expect.anything(),
        expect.anything(),
        expect.anything(),
        'android-key-attestation-v3',
        expect.anything(),
      )
    })

    it('should return invalid for empty certificate chain', async () => {
      mockVerifyHardwareEvidence.mockResolvedValue({
        valid: false,
        certificateChainValid: false,
        publicKeyMatchesLeafCert: false,
        signatureValid: false,
        errors: ['Certificate chain is empty'],
      })

      const emptyChainEvidence: HardwareAttestationEvidence = {
        ...testEvidence,
        attestation: { ...testEvidence.attestation, certificateChain: [] },
      }

      const verifier = new HardwareSignatureVerifier()
      const result = await verifier.verifyEvidence(emptyChainEvidence, 'test-content')

      expect(result.valid).toBe(false)
      expect(result.details.certificateChainValid).toBe(false)
    })

    it('should pass undefined signedContentHash to native when missing from evidence', async () => {
      mockVerifyHardwareEvidence.mockResolvedValue({
        valid: true,
        certificateChainValid: true,
        publicKeyMatchesLeafCert: true,
        signatureValid: true,
      })

      const noHashEvidence: HardwareAttestationEvidence = {
        ...testEvidence,
        signature: { value: testEvidence.signature.value, algorithm: 'ECDSA-SHA256' },
      }

      const verifier = new HardwareSignatureVerifier()
      await verifier.verifyEvidence(noHashEvidence, 'test-content')

      expect(mockVerifyHardwareEvidence).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        undefined,
      )
    })
  })

  describe('extractSignedContent edge cases (via verifyVrcHardwareEvidence)', () => {
    it('should restore @context from Credo-style credential with "context" key', async () => {
      mockVerifyHardwareEvidence.mockResolvedValue({
        valid: true,
        certificateChainValid: true,
        publicKeyMatchesLeafCert: true,
        signatureValid: true,
      })

      const credoCredential = {
        context: ['https://www.w3.org/2018/credentials/v1'],
        type: ['VerifiableCredential', 'RelationshipCredential'],
        issuer: { id: 'did:peer:2.Ez6LStest123' },
        issuanceDate: '2025-01-23T12:00:00.000Z',
        credentialSubject: { id: 'did:peer:2.Ez6LStest456' },
        evidence: [testEvidence],
      }

      await verifyVrcHardwareEvidence(credoCredential as any)

      const passedContent = mockVerifyHardwareEvidence.mock.calls[0][2]
      const parsed = JSON.parse(passedContent)
      expect(parsed['@context']).toEqual(['https://www.w3.org/2018/credentials/v1'])
      expect(parsed['context']).toBeUndefined()
    })

    it('should strip both proof and evidence from content passed to native', async () => {
      mockVerifyHardwareEvidence.mockResolvedValue({
        valid: true,
        certificateChainValid: true,
        publicKeyMatchesLeafCert: true,
        signatureValid: true,
      })

      const credentialWithProof = {
        ...testCredential,
        evidence: [testEvidence],
        proof: {
          type: 'Ed25519Signature2018',
          verificationMethod: 'did:peer:2.Ez6LStest#key-1',
          proofPurpose: 'assertionMethod',
          jws: 'eyJhbGciOiJFZERTQSJ9..test',
        },
      }

      await verifyVrcHardwareEvidence(credentialWithProof as any)

      const passedContent = mockVerifyHardwareEvidence.mock.calls[0][2]
      const parsed = JSON.parse(passedContent)
      expect(parsed.evidence).toBeUndefined()
      expect(parsed.proof).toBeUndefined()
      expect(parsed.issuer).toEqual(testCredential.issuer)
    })
  })

  describe('Evidence Structure Validation', () => {
    it('should validate a complete evidence structure', () => {
      const verifier = new HardwareSignatureVerifier()
      expect(verifier.hasValidEvidenceFormat(testEvidence)).toBe(true)
    })

    it('should reject evidence missing required fields', () => {
      const verifier = new HardwareSignatureVerifier()

      const invalidEvidence = {
        id: 'urn:uuid:test',
        type: ['BiometricAttestation'],
      } as any

      expect(verifier.hasValidEvidenceFormat(invalidEvidence)).toBe(false)
    })

    it('should reject evidence without public key', () => {
      const verifier = new HardwareSignatureVerifier()

      const noKeyEvidence = {
        ...testEvidence,
        hardwareBinding: { ...testEvidence.hardwareBinding, publicKey: '' },
      }

      expect(verifier.hasValidEvidenceFormat(noKeyEvidence)).toBe(false)
    })

    it('should reject evidence without signature value', () => {
      const verifier = new HardwareSignatureVerifier()

      const noSigEvidence = {
        ...testEvidence,
        signature: { ...testEvidence.signature, value: '' },
      }

      expect(verifier.hasValidEvidenceFormat(noSigEvidence)).toBe(false)
    })
  })
})
