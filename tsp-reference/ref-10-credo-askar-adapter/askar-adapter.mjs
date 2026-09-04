// A real Askar-backed implementation of ref-09's SigningKey/KeyAgreement
// ports (../ref-09-tsp-core-ports/ports.mjs), against a live @credo-ts/node
// agent. This is "the reference adapter" the parent plan's §4.4 names as
// still open after ref-09: ref-09 proved the port *shape* is right using a
// raw in-memory key and a simulated opaque/async identity; this rung proves
// a real Askar wallet satisfies it.
//
// Two operations, two different routes through Credo, and that split is the
// finding worth recording:
//
//   - SigningKey.sign — Credo's PUBLIC KeyManagementApi already supports
//     `sign`. No bypass needed; documentProof.ts (bifold/packages/trust-tasks)
//     already signs Trust Task documents this exact way in production.
//   - KeyAgreement.agree — Credo's public KeyManagementApi has NO derive/
//     key-exchange operation at all (verified against its .d.ts: create/sign/
//     verify/encrypt/decrypt/import/getPublicKey/delete/randomBytes). The
//     operation exists only on the raw askar-shared `Key` object
//     (`keyFromKeyExchange`), reachable by fetching the key straight out of
//     Askar's own session.
//
// The fetch route is NOT a fork or a private-API reach-around: `Askar
// StoreManager` is exported from `@credo-ts/askar`'s public index and
// registered as a resolvable singleton on the agent's own dependency
// manager (`AskarModule.register`), and its `withSession` method is public
// (not `private` in the class). Credo's own `AskarKeyManagementService`
// gets from an agent context to a session the exact same way:
// `agentContext.dependencyManager.resolve(AskarStoreManager).withSession(...)`
// (verified against `@credo-ts/askar`'s built source). This adapter calls
// the identical public method from outside the module instead of from
// inside it — the "public extension point" the parent plan's §4.3 called
// for, not a bypass.

import { Kms, TypedArrayEncoder } from "@credo-ts/core";
import { AskarStoreManager } from "@credo-ts/askar";
import { Key } from "@openwallet-foundation/askar-shared";

/** @returns {import('../ref-09-tsp-core-ports/ports.mjs').KeyAgreement} */
function keyAgreementForAskarKey(agent, keyId, publicKeyBytes) {
  const storeManager = agent.dependencyManager.resolve(AskarStoreManager);
  return {
    publicKey: publicKeyBytes,
    async agree(peerPublicKey) {
      const sharedSecret = await storeManager.withSession(agent.context, async (session) => {
        const entry = await session.fetchKey({ name: keyId });
        if (!entry) {
          throw new Error(`ref-10: no askar key stored under keyId ${keyId}`);
        }
        const peerKey = Key.fromPublicBytes({ algorithm: "x25519", publicKey: peerPublicKey });
        // `algorithm` here names the OUTPUT key's type, not the curve the DH
        // ran on (that's fixed by the two x25519 keys involved) — Askar's
        // key_from_key_exchange only knows how to package the raw ECDH
        // output as one of its symmetric key types (measured: `x25519` and
        // `ed25519` both fail "Unsupported algorithm for key exchange";
        // `c20p`/`xc20p`/`a256gcm`/`a256kw` all succeed with a 32-byte
        // result). `c20p` is an arbitrary but inert choice — it only
        // controls how `.secretBytes` are boxed on the way out, not the DH
        // math that already ran; any of the working algorithms yields the
        // identical 32 bytes (checked against `a256gcm` below in run.mjs's
        // level 2).
        return entry.key.keyFromKeyExchange({ algorithm: "c20p", publicKey: peerKey }).secretBytes;
      });
      // Same belt-and-braces RFC 9180 check ref-09's raw-key-adapter.mjs
      // applies — worth keeping even though aries-askar's own X25519
      // implementation is expected to already reject low-order points.
      if (sharedSecret.every((b) => b === 0)) {
        throw new Error("keyAgreement: DH produced the all-zero shared secret");
      }
      return sharedSecret;
    },
  };
}

/**
 * Generate a fresh X25519 key inside the agent's Askar wallet (the private
 * key never leaves Askar) and wrap it in the KeyAgreement port shape.
 * @returns {Promise<import('../ref-09-tsp-core-ports/ports.mjs').KeyAgreement>}
 */
export async function createAskarKeyAgreement(agent) {
  const kms = agent.dependencyManager.resolve(Kms.KeyManagementApi);
  const { keyId, publicJwk } = await kms.createKey({ type: { kty: "OKP", crv: "X25519" }, backend: "askar" });
  return keyAgreementForAskarKey(agent, keyId, TypedArrayEncoder.fromBase64(publicJwk.x));
}

/**
 * Import a KNOWN X25519 private key into the agent's Askar wallet, through
 * Credo's public `importKey` — used only to run the official CFRG vectors
 * (which specify fixed keys) through a real Askar-backed adapter; never a
 * production path (a real adapter always calls `createAskarKeyAgreement`
 * so the private key is minted inside Askar and never seen in JS at all).
 * @returns {Promise<import('../ref-09-tsp-core-ports/ports.mjs').KeyAgreement>}
 */
export async function importAskarKeyAgreement(agent, privateKeyBytes, publicKeyBytes) {
  const kms = agent.dependencyManager.resolve(Kms.KeyManagementApi);
  const { keyId } = await kms.importKey({
    privateJwk: {
      kty: "OKP",
      crv: "X25519",
      x: TypedArrayEncoder.toBase64URL(publicKeyBytes),
      d: TypedArrayEncoder.toBase64URL(privateKeyBytes),
    },
  });
  return keyAgreementForAskarKey(agent, keyId, publicKeyBytes);
}

/**
 * Generate a fresh Ed25519 key inside the agent's Askar wallet and wrap it
 * in the SigningKey port shape. Signing rides Credo's PUBLIC KMS API
 * unchanged — see the file header.
 * @returns {Promise<import('../ref-09-tsp-core-ports/ports.mjs').SigningKey>}
 */
export async function createAskarSigningKey(agent) {
  const kms = agent.dependencyManager.resolve(Kms.KeyManagementApi);
  const { keyId, publicJwk } = await kms.createKey({ type: { kty: "OKP", crv: "Ed25519" }, backend: "askar" });
  const publicKeyBytes = TypedArrayEncoder.fromBase64(publicJwk.x);
  return {
    publicKey: publicKeyBytes,
    async sign(message) {
      const { signature } = await kms.sign({ keyId, algorithm: "EdDSA", data: message });
      return new Uint8Array(signature);
    },
  };
}
