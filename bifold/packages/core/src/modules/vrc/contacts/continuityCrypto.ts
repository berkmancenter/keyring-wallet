/**
 * The cryptography of a continuity check, on the agent's own key management: seal a challenge to someone's pairwise
 * relationship DID, and try to open one with this phone's own relationship keys.
 *
 * Relationship DIDs are did:peer:0 with one Ed25519 key, held in the agent's KMS (never hardware: the hardware key is
 * sign-only and one per device). The KMS gives no raw shared secret, but its sealed box does what is needed: sealing
 * converts the recipient's Ed25519 public key to X25519 (PublicJwk.convertTo), and opening converts the private key
 * the same way (ECDH-HSALSA20 with no sender key). Only the holder of the DID's key can open the box.
 *
 * @module vrc/contacts/continuityCrypto
 */
import { Kms, TypedArrayEncoder, getPublicJwkFromVerificationMethod, type Agent } from '@credo-ts/core'

const SEAL = { algorithm: 'XSALSA20-POLY1305' } as const
const CHALLENGE_BYTES = 32

type ContinuityAgent = Pick<Agent, 'dids'> & { kms: Kms.KeyManagementApi }

/** The X25519 public key, as a JWK, of a DID's first verification method (an Ed25519 key). */
async function x25519PublicJwkOf(agent: ContinuityAgent, did: string) {
  const { didDocument } = await agent.dids.resolve(did)
  const method = didDocument?.verificationMethod?.[0]
  if (!method) throw new Error(`no verification method on ${did}`)
  const publicJwk = getPublicJwkFromVerificationMethod(method)
  if (!publicJwk.is(Kms.Ed25519PublicJwk)) throw new Error(`${did} is not an Ed25519 DID`)
  return publicJwk.convertTo(Kms.X25519PublicJwk).toJson()
}

/** The KMS key id of one of this agent's own (created) DIDs. */
export async function kmsKeyIdOfOwnDid(agent: Pick<Agent, 'dids'>, did: string): Promise<string> {
  const { didDocument } = await agent.dids.resolveCreatedDidDocumentWithKeys(did)
  const methodId = didDocument.verificationMethod?.[0]?.id
  if (!methodId) throw new Error(`no verification method on own DID ${did}`)
  const { publicJwk } = await agent.dids.resolveVerificationMethodFromCreatedDidRecord(methodId)
  if (!publicJwk.keyId) throw new Error(`no key id for own DID ${did}`)
  return publicJwk.keyId
}

/** A fresh random challenge, sealed to `recipientDid`. Both as base64url. */
export async function sealChallenge(
  agent: ContinuityAgent,
  recipientDid: string
): Promise<{ challenge: string; sealed: string }> {
  const challenge = agent.kms.randomBytes({ length: CHALLENGE_BYTES })
  const { encrypted } = await agent.kms.encrypt({
    data: challenge,
    encryption: SEAL,
    key: {
      keyAgreement: { algorithm: 'ECDH-HSALSA20', externalPublicJwk: await x25519PublicJwkOf(agent, recipientDid) },
    },
  })
  return {
    challenge: TypedArrayEncoder.toBase64Url(challenge),
    sealed: TypedArrayEncoder.toBase64Url(encrypted),
  }
}

/**
 * Open `sealed` with the first of `ownDids` whose key opens it. Undefined when none does — a box sealed to someone
 * else, or to a DID not offered here, never opens. Says which DID opened it for the caller's own use only.
 */
export async function openChallenge(
  agent: ContinuityAgent,
  sealed: string,
  ownDids: string[]
): Promise<{ challenge: string; openedWith: string } | undefined> {
  const encrypted = TypedArrayEncoder.fromBase64Url(sealed)
  for (const did of ownDids) {
    let keyId: string
    try {
      keyId = await kmsKeyIdOfOwnDid(agent, did)
    } catch {
      continue
    }
    try {
      const { data } = await agent.kms.decrypt({
        encrypted,
        decryption: SEAL,
        key: { keyAgreement: { algorithm: 'ECDH-HSALSA20', keyId } },
      })
      return { challenge: TypedArrayEncoder.toBase64Url(data), openedWith: did }
    } catch {
      // Not this key.
    }
  }
  return undefined
}

/** Equal challenges, compared in time independent of where they differ. */
export function sameChallenge(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let difference = 0
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return difference === 0
}
