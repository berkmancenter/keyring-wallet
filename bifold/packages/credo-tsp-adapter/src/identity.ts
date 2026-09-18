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
 * **That rule is true of v1 peer DIDs and `did:key`, not of every DID.** A
 * DIDComm v2 connection DID minted by Credo (`did:peer:2`, credo-ts PR #2704)
 * publishes a SEPARATELY generated X25519 key as `keyAgreement` (`#key-2`,
 * its own KMS key). The general rule, which covers both, is the one
 * `identityFromDid` applies: key agreement uses the private key behind the
 * DID document's `keyAgreement` method — converting it only when that key is
 * Ed25519 — so our public key always equals what a `VidResolver` resolves.
 * `tsp-reference/ref-19` measured the v2 case (didcomm_v2_subtask.md V2T).
 *
 * @module credo-tsp-adapter/identity
 */
import {
  getPublicJwkFromVerificationMethod,
  Kms,
  TypedArrayEncoder,
  type Agent,
  type VerificationMethod,
} from '@credo-ts/core'
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
export function keyAgreementFromEd25519Key(
  agent: Agent,
  signingKeyId: string,
  ed25519PublicKeyBytes: Uint8Array
): tsp.KeyAgreement {
  const storeManager = agent.dependencyManager.resolve(AskarStoreManager)
  const publicKey = convertPublicKeyToX25519(ed25519PublicKeyBytes)
  return {
    publicKey,
    async agree(peerPublicKey) {
      const sharedSecret = await storeManager.withSession(agent.context, async (session) => {
        const entry = await session.fetchKey({ name: signingKeyId })
        if (!entry) throw new Error(`credo-tsp-adapter: no askar key stored under keyId ${signingKeyId}`)
        const x25519Key = entry.key.convertkey({ algorithm: KeyAlgorithm.X25519 })
        // Askar's native binding needs a standalone 32-byte buffer: a `Buffer`
        // view sliced from a larger message (`Buffer.prototype.slice` — unlike
        // `Uint8Array.prototype.slice` — returns a view over the ORIGINAL
        // backing ArrayBuffer, not a copy) crosses the JSI boundary as that
        // whole larger buffer and gets rejected as "Invalid key data". Force
        // a real copy regardless of what the caller handed us.
        const peerKey = Key.fromPublicBytes({
          algorithm: KeyAlgorithm.X25519,
          publicKey: Uint8Array.from(peerPublicKey),
        })
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
/**
 * A `KeyAgreement` port from the Askar key named `kmsKeyId`, whatever its
 * type: an X25519 key is used as-is (DIDComm v2's independent key agreement
 * key); an Ed25519 key is converted, exactly as `keyAgreementFromEd25519Key`
 * does. `publicKey` is the X25519 public key the DID document publishes.
 */
export function keyAgreementFromAskarKey(agent: Agent, kmsKeyId: string, publicKey: Uint8Array): tsp.KeyAgreement {
  const storeManager = agent.dependencyManager.resolve(AskarStoreManager)
  return {
    publicKey,
    async agree(peerPublicKey) {
      const sharedSecret = await storeManager.withSession(agent.context, async (session) => {
        const entry = await session.fetchKey({ name: kmsKeyId })
        if (!entry) throw new Error(`credo-tsp-adapter: no askar key stored under keyId ${kmsKeyId}`)
        const x25519Key =
          entry.key.algorithm === KeyAlgorithm.X25519
            ? entry.key
            : entry.key.convertkey({ algorithm: KeyAlgorithm.X25519 })
        const peerKey = Key.fromPublicBytes({
          algorithm: KeyAlgorithm.X25519,
          publicKey: Uint8Array.from(peerPublicKey),
        })
        return x25519Key.keyFromKeyExchange({ algorithm: KeyAlgorithm.Chacha20C20P, publicKey: peerKey }).secretBytes
      })
      if (sharedSecret.every((b: number) => b === 0)) {
        throw new Error('keyAgreement: DH produced the all-zero shared secret')
      }
      return sharedSecret
    },
  }
}

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

/** Same embedded-verification-method fallback order as `@bifold/trust-tasks`'s
 *  `documentProof.ts` (`firstSigningVerificationMethod`) and this package's
 *  own `vidResolver.ts`: did:peer:0 documents list a signing key under
 *  `verificationMethod`; did:peer:4 documents (Credo's connection DIDs) embed
 *  it in `authentication`/`assertionMethod` instead. */
function firstSigningVerificationMethod(didDocument: {
  verificationMethod?: VerificationMethod[]
  authentication?: Array<string | VerificationMethod>
  assertionMethod?: Array<string | VerificationMethod>
}): VerificationMethod | undefined {
  const embedded = (arr?: Array<string | VerificationMethod>) =>
    (arr ?? []).find((entry): entry is VerificationMethod => typeof entry === 'object' && entry !== null)
  return (
    embedded(didDocument.verificationMethod) ??
    embedded(didDocument.assertionMethod) ??
    embedded(didDocument.authentication)
  )
}

/**
 * The `TspIdentity` for one of the WALLET'S OWN existing DIDs — e.g. a
 * DIDComm connection's own DID — reusing that DID's already-existing
 * signing key rather than minting a new one. This is the shape a
 * `Carriage` implementation needs: derive TSP identity from the same
 * relationship the DIDComm connection already represents, with no separate
 * pairing/bootstrap step. Same KMS key id lookup
 * `@bifold/trust-tasks`'s `documentProof.ts`'s `signDocumentProof` uses (the
 * key id is not derivable from the JWK alone; it lives in the DidRecord's
 * key mapping, with the pre-0.6 fingerprint id as fallback).
 */
export async function identityFromDid(agent: Agent, did: string): Promise<tsp.TspIdentity> {
  const didDocument = await agent.dids.resolveDidDocument(did)
  const verificationMethod = firstSigningVerificationMethod(didDocument)
  if (!verificationMethod) {
    throw new Error(`credo-tsp-adapter: no signing verification method on ${did}`)
  }

  const publicJwk = getPublicJwkFromVerificationMethod(verificationMethod)
  const relativeKeyId = verificationMethod.id.startsWith(did)
    ? verificationMethod.id.slice(did.length)
    : verificationMethod.id
  const [didRecord] = await agent.dids.getCreatedDids({ did })
  const keyId =
    didRecord?.keys?.find(({ didDocumentRelativeKeyId }) => didDocumentRelativeKeyId === relativeKeyId)?.kmsKeyId ??
    publicJwk.legacyKeyId
  if (!keyId) {
    throw new Error(`credo-tsp-adapter: no KMS key id resolvable for ${did}`)
  }

  const publicKey = (publicJwk.publicKey as { publicKey: Uint8Array }).publicKey

  // Key agreement follows the DID document's own keyAgreement method when we
  // hold its private key (DIDComm v2's did:peer:2 publishes an independent
  // X25519 key there); otherwise it is derived from the signing key (v1 peer
  // DIDs, did:key), which is what those documents publish anyway.
  const keyAgreementVm = firstKeyAgreementVerificationMethod(didDocument)
  if (keyAgreementVm) {
    const agreementRelativeId = keyAgreementVm.id.startsWith(did) ? keyAgreementVm.id.slice(did.length) : keyAgreementVm.id
    const agreementJwk = getPublicJwkFromVerificationMethod(keyAgreementVm)
    // Unlike the signing-key lookup above, there is no legacy fallback here:
    // only did:peer:2 (DIDComm v2) registers a SEPARATE Askar key for its
    // keyAgreement verification method. did:key / did:peer:0 publish a
    // DERIVED X25519 key at this method (Edwards→Montgomery of the signing
    // key) with no independent storage at all — Askar never stored anything
    // under a "legacy" name for it, so treating agreementJwk.legacyKeyId as
    // a real key id made `.agree()` throw at use time instead of falling
    // through to the Ed25519-derivation path below, which is what these DID
    // types actually need.
    const agreementKeyId = didRecord?.keys?.find(
      ({ didDocumentRelativeKeyId }) => didDocumentRelativeKeyId === agreementRelativeId
    )?.kmsKeyId
    const agreementPublicKey = (agreementJwk.publicKey as { publicKey: Uint8Array }).publicKey
    if (agreementKeyId && agreementJwk.is(Kms.X25519PublicJwk)) {
      return {
        signingKey: signingKeyFromEd25519Key(agent, keyId, publicKey),
        keyAgreement: keyAgreementFromAskarKey(agent, agreementKeyId, agreementPublicKey),
      }
    }
  }
  return identityFromEd25519Key(agent, keyId, publicKey)
}

/** The document's first keyAgreement method, embedded or referenced by id. */
function firstKeyAgreementVerificationMethod(didDocument: {
  keyAgreement?: Array<string | VerificationMethod>
  verificationMethod?: VerificationMethod[]
}): VerificationMethod | undefined {
  for (const entry of didDocument.keyAgreement ?? []) {
    if (typeof entry === 'object' && entry !== null) return entry
    const referenced = (didDocument.verificationMethod ?? []).find(
      (vm) => vm.id === entry || (entry.startsWith('#') && vm.id.endsWith(entry))
    )
    if (referenced) return referenced
  }
  return undefined
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
  const publicKey = TypedArrayEncoder.fromBase64Url(publicJwk.x)

  const created = await agent.dids.create({ method: 'key', options: { keyId } })
  if (created.didState.state !== 'finished' || !created.didState.did) {
    throw new Error(`credo-tsp-adapter: did:key creation failed: ${JSON.stringify(created.didState)}`)
  }

  return { vid: created.didState.did, ...identityFromEd25519Key(agent, keyId, publicKey) }
}
