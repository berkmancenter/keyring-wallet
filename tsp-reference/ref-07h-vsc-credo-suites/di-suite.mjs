// Vendored from bifold/packages/core/src/modules/vrc/services/EddsaRdfc2022DataIntegritySuite.ts
// and bifold/packages/core/src/modules/vrc/module/DataIntegritySuiteModule.ts — Keyring's OWN
// production code (not a third-party dependency), copied rather than imported because
// bifold/packages/core is an RN/Metro package, not resolvable from a plain Node script.
// This is real, so a change to the production files should be mirrored here; not a
// reinvention of the mechanism, a portability copy of it.
import { DataIntegrityProof } from "@digitalcredentials/data-integrity";
import { cryptosuite as eddsaRdfc2022Cryptosuite } from "@digitalcredentials/eddsa-rdfc-2022-cryptosuite";
import {
  Kms,
  SignatureSuiteToken,
  VERIFICATION_METHOD_TYPE_ED25519_VERIFICATION_KEY_2018,
  VERIFICATION_METHOD_TYPE_ED25519_VERIFICATION_KEY_2020,
  VERIFICATION_METHOD_TYPE_MULTIKEY,
} from "@credo-ts/core";

export const DATA_INTEGRITY_PROOF_TYPE = "DataIntegrityProof";
export const EDDSA_RDFC_2022_CRYPTOSUITE_NAME = "eddsa-rdfc-2022";

export class EddsaRdfc2022DataIntegritySuite extends DataIntegrityProof {
  constructor(options = {}) {
    const { key, proof, date } = options;
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
    });
    if (!this.verificationMethod && proof?.verificationMethod) {
      this.verificationMethod = proof.verificationMethod;
    }
  }
}

export class DataIntegritySuiteModule {
  register(dependencyManager) {
    dependencyManager.registerInstance(SignatureSuiteToken, {
      suiteClass: EddsaRdfc2022DataIntegritySuite,
      proofType: DATA_INTEGRITY_PROOF_TYPE,
      verificationMethodTypes: [
        VERIFICATION_METHOD_TYPE_ED25519_VERIFICATION_KEY_2018,
        VERIFICATION_METHOD_TYPE_ED25519_VERIFICATION_KEY_2020,
        VERIFICATION_METHOD_TYPE_MULTIKEY,
      ],
      supportedPublicJwkTypes: [Kms.Ed25519PublicJwk],
    });
  }
}
