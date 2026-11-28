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

import { signDocumentProof, wireTimestamp } from '../../trust-tasks/documentProof'

import { newEnvelopeId } from './envelope'

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

/**
 * Sign an introduction as the granter, for `assertionMethod`, with eddsa-jcs-2022. A document naming another issuer
 * is refused; a proof already on it is replaced, so a resend may be signed afresh while keeping its `id`.
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
  const signed = await signDocumentProof(agent, { ...unsigned }, granterDid, { proofPurpose: 'assertionMethod' })
  return signed as unknown as SignedIntroduction
}
