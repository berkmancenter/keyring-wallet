/**
 * Signed chat and control envelopes between Keyring and its agent (plan §7.9, Step 6; backlog 2, fb-C2).
 *
 * Every document the chat carries, a chat event or a control message, is one envelope: `type`, `id` (`urn:uuid:`),
 * `issuer`, `recipient`, `issuedAt` and a `payload` carrying `version`, with a `DataIntegrityProof`
 * (`eddsa-jcs-2022`, `proofPurpose: 'assertionMethod'`) by the issuer's key, made and checked with trust-tasks'
 * `signDocumentProof` and `verifyDocumentProof`. The receiver's rules are exactly the `rules` of the vectors
 * (`connected-agents/vectors/control-messages.json`, version 1), plus the version rule of §7.9:
 *
 *  - **proof:** by the expected issuer's key, and the `issuer` member is that issuer;
 *  - **recipient:** the receiver's own chat identity, no other;
 *  - **version:** Keyring's own major (1), any minor; a higher minor may carry members Keyring does not know, which
 *    are ignored, but not lack one Keyring needs; another major is `versionMismatch` and is never acted on;
 *  - **freshness:** `issuedAt` at most 300 s ahead of, and at most 604 800 s (7 days) behind, the receiver's now;
 *  - **state:** a `keyring/agent/settings` or `keyring/agent/room-offer` not newer than the last of its type applied
 *    is `olderState`;
 *  - **seen ids:** an id already seen within the window is `repeated`. The id is recorded when the envelope is
 *    accepted, before anything acts on it, so a crash while acting cannot let the same document act twice. The
 *    price is at-most-once: a document whose handler failed is not acted on again, and a resend, which keeps its
 *    `id`, is `repeated`.
 *
 * The checks run in that order, cheapest refusals of an unproven document last: nothing about a document is believed,
 * and no id is recorded, until its proof verifies. So a forged document can neither burn a genuine id nor move the
 * chat to `versionMismatch`.
 *
 * @module connected-agents/chat/envelope
 */
import type { Agent } from '@credo-ts/core'
import { utils } from '@credo-ts/core'

import { signDocumentProof, verifyDocumentProof, wireTimestamp } from '../../trust-tasks/documentProof'
import { ENVELOPE_MAX_AGE_MS, ENVELOPE_MAX_AHEAD_MS, type SeenIdStore } from './seenIds'

/** Keyring's own envelope version, the one it sends: major 1, minor 0. */
export const ENVELOPE_VERSION = '1.0'
const OWN_MAJOR = 1

/** The envelope types of the vectors, at Keyring's version. */
export const ENVELOPE_TYPE = {
  chat: 'keyring/chat/1.0',
  settings: 'keyring/agent/settings/1.0',
  roomOffer: 'keyring/agent/room-offer/1.0',
  revoked: 'keyring/agent/revoked/1.0',
  vdcGrant: 'keyring/agent/vdc-grant/1.0',
  vdcAcceptance: 'keyring/agent/vdc-acceptance/1.0',
  heartbeat: 'keyring/agent/heartbeat/1.0',
} as const

export type EnvelopeType = (typeof ENVELOPE_TYPE)[keyof typeof ENVELOPE_TYPE]

/**
 * The payload members a receiver needs of each type, by the type's name without its version. A higher minor may add
 * members; it may not drop one of these. Taken from the vectors' documents: the members the plugin and Keyring read.
 */
const NEEDED_MEMBERS: Record<string, readonly string[]> = {
  'keyring/chat': ['profile', 'eventId', 'type'],
  'keyring/agent/settings': ['answersOthers'],
  'keyring/agent/room-offer': ['roomId', 'hostDid', 'tier'],
  'keyring/agent/revoked': ['revokedAt'],
  'keyring/agent/vdc-grant': ['vdc'],
  'keyring/agent/vdc-acceptance': ['vdc'],
  'keyring/agent/heartbeat': ['at'],
}

/** The types whose newest applied state wins (the vectors' `rules.state`). */
const STATE_TYPES: readonly string[] = ['keyring/agent/settings', 'keyring/agent/room-offer']

/** An envelope's payload: `version` and the type's own members. */
export interface EnvelopePayload {
  version: string
  [member: string]: unknown
}

/** An envelope as built, before it is signed. */
export interface UnsignedEnvelope {
  type: string
  id: string
  issuer?: string
  recipient: string
  issuedAt: string
  payload: EnvelopePayload
}

/** An envelope as sent and as accepted: signed by its issuer. */
export interface SignedEnvelope extends UnsignedEnvelope {
  issuer: string
  proof: Record<string, unknown>
}

