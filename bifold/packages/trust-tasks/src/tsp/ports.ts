/**
 * tsp-core's three ports — the capabilities the TSP envelope layer (HPKE-Auth
 * seal/open, the outer Ed25519 signature, VID→keys resolution) needs from an
 * identity, expressed as OPERATIONS rather than raw key material, so a
 * custody boundary that never exports a private key (Askar/HSM-backed) can
 * satisfy them exactly as well as an in-memory raw key can.
 *
 * TypeScript port of `tsp-reference/ref-09-tsp-core-ports/ports.mjs` and
 * `ref-11-vidresolver-port/ports.mjs`, proven there against a raw-key
 * reference adapter, a real Askar-backed adapter (`ref-10`), and a real
 * Credo-backed `VidResolver` (`ref-11`) — see
 * `docs/plans/openvtc-integration-plan/2026-09-02-bam.md`. This package owns
 * the port TYPES and the port-based envelope orchestration (`./direct`);
 * `@bifold/credo-tsp-adapter` owns the concrete Askar-backed implementations,
 * keeping this package's zero-Credo/Askar/RN-imports contract intact.
 *
 * @module trust-tasks/tsp/ports
 */

/** A 32-byte Ed25519 public key, or a 32-byte X25519 public key — the port
 *  types don't distinguish these at the type level (both are `Uint8Array`),
 *  but every function below documents which it expects. */

export interface SigningKey {
  /** 32-byte Ed25519 public key. */
  readonly publicKey: Uint8Array
  /** A 64-byte Ed25519 signature over `message`. No custody problem here —
   *  Askar's `signMessage` already returns just the signature, so this is a
   *  direct passthrough for any backend. */
  sign(message: Uint8Array): Promise<Uint8Array>
}

export interface KeyAgreement {
  /** 32-byte X25519 public key. */
  readonly publicKey: Uint8Array
  /** The RAW X25519 Diffie-Hellman shared secret with `peerPublicKey` — no
   *  KDF applied, no HPKE context mixed in. This is exactly what Askar's
   *  `Key.fromKeyExchange` exposes: the static-key half of HPKE-Auth's
   *  AuthEncap/AuthDecap DH, nothing more. Everything downstream of this
   *  call (kemContext, LabeledExtract/LabeledExpand, the AEAD) is pure
   *  symmetric crypto over public inputs and needs no port at all. */
  agree(peerPublicKey: Uint8Array): Promise<Uint8Array>
}

export interface ResolvedVidKeys {
  /** 32-byte X25519 public key, the VID's keyAgreement key — what a sender
   *  seals an HPKE-Auth message to. */
  encryptionPublicKey: Uint8Array
  /** 32-byte Ed25519 public key, the VID's signing/verification key — what a
   *  recipient verifies a message's outer signature against. */
  signingPublicKey: Uint8Array
}

export interface VidResolver {
  /** Resolve a VID to its current keys. Rejects (does not return a partial
   *  result) if the VID cannot be resolved at all, or resolves to a document
   *  missing either key relationship a TSP envelope needs. */
  resolve(vid: string): Promise<ResolvedVidKeys>
}

/** The pair of local ports a TSP identity needs — never resolved, always
 *  custody-backed, as opposed to a counterparty's keys, which always come
 *  from a {@link VidResolver}. */
export interface TspIdentity {
  signingKey: SigningKey
  keyAgreement: KeyAgreement
}
