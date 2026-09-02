// A deliberate, documented DUPLICATE of ref-10's askar-adapter.mjs
// (createAskarSigningKey/createAskarKeyAgreement) and ref-11's
// credo-adapter.mjs (createCredoVidResolver) — not a stylistic choice.
//
// ref-11's README documents the reason: Node resolves a bare specifier
// relative to the IMPORTING FILE's own directory, not the entry script's. A
// file physically living in ref-10/ref-11's directory tree resolves
// `@credo-ts/core` against THEIR OWN `node_modules`, a different object
// identity than the copy this rung's own `Agent` is built from even at the
// identical version — and `tsyringe`'s DI container keys its metadata off
// the exact class reference, so a borrowed file's
// `agent.dependencyManager.resolve(...)` throws `TypeInfo not known for
// "<Class>"` against an agent built from a different copy. Measured in
// ref-11, not assumed. The fix, here as there: keep every Credo-DI-backed
// file inside the rung whose `node_modules` its `Agent` is built from.
//
// This file changes nothing about the crypto or the resolution logic ref-10/
// ref-11 already proved correct — see those rungs for the rationale (the
// public-KMS-vs-AskarStoreManager split, the algorithm-tag inertness finding,
// the assertionMethod/keyAgreement extraction order).

import { Kms, TypedArrayEncoder, getPublicJwkFromVerificationMethod } from "@credo-ts/core";
import { AskarStoreManager } from "@credo-ts/askar";
import { Key } from "@openwallet-foundation/askar-shared";
import { convertPublicKeyToX25519 } from "@stablelib/ed25519";

/**
 * A KeyAgreement port DERIVED from an existing Ed25519 Askar key via Askar's
 * own `Key.convertkey({algorithm: "x25519"})` — the same standard Edwards→
 * Montgomery birational map `did:key`'s document builder applies to the
 * PUBLIC key (`@stablelib/ed25519`'s `convertPublicKeyToX25519`, see
 * ref-11), performed here on the PRIVATE side without the private key ever
 * leaving Askar. This is deliberate, not the simpler "mint an independent
 * X25519 key" shape ref-10 used: `did:key`'s resolved `keyAgreement` verification
 * method is ALWAYS this exact derivation from the identity's Ed25519 key
 * (`keyDidDocument.mjs`'s `getEd25519DidDoc`), so a real `VidResolver`
 * resolving this identity's own did:key must see the SAME key this port
 * uses — an independently-generated X25519 key would resolve to the wrong
 * bytes and every seal would silently target a key this identity cannot
 * open with (measured: this was the first version tried here, and it
 * produced exactly that "invalid tag" failure).
 * @returns {import('../ref-09-tsp-core-ports/ports.mjs').KeyAgreement}
 */
function keyAgreementFromEd25519AskarKey(agent, signingKeyId, ed25519PublicKeyBytes) {
  const storeManager = agent.dependencyManager.resolve(AskarStoreManager);
  const convertedPublicKey = convertPublicKeyToX25519(ed25519PublicKeyBytes);
  return {
    publicKey: convertedPublicKey,
    async agree(peerPublicKey) {
      const sharedSecret = await storeManager.withSession(agent.context, async (session) => {
        const entry = await session.fetchKey({ name: signingKeyId });
        if (!entry) throw new Error(`ref-12: no askar key stored under keyId ${signingKeyId}`);
        const x25519Key = entry.key.convertkey({ algorithm: "x25519" });
        const peerKey = Key.fromPublicBytes({ algorithm: "x25519", publicKey: peerPublicKey });
        return x25519Key.keyFromKeyExchange({ algorithm: "c20p", publicKey: peerKey }).secretBytes;
      });
      if (sharedSecret.every((b) => b === 0)) {
        throw new Error("keyAgreement: DH produced the all-zero shared secret");
      }
      return sharedSecret;
    },
  };
}

/**
 * Generate a fresh Askar-backed identity — a single Ed25519 key, minted
 * inside Askar (the private key never leaves it) — expose it as BOTH a
 * `SigningKey` port and, via Askar's own key conversion, a `KeyAgreement`
 * port, and register a did:key DID for it so the identity has a resolvable
 * VID whose keyAgreement entry matches.
 * @param {import('@credo-ts/core').Agent} agent
 * @returns {Promise<{ vid: string, signingKey: import('../ref-09-tsp-core-ports/ports.mjs').SigningKey, keyAgreement: import('../ref-09-tsp-core-ports/ports.mjs').KeyAgreement }>}
 */
export async function createAskarIdentity(agent) {
  const kms = agent.dependencyManager.resolve(Kms.KeyManagementApi);

  const signing = await kms.createKey({ type: { kty: "OKP", crv: "Ed25519" }, backend: "askar" });
  const signingPublicKey = TypedArrayEncoder.fromBase64(signing.publicJwk.x);
  const signingKey = {
    publicKey: signingPublicKey,
    async sign(message) {
      const { signature } = await kms.sign({ keyId: signing.keyId, algorithm: "EdDSA", data: message });
      return new Uint8Array(signature);
    },
  };

  const keyAgreement = keyAgreementFromEd25519AskarKey(agent, signing.keyId, signingPublicKey);

  const created = await agent.dids.create({ method: "key", options: { keyId: signing.keyId } });
  if (created.didState.state !== "finished") {
    throw new Error(`ref-12: did:key creation failed: ${created.didState.reason ?? "unknown"}`);
  }

  return { vid: created.didState.did, signingKey, keyAgreement };
}

/**
 * A real Credo-backed VidResolver — see ref-11-vidresolver-port/credo-adapter.mjs
 * for the authoritative version and its own four-level proof; this is an
 * unchanged copy for the DI-identity reason above.
 * @param {import('@credo-ts/core').Agent} agent
 * @returns {import('../ref-11-vidresolver-port/ports.mjs').VidResolver}
 */
export function createCredoVidResolver(agent) {
  const firstEmbedded = (arr) => (arr ?? []).find((entry) => typeof entry === "object" && entry !== null);
  return {
    async resolve(vid) {
      const didDocument = await agent.dids.resolveDidDocument(vid);
      const signingVm =
        firstEmbedded(didDocument.assertionMethod) ??
        firstEmbedded(didDocument.authentication) ??
        firstEmbedded(didDocument.verificationMethod);
      if (!signingVm) throw new Error(`ref-12: no signing verification method resolvable on ${vid}`);
      const keyAgreementVm = firstEmbedded(didDocument.keyAgreement);
      if (!keyAgreementVm) throw new Error(`ref-12: no keyAgreement verification method resolvable on ${vid}`);
      return {
        signingPublicKey: getPublicJwkFromVerificationMethod(signingVm).publicKey.publicKey,
        encryptionPublicKey: getPublicJwkFromVerificationMethod(keyAgreementVm).publicKey.publicKey,
      };
    },
  };
}
