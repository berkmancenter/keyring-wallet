/**
 * A real Credo-backed `VidResolver` (`@bifold/trust-tasks`'s `tsp` module):
 * resolves a VID through `agent.dids.resolveDidDocument` — the same public
 * Credo API `@bifold/trust-tasks`'s `documentProof.ts` already calls in
 * production to resolve a signing key — and extracts both the signing key
 * (assertionMethod/authentication/verificationMethod, same fallback order as
 * `documentProof.ts`'s `firstSigningVerificationMethod`) and the keyAgreement
 * key from the resolved document.
 *
 * TypeScript port of `tsp-reference/ref-11-vidresolver-port/credo-adapter.mjs`
 * — see that rung's README for the four-level proof this is built against.
 *
 * @module credo-tsp-adapter/vidResolver
 */
import { getPublicJwkFromVerificationMethod, type Agent, type VerificationMethod } from '@credo-ts/core'
import { tsp } from '@bifold/trust-tasks'

function firstEmbedded(arr?: Array<string | VerificationMethod>): VerificationMethod | undefined {
  return (arr ?? []).find((entry): entry is VerificationMethod => typeof entry === 'object' && entry !== null)
}

export function createCredoVidResolver(agent: Agent): tsp.VidResolver {
  return {
    async resolve(vid) {
      const didDocument = await agent.dids.resolveDidDocument(vid)

      const signingVm =
        firstEmbedded(didDocument.assertionMethod) ??
        firstEmbedded(didDocument.authentication) ??
        firstEmbedded(didDocument.verificationMethod)
      if (!signingVm) {
        throw new Error(`credo-tsp-adapter: no signing verification method resolvable on ${vid}`)
      }

      const keyAgreementVm = firstEmbedded(didDocument.keyAgreement)
      if (!keyAgreementVm) {
        throw new Error(`credo-tsp-adapter: no keyAgreement verification method resolvable on ${vid}`)
      }

      // publicJwk.publicKey's type is a union across all Credo-supported key
      // types, most of which (e.g. RSA) have no `publicKey` field at all —
      // same controlled assertion @bifold/trust-tasks's documentProof.ts uses
      // for the identical reason.
      return {
        signingPublicKey: (getPublicJwkFromVerificationMethod(signingVm).publicKey as { publicKey: Uint8Array }).publicKey,
        encryptionPublicKey: (getPublicJwkFromVerificationMethod(keyAgreementVm).publicKey as { publicKey: Uint8Array }).publicKey,
      }
    },
  }
}
