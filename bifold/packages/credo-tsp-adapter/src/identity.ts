/**
 * Askar-backed implementations of tsp-core's SigningKey/KeyAgreement ports
 * (`@bifold/trust-tasks`'s `tsp` module) — real production code following
 * the approach `tsp-reference/ref-10` through `ref-12` proved.
 *
 * Includes a real mistake `ref-12` caught and fixed, worth restating here
 * since it is the load-bearing design decision of this file:
 * **`KeyAgreement` must be derived from the SAME Ed25519 identity key a
 * VID's DID document names, via Askar's own `Key.convertkey({algorithm:
 * "x25519"})`** — the private-key-side analogue of the standard
 * Edwards→Montgomery conversion `did:key`/`did:peer` DID documents already
 * apply to the public key. An independently-generated X25519 key satisfies
 * `KeyAgreement` in isolation but resolves to the WRONG public key once a
 * real `VidResolver` is in the loop, since the DID document's own
 * `keyAgreement` verification method is always the derived key, never an
 * independent one (`ref-12`'s README has the full postmortem — this failed
 * with an AEAD `invalid tag` error, not a type error, so it is easy to get
 * wrong silently).
 *
 * @module credo-tsp-adapter/identity
 */
import { Kms, TypedArrayEncoder, type Agent } from '@credo-ts/core'
import { AskarStoreManager } from '@credo-ts/askar'
import { Key, KeyAlgorithm } from '@openwallet-foundation/askar-shared'
import { convertPublicKeyToX25519 } from '@stablelib/ed25519'
import { tsp } from '@bifold/trust-tasks'

/**
 * Derive a `KeyAgreement` port from an EXISTING Ed25519 Askar key — never an
 * independent key (see module header). `signingKeyId` is the Credo KMS key
 * id backing the identity's signing key (e.g. a relationship DID's owning
 * key); the private key never leaves Askar.
 */
export function keyAgreementFromEd25519Key(agent: Agent, signingKeyId: string, ed25519PublicKeyBytes: Uint8Array): tsp.KeyAgreement {
  const storeManager = agent.dependencyManager.resolve(AskarStoreManager)
  const publicKey = convertPublicKeyToX25519(ed25519PublicKeyBytes)
  return {
    publicKey,
    async agree(peerPublicKey) {
      const sharedSecret = await storeManager.withSession(agent.context, async (session) => {
        const entry = await session.fetchKey({ name: signingKeyId })
        if (!entry) throw new Error(`credo-tsp-adapter: no askar key stored under keyId ${signingKeyId}`)
        const x25519Key = entry.key.convertkey({ algorithm: KeyAlgorithm.X25519 })
        const peerKey = Key.fromPublicBytes({ algorithm: KeyAlgorithm.X25519, publicKey: peerPublicKey })
        return x25519Key.keyFromKeyExchange({ algorithm: KeyAlgorithm.Chacha20C20P, publicKey: peerKey }).secretBytes
      })
      if (sharedSecret.every((b: number) => b === 0)) {
        throw new Error('keyAgreement: DH produced the all-zero shared secret')
      }
      return sharedSecret
    },
  }
}

/** Wrap an existing Ed25519 Askar key (by its KMS key id) as a `SigningKey` port. */
export function signingKeyFromEd25519Key(agent: Agent, signingKeyId: string, publicKey: Uint8Array): tsp.SigningKey {
  const kms = agent.dependencyManager.resolve(Kms.KeyManagementApi)
  return {
    publicKey,
    async sign(message) {
      const { signature } = await kms.sign({ keyId: signingKeyId, algorithm: 'EdDSA', data: message })
      return new Uint8Array(signature)
    },
  }
}

/**
 * The pair of local ports (`SigningKey` + derived `KeyAgreement`) for an
 * existing Ed25519 identity key, given its Credo KMS key id and public key —
 * the shape most Keyring callers need: an existing relationship DID's
 * owning key, not a freshly minted one.
 */
export function identityFromEd25519Key(agent: Agent, signingKeyId: string, publicKey: Uint8Array): tsp.TspIdentity {
  return {
    signingKey: signingKeyFromEd25519Key(agent, signingKeyId, publicKey),
    keyAgreement: keyAgreementFromEd25519Key(agent, signingKeyId, publicKey),
  }
}

/**
 * Convenience for tests/examples: mint a fresh Ed25519 key inside Askar and
 * register a did:key DID for it, returning both the identity's ports and its
 * VID. Production callers with an existing relationship DID should use
 * {@link identityFromEd25519Key} against that DID's own key instead of
 * minting a new one.
 */
export async function createAskarIdentity(agent: Agent): Promise<{ vid: string } & tsp.TspIdentity> {
  const kms = agent.dependencyManager.resolve(Kms.KeyManagementApi)
  const { keyId, publicJwk } = await kms.createKey({ type: { kty: 'OKP', crv: 'Ed25519' }, backend: 'askar' })
  if (!publicJwk.x) throw new Error('credo-tsp-adapter: created key has no public x coordinate')
  const publicKey = TypedArrayEncoder.fromBase64(publicJwk.x)

  const created = await agent.dids.create({ method: 'key', options: { keyId } })
  if (created.didState.state !== 'finished' || !created.didState.did) {
    throw new Error(`credo-tsp-adapter: did:key creation failed: ${JSON.stringify(created.didState)}`)
  }

  return { vid: created.didState.did, ...identityFromEd25519Key(agent, keyId, publicKey) }
}
