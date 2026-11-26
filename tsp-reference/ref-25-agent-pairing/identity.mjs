// identity.mjs: a DIDComm identity from one Ed25519 seed.
//
// One seed gives the signing pair (a Trust Task's document proof), an X25519
// pair derived from it (authcrypt key agreement) and a self-resolving
// `did:key`. That is the shape both parties of the agent pairing have: the
// agent's key and the phone's chat key are plain `did:key`s with no service
// (agent-connect-plan.md section 2.4).

import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { didKey, didPeer, jwk, multibase } from "@openvtc/vti-didcomm-js";

const mintSeed = () => ed25519.utils.randomSecretKey();

/** The key-agreement method of a DID document: `{ kid, publicKey }`. */
function agreementOf(document, did) {
  const entry = document.keyAgreement?.[0];
  const kid = typeof entry === "string" ? entry : entry?.id;
  const method =
    typeof entry === "object" && entry.publicKeyMultibase
      ? entry
      : (document.verificationMethod ?? []).find((vm) => vm.id === kid);
  if (!kid || !method?.publicKeyMultibase) throw new Error(`no key agreement key in ${did}`);
  return { kid, publicKey: multibase.decodeMultikey(method.publicKeyMultibase).key };
}

/** What `pack` needs to address a DID: `{ kid, publicJwk }`. Resolves `did:key` and `did:peer:2` offline. */
export function recipientOf(did) {
  const resolved = did.startsWith("did:peer:") ? didPeer.resolve(did) : didKey.resolve(did);
  const { kid, publicKey } = agreementOf(resolved.didDocument, did);
  return { kid, publicJwk: jwk.publicJwk("X25519", publicKey, kid) };
}

/** A full identity from an Ed25519 seed. */
export function identityFromSeed(edSecret) {
  const edPublic = ed25519.getPublicKey(edSecret);
  const xSecret = ed25519.utils.toMontgomerySecret(edSecret);
  const xPublic = x25519.getPublicKey(xSecret);
  const edMultikey = multibase.encodeMultikey(multibase.MULTICODEC.ED25519_PUB, edPublic);
  const did = `did:key:${edMultikey}`;
  const { kid } = recipientOf(did);
  return {
    did,
    kid,
    /** The verification method a document proof names (the Ed25519 key). */
    authVm: `${did}#${edMultikey}`,
    edSecret,
    edPublic,
    xSecret,
    xPublic,
    sender: { kid, privateJwk: jwk.privateJwk("X25519", xSecret, xPublic, kid) },
  };
}

export const mintIdentity = () => identityFromSeed(mintSeed());

/**
 * The same keys as a `did:peer:2` that names a DIDComm service. Section 2.4
 * measures two of these: one whose service is the mediator under test, and
 * one whose service is another host.
 */
export function peerIdentity(identity, serviceUri) {
  const enc = multibase.encodeMultikey(multibase.MULTICODEC.X25519_PUB, identity.xPublic);
  const sig = multibase.encodeMultikey(multibase.MULTICODEC.ED25519_PUB, identity.edPublic);
  const service = { t: "dm", s: { uri: serviceUri, a: ["didcomm/v2"] } };
  const encoded = Buffer.from(JSON.stringify(service)).toString("base64url");
  const did = `did:peer:2.E${enc}.V${sig}.S${encoded}`;
  const { kid } = recipientOf(did);
  return {
    ...identity,
    did,
    kid,
    sender: { kid, privateJwk: jwk.privateJwk("X25519", identity.xSecret, identity.xPublic, kid) },
  };
}
