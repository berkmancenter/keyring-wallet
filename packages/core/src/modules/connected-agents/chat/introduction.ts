/**
 * The introduction: Keyring's first document to an agent (§11 Q7, decided 2026-11-28 by Alberto: option 3).
 *
 * The agent cannot learn Keyring's chat identity from its own ACL entry, so Keyring tells it, in a document signed by
 * the administrator key that granted the agent's entry: the entry's granter (acl-entry 0.3 `delegatedBy`, else
 * `createdBy`). The agent checks the issuer against that granter, then checks the chat and the VDC against what the
 * introduction named. It introduces three things and pins one:
 * - `chatDid`: Keyring's chat identity for this agent (`K_c`), the issuer of every later chat and control envelope;
 * - `ownerPersonaDid`: the persona the agent acts for;
 * - `mediatorDid`: Keyring's mediator, where `chatDid` is reached;
 * - `vtaDid`: the VTA the entry is on, so an introduction for another VTA is refused.
 *
 * Its shape is the shared vectors' (`vectors/introduction.json`, version 1, generated independently by
 * `scripts/agent-connect/control_message_vectors.py`): the members of every envelope (`type`, `id`, `issuer`,
 * `recipient`, `issuedAt`, `payload`, `proof`), signed with eddsa-jcs-2022 for `assertionMethod` by the issuer's key.
 * The receiver applies an introduction only if it is newer than the last one it applied, and a newer one with a
 * different `chatDid` replaces the old.
 *
 * Sending it is the carrier's (#1117), once that lands. Until a VTA serves the granter to the agent in `auth/whoami`,
 * the live fallback path stays unannounced: nothing here sends.
 *
 * @module connected-agents/chat/introduction
 */
import type { Agent } from '@credo-ts/core'

import { signDocumentProof, verifyDocumentProof, wireTimestamp } from '../../trust-tasks/documentProof'

import { newEnvelopeId } from './envelope'
import { ENVELOPE_MAX_AGE_MS, ENVELOPE_MAX_AHEAD_MS } from './seenIds'

export const INTRODUCTION_TYPE = 'keyring/agent/introduction/1.0'
export const INTRODUCTION_VERSION = '1.0'

/** What an introduction tells the agent. */
export interface IntroductionPayload {
  version: string
  chatDid: string
  ownerPersonaDid: string
  mediatorDid: string
  vtaDid: string
}

/** An introduction as built, before the granter signs it. */
export interface UnsignedIntroduction {
  type: typeof INTRODUCTION_TYPE
  id: string
  issuer: string
  recipient: string
  issuedAt: string
  payload: IntroductionPayload
}

/** An introduction as sent: signed by the granter. */
export interface SignedIntroduction extends UnsignedIntroduction {
  proof: Record<string, unknown>
}

/** The parts of an ACL entry (acl-entry 0.3) that say who granted it. */
export interface EntryGrant {
  createdBy?: string
  delegatedBy?: string
}

/**
 * Who granted the entry, and so who must sign its introduction: `delegatedBy` when the entry was written on a
 * granter's behalf (an out-of-band grant), else `createdBy`. Undefined when the entry names neither.
 */
export function granterOf(entry: EntryGrant): string | undefined {
  const named = (value: string | undefined) => (typeof value === 'string' && value.trim() ? value : undefined)
  return named(entry.delegatedBy) ?? named(entry.createdBy)
}

/**
 * An introduction ready for the granter to sign. A resend passes the first send's `id`, so the agent sees one
 * document however often it arrives. `issuedAt` is in whole seconds, as every envelope's is.
 */
export function buildIntroduction(input: {
  granterDid: string
  agentDid: string
  chatDid: string
  ownerPersonaDid: string
  mediatorDid: string
  vtaDid: string
  id?: string
  now?: Date
}): UnsignedIntroduction {
  const now = input.now ?? new Date()
  for (const [name, value] of Object.entries({
    granterDid: input.granterDid,
    agentDid: input.agentDid,
    chatDid: input.chatDid,
    ownerPersonaDid: input.ownerPersonaDid,
    mediatorDid: input.mediatorDid,
    vtaDid: input.vtaDid,
  }))
    if (typeof value !== 'string' || !value.trim()) throw new Error(`an introduction needs ${name}`)
  // The chat identity cannot introduce itself: the agent could not tell it from anyone's.
  if (input.chatDid === input.granterDid) throw new Error('an introduction is signed by the granter, not by chatDid')
  return {
    type: INTRODUCTION_TYPE,
    id: input.id ?? newEnvelopeId(),
    issuer: input.granterDid,
    recipient: input.agentDid,
    issuedAt: wireTimestamp(new Date(Math.floor(now.getTime() / 1000) * 1000)),
    payload: {
      version: INTRODUCTION_VERSION,
      chatDid: input.chatDid,
      ownerPersonaDid: input.ownerPersonaDid,
      mediatorDid: input.mediatorDid,
      vtaDid: input.vtaDid,
    },
  }
}

/** The granter is not a DID this phone created, so it holds no key to sign as it: nothing was signed. */
export class IntroductionGranterNotHeld extends Error {
  public constructor(public readonly granterDid: string) {
    super(`this phone holds no key for the granter ${granterDid}, so it cannot sign the introduction`)
    this.name = 'IntroductionGranterNotHeld'
  }
}

