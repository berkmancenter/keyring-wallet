// A real Credo-backed VidResolver (ports.mjs): resolves a VID through
// `agent.dids.resolveDidDocument` — the exact same Credo API
// `@bifold/trust-tasks`'s documentProof.ts already calls in production to
// resolve a signing key — and extracts both the signing key (assertionMethod
// /authentication/verificationMethod) and the keyAgreement key from the
// resolved document.
//
// No fork, no private API: `agent.dids.resolveDidDocument` and
// `getPublicJwkFromVerificationMethod` are both `@credo-ts/core`'s public
// surface. did:key documents (used throughout this rung) carry both
// relationships out of the box — Credo derives the keyAgreement entry from
// the identity Ed25519 key via the standard Edwards→Montgomery birational
// map (`@credo-ts/core`'s domain/key-type/ed25519.mjs,
// `convertPublicKeyToX25519` from `@stablelib/ed25519`) — so no extra setup
// is needed to exercise the keyAgreement half.

import { getPublicJwkFromVerificationMethod } from "@credo-ts/core";

/**
 * did:peer:0/did:key documents embed the verification method directly in
 * each relationship array; did:peer:4 documents do too but under different
 * arrays depending on the method. Same helper shape as
 * `@bifold/trust-tasks`'s documentProof.ts `firstSigningVerificationMethod`,
 * generalized to any relationship array.
 * @param {unknown[] | undefined} arr
 */
function firstEmbedded(arr) {
  return (arr ?? []).find((entry) => typeof entry === "object" && entry !== null);
}

/**
 * @param {import('@credo-ts/core').Agent} agent
 * @returns {import('./ports.mjs').VidResolver}
 */
export function createCredoVidResolver(agent) {
  return {
    async resolve(vid) {
      const didDocument = await agent.dids.resolveDidDocument(vid);

      const signingVm =
        firstEmbedded(didDocument.assertionMethod) ??
        firstEmbedded(didDocument.authentication) ??
        firstEmbedded(didDocument.verificationMethod);
      if (!signingVm) {
        throw new Error(`ref-11: no signing verification method resolvable on ${vid}`);
      }

      const keyAgreementVm = firstEmbedded(didDocument.keyAgreement);
      if (!keyAgreementVm) {
        throw new Error(`ref-11: no keyAgreement verification method resolvable on ${vid}`);
      }

      return {
        signingPublicKey: getPublicJwkFromVerificationMethod(signingVm).publicKey.publicKey,
        encryptionPublicKey: getPublicJwkFromVerificationMethod(keyAgreementVm).publicKey.publicKey,
      };
    },
  };
}
