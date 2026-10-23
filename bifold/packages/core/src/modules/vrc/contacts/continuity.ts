/**
 * Confirming a merge with the other person's phone (contacts/continuity-check). A merge (mergeContacts.ts) rests on
 * the person's word; this asks the other phone to confirm that two of our relationships with it are one person.
 *
 * Asking (the phone that merged): over the connection of the contact's newest relationship, one request per other
 * relationship, each a random challenge sealed to the pairwise relationship DID the other person used THERE. The
 * challenge is kept here; when it comes back over the same connection, on the same thread, the two relationships are
 * marked confirmed by the other phone ('peer').
 *
 * Answering (the other phone): the challenge is tried against the keys of its OTHER relationships only — never the
 * relationship of the connection it came on, whose DID the asker legitimately knows — so the asker cannot make it look
 * like someone else. If no key opens it, nothing happens: no prompt, no reply, nothing that says it failed. If one
 * does, its person is asked; on Confirm the challenge goes back and nothing else (not which relationship opened it).
 * On Not now, nothing is sent. Requests are limited before anything is stored or opened: one pending prompt per
 * connection, a few attempts per connection per hour, a few prompts per hour in all.
 *
 * @module vrc/contacts/continuity
 */
import { utils, type Agent } from '@credo-ts/core'
import { EventEmitter } from 'events'

import type { InboundContext } from '../../trust-tasks/registry'
import { respondWith, type TrustTasksService } from '../../trust-tasks/services/TrustTasksService'
import { RelationshipDidRepository } from '../repositories/RelationshipDidRepository'
import { resolveContactDisplayInfo } from '../utils/rcardDisplayUtils'

import { CONTACT_LINK, type ContactLinks, contactIdOf, relationshipsOfContact } from './contactLinks'
import { openChallenge, sameChallenge, sealChallenge } from './continuityCrypto'
import { RESPONSE_SPEC, SPEC, TYPE_URI } from './continuitySpec'

/** genericRecords recordType of a challenge this phone sent and is waiting for. */
export const CONTINUITY_ASK = 'keyring.contact-continuity-ask'

const HOUR = 60 * 60 * 1000
/** How long an unanswered ask shows as asked. A Not now is silent by design, so an ask cannot wait for an answer. */
export const ASK_SHOWN_FOR = 24 * HOUR
export const ATTEMPTS_PER_CONNECTION_PER_HOUR = 5
export const PROMPTS_PER_HOUR = 3

/** The ceremony module, reached lazily: it registers this type, so importing it at the top would be a cycle. */
function ceremony(): typeof import('../../trust-tasks/ceremony') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  return require('../../trust-tasks/ceremony')
}

/** Confirmations reached this phone: a contact's screen reads its links again. */
export const continuityEvents = new EventEmitter()

// ---------------------------------------------------------------------------------------------------------------
// Asking

export type AskResult = 'sent' | 'noConnection' | 'nothingToConfirm'

/**
 * Ask the other phone to confirm the contact of `issuerId`: one sealed challenge per relationship of the contact
 * other than `issuerId`'s own, sent over `issuerId`'s connection.
 */
export async function askToConfirm(agent: Agent, links: ContactLinks, issuerId: string): Promise<AskResult> {
  const others = relationshipsOfContact(links, issuerId).filter((member) => member !== issuerId)
  if (others.length === 0) return 'nothingToConfirm'
  const record = await agent.dependencyManager
    .resolve(RelationshipDidRepository)
    .findByCounterpartyRelationshipDid(agent.context, issuerId)
  if (!record?.connectionId) return 'noConnection'
  const connection = await agent.modules.didcomm.connections.getById(record.connectionId)
  if (!connection.did || !connection.theirDid) return 'noConnection'

  // A new ask replaces the earlier ones on this connection, which also bounds how many are kept.
  for (const earlier of await agent.genericRecords.findAllByQuery({
    recordType: CONTINUITY_ASK,
    connectionId: record.connectionId,
  })) {
    await agent.genericRecords.deleteById(earlier.id)
  }
  const { getTrustTasksService, sendTrustTaskDocument } = ceremony()
  for (const about of others) {
    const { challenge, sealed } = await sealChallenge(agent, about)
    const document: Record<string, unknown> = {
      id: utils.uuid(),
      type: TYPE_URI,
      issuer: connection.did,
      recipient: connection.theirDid,
      issuedAt: new Date().toISOString(),
      payload: { sealed },
    }
    await agent.genericRecords.save({
      content: {
        threadId: document.id,
        connectionId: record.connectionId,
        askedFrom: issuerId,
        about,
        challenge,
        askedAt: Date.now(),
      },
      tags: { recordType: CONTINUITY_ASK, connectionId: record.connectionId, threadId: String(document.id) },
    })
    await getTrustTasksService(agent).retain(agent.context, document, 'request', record.connectionId)
    await sendTrustTaskDocument(agent, record.connectionId, document)
  }
  return 'sent'
}

