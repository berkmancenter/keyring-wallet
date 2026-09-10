// HPKE-Auth (RFC 9180) + the outer Ed25519 signature, built on the
// SigningKey/KeyAgreement ports (ports.mjs) instead of raw private keys —
// the pluggable twin of ../ref-03-noble-crypto/hpke-noble.mjs (which is in
// turn the pure-@noble twin of vti-tsp-js's crypto/{hpke,sign}.ts).
//
// Every primitive below (LabeledExtract/LabeledExpand, AuthEncap/AuthDecap,
// KeySchedule) is copied unchanged from hpke-noble.mjs. The only change is
// WHERE the sender's/recipient's static private key is used:
// hpke-noble.mjs computes `dh(staticSk, peerPk)` directly; this file asks
// the KeyAgreement port to do it (`keyAgreement.agree(peerPk)`) — the one
// call an Askar-backed implementation would satisfy via
// `Key.fromKeyExchange` without ever exporting the private key. Everything
// downstream (kemContext, extractAndExpand, the key schedule, the AEAD) is
// pure symmetric crypto over public inputs — it does not care where the DH
// result came from, and needed no change at all.
//
// The ephemeral key (`skE`/`enc`) is never custody-sensitive — it's minted
// fresh per message and thrown away — so it stays a plain local variable
// here exactly as in hpke-noble.mjs, never routed through a port.
//
// Verified byte-identical to hpke-noble.mjs for the raw-key case in run.mjs
// (same static keys in, same enc/ciphertext out): this is a refactor of an
// already RFC-9180-vector-verified implementation, not a new one.

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
export const TAG_LEN = 16;
export const ENC_LEN = 32;

const HPKE_V1 = new TextEncoder().encode("HPKE-v1");
const EMPTY = new Uint8Array(0);

const cat = (...arrays) => {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) {
    out.set(a, off);
    off += a.length;
  }
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
  };
}

// The ephemeral half of AuthEncap/AuthDecap's DH — never custody-sensitive,
// so it stays a direct noble call, same zero-output check as hpke-noble.mjs.
function dh(sk, pk) {
  const shared = x25519.getSharedSecret(sk, pk);
  if (shared.every((b) => b === 0)) throw new Error("hpke: DH produced the all-zero shared secret");
  return shared;
}

/**
 * §5.1.4 AuthEncap, ported to the KeyAgreement port. The ephemeral half of
 * the DH is always minted here in plain JS; the static half goes through
 * `senderKeyAgreement.agree(...)`.
 * @param {Uint8Array} recipientPk
 * @param {import('./ports.mjs').KeyAgreement} senderKeyAgreement
 * @param {Uint8Array} [ephemeralSk] - fixed only for RFC 9180 test vectors;
 *   production callers omit it and get a fresh key.
 */
export async function authEncap(recipientPk, senderKeyAgreement, ephemeralSk) {
  const skE = ephemeralSk ?? (x25519.utils.randomSecretKey ?? x25519.utils.randomPrivateKey)();
  const enc = x25519.getPublicKey(skE);
  const staticDh = await senderKeyAgreement.agree(recipientPk);
  const dhBytes = cat(dh(skE, recipientPk), staticDh);
  const kemContext = cat(enc, recipientPk, senderKeyAgreement.publicKey);
  return { sharedSecret: extractAndExpand(dhBytes, kemContext), enc };
}

/**
 * §5.1.4 AuthDecap, ported to the KeyAgreement port. Both DH terms are the
 * recipient's static key against a different peer public key each time, so
 * both go through the port — there is no non-custodial half on this side.
 * @param {Uint8Array} enc
 * @param {import('./ports.mjs').KeyAgreement} recipientKeyAgreement
 * @param {Uint8Array} senderPk
 */
export async function authDecap(enc, recipientKeyAgreement, senderPk) {
  const dhWithEnc = await recipientKeyAgreement.agree(enc);
  const dhWithSender = await recipientKeyAgreement.agree(senderPk);
  const kemContext = cat(enc, recipientKeyAgreement.publicKey, senderPk);
  return extractAndExpand(cat(dhWithEnc, dhWithSender), kemContext);
}

/**
 * HPKE-Auth single-shot seal, port-shaped — same signature as
 * hpke-noble.mjs's `seal`, minus the raw sender key.
 * @param {import('./ports.mjs').KeyAgreement} senderKeyAgreement
 */
export async function seal(plaintext, aad, senderKeyAgreement, recipientPk, info, ephemeralSk) {
  const { sharedSecret, enc } = await authEncap(recipientPk, senderKeyAgreement, ephemeralSk);
  const { key, baseNonce } = keySchedule(sharedSecret, info);
  // Single-shot: seq = 0, so the nonce is base_nonce unmodified (§5.2).
  const ciphertext = chacha20poly1305(key, baseNonce, aad).encrypt(plaintext);
  return { enc, ciphertext };
}

/**
 * HPKE-Auth single-shot open, port-shaped.
 * @param {import('./ports.mjs').KeyAgreement} recipientKeyAgreement
 */
export async function open(ciphertext, aad, enc, recipientKeyAgreement, senderPk, info) {
  const sharedSecret = await authDecap(enc, recipientKeyAgreement, senderPk);
  const { key, baseNonce } = keySchedule(sharedSecret, info);
  return chacha20poly1305(key, baseNonce, aad).decrypt(ciphertext);
}

/**
 * The outer Ed25519 signature, port-shaped — a straight passthrough. There's
 * no DH-style custody problem here: Askar's `signMessage` already returns
 * just the signature, never the key, so no protocol-level porting is needed
 * beyond the interface itself.
 * @param {Uint8Array} data
 * @param {import('./ports.mjs').SigningKey} signingKey
 */
export async function sign(data, signingKey) {
  return signingKey.sign(data);
}
