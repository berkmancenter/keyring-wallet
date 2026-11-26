// A TSP/DIDComm identity from one Ed25519 seed, as tsp-reference/ref-04-mediator/identity.mjs
// derives it: the signing pair, the X25519 pair derived from it, and a self-resolving did:key.
import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { multibase, didKey } from "@openvtc/vti-didcomm-js";

export interface Identity {
  name: string;
  did: string;
  kid: string;
  edSecret: Uint8Array;
  edPublic: Uint8Array;
  xSecret: Uint8Array;
  xPublic: Uint8Array;
}

function resolveVerification(did: string) {
  const doc = didKey.resolve(did).didDocument as any;
  const agreementId = doc.keyAgreement?.[0]?.id ?? doc.keyAgreement?.[0];
  const methods = doc.verificationMethod ?? [];
  const agreement = methods.find((vm: any) => vm.id === agreementId);
  const signing = methods.find((vm: any) => vm.id !== agreementId);
  if (!signing || !agreement) throw new Error(`cannot derive keys from ${did}`);
  return {
    kid: agreementId as string,
    signingId: signing.id as string,
    signPub: multibase.decodeMultikey(signing.publicKeyMultibase).key as Uint8Array,
    encPub: multibase.decodeMultikey(agreement.publicKeyMultibase).key as Uint8Array,
  };
}

/** A throwaway identity for this run. Never reused, never a real persona. */
export function mintIdentity(name: string): Identity {
  const edSecret = ed25519.utils.randomSecretKey();
  const edPublic = ed25519.getPublicKey(edSecret);
  const xSecret = ed25519.utils.toMontgomerySecret(edSecret);
  const xPublic = x25519.getPublicKey(xSecret);
  const did = `did:key:${multibase.encodeMultikey(multibase.MULTICODEC.ED25519_PUB, edPublic)}`;
  return { name, did, kid: resolveVerification(did).kid, edSecret, edPublic, xSecret, xPublic };
}

/** A peer's public TSP keys, resolved offline from its did:key. */
export function publicKeys(did: string): { signPub: Uint8Array; encPub: Uint8Array; signingId: string } {
  const { signPub, encPub, signingId } = resolveVerification(did);
  return { signPub, encPub, signingId };
}
