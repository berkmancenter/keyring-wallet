// The reference adapter: wraps an in-memory raw private key in the
// SigningKey/KeyAgreement port shape (ports.mjs). Every operation here is
// exactly what ref-03-noble-crypto/hpke-noble.mjs and vti-tsp-js's
// crypto/sign.ts already did inline — this file changes nothing about the
// crypto, only where the private key lives relative to the call. It exists
// so a second, Askar-backed adapter can be swapped in later without either
// adapter's caller changing.

import { ed25519, x25519 } from "@noble/curves/ed25519.js";

/** Same zero-output check RFC 9180 mandates (belt-and-braces; noble also
 *  rejects low-order points) — copied from hpke-noble.mjs's `dh()`. */
function rawDh(sk, pk) {
  const shared = x25519.getSharedSecret(sk, pk);
  if (shared.every((b) => b === 0)) {
    throw new Error("keyAgreement: DH produced the all-zero shared secret");
  }
  return shared;
}

/**
 * @param {Uint8Array} privateKey - 32-byte Ed25519 private key (seed).
 * @returns {import('./ports.mjs').SigningKey}
 */
export function rawKeySigningKey(privateKey) {
  return {
    publicKey: ed25519.getPublicKey(privateKey),
    async sign(message) {
      return ed25519.sign(message, privateKey);
    },
  };
}

/**
 * @param {Uint8Array} privateKey - 32-byte X25519 private key.
 * @returns {import('./ports.mjs').KeyAgreement}
 */
export function rawKeyAgreement(privateKey) {
  return {
    publicKey: x25519.getPublicKey(privateKey),
    async agree(peerPublicKey) {
      return rawDh(privateKey, peerPublicKey);
    },
  };
}
