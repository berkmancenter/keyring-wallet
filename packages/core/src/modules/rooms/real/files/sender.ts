/**
 * Who shared a room file, checked: the record body a file comes in is signed by its author (`SealedRecordBody`,
 * `rooms/_shared/0.1/room.schema.json`), and the reader checks that signature before saying who shared it. The VTA
 * opens the record but does not check it; upstream's own reader does it the same way (vtc-client
 * `rooms/body.rs` `verify_record_body`, vta-service-v0.69.1), and so does this:
 *
 *  - the proof verifies for the body's `author`, under a key the author's DID document lists for `assertionMethod`;
 *  - the body was signed for the room, key and version it was read from (the version it was sealed at);
 *  - on an attributed room, the body's `author` is the author the host recorded.
 *
 * A body that fails any of these is refused, as upstream refuses it: its file is not opened. One that could not be
 * checked (the author's DID document could not be fetched, or it is signed only with a suite this client does not
 * verify) is unconfirmed: its file opens, but who shared it is not said.
 *
 * @module rooms/real/files/sender
 */
import { TypedArrayEncoder, getPublicJwkFromVerificationMethod, type VerificationMethod } from '@credo-ts/core'
import { jcsCanonicalize, verificationMethodInRelationship } from '@bifold/trust-tasks'
import { ed25519 } from '@noble/curves/ed25519.js'
import { sha256 } from '@noble/hashes/sha2.js'

import type { RoomFileSender } from '../../types'

/** `confirmed`: the signature holds. `unconfirmed`: it could not be checked. `refused`: it does not hold. */
export type SenderCheck = RoomFileSender

/** A DID document, as far as the check reads it. */
export interface SenderDidDocument {
  id?: string
  verificationMethod?: VerificationMethod[]
  assertionMethod?: unknown[]
}

/** The name of the error a resolver rejects with when it gave up waiting: a host that may only be down for now. */
export const DOCUMENT_TIMEOUT = 'SenderDocumentTimeout'

/** The author's DID document; rejects when it can't be had. */
export type ResolveSender = (did: string) => Promise<SenderDidDocument>

/** Where a record was read: what its body must have been signed for. */
export interface ReadAt {
  roomId: string
  key: string
  /** The version the body was sealed at: the agent's `sealedAt` where it gave one, else the record's own. */
  version: number
  /** The author the host recorded for the record; none on a private room. */
  hostAuthor?: string
}

/** The suites upstream takes a record body in. Only the first is verified here. */
const EDDSA = 'eddsa-jcs-2022'
const ACCEPTED_SUITES = [EDDSA, 'ecdsa-jcs-2019']

const record = (v: unknown): Record<string, unknown> | undefined =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined

/**
 * Which rule decided, from a closed list: safe to count and log, where `why` names DIDs, rooms, keys and an error's own
 * words. `key-not-listed` is what a key the author has since rotated away reads as, as well as a forged method.
 */
export type SenderKind =
  | 'holds'
  | 'no-author'
  | 'wrong-location'
  | 'wrong-version'
  | 'author-differs'
  | 'no-proof'
  | 'suite-refused'
  | 'suite-unverified'
  | 'proof-type'
  | 'proof-purpose'
  | 'signer-not-author'
  | 'no-proof-value'
  | 'no-resolver'
  | 'document-timeout'
  | 'document-unavailable'
  | 'key-not-listed'
  | 'key-unreadable'
  | 'bad-signature'
  | 'mixed-suites'

/** The outcome: which rule decided, and why, for the log. */
export interface SenderOutcome {
  check: SenderCheck
  kind: SenderKind
  /** The author whose signature holds: set only when `confirmed`. */
  signer?: string
  why: string
}