/**
 * Why an envelope was refused. The first seven are the vectors' refusal names (`older-state` there is `olderState`
 * here), `versionMismatch` is §7.9's version rule. Two more, not in the brief's list, so no case shares a code with
 * another (recorded in the PR): `malformed`, a document missing an envelope member or one its type needs at Keyring's
 * own version; and `unknownType`, a type of Keyring's major that this Keyring does not know, which a later minor may
 * add and the receiver ignores.
 */
export type EnvelopeRefusal =
  | 'stale'
  | 'future'
  | 'repeated'
  | 'recipient'
  | 'proof'
  | 'olderState'
  | 'versionMismatch'
  | 'malformed'
  | 'unknownType'

export type EnvelopeCheck = { result: 'ok'; envelope: SignedEnvelope } | { result: EnvelopeRefusal; detail: string }

/** What the receiver expects of an envelope. */
export interface EnvelopeExpectation {
  /** The receiver's own chat identity: Keyring's `chatDid` (`K_c`), or the agent's `agentDid` (`K_a`). */
  receiver: string
  /** Who must have issued and signed it: the peer's chat identity. */
  issuer: string
  /** The receiver's seen ids and applied state. */
  seen: SeenIdStore
  /** The receiver's clock; now when absent. */
  now?: Date
}

/** The type's name without its version, `keyring/agent/settings` for `keyring/agent/settings/1.0`. */
export function envelopeBaseType(type: string): string {
  const slash = type.lastIndexOf('/')
  return slash < 0 ? type : type.slice(0, slash)
}

function parseVersion(version: unknown): { major: number; minor: number } | undefined {
  if (typeof version !== 'string') return undefined
  const match = /^(\d+)\.(\d+)$/.exec(version)
  return match ? { major: Number(match[1]), minor: Number(match[2]) } : undefined
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const URN_UUID = /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A fresh envelope id. */
export function newEnvelopeId(): string {
  return `urn:uuid:${utils.uuid()}`
}

/**
 * An envelope at Keyring's version, ready to sign. A resend passes the first send's `id`, so the receiver sees one
 * document however often it arrives.
 */
export function buildEnvelope(input: {
  type: EnvelopeType
  recipient: string
  payload: Record<string, unknown>
  id?: string
  now?: Date
}): UnsignedEnvelope {
  const now = input.now ?? new Date()
  return {
    type: input.type,
    id: input.id ?? newEnvelopeId(),
    recipient: input.recipient,
    // Whole seconds, as the vectors and every verifier that rebuilds an instant write them.
    issuedAt: wireTimestamp(new Date(Math.floor(now.getTime() / 1000) * 1000)),
    payload: { ...input.payload, version: ENVELOPE_VERSION },
  }
}

/** The envelope members every document has, or why it lacks one. */
function shapeProblem(doc: Record<string, unknown>): string | undefined {
  if (typeof doc.type !== 'string' || !doc.type) return 'no type'
  if (typeof doc.id !== 'string' || !URN_UUID.test(doc.id)) return 'the id is not a urn:uuid'
  if (typeof doc.recipient !== 'string' || !doc.recipient) return 'no recipient'
  if (typeof doc.issuedAt !== 'string' || !Number.isFinite(Date.parse(doc.issuedAt))) return 'issuedAt is not a date'
  if (!isRecord(doc.payload)) return 'no payload'
  if (typeof doc.payload.version !== 'string') return 'the payload has no version'
  return undefined
}

/**
 * Sign `doc` as `chatDid`, Keyring's chat identity, for `assertionMethod`. `issuer` is set to `chatDid`; a document
 * naming another issuer is refused, as is one without the envelope members. A proof already on `doc` is replaced, so
 * a resend may be signed afresh while keeping its `id`.
 */
export async function signEnvelope(
  agent: Agent,
  doc: UnsignedEnvelope | SignedEnvelope,
  chatDid: string
): Promise<SignedEnvelope> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { proof: _previous, ...unsigned } = doc as SignedEnvelope
  if (unsigned.issuer !== undefined && unsigned.issuer !== chatDid) {
    throw new Error(`the envelope names ${unsigned.issuer} as its issuer, not ${chatDid}`)
  }
  const problem = shapeProblem(unsigned as unknown as Record<string, unknown>)
  if (problem) throw new Error(`not an envelope: ${problem}`)
  const signed = await signDocumentProof(agent, { ...unsigned, issuer: chatDid }, chatDid, {
    proofPurpose: 'assertionMethod',
  })
  return signed as unknown as SignedEnvelope
}

/**
 * Check a received envelope against the rules above and, when it passes, record its id: an `ok` means the id is now
 * seen, and whatever acts on the document runs after that record. A refusal records nothing.
 */
