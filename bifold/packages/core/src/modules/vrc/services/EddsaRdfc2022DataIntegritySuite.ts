/**
 * Credo-compatible signature suite for W3C VC Data Integrity proofs with the
 * eddsa-rdfc-2022 cryptosuite (VC-DI-EDDSA). Ported from the validated
 * Level 0/1 spikes (docs/CRYPTO_SUITE_FOLLOWUP.md decision record).
 *
 * Credo's W3cJsonLdCredentialService constructs registered suites as
 * `new SuiteClass({ key, LDKeyClass, proof, useNativeCanonize, date })`,
 * while @digitalcredentials/data-integrity's DataIntegrityProof expects
 * `{ signer, cryptosuite, date }`, derives `verificationMethod` from
 * `signer.id`, and asserts `signer.algorithm` matches the cryptosuite's
 * requiredAlgorithm. This class maps one constructor shape onto the other.
 *
 * `key` is Credo's KmsKeyPair: its .signer() wraps KeyManagementApi.sign, so
 * the private key never leaves the wallet/KMS. On the verify path Credo
 * constructs the suite without a key — none is needed, the cryptosuite's
 * createVerifier resolves the verification method through the document
 * loader (and translates Ed25519VerificationKey2018/2020 to Multikey).
 */
import { DataIntegrityProof } from '@digitalcredentials/data-integrity'
import { cryptosuite as eddsaRdfc2022Cryptosuite } from '@digitalcredentials/eddsa-rdfc-2022-cryptosuite'

export const DATA_INTEGRITY_PROOF_TYPE = 'DataIntegrityProof'
export const EDDSA_RDFC_2022_CRYPTOSUITE_NAME = 'eddsa-rdfc-2022'

interface CredoKeyPairLike {
  signer(): { sign(options: { data: Uint8Array | Uint8Array[] }): Promise<Uint8Array> }
}

export interface CredoSuiteConstructorOptions {
  /** Credo KmsKeyPair (sign path only; absent when verifying) */
  key?: CredoKeyPairLike
  /** Preset proof fields; Credo pins the verification method here */
  proof?: { verificationMethod?: string }
  date?: string | Date
  /** Passed by Credo, unused by DataIntegrityProof */
  LDKeyClass?: unknown
  /** Passed by Credo, unused by DataIntegrityProof */
  useNativeCanonize?: boolean
}

export class EddsaRdfc2022DataIntegritySuite extends DataIntegrityProof {
  public constructor(options: CredoSuiteConstructorOptions = {}) {
    const { key, proof, date } = options
    super({
      cryptosuite: eddsaRdfc2022Cryptosuite,
      date,
      signer: key
        ? {
            ...key.signer(),
            id: proof?.verificationMethod,
            algorithm: eddsaRdfc2022Cryptosuite.requiredAlgorithm,
          }
        : undefined,
    })

    // Verify-path construction has no signer to derive the method from
    if (!this.verificationMethod && proof?.verificationMethod) {
      this.verificationMethod = proof.verificationMethod
    }
  }
}