export async function checkSender(
  signed: Record<string, unknown>,
  at: ReadAt,
  resolve: ResolveSender | undefined
): Promise<SenderOutcome> {
  const refused = (kind: SenderKind, why: string): SenderOutcome => ({ check: 'refused', kind, why })
  const unconfirmed = (kind: SenderKind, why: string): SenderOutcome => ({ check: 'unconfirmed', kind, why })

  const { proof, ...unsecured } = signed
  const author = typeof signed.author === 'string' ? signed.author : ''
  if (!author) return refused('no-author', 'the body names no author')
  if (signed.roomId !== at.roomId || signed.key !== at.key || signed.version !== at.version)
    return refused(
      signed.roomId === at.roomId && signed.key === at.key ? 'wrong-version' : 'wrong-location',
      `signed for ${String(signed.roomId)} / ${String(signed.key)} @ v${String(signed.version)}, read from ${at.roomId} / ${at.key} @ v${at.version}`
    )
  if (at.hostAuthor !== undefined && at.hostAuthor !== author)
    return refused('author-differs', `signed as ${author}, but the host recorded ${at.hostAuthor}`)

  // One proof, or a proof set: every proof must be in a suite a record body takes, and every one checked must hold.
  const proofs = Array.isArray(proof) ? proof.map(record) : [record(proof)]
  if (proofs.length === 0 || proofs.some((p) => !p)) return refused('no-proof', 'the body carries no proof')
  const suites = (proofs as Record<string, unknown>[]).map((p) => p.cryptosuite)
  if (suites.some((s) => typeof s !== 'string' || !ACCEPTED_SUITES.includes(s)))
    return refused('suite-refused', `signed with ${suites.join(', ')}`)
  const ours = (proofs as Record<string, unknown>[]).filter((p) => p.cryptosuite === EDDSA)
  if (ours.length === 0)
    return unconfirmed('suite-unverified', `signed with ${suites.join(', ')}, which this client does not verify`)

  for (const p of ours) {
    if (p.type !== 'DataIntegrityProof') return refused('proof-type', `proof type ${String(p.type)}`)
    if (p.proofPurpose !== 'assertionMethod') return refused('proof-purpose', `proof purpose ${String(p.proofPurpose)}`)
    const method = typeof p.verificationMethod === 'string' ? p.verificationMethod : ''
    if (method.split('#')[0] !== author)
      return refused('signer-not-author', `signed by ${method}, not by the author ${author}`)
    if (typeof p.proofValue !== 'string' || !p.proofValue.startsWith('z'))
      return refused('no-proof-value', 'no base58btc proof value')
  }

  let document: SenderDidDocument
  try {
    if (!resolve) return unconfirmed('no-resolver', 'this build fetches no DID documents')
    document = await resolve(author)
  } catch (e) {
    return unconfirmed(
      (e as Error | undefined)?.name === DOCUMENT_TIMEOUT ? 'document-timeout' : 'document-unavailable',
      `the author's DID document could not be had: ${e instanceof Error ? e.message : String(e)}`
    )
  }

  const documentHash = sha256(new TextEncoder().encode(jcsCanonicalize(unsecured)))
  for (const p of ours) {
    const method = verificationMethodInRelationship(document, 'assertionMethod', p.verificationMethod as string)
    if (!method)
      return refused('key-not-listed', `${String(p.verificationMethod)} is not one of the author's assertion keys`)
    let publicKey: Uint8Array
    try {
      publicKey = (getPublicJwkFromVerificationMethod(method).publicKey as { publicKey: Uint8Array }).publicKey
    } catch (e) {
      // The author's own document, which no other member writes: a key this client can't read is not checked.
      return unconfirmed(
        'key-unreadable',
        `the author's key could not be read: ${e instanceof Error ? e.message : String(e)}`
      )
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { proofValue, ...config } = p
    const configHash = sha256(new TextEncoder().encode(jcsCanonicalize(config)))
    const input = new Uint8Array(configHash.length + documentHash.length)
    input.set(configHash, 0)
    input.set(documentHash, configHash.length)
    let holds = false
    try {
      holds = ed25519.verify(TypedArrayEncoder.fromBase58((proofValue as string).slice(1)), input, publicKey)
    } catch {
      holds = false
    }
    if (!holds) return refused('bad-signature', 'the signature does not verify')
  }
  if (ours.length < proofs.length)
    return unconfirmed(
      'mixed-suites',
      `signed also with ${suites.filter((s) => s !== EDDSA).join(', ')}, which this client does not verify`
    )
  return { check: 'confirmed', kind: 'holds', signer: author, why: 'the signature holds' }
}