export async function verifyEnvelope(agent: Agent, doc: unknown, expect: EnvelopeExpectation): Promise<EnvelopeCheck> {
  const now = expect.now ?? new Date()
  if (!isRecord(doc)) return { result: 'malformed', detail: 'not an object' }
  const problem = shapeProblem(doc)
  if (problem) return { result: 'malformed', detail: problem }
  const envelope = doc as unknown as SignedEnvelope

  // Proof first: until it verifies, nothing in the document is believed.
  if (envelope.issuer !== expect.issuer) {
    return { result: 'proof', detail: `issued by ${String(envelope.issuer)}, not ${expect.issuer}` }
  }
  if (!(await verifyDocumentProof(agent, doc, expect.issuer, { proofPurpose: 'assertionMethod' }))) {
    return { result: 'proof', detail: `no valid assertionMethod proof by ${expect.issuer}` }
  }

  if (envelope.recipient !== expect.receiver) {
    return { result: 'recipient', detail: `addressed to ${envelope.recipient}, not ${expect.receiver}` }
  }

  const versionCheck = checkVersion(envelope)
  if (versionCheck) return versionCheck

  const issuedAt = Date.parse(envelope.issuedAt)
  if (issuedAt > now.getTime() + ENVELOPE_MAX_AHEAD_MS) {
    return { result: 'future', detail: `issued at ${envelope.issuedAt}, more than 300 s ahead` }
  }
  if (issuedAt < now.getTime() - ENVELOPE_MAX_AGE_MS) {
    return { result: 'stale', detail: `issued at ${envelope.issuedAt}, more than 7 days ago` }
  }

  const base = envelopeBaseType(envelope.type)
  if (STATE_TYPES.includes(base)) {
    const last = await expect.seen.lastApplied(expect.receiver, base)
    if (last !== undefined && issuedAt <= Date.parse(last)) {
      return { result: 'olderState', detail: `issued at ${envelope.issuedAt}, not after the applied ${last}` }
    }
  }

  if (!(await expect.seen.claim(expect.receiver, envelope.id, envelope.issuedAt, now))) {
    return { result: 'repeated', detail: `${envelope.id} was already received` }
  }
  return { result: 'ok', envelope }
}

/** The version rule (§7.9): the type's and the payload's major are Keyring's, and the members it needs are there. */
function checkVersion(envelope: SignedEnvelope): EnvelopeCheck | undefined {
  const typeVersion = parseVersion(envelope.type.slice(envelope.type.lastIndexOf('/') + 1))
  const payloadVersion = parseVersion(envelope.payload.version)
  if (!typeVersion) return { result: 'malformed', detail: `${envelope.type} carries no version` }
  if (!payloadVersion) return { result: 'malformed', detail: `version ${String(envelope.payload.version)}` }
  if (typeVersion.major !== OWN_MAJOR || payloadVersion.major !== OWN_MAJOR) {
    return {
      result: 'versionMismatch',
      detail: `${envelope.type} at version ${envelope.payload.version}; Keyring reads major ${OWN_MAJOR}`,
    }
  }
  const needed = NEEDED_MEMBERS[envelopeBaseType(envelope.type)]
  if (!needed) return { result: 'unknownType', detail: `${envelope.type} is not a type this Keyring knows` }
  const missing = needed.filter((member) => !(member in envelope.payload))
  if (missing.length > 0) {
    // At Keyring's own minor the document is simply incomplete; at a higher one the newer peer no longer sends what
    // this Keyring needs, which an update fixes.
    const higherMinor = Math.max(typeVersion.minor, payloadVersion.minor) > 0
    return {
      result: higherMinor ? 'versionMismatch' : 'malformed',
      detail: `${envelope.type} lacks ${missing.join(', ')}`,
    }
  }
  return undefined
}

/**
 * Verify `doc` and, only when it is accepted, run `act` on it: after its id is recorded, never before. For the state
 * types, the document's `issuedAt` is recorded as the last applied once `act` returns, so a later older one is
 * `olderState`. A refusal returns the check and does not run `act`.
 */
export async function receiveEnvelope<T>(
  agent: Agent,
  doc: unknown,
  expect: EnvelopeExpectation,
  act: (envelope: SignedEnvelope) => Promise<T>
): Promise<{ check: EnvelopeCheck; acted?: T }> {
  const check = await verifyEnvelope(agent, doc, expect)
  if (check.result !== 'ok') return { check }
  const acted = await act(check.envelope)
  const base = envelopeBaseType(check.envelope.type)
  if (STATE_TYPES.includes(base)) await expect.seen.markApplied(expect.receiver, base, check.envelope.issuedAt)
  return { check, acted }
}
