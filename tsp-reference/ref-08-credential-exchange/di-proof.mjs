/**
 * eddsa-jcs-2022 Data-Integrity proof helpers, shared across the ref-08
 * scripts — extracted from run.mjs so run-pending.mjs doesn't duplicate the
 * signing algorithm. Mirrors @bifold/trust-tasks/src/documentProof.ts
 * exactly (same JCS-canonicalize, same proof-config-hash || document-hash
 * construction, same proofValue encoding) — Keyring's own signer is this
 * proof, just against a different counterparty.
 *
 * `signDocument` is generic over any JSON object, not just Trust Task
 * envelopes — it's used both to sign Trust Task documents (run.mjs) and to
 * sign a bare W3C VC (run-pending.mjs, minting a credential to receive).
 */
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import canonicalize from "canonicalize";

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58encode(bytes) {
  let digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let leadingZeros = 0;
  for (const b of bytes) {
    if (b === 0) leadingZeros++;
    else break;
  }
  return "1".repeat(leadingZeros) + digits.reverse().map((d) => B58[d]).join("");
}

export function hexToBytes(hex) {
  return new Uint8Array(hex.match(/.{2}/g).map((b) => parseInt(b, 16)));
}
export function bytesToHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * A did:key:z... holder identity — multicodec 0xed01 (ed25519-pub). Reuses
 * `secretKeyHex` if set, so the same DID persists across runs — needed to
 * grant it an ACL role once (`vta import-did`) and reuse it, instead of
 * every run minting an unknown DID the VTA has never seen.
 */
export function generateDidKeyHolder(secretKeyHex) {
  const privateKey = secretKeyHex ? hexToBytes(secretKeyHex) : ed25519.utils.randomSecretKey();
  const publicKey = ed25519.getPublicKey(privateKey);
  const prefixed = new Uint8Array([0xed, 0x01, ...publicKey]);
  const did = "did:key:z" + base58encode(prefixed);
  return {
    did,
    privateKey,
    secretKeyHex: bytesToHex(privateKey),
    verificationMethod: `${did}#${did.slice("did:key:".length)}`,
  };
}

/**
 * Sign any JSON document with eddsa-jcs-2022: sha256(JCS(proof config)) ||
 * sha256(JCS(document without proof)), ed25519-signed, multibase(base58btc).
 * Returns `{...doc, proof}` — works equally for a Trust Task envelope
 * (`{id,type,payload,issuer,recipient,issuedAt}`) or a bare W3C VC.
 */
export function signDocument(doc, holder) {
  const proofConfig = {
    type: "DataIntegrityProof",
    cryptosuite: "eddsa-jcs-2022",
    created: new Date().toISOString(),
    verificationMethod: holder.verificationMethod,
    proofPurpose: "assertionMethod",
  };
  const configHash = sha256(new TextEncoder().encode(canonicalize(proofConfig)));
  const documentHash = sha256(new TextEncoder().encode(canonicalize(doc)));
  const signedInput = new Uint8Array(configHash.length + documentHash.length);
  signedInput.set(configHash, 0);
  signedInput.set(documentHash, configHash.length);
  const signature = ed25519.sign(signedInput, holder.privateKey);
  return { ...doc, proof: { ...proofConfig, proofValue: "z" + base58encode(signature) } };
}
