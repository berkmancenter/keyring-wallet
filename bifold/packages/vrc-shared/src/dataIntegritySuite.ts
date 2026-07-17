/**
 * Credo-compatible signature suite + registration module for W3C VC Data
 * Integrity proofs with the eddsa-rdfc-2022 cryptosuite.
 *
 * Canonical Node-side copy for witness-server and vrc-reference (the RN app
 * carries the same adapter in @bifold/core src/modules/vrc — keep the two in
 * sync; see keyring-wallet docs/CRYPTO_SUITE_FOLLOWUP.md).
 *
 * Credo's W3cJsonLdCredentialService constructs registered suites as
 * `new SuiteClass({ key, LDKeyClass, proof, useNativeCanonize, date })`,
 * while DataIntegrityProof expects `{ signer, cryptosuite, date }` and
 * derives `verificationMethod` from `signer.id`, asserting
 * `signer.algorithm` matches the cryptosuite's requiredAlgorithm. The suite
 * class maps one shape onto the other; `key` is Credo's KmsKeyPair whose
 * .signer() wraps KeyManagementApi.sign (no raw private key). The verify
 * path needs no key: the cryptosuite's createVerifier resolves the
 * verification method through the document loader and translates
 * Ed25519VerificationKey2018/2020 to Multikey.
 *
 * Registration uses SignatureSuiteToken (a tsyringe multi-injection token),
 * so no @credo-ts/core patch is required.
 */
import type { DependencyManager, Module } from '@credo-ts/core'
import {
  Kms,
  SignatureSuiteToken,
  VERIFICATION_METHOD_TYPE_ED25519_VERIFICATION_KEY_2018,
  VERIFICATION_METHOD_TYPE_ED25519_VERIFICATION_KEY_2020,
  VERIFICATION_METHOD_TYPE_MULTIKEY,
} from '@credo-ts/core'
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

export class DataIntegritySuiteModule implements Module {
  public register(dependencyManager: DependencyManager) {
    dependencyManager.registerInstance(SignatureSuiteToken, {
      suiteClass: EddsaRdfc2022DataIntegritySuite,
      proofType: DATA_INTEGRITY_PROOF_TYPE,
      verificationMethodTypes: [
        VERIFICATION_METHOD_TYPE_ED25519_VERIFICATION_KEY_2018,
        VERIFICATION_METHOD_TYPE_ED25519_VERIFICATION_KEY_2020,
        VERIFICATION_METHOD_TYPE_MULTIKEY,
      ],
      supportedPublicJwkTypes: [Kms.Ed25519PublicJwk],
    })
  }
}