/** A reply to one of our challenges: when it carries the challenge back, the two relationships are confirmed. */
export async function handleContinuityResponse(
  agent: Agent,
  service: TrustTasksService,
  document: Record<string, unknown>,
  context: InboundContext
): Promise<void> {
  const outcome = await service.consume(agent.context, {
    spec: RESPONSE_SPEC as never,
    document,
    myDid: context.recipientDid,
    senderDid: context.senderDid,
    connectionId: context.connectionId,
    handler: async (doc) => doc,
  })
  if (outcome.kind !== 'handled') return
  const threadId = String(document.threadId ?? '')
  const [ask] = await agent.genericRecords.findAllByQuery({
    recordType: CONTINUITY_ASK,
    connectionId: context.connectionId,
    threadId,
  })
  if (!ask) return
  const { askedFrom, about, challenge } = ask.content as { askedFrom: string; about: string; challenge: string }
  const echoed = String((document.payload as { challenge?: unknown } | undefined)?.challenge ?? '')
  // A reply that does not carry our challenge back confirms nothing; the ask stays for the real answer.
  if (!sameChallenge(challenge, echoed)) return
  await markConfirmedByPeer(agent, [askedFrom, about])
  await agent.genericRecords.deleteById(ask.id)
  continuityEvents.emit('confirmed', { connectionId: context.connectionId })
}

/**
 * Mark the contact links of these relationships as confirmed by the other phone, in place: the link is never absent,
 * so a failed write leaves the merge as it was. The confirmation lives in the content, which every read goes by.
 */
async function markConfirmedByPeer(agent: Agent, relationships: string[]): Promise<void> {
  for (const issuerDid of relationships) {
    for (const link of await agent.genericRecords.findAllByQuery({ recordType: CONTACT_LINK, issuerDid })) {
      const content = link.content as { issuerDid: string; contactId: string; confirmation?: string }
      if (content.confirmation === 'peer') continue
      link.content = { ...content, confirmation: 'peer' }
      await agent.genericRecords.update(link)
    }
  }
}

/** Whether this phone asked the other phone, over `connectionId`, within the last day. */
export async function askedRecently(agent: Pick<Agent, 'genericRecords'>, connectionId: string): Promise<boolean> {
  const asks = (await agent.genericRecords.findAllByQuery({ recordType: CONTINUITY_ASK, connectionId })) ?? []
  const now = Date.now()
  return asks.some((ask) => now - Number((ask.content as { askedAt?: number }).askedAt ?? 0) < ASK_SHOWN_FOR)
}

/** Whether every link of the contact of `issuerId` has been confirmed by the other phone. */
export async function isConfirmedByPeer(
  agent: Pick<Agent, 'genericRecords'>,
  links: ContactLinks,
  issuerId: string
): Promise<boolean> {
  const records =
    (await agent.genericRecords.findAllByQuery({
      recordType: CONTACT_LINK,
      contactId: contactIdOf(links, issuerId),
    })) ?? []
  return (
    records.length > 0 &&
    records.every((record) => (record.content as { confirmation?: string }).confirmation === 'peer')
  )
}

// ---------------------------------------------------------------------------------------------------------------
// Answering

export interface ContinuityPrompt {
  connectionId: string
  /** The asker, as this phone knows them on this connection. */
  asker: string
  /** The earlier contact the challenge opened for, as this phone knows them. */
  earlier: string
  request: Record<string, unknown>
  challenge: string
}

