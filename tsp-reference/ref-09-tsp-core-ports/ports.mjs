// tsp-core ports — the two capabilities `pack`/`unpack`'s crypto layer needs
// from an identity, expressed as OPERATIONS rather than raw key material, so
// a custody boundary that never exports a private key (Askar/HSM-backed) can
// satisfy them exactly as well as an in-memory raw key can.
//
// Why this file exists: vti-tsp-js's `pack`/`unpack` and hpke-js's
// `CipherSuite` both require the caller to hand over a raw private key
// directly — there is no entry point that accepts a pre-computed DH result
// instead. Askar's `Key.fromKeyExchange` (the operation Credo's KMS exposes
// for X25519) gives exactly a raw ECDH shared secret and nothing more — the
// private key itself never leaves Askar. These two shapes are the minimum
// port needed to bridge that gap; nothing here is Askar-specific.
// See ../../docs/plans/openvtc-integration-plan/2026-09-02-bam.md for the
// full investigation.

/**
 * @typedef {object} SigningKey
 * @property {Uint8Array} publicKey - 32-byte Ed25519 public key.
 * @property {(message: Uint8Array) => Promise<Uint8Array>} sign - a 64-byte
 *   Ed25519 signature over `message`. No custody problem here — Askar's
 *   `signMessage` already returns just the signature, so this is a direct
 *   passthrough for any backend.
 */

/**
 * @typedef {object} KeyAgreement
 * @property {Uint8Array} publicKey - 32-byte X25519 public key.
 * @property {(peerPublicKey: Uint8Array) => Promise<Uint8Array>} agree - the
 *   RAW X25519 Diffie-Hellman shared secret with `peerPublicKey` — no KDF
 *   applied, no HPKE context mixed in. This is exactly what
 *   `Key.fromKeyExchange` exposes: the static-key half of HPKE-Auth's
 *   AuthEncap/AuthDecap DH, nothing more. Everything downstream of this call
 *   (kemContext, LabeledExtract/LabeledExpand, the AEAD) is pure symmetric
 *   crypto over public inputs and needs no port at all.
 */

export {};
