// tsp-core's third port (ref-09-tsp-core-ports/ports.mjs defined the other
// two, SigningKey/KeyAgreement) — resolving a VID (in our case, a DID
// string) to the two public keys a TSP envelope needs to address it: an
// Ed25519 key to verify a sender's signature against, and an X25519 key to
// seal a message to. No custody boundary here — every byte this port
// returns is public by definition — which is why, unlike the other two
// ports, a single typedef covers both the raw-key/fixture case and the
// Credo-backed case with no special-casing.
//
// See ../../docs/plans/openvtc-integration-plan/2026-09-02-bam.md for the
// scope this closes.

/**
 * @typedef {object} ResolvedVidKeys
 * @property {Uint8Array} encryptionPublicKey - 32-byte X25519 public key,
 *   the VID's keyAgreement key — what a sender seals an HPKE-Auth message to.
 * @property {Uint8Array} signingPublicKey - 32-byte Ed25519 public key, the
 *   VID's signing/verification key — what a recipient verifies a message's
 *   outer signature against.
 */

/**
 * @typedef {object} VidResolver
 * @property {(vid: string) => Promise<ResolvedVidKeys>} resolve - resolve a
 *   VID to its current keys. Rejects (does not return a partial result) if
 *   the VID cannot be resolved at all, or resolves to a document missing
 *   either key relationship a TSP envelope needs.
 */

export {};
