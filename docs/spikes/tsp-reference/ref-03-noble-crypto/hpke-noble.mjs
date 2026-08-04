// hpke-noble.mjs — RFC 9180 HPKE-Auth, single-shot, on @noble primitives only.
//
// Drop-in replacement for vti-tsp-js's src/crypto/hpke.ts (which uses hpke-js
// → WebCrypto for HKDF and X25519). Identical suite, identical wire bytes:
//
//   KEM  0x0020  DHKEM(X25519, HKDF-SHA256)
//   KDF  0x0001  HKDF-SHA256
//   AEAD 0x0003  ChaCha20Poly1305
//   mode 0x02    Auth (sender's static key mixed into key agreement)
//
// Why this exists: React Native's Hermes engine has no `crypto.subtle`, so
// hpke-js throws on `importKey`/`deriveBits`. Everything here is pure JS
// (@noble/curves, @noble/hashes, @noble/ciphers), so the same code runs in
// browsers, Node (any version), Deno, Workers, and Hermes.
//
// Spec references are section numbers from RFC 9180.
// `ephemeralSk` on seal() exists ONLY so RFC 9180 test vectors (which fix
// skEm) can be verified; production callers omit it and get a fresh key.

import { x25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { extract, expand } from "@noble/hashes/hkdf.js";
import { chacha20poly1305 } from "@noble/ciphers/chacha.js";

export const KEM_ID = 0x0020;
export const KDF_ID = 0x0001;
export const AEAD_ID = 0x0003;
export const MODE_AUTH = 0x02;

const NSECRET = 32; // DHKEM(X25519) shared-secret length
const NK = 32; // ChaCha20Poly1305 key length
const NN = 12; // ChaCha20Poly1305 nonce length
const NH = 32; // SHA-256 output length
export const TAG_LEN = 16;
export const ENC_LEN = 32;

const HPKE_V1 = new TextEncoder().encode("HPKE-v1");
const EMPTY = new Uint8Array(0);

const cat = (...arrays) => {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) { out.set(a, off); off += a.length; }
  return out;
};
const i2osp2 = (n) => new Uint8Array([(n >> 8) & 0xff, n & 0xff]);
const label = (s) => new TextEncoder().encode(s);

// §4.1 — suite_id differs between the KEM's labeled calls and the key schedule's.
const KEM_SUITE_ID = cat(label("KEM"), i2osp2(KEM_ID));
const HPKE_SUITE_ID = cat(label("HPKE"), i2osp2(KEM_ID), i2osp2(KDF_ID), i2osp2(AEAD_ID));

// §4 LabeledExtract / LabeledExpand
const labeledExtract = (suiteId, salt, lbl, ikm) =>
  extract(sha256, cat(HPKE_V1, suiteId, label(lbl), ikm), salt);

const labeledExpand = (suiteId, prk, lbl, info, len) =>
  expand(sha256, prk, cat(i2osp2(len), HPKE_V1, suiteId, label(lbl), info), len);

// §4.1 ExtractAndExpand (inside the KEM)
function extractAndExpand(dh, kemContext) {
  const eaePrk = labeledExtract(KEM_SUITE_ID, EMPTY, "eae_prk", dh);
  return labeledExpand(KEM_SUITE_ID, eaePrk, "shared_secret", kemContext, NSECRET);
}

// §5.1 KeySchedule for mode_auth (no PSK)
function keySchedule(sharedSecret, info) {
  const pskIdHash = labeledExtract(HPKE_SUITE_ID, EMPTY, "psk_id_hash", EMPTY);
  const infoHash = labeledExtract(HPKE_SUITE_ID, EMPTY, "info_hash", info);
  const ksContext = cat(new Uint8Array([MODE_AUTH]), pskIdHash, infoHash);
  const secret = labeledExtract(HPKE_SUITE_ID, sharedSecret, "secret", EMPTY);
  return {
    key: labeledExpand(HPKE_SUITE_ID, secret, "key", ksContext, NK),
    baseNonce: labeledExpand(HPKE_SUITE_ID, secret, "base_nonce", ksContext, NN),
    exporterSecret: labeledExpand(HPKE_SUITE_ID, secret, "exp", ksContext, NH),
  };
}

// §4.1 DH with the zero-output check RFC 9180 mandates (noble also rejects
// low-order points, so this is belt-and-braces).
function dh(sk, pk) {
  const shared = x25519.getSharedSecret(sk, pk);
  if (shared.every((b) => b === 0)) throw new Error("hpke: DH produced the all-zero shared secret");
  return shared;
}

/** §5.1.4 AuthEncap — returns {sharedSecret, enc}. */
export function authEncap(recipientPk, senderSk, ephemeralSk) {
  const skE = ephemeralSk ?? (x25519.utils.randomSecretKey ?? x25519.utils.randomPrivateKey)();
  const enc = x25519.getPublicKey(skE);
  const dhBytes = cat(dh(skE, recipientPk), dh(senderSk, recipientPk));
  const kemContext = cat(enc, recipientPk, x25519.getPublicKey(senderSk));
  return { sharedSecret: extractAndExpand(dhBytes, kemContext), enc };
}

/** §5.1.4 AuthDecap — returns the shared secret. */
export function authDecap(enc, recipientSk, senderPk) {
  const dhBytes = cat(dh(recipientSk, enc), dh(recipientSk, senderPk));
  const kemContext = cat(enc, x25519.getPublicKey(recipientSk), senderPk);
  return extractAndExpand(dhBytes, kemContext);
}

/**
 * HPKE-Auth single-shot seal — same signature as vti-tsp-js's `hpke.seal`.
 * Returns { enc, ciphertext } where ciphertext is `ct ‖ tag(16)`.
 */
export async function seal(plaintext, aad, senderSk, recipientPk, info, ephemeralSk) {
  const { sharedSecret, enc } = authEncap(recipientPk, senderSk, ephemeralSk);
  const { key, baseNonce } = keySchedule(sharedSecret, info);
  // Single-shot: seq = 0, so the nonce is base_nonce unmodified (§5.2).
  const ciphertext = chacha20poly1305(key, baseNonce, aad).encrypt(plaintext);
  return { enc, ciphertext };
}

/**
 * HPKE-Auth single-shot open — same signature as vti-tsp-js's `hpke.open`.
 * Throws if authentication fails (wrong recipient key, wrong claimed sender,
 * or tampered ciphertext).
 */
export async function open(ciphertext, aad, enc, recipientSk, senderPk, info) {
  const sharedSecret = authDecap(enc, recipientSk, senderPk);
  const { key, baseNonce } = keySchedule(sharedSecret, info);
  return chacha20poly1305(key, baseNonce, aad).decrypt(ciphertext);
}
