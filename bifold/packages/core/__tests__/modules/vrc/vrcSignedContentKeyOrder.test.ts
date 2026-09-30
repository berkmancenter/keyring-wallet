/**
 * The hardware signature covers JSON.stringify(credential) as built (before
 * evidence/proof), which is key-order dependent. The verifier reconstructs it
 * from the credential AFTER a Credo JsonTransformer round trip, so a member the
 * builder adds (issuerScope, G32) must survive that round trip in the same
 * position. Runs the real builder output through the real Credo transformer.
 */
const mockVerifyHardwareEvidence = jest.fn()
jest.mock('@bifold/react-native-attestation', () => ({
  verifyHardwareEvidence: (...args: unknown[]) => mockVerifyHardwareEvidence(...args),
}))

import { JsonTransformer, W3cJsonLdVerifiableCredential } from '@credo-ts/core'

import { contentHashBase64 } from '../../../src/hardware-signing/binding'
import { verifyVrcHardwareEvidence } from '../../../src/modules/vrc/services/BiometricSignatureVerifier'
import { buildVrcCredential } from '../../../src/modules/vrc/vrc-manager'

const agentForPeer = (counterpartyRceVersion: number) =>
  ({
    context: {},
    config: { logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() } },
    dependencyManager: {
      resolve: () => ({ findByCounterpartyRelationshipDid: async () => ({ counterpartyRceVersion }) }),
    },
  }) as never

const evidenceFor = (signedContentHash: string) => ({
  id: 'urn:uuid:e1',
  type: ['BiometricAttestation', 'HardwareKeyAttestation'],
  created: '2026-09-30T10:00:00Z',
  authenticationMethod: { type: 'FaceID', authenticatorType: 'platform', userVerification: 'required' },
  hardwareBinding: {
    keyStorage: 'SecureEnclave',
    platform: 'ios',
    keyType: 'EC-P256',
    algorithm: 'ECDSA-SHA256',
    publicKey: 'BAAA',
  },
  attestation: { format: 'apple-appattest-v1', certificateChain: ['a', 'b'] },
  signature: { value: 'MEUC', algorithm: 'ECDSA-SHA256', signedContentHash },
})

describe('hardware-signed bytes survive the Credo round trip (issuerScope included)', () => {
  test.each([3, 5])('RCE v%i: verifier reconstructs exactly the bytes that were hardware-signed', async (v) => {
    mockVerifyHardwareEvidence.mockReset()
    mockVerifyHardwareEvidence.mockResolvedValue({
      valid: true,
      certificateChainValid: true,
      publicKeyMatchesLeafCert: true,
      signatureValid: true,
    })
    const { credential } = await buildVrcCredential(agentForPeer(v), 'did:peer:0issuer', 'did:peer:0subject')
    expect(credential.issuerScope).toBe('pairwise')
    const signedBytes = JSON.stringify(credential) // what requestBiometricWithHardwareSigning signs

    // A genuine signer embeds SHA-256 of the bytes it signed; the verifier's Stage 1 gate
    // rejects anything else before native is called.
    const withEvidenceAndProof = {
      ...credential,
      evidence: [evidenceFor(contentHashBase64(signedBytes))],
      proof: {
        type: 'DataIntegrityProof',
        cryptosuite: 'eddsa-rdfc-2022',
        created: '2026-09-30T10:00:00Z',
        verificationMethod: 'did:peer:0issuer#key-1',
        proofPurpose: 'assertionMethod',
        proofValue: 'zabc',
      },
    }
    const roundTripped = JsonTransformer.toJSON(
      JsonTransformer.fromJSON(withEvidenceAndProof, W3cJsonLdVerifiableCredential, { validate: false })
    ) as Record<string, unknown>
    expect(roundTripped.issuerScope).toBe('pairwise')

    await verifyVrcHardwareEvidence(roundTripped as never)
    expect(mockVerifyHardwareEvidence).toHaveBeenCalledTimes(1)
    const passedContent = mockVerifyHardwareEvidence.mock.calls[0].find(
      (a) => typeof a === 'string' && a.includes('issuerScope')
    )
    expect(passedContent).toBe(signedBytes)
    expect(mockVerifyHardwareEvidence.mock.calls[0][5]).toBe(contentHashBase64(signedBytes))
  })
})
