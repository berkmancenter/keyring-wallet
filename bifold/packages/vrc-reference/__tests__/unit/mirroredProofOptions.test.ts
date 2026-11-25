/**
 * Witness issuance mirroring (docs/CRYPTO_SUITE_FOLLOWUP.md): the VWC's
 * proof family mirrors the observed VRC's. A DI-signed VRC implies the
 * cross-distributed recipient is DI-capable (apps only sign DI for RCE v3
 * counterparties); anything else falls back to Ed25519Signature2018.
 */
import { getMirroredJsonLdProofOptions } from '@bifold/vrc-shared'

const DI_PROOF = {
  type: 'DataIntegrityProof',
  cryptosuite: 'eddsa-rdfc-2022',
  proofPurpose: 'assertionMethod',
  verificationMethod: 'did:peer:0z6Mk#z6Mk',
  proofValue: 'zTest',
}

const PROOF_2018 = {
  type: 'Ed25519Signature2018',
  proofPurpose: 'assertionMethod',
  verificationMethod: 'did:peer:0z6Mk#z6Mk',
  jws: 'test',
}

describe('getMirroredJsonLdProofOptions', () => {
  test('mirrors a DI proof to DI options', () => {
    expect(getMirroredJsonLdProofOptions(DI_PROOF)).toEqual({
      proofType: 'DataIntegrityProof',
      cryptosuite: 'eddsa-rdfc-2022',
      proofPurpose: 'assertionMethod',
    })
  })

  test('mirrors a 2018 proof to 2018 options (no cryptosuite field)', () => {
    expect(getMirroredJsonLdProofOptions(PROOF_2018)).toEqual({
      proofType: 'Ed25519Signature2018',
      proofPurpose: 'assertionMethod',
    })
  })

  test('a DataIntegrityProof with an unknown cryptosuite falls back to 2018', () => {
    expect(getMirroredJsonLdProofOptions({ ...DI_PROOF, cryptosuite: 'eddsa-jcs-2022' }).proofType).toBe(
      'Ed25519Signature2018'
    )
  })

  test('proof sets: DI anywhere in the array mirrors DI', () => {
    expect(getMirroredJsonLdProofOptions([PROOF_2018, DI_PROOF]).proofType).toBe('DataIntegrityProof')
  })

  test('missing/malformed proof falls back to 2018 (fail-safe)', () => {
    expect(getMirroredJsonLdProofOptions(undefined).proofType).toBe('Ed25519Signature2018')
    expect(getMirroredJsonLdProofOptions(null).proofType).toBe('Ed25519Signature2018')
    expect(getMirroredJsonLdProofOptions('DataIntegrityProof').proofType).toBe('Ed25519Signature2018')
  })
})
