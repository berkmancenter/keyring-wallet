import type { DependencyManager, Module } from '@credo-ts/core'
import {
  Kms,
  SignatureSuiteToken,
  VERIFICATION_METHOD_TYPE_ED25519_VERIFICATION_KEY_2018,
  VERIFICATION_METHOD_TYPE_ED25519_VERIFICATION_KEY_2020,
  VERIFICATION_METHOD_TYPE_MULTIKEY,
} from '@credo-ts/core'

import {
  DATA_INTEGRITY_PROOF_TYPE,
  EddsaRdfc2022DataIntegritySuite,
} from '../services/EddsaRdfc2022DataIntegritySuite'

/**
 * Registers the DataIntegrityProof/eddsa-rdfc-2022 signature suite in Credo's
 * SignatureSuiteRegistry. SignatureSuiteToken is a tsyringe multi-injection
 * token, so no @credo-ts/core patch is needed — plain module registration is
 * enough for agent.w3cCredentials sign/verify to support the suite
 * (docs/CRYPTO_SUITE_FOLLOWUP.md, Level 1 spike finding #1).
 */
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
