import { CREDENTIALS_V2_CONTEXT_URL, ED25519_2018_SUITE_CONTEXT_URL } from '@bifold/vrc-contexts'

export const CREDENTIALS_V1_CONTEXT_URL = 'https://www.w3.org/2018/credentials/v1'

/**
 * Select the `@context` array for a credential the app issues, from the
 * negotiated capability shape (`{useVc20, useDi}`) plus the credential's own
 * domain contexts. Single source of the proof-context rules shared by the VRC
 * and RCard builders, so the two can't drift as the DI/VC 2.0 rollout
 * continues:
 *
 * - VCDM 2.0 + Ed25519Signature2018: the Ed25519 suite context must be present
 *   at build time — the v2 base context doesn't define the suite terms (v1.1
 *   did), so jsonld-signatures would append it during signing and the signed
 *   credential would no longer match the offer/request in credo's holder-side
 *   equality check.
 * - VCDM 2.0 + DataIntegrityProof (RCE v3): no suite context at all —
 *   credentials/v2 already defines the DataIntegrityProof terms
 *   (docs/CRYPTO_SUITE_FOLLOWUP.md, Level 0 spike check 4).
 * - Legacy VCDM 1.1 (pre-v2 peer): the v1 base context defines the 2018 suite
 *   terms itself.
 */
export function selectCredentialContexts(
  capabilities: { useVc20?: boolean; useDi?: boolean },
  domainContexts: string[]
): string[] {
  if (!capabilities.useVc20) {
    return [CREDENTIALS_V1_CONTEXT_URL, ...domainContexts]
  }
  return capabilities.useDi
    ? [CREDENTIALS_V2_CONTEXT_URL, ...domainContexts]
    : [CREDENTIALS_V2_CONTEXT_URL, ...domainContexts, ED25519_2018_SUITE_CONTEXT_URL]
}
