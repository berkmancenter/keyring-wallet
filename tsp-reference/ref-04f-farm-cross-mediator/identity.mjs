// identity.mjs — a TSP/DIDComm identity from one Ed25519 seed.
//
// The same derivation the browser wallet uses (packages/core/src/vta/
// tsp-channel.ts `tspHolderIdentityFromSecret`): one Ed25519 secret gives
//   • the signing pair (TSP's outer seal, DIDComm's authentication VM)
//   • an X25519 pair derived from it (TSP's HPKE keys, DIDComm keyAgreement)
//   • a self-resolving `did:key` identifier — no publishing, no network
//
// The mediator resolves did:key locally too, so two Node processes can find
// each other's keys with zero infrastructure beyond the mediator itself.

import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { multibase, didKey } from "@openvtc/vti-didcomm-js";

const mintSeed = () => (ed25519.utils.randomSecretKey ?? ed25519.utils.randomPrivateKey)();

/** Build a full identity (DIDComm + TSP) from an Ed25519 seed. */
export function identityFromSeed(edSecret) {
  const edPublic = ed25519.getPublicKey(edSecret);
  const xSecret = ed25519.utils.toMontgomerySecret(edSecret);
  const xPublic = x25519.getPublicKey(xSecret);
  const did = `did:key:${multibase.encodeMultikey(multibase.MULTICODEC.ED25519_PUB, edPublic)}`;

  // The DIDComm kid the mediator expects: `${did}#${x25519 multikey}` — the
  // did:key resolver derives exactly this keyAgreement VM.
  const { kid } = resolveVerification(did);

  return { did, kid, edSecret, edPublic, xSecret, xPublic };
}

export const mintIdentity = () => identityFromSeed(mintSeed());

/** Resolve a did:key locally → its signing key, agreement key, and kid. */
function resolveVerification(did) {
  const doc = didKey.resolve(did).didDocument;
  const agreementId = doc.keyAgreement?.[0]?.id ?? doc.keyAgreement?.[0];
  const methods = doc.verificationMethod ?? [];
  const agreement = methods.find((vm) => vm.id === agreementId);
  const signing = methods.find((vm) => vm.id !== agreementId);
  if (!signing || !agreement) throw new Error(`cannot derive keys from ${did}`);
  return {
    kid: agreementId,
    signPub: multibase.decodeMultikey(signing.publicKeyMultibase).key,
    encPub: multibase.decodeMultikey(agreement.publicKeyMultibase).key,
  };
}

/** Public TSP keys for a peer DID — resolved offline, no network. */
export function tspKeysForDid(did) {
  const { signPub, encPub } = resolveVerification(did);
  return { signPub, encPub };
}
