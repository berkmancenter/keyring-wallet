// proof.mjs: a W3C Data Integrity proof under `eddsa-jcs-2022`, made and checked.
//
// The signed bytes are two SHA-256 digests side by side: the proof's own options (everything in `proof` but
// `proofValue`) and the document without `proof`, each serialised with RFC 8785. When the document has an
// `@context`, the proof carries the same one, so the options digest covers it. A Trust Task document has none.
//
// Two parties sign this way in agent connect: a VTA, as the persona, over the delegation credential
// (`keys/sign-document`), and the agent, with its own key, over the acceptance. This file checks both, and
// makes the second.

import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import canonicalize from "canonicalize";
import { multibase } from "@openvtc/vti-didcomm-js";

export const CRYPTOSUITE = "eddsa-jcs-2022";

const digest = (value) => sha256(new TextEncoder().encode(canonicalize(value)));

/** The 64 bytes a key signs: the digest of the proof options, then the digest of the document. */
export function proofInput(document, options) {
  const input = new Uint8Array(64);
  input.set(digest(options), 0);
  input.set(digest(document), 32);
  return input;
}

/** `document` with a proof by `edSecret`, named as `verificationMethod`. The document must carry no proof. */
export function secure(document, { verificationMethod, edSecret, proofPurpose = "assertionMethod", created }) {
  if ("proof" in document) throw new Error("the document already carries a proof");
  const options = {
    ...(document["@context"] !== undefined ? { "@context": document["@context"] } : {}),
    type: "DataIntegrityProof",
    cryptosuite: CRYPTOSUITE,
    created,
    verificationMethod,
    proofPurpose,
  };
  const signature = ed25519.sign(proofInput(document, options), edSecret);
  return { ...document, proof: { ...options, proofValue: `z${multibase.base58btcEncode(signature)}` } };
}

/** The Ed25519 key a DID document lists as `verificationMethod`; `undefined` for no such method or a key of another kind. */
export function keyOfMethod(didDocument, verificationMethod) {
  const method = (didDocument?.verificationMethod ?? []).find((vm) => vm.id === verificationMethod);
  if (!method?.publicKeyMultibase) return undefined;
  try {
    const { codec, key } = multibase.decodeMultikey(method.publicKeyMultibase);
    const [a, b] = multibase.MULTICODEC.ED25519_PUB;
    return codec?.[0] === a && codec?.[1] === b && key.length === 32 ? key : undefined;
  } catch {
    return undefined;
  }
}

/** Whether a DID document lists `verificationMethod` under `relationship` (by reference or embedded). */
export const listedUnder = (didDocument, relationship, verificationMethod) =>
  (didDocument?.[relationship] ?? []).some((entry) => (typeof entry === "string" ? entry : entry?.id) === verificationMethod);

/**
 * Whether `secured.proof` is a valid `eddsa-jcs-2022` proof by `publicKey` over the rest of `secured`.
 * A proof that names a context must name the document's own, and a proof of any other suite is refused.
 */
export function verify(secured, publicKey) {
  const proof = secured?.proof;
  if (!proof || Array.isArray(proof) || proof.type !== "DataIntegrityProof" || proof.cryptosuite !== CRYPTOSUITE) return false;
  if (typeof proof.proofValue !== "string" || !proof.proofValue.startsWith("z")) return false;
  const { proof: _proof, ...document } = secured;
  if ("@context" in proof && canonicalize(proof["@context"]) !== canonicalize(document["@context"])) return false;
  const { proofValue, ...options } = proof;
  try {
    return ed25519.verify(multibase.base58btcDecode(proofValue.slice(1)), proofInput(document, options), publicKey);
  } catch {
    return false;
  }
}