/**
 * Sign an introduction as the granter, for `assertionMethod`, with eddsa-jcs-2022. A document naming another issuer
 * is refused; a proof already on it is replaced, so a resend may be signed afresh while keeping its `id`.
 *
 * Signed only as a DID this phone created (`agent.dids.getCreatedDids`), as the administrator DID it signs grants
 * with is. A granter it did not create, the VTA itself on an entry it wrote alone (`createdBy` and no `delegatedBy`)
 * for one, is refused with {@link IntroductionGranterNotHeld} before anything is signed: the proof layer would
 * otherwise try the key store with the DID document's own key id, and a refusal must not rest on that failing.
 */
export async function signIntroduction(
  agent: Agent,
  doc: UnsignedIntroduction | SignedIntroduction,
  granterDid: string
): Promise<SignedIntroduction> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { proof: _previous, ...unsigned } = doc as SignedIntroduction
  if (unsigned.type !== INTRODUCTION_TYPE) throw new Error(`not an introduction: ${String(unsigned.type)}`)
  if (unsigned.issuer !== granterDid) {
    throw new Error(`the introduction names ${unsigned.issuer} as its issuer, not the granter ${granterDid}`)
  }
  const [held] = await agent.dids.getCreatedDids({ did: granterDid })
  if (!held) throw new IntroductionGranterNotHeld(granterDid)
  const signed = await signDocumentProof(agent, { ...unsigned }, granterDid, { proofPurpose: 'assertionMethod' })
  return signed as unknown as SignedIntroduction
}

/**
 * Why a receiver refuses an introduction, spelled as the shared vectors spell their reasons (`vectors/introduction.json`,
 * kebab-case as in `control-messages.json`). `malformed` is a document missing a member the type needs.
 */
export type IntroductionRefusal =
  | 'wrong-issuer'
  | 'wrong-vta'
  | 'recipient'
  | 'stale'
  | 'future'
  | 'repeated'
  | 'proof'
  | 'older-state'
  | 'malformed'

/** What the receiver knows when an introduction arrives: the vectors' `receiver` block. */
export interface IntroductionReceiver {
  /** The agent's own identity, `K_a`. */
  did: string
  /** Who granted its entry (`granterOf` over what `auth/whoami` answers). */
  granter: string
  /** The VTA the agent is pinned to. */
  vtaDid: string
  now: string | Date
  /** Ids already seen within the window. */
  seenIds?: readonly string[]
  /** When the last introduction it applied was issued. */
  lastIntroduction?: string
}

export type IntroductionCheck =
  | { result: 'accept'; introduction: SignedIntroduction }
  | { result: 'refuse'; reason: IntroductionRefusal; detail: string }

const PAYLOAD_MEMBERS = ['chatDid', 'ownerPersonaDid', 'mediatorDid', 'vtaDid'] as const

/**
 * The receiver's rules, as the shared vectors state them: Keyring's reading of the file, so the file is a check on
 * this side too and not only a description. The plugin, which receives introductions, applies the same rules. In
 * order: the shape; the issuer is the granter; a valid `assertionMethod` proof by it; addressed to the receiver; for
 * the pinned VTA; fresh (300 s ahead, 604800 s behind); not seen; newer than the last introduction applied.
 */
export async function checkIntroduction(
  agent: Agent,
  doc: unknown,
  receiver: IntroductionReceiver
): Promise<IntroductionCheck> {
  const refuse = (reason: IntroductionRefusal, detail: string): IntroductionCheck => ({
    result: 'refuse',
    reason,
    detail,
  })
  const d = doc as Partial<SignedIntroduction> | null
  if (!d || typeof d !== 'object' || d.type !== INTRODUCTION_TYPE) return refuse('malformed', 'not an introduction')
  if (typeof d.id !== 'string' || typeof d.issuer !== 'string' || typeof d.recipient !== 'string')
    return refuse('malformed', 'an envelope member is missing')
  if (typeof d.issuedAt !== 'string' || !Number.isFinite(Date.parse(d.issuedAt)))
    return refuse('malformed', 'issuedAt is not a date')
  const payload = d.payload as Partial<IntroductionPayload> | undefined
  if (!payload || typeof payload.version !== 'string' || !payload.version.startsWith('1.'))
    return refuse('malformed', 'no payload at version 1')
  for (const member of PAYLOAD_MEMBERS)
    if (typeof payload[member] !== 'string' || !payload[member]) return refuse('malformed', `no ${member}`)
  if (d.issuer !== receiver.granter) return refuse('wrong-issuer', `issued by ${d.issuer}, not the granter`)
  if (!(await verifyDocumentProof(agent, d as never, receiver.granter, { proofPurpose: 'assertionMethod' })))
    return refuse('proof', `no valid assertionMethod proof by the granter`)
  if (d.recipient !== receiver.did) return refuse('recipient', `addressed to ${d.recipient}`)
  if (payload.vtaDid !== receiver.vtaDid) return refuse('wrong-vta', `for ${payload.vtaDid}, not the pinned VTA`)
  const now = new Date(receiver.now).getTime()
  const at = Date.parse(d.issuedAt)
  if (at > now + ENVELOPE_MAX_AHEAD_MS) return refuse('future', `issued at ${d.issuedAt}, ahead of the receiver`)
  if (at < now - ENVELOPE_MAX_AGE_MS) return refuse('stale', `issued at ${d.issuedAt}, too long ago`)
  if (receiver.seenIds?.includes(d.id)) return refuse('repeated', `${d.id} was already seen`)
  if (receiver.lastIntroduction !== undefined && at <= Date.parse(receiver.lastIntroduction))
    return refuse('older-state', `issued at ${d.issuedAt}, not after the last applied ${receiver.lastIntroduction}`)
  return { result: 'accept', introduction: d as SignedIntroduction }
}
