import type { DependencyManager } from '@credo-ts/core'
import {
  Kms,
  SignatureSuiteToken,
  VERIFICATION_METHOD_TYPE_ED25519_VERIFICATION_KEY_2018,
  VERIFICATION_METHOD_TYPE_ED25519_VERIFICATION_KEY_2020,
  VERIFICATION_METHOD_TYPE_MULTIKEY,
} from '@credo-ts/core'

import { DataIntegritySuiteModule } from '../../module/DataIntegritySuiteModule'
import {
  DATA_INTEGRITY_PROOF_TYPE,
  EDDSA_RDFC_2022_CRYPTOSUITE_NAME,
  EddsaRdfc2022DataIntegritySuite,
} from '../../services/EddsaRdfc2022DataIntegritySuite'

const verificationMethodId = 'did:peer:0z6MkTest#z6MkTest'

const makeCredoKeyPair = () => {
  const sign = jest.fn(async () => new Uint8Array([1, 2, 3]))
  return {
    keyPair: { signer: () => ({ sign }) },
    sign,
  }
}

describe('EddsaRdfc2022DataIntegritySuite', () => {
  // Credo's W3cJsonLdCredentialService constructs suites with
  // { key, LDKeyClass, proof, useNativeCanonize, date } — this contract is
  // what the adapter exists to satisfy.
  it('maps the credo sign-path constructor onto DataIntegrityProof', () => {
    const { keyPair } = makeCredoKeyPair()
    const suite = new EddsaRdfc2022DataIntegritySuite({
      key: keyPair,
      proof: { verificationMethod: verificationMethodId },
      date: '2026-01-01T00:00:00Z',
      LDKeyClass: class {},
      useNativeCanonize: false,
    })

    expect(suite.type).toBe(DATA_INTEGRITY_PROOF_TYPE)
    expect(suite.cryptosuite).toBe(EDDSA_RDFC_2022_CRYPTOSUITE_NAME)
    // DataIntegrityProof derives verificationMethod from signer.id — the glue
    // the adapter adds around credo's KmsKeyPair.signer()
    expect(suite.verificationMethod).toBe(verificationMethodId)
  })

  it('delegates signing to the credo KMS signer', async () => {
    const { keyPair, sign } = makeCredoKeyPair()
    const suite = new EddsaRdfc2022DataIntegritySuite({
      key: keyPair,
      proof: { verificationMethod: verificationMethodId },
    })

    const data = new Uint8Array([9, 9])
    const proof = await (suite as any).sign({ verifyData: data, proof: {} })

    expect(sign).toHaveBeenCalledWith({ data })
    // eddsa-rdfc-2022 proofValue is multibase base58-btc ('z' header)
    expect(proof.proofValue).toMatch(/^z/)
  })

  it('constructs without a key on the verify path and pins the verification method', () => {
    const suite = new EddsaRdfc2022DataIntegritySuite({
      proof: { verificationMethod: verificationMethodId },
      date: '2026-01-01T00:00:00Z',
    })

    expect(suite.verificationMethod).toBe(verificationMethodId)
    expect((suite as any).signer).toBeUndefined()
  })

  it('rejects a signer whose algorithm cannot satisfy the cryptosuite', () => {
    // Sanity check that the requiredAlgorithm assertion inside
    // DataIntegrityProof stays active — the adapter relies on it.
    expect(
      () =>
        new (require('@digitalcredentials/data-integrity').DataIntegrityProof)({
          cryptosuite: require('@digitalcredentials/eddsa-rdfc-2022-cryptosuite').cryptosuite,
          signer: { sign: async () => new Uint8Array(), id: verificationMethodId, algorithm: 'ES256' },
        })
    ).toThrow(/algorithm/)
  })
})

describe('DataIntegritySuiteModule', () => {
  it('registers the suite via SignatureSuiteToken multi-injection (no core patch)', () => {
    const registerInstance = jest.fn()
    const dependencyManager = { registerInstance } as unknown as DependencyManager

    new DataIntegritySuiteModule().register(dependencyManager)

    expect(registerInstance).toHaveBeenCalledTimes(1)
    const [token, suiteInfo] = registerInstance.mock.calls[0]
    expect(token).toBe(SignatureSuiteToken)
    expect(suiteInfo).toEqual({
      suiteClass: EddsaRdfc2022DataIntegritySuite,
      proofType: DATA_INTEGRITY_PROOF_TYPE,
      verificationMethodTypes: [
        VERIFICATION_METHOD_TYPE_ED25519_VERIFICATION_KEY_2018,
        VERIFICATION_METHOD_TYPE_ED25519_VERIFICATION_KEY_2020,
        VERIFICATION_METHOD_TYPE_MULTIKEY,
      ],
      supportedPublicJwkTypes: [Kms.Ed25519PublicJwk],
    })
  })
})