class ContinuityPromptStore extends EventEmitter {
  private prompts = new Map<string, ContinuityPrompt>()

  public has(connectionId: string): boolean {
    return this.prompts.has(connectionId)
  }

  public getAny(): ContinuityPrompt | undefined {
    return this.prompts.values().next().value
  }

  public set(prompt: ContinuityPrompt): void {
    this.prompts.set(prompt.connectionId, prompt)
    this.emit('prompt', prompt)
  }

  public take(connectionId: string): ContinuityPrompt | undefined {
    const prompt = this.prompts.get(connectionId)
    this.prompts.delete(connectionId)
    if (prompt) this.emit('promptCleared', { connectionId })
    return prompt
  }

  public clear(): void {
    this.prompts.clear()
  }
}

/** Continuity prompts waiting for this phone's person; the global modal listens. */
export const continuityPromptStore = new ContinuityPromptStore()

const attempts = new Map<string, number[]>()
let prompted: number[] = []

/** Forget every limit and prompt (tests). */
export function resetContinuityLimits(): void {
  attempts.clear()
  prompted = []
  continuityPromptStore.clear()
}

/** A challenge from the other phone. Prompts only if it opens with one of this phone's earlier relationship keys. */
export async function handleContinuityRequest(
  agent: Agent,
  service: TrustTasksService,
  document: Record<string, unknown>,
  context: InboundContext
): Promise<void> {
  const now = Date.now()
  const { connectionId } = context
  // Limits first, so a flood is neither stored nor opened.
  if (continuityPromptStore.has(connectionId)) return
  const recent = (attempts.get(connectionId) ?? []).filter((at) => now - at < HOUR)
  if (recent.length >= ATTEMPTS_PER_CONNECTION_PER_HOUR) return
  attempts.set(connectionId, [...recent, now])

  const outcome = await service.consume(agent.context, {
    spec: SPEC as never,
    document,
    myDid: context.recipientDid,
    senderDid: context.senderDid,
    connectionId,
    handler: async () => undefined,
  })
  if (outcome.kind !== 'handled') return

  const relationships = await agent.dependencyManager.resolve(RelationshipDidRepository).getAll(agent.context)
  const current = relationships.find((record) => record.connectionId === connectionId)
  if (!current?.counterpartyRelationshipDid) return
  // Excluded by the DID the asker knows, not only by connection: a record without a connection, or a second record
  // holding the same DID, must not bring this relationship's own key back in.
  const earlierDids = relationships
    .filter(
      (record) =>
        record.connectionId !== connectionId &&
        record.myRelationshipDid &&
        record.myRelationshipDid !== current.myRelationshipDid
    )
    .map((record) => record.myRelationshipDid)
  const sealed = String((document.payload as { sealed?: unknown } | undefined)?.sealed ?? '')
  const opened = await openChallenge(agent, sealed, earlierDids)
  if (!opened) return

  prompted = prompted.filter((at) => now - at < HOUR)
  if (prompted.length >= PROMPTS_PER_HOUR) return
  prompted.push(now)

  const credentials = await agent.w3cCredentials.getAll()
  const earlier = relationships.find((record) => record.myRelationshipDid === opened.openedWith)
  continuityPromptStore.set({
    connectionId,
    asker: resolveContactDisplayInfo(credentials, current.counterpartyRelationshipDid).name ?? '',
    earlier: resolveContactDisplayInfo(credentials, earlier?.counterpartyRelationshipDid ?? '').name ?? '',
    request: document,
    challenge: opened.challenge,
  })
}

/** The person's answer to a continuity prompt: on Confirm the challenge goes back, and nothing else; otherwise nothing. */
export async function respondToContinuityPrompt(agent: Agent, connectionId: string, confirm: boolean): Promise<void> {
  const prompt = continuityPromptStore.take(connectionId)
  if (!prompt || !confirm) return
  const response = respondWith(prompt.request as never, utils.uuid(), { challenge: prompt.challenge }, () =>
    new Date().toISOString()
  ) as unknown as Record<string, unknown>
  const { getTrustTasksService, sendTrustTaskDocument } = ceremony()
  await getTrustTasksService(agent).retain(agent.context, response, 'response', connectionId)
  await sendTrustTaskDocument(agent, connectionId, response)
}
