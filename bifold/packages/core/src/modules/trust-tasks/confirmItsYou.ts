/**
 * "Confirm it's you" (confirmItsYouSpec.ts), both phones: Sam gets a call that sounds like Jordan asking for money,
 * so Sam's phone asks Jordan's, over the relationship they set up, "is this really you?" with a note. Jordan's phone
 * shows the note; Jordan answers "it's me" or "not me", and either answer needs Jordan's own phone lock (Face ID,
 * fingerprint or passcode). Sam's phone shows the answer, or that none came in time.
 *
 * What makes it evidence: the answer is signed under the relationship DID Jordan's phone holds, and verified under
 * the one the relationship established. A cloned voice cannot make that signature. Nothing is read unverified: with no
 * relationship on the connection, a document is dropped (and logged). An answer counts only against a request this
 * phone sent on that connection, on that thread, still open, carrying its challenge back.
 *
 * Person to person: no agent or VTA is involved, so it works between any two Keyring contacts.
 *
 * Off unless the "Confirm it's you" switch is on (confirmItsYouFlag.ts).
 *
 * Records are changed in place, never deleted (one per contact on each phone), so this goes out over the air.
 *
 * @module trust-tasks/confirmItsYou
 */

import { TypedArrayEncoder, utils, type Agent } from '@credo-ts/core'
import { EventEmitter } from 'events'

import { RelationshipDidRepository } from '../vrc/repositories/RelationshipDidRepository'
import { resolveContactDisplayInfo } from '../vrc/utils/rcardDisplayUtils'
import { sameChallenge } from '../vrc/contacts/continuityCrypto'

import {
  NOTE_MAX,
  RESPONSE_SPEC,
  SPEC,
  TYPE_URI,
  CONFIRM_LOCKS,
  type ConfirmDecision,
  type ConfirmLock,
  type ConfirmRequestPayload,
  type ConfirmResponsePayload,
} from './confirmItsYouSpec'
import { signDocumentProof, verifyDocumentProof } from './documentProof'
import { isConfirmItsYouEnabled } from './module/confirmItsYouFlag'
import type { OwnerConfirmation } from './module/vtaOwner'
import type { InboundContext } from './registry'
import { respondWith, type TrustTasksService } from './services/TrustTasksService'

const LOG_PREFIX = '[TrustTasks:ConfirmItsYou]'

/** Why an arriving request or answer went no further: logged, never silent. Names the connection, never the note. */
const dropped = (agent: Agent, what: string, connectionId: string, why: string) =>
  agent.config?.logger?.warn(`${LOG_PREFIX} ${what} on connection ${connectionId} not taken: ${why}`)
const SWITCHED_OFF = "Confirm it's you is switched off on this phone (Settings › Developer)"
const NO_RELATIONSHIP = 'no relationship with this contact to check it against'
const refusedAs = (kind: string) => `it did not pass its check (${kind})`

/** genericRecords recordType of the requests this phone sent to a contact: one record per connection, kept in place. */
export const CONFIRM_ASKS = 'keyring.confirm-its-you-asks'
/** genericRecords recordType of a request from a contact to this phone's person: one per connection, kept in place. */
export const CONFIRM_PROMPT = 'keyring.confirm-its-you-prompt'

const MINUTE = 60 * 1000
/** How long a request can be answered, unless the asker chose otherwise. */
export const CONFIRM_OPEN_FOR = 15 * MINUTE
/** The longest a request may stay open: an arriving one asking for longer is not shown. */
export const CONFIRM_OPEN_AT_MOST = 60 * MINUTE
/** Clocks on two phones differ: a little slack on "not too far ahead". */
const SKEW = 2 * MINUTE
/** How many requests to one contact this phone keeps (newest first): the oldest is written over, never deleted. */
export const CONFIRM_KEPT = 5
const CHALLENGE_BYTES = 32

/** The ceremony module, reached lazily: it registers this type, so importing it at the top would be a cycle. */
function ceremony(): typeof import('./ceremony') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  return require('./ceremony')
}

/**
 * 'prompt' (a request arrived or was brought back), 'promptCleared' (this phone answered or it lapsed), 'answered' (an
 * answer to one of my requests arrived), 'asked' (this phone sent one).
 */
export const confirmEvents = new EventEmitter()

interface Relationship {
  connectionId?: string
  myRelationshipDid?: string
  counterpartyRelationshipDid?: string
}

async function relationshipOn(agent: Agent, connectionId: string): Promise<Relationship | undefined> {
  const all: Relationship[] = await agent.dependencyManager.resolve(RelationshipDidRepository).getAll(agent.context)
  const found = all.find((record) => record.connectionId === connectionId)
  return found?.myRelationshipDid && found.counterpartyRelationshipDid ? found : undefined
}

const proofUnder = (agent: Agent, controller: string) => ({
  kind: 'verify' as const,
  verify: { verify: (doc: unknown) => verifyDocumentProof(agent, doc as Record<string, unknown>, controller) },
})

/** Past its time, or a time that cannot be read: either way, not answerable. */
const pastDue = (expiresAt: string, now: number) => {
  const at = Date.parse(expiresAt)
  return !Number.isFinite(at) || at <= now
}

async function recordOf(agent: Pick<Agent, 'genericRecords'>, recordType: string, connectionId: string) {
  const [record] = (await agent.genericRecords.findAllByQuery({ recordType, connectionId })) ?? []
  return record
}

/** The one record of `recordType` on `connectionId`, its content replaced; saved the first time. */
async function keepOn(
  agent: Pick<Agent, 'genericRecords'>,
  recordType: string,
  connectionId: string,
  content: object
): Promise<void> {
  const existing = await recordOf(agent, recordType, connectionId)
  if (existing) {
    existing.content = { ...content }
    await agent.genericRecords.update(existing)
  } else {
    await agent.genericRecords.save({ content: { ...content }, tags: { recordType, connectionId } })
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Asking (Sam's phone)

/** A request this phone sent. `waiting` until an answer comes; it reads as expired once its time passes. */
export interface ConfirmAsk {
  threadId: string
  challenge: string
  note: string
  askedAt: string
  expiresAt: string
  /** `cancelled`: this phone's person stopped waiting (here only: nothing is sent, and a late answer is ignored). */
  state: 'waiting' | 'cancelled' | ConfirmDecision
  /** When the answer arrived here. */
  answeredAt?: string
  /** When the contact answered, as their signed answer says: the time the screen shows. */
  respondedAt?: string
  /** The lock their phone says the answer was confirmed with. */
  confirmedWith?: ConfirmLock
}

/** Where a request stands for the screen: an unanswered one past its time is expired. */
export type ConfirmStatus = 'waiting' | 'itsMe' | 'notMe' | 'expired' | 'cancelled'

export function confirmStatusOf(ask: Pick<ConfirmAsk, 'state' | 'expiresAt'>, now = Date.now()): ConfirmStatus {
  if (ask.state !== 'waiting') return ask.state
  return pastDue(ask.expiresAt, now) ? 'expired' : 'waiting'
}

interface ConfirmAsksContent {
  connectionId: string
  /** Newest first, at most {@link CONFIRM_KEPT}. */
  asks: ConfirmAsk[]
}

async function asksOn(agent: Pick<Agent, 'genericRecords'>, connectionId: string): Promise<ConfirmAsk[]> {
  const record = await recordOf(agent, CONFIRM_ASKS, connectionId)
  const content = record?.content as unknown as ConfirmAsksContent | undefined
  return Array.isArray(content?.asks) ? content.asks : []
}

/** The requests this phone sent to the contact on `connectionId`, newest first. */
export async function confirmAsksOn(agent: Pick<Agent, 'genericRecords'>, connectionId: string): Promise<ConfirmAsk[]> {
  return asksOn(agent, connectionId)
}

/** The note as it will be sent: trimmed, and refused when empty or over {@link NOTE_MAX}. */
export function noteToSend(note: string): string | null {
  const trimmed = note.trim()
  return trimmed.length > 0 && trimmed.length <= NOTE_MAX ? trimmed : null
}

export type ConfirmSendResult = 'sent' | 'off' | 'noRelationship' | 'badNote'

/** Ask the contact on `connectionId` to confirm it's them, with `note`. Open for {@link CONFIRM_OPEN_FOR}. */
export async function sendConfirmRequest(
  agent: Agent,
  connectionId: string,
  note: string,
  openFor = CONFIRM_OPEN_FOR
): Promise<ConfirmSendResult> {
  if (!isConfirmItsYouEnabled()) return 'off'
  const text = noteToSend(note)
  if (text === null) return 'badNote'
  const relationship = await relationshipOn(agent, connectionId)
  if (!relationship) return 'noRelationship'
  const connection = await agent.modules.didcomm.connections.getById(connectionId)
  if (!connection.did || !connection.theirDid) return 'noRelationship'

  const challenge = TypedArrayEncoder.toBase64Url(agent.kms.randomBytes({ length: CHALLENGE_BYTES }))
  const id = utils.uuid()
  const now = Date.now()
  const expiresAt = new Date(now + Math.min(openFor, CONFIRM_OPEN_AT_MOST)).toISOString()
  const payload: ConfirmRequestPayload = { challenge, note: text, expiresAt }
  const document: Record<string, unknown> = {
    id,
    type: TYPE_URI,
    threadId: id,
    issuer: connection.did,
    recipient: connection.theirDid,
    issuedAt: new Date(now).toISOString(),
    payload,
  }
  const signed = await signDocumentProof(agent, document, relationship.myRelationshipDid as string)

  const ask: ConfirmAsk = {
    threadId: id,
    challenge,
    note: text,
    askedAt: new Date(now).toISOString(),
    expiresAt,
    state: 'waiting',
  }
  const earlier = await asksOn(agent, connectionId)
  const content: ConfirmAsksContent = { connectionId, asks: [ask, ...earlier].slice(0, CONFIRM_KEPT) }
  await keepOn(agent, CONFIRM_ASKS, connectionId, content)
  const { getTrustTasksService, sendTrustTaskDocument } = ceremony()
  await getTrustTasksService(agent).retain(agent.context, signed, 'request', connectionId)
  await sendTrustTaskDocument(agent, connectionId, signed)
  agent.config?.logger?.info(`${LOG_PREFIX} request sent on connection ${connectionId}`)
  confirmEvents.emit('asked', { connectionId })
  return 'sent'
}

/** The contact's answer arrives: it counts only for a request of mine still waiting, with its challenge carried back. */
export async function handleConfirmResponse(
  agent: Agent,
  service: TrustTasksService,
  document: Record<string, unknown>,
  context: InboundContext
): Promise<void> {
  const what = "an answer to my Confirm it's you request"
  if (!isConfirmItsYouEnabled()) return dropped(agent, what, context.connectionId, SWITCHED_OFF)
  const relationship = await relationshipOn(agent, context.connectionId)
  if (!relationship) return dropped(agent, what, context.connectionId, NO_RELATIONSHIP)
  const outcome = await service.consume(agent.context, {
    spec: RESPONSE_SPEC as never,
    document,
    myDid: context.recipientDid,
    senderDid: context.senderDid,
    connectionId: context.connectionId,
    proofPolicy: proofUnder(agent, relationship.counterpartyRelationshipDid as string),
    handler: async (doc) => doc,
  })
  if (outcome.kind !== 'handled') return dropped(agent, what, context.connectionId, refusedAs(outcome.kind))

  const record = await recordOf(agent, CONFIRM_ASKS, context.connectionId)
  const content = record?.content as unknown as ConfirmAsksContent | undefined
  const asks = Array.isArray(content?.asks) ? content.asks : []
  const threadId = String(document.threadId ?? '')
  const index = asks.findIndex((ask) => ask.threadId === threadId)
  const ask = index >= 0 ? asks[index] : undefined
  if (!record || !ask) return dropped(agent, what, context.connectionId, 'it answers no request this phone sent')
  if (confirmStatusOf(ask) !== 'waiting')
    return dropped(agent, what, context.connectionId, 'it answers a request that is no longer waiting here')
  const answer = document.payload as ConfirmResponsePayload
  // Refused on an empty challenge too: sameChallenge holds for two empty strings.
  if (!ask.challenge || !sameChallenge(ask.challenge, String(answer?.challenge ?? '')))
    return dropped(agent, what, context.connectionId, 'it does not carry the request’s challenge back')

  const next = [...asks]
  const signedAt = Number.isFinite(Date.parse(String(answer.respondedAt))) ? String(answer.respondedAt) : undefined
  const lock = namedLock(answer.confirmedWith)
  next[index] = {
    ...ask,
    state: answer.decision,
    answeredAt: new Date().toISOString(),
    respondedAt: signedAt,
    confirmedWith: lock,
  }
  record.content = { ...(content as ConfirmAsksContent), asks: next } as unknown as Record<string, unknown>
  await agent.genericRecords.update(record)
  agent.config?.logger?.info(`${LOG_PREFIX} answered on connection ${context.connectionId}: ${answer.decision}`)
  confirmEvents.emit('answered', { connectionId: context.connectionId, decision: answer.decision })
}

/**
 * Stop waiting for the request `threadId` on `connectionId`. Local only: nothing is sent to the contact, the record is
 * marked cancelled in place, and an answer that comes later is ignored (and logged). Only a waiting request can be.
 */
export async function cancelConfirmRequest(
  agent: Pick<Agent, 'genericRecords'>,
  connectionId: string,
  threadId: string
): Promise<'cancelled' | 'notWaiting'> {
  const record = await recordOf(agent, CONFIRM_ASKS, connectionId)
  const content = record?.content as unknown as ConfirmAsksContent | undefined
  const asks = Array.isArray(content?.asks) ? content.asks : []
  const index = asks.findIndex((ask) => ask.threadId === threadId)
  if (!record || index < 0 || confirmStatusOf(asks[index]) !== 'waiting') return 'notWaiting'
  const next = [...asks]
  next[index] = { ...asks[index], state: 'cancelled' }
  record.content = { ...(content as ConfirmAsksContent), asks: next } as unknown as Record<string, unknown>
  await agent.genericRecords.update(record)
  confirmEvents.emit('asked', { connectionId })
  return 'cancelled'
}

// ---------------------------------------------------------------------------------------------------------------
// Answering (Jordan's phone)

/** A request from a contact. `open` until this phone's person answers it or its time passes. */
export interface ConfirmPrompt {
  open: boolean
  connectionId: string
  /** The asking contact's name, from the relationship. */
  asker: string
  note: string
  expiresAt: string
  request: Record<string, unknown>
  receivedAt: string
  answered?: ConfirmDecision
}

class ConfirmPromptStore {
  private prompts = new Map<string, ConfirmPrompt>()
  set(prompt: ConfirmPrompt) {
    this.prompts.set(prompt.connectionId, prompt)
  }
  get(connectionId: string) {
    return this.prompts.get(connectionId)
  }
  take(connectionId: string) {
    const prompt = this.prompts.get(connectionId)
    this.prompts.delete(connectionId)
    return prompt
  }
  /** The open ones not past their time, oldest first. */
  list(now = Date.now()) {
    return [...this.prompts.values()].filter((prompt) => prompt.open && !pastDue(prompt.expiresAt, now))
  }
  /** Tests only. */
  clear() {
    this.prompts.clear()
  }
}

export const confirmPromptStore = new ConfirmPromptStore()

const keepPrompt = (agent: Pick<Agent, 'genericRecords'>, prompt: ConfirmPrompt) =>
  keepOn(agent, CONFIRM_PROMPT, prompt.connectionId, prompt)

/**
 * A request arrives: verified under the asker's relationship DID, then shown and kept (so it comes back after a
 * restart while it is still open). Not shown if it is already past its time, or asks to stay open longer than
 * {@link CONFIRM_OPEN_AT_MOST}.
 */
export async function handleConfirmRequest(
  agent: Agent,
  service: TrustTasksService,
  document: Record<string, unknown>,
  context: InboundContext
): Promise<void> {
  const what = "a Confirm it's you request"
  if (!isConfirmItsYouEnabled()) return dropped(agent, what, context.connectionId, SWITCHED_OFF)
  const relationship = await relationshipOn(agent, context.connectionId)
  if (!relationship) return dropped(agent, what, context.connectionId, NO_RELATIONSHIP)
  const outcome = await service.consume(agent.context, {
    spec: SPEC as never,
    document,
    myDid: context.recipientDid,
    senderDid: context.senderDid,
    connectionId: context.connectionId,
    proofPolicy: proofUnder(agent, relationship.counterpartyRelationshipDid as string),
    handler: async () => undefined,
  })
  // No reply is sent here (that waits for the person), so a request that passes comes back 'accepted'.
  if (outcome.kind !== 'accepted' && outcome.kind !== 'handled')
    return dropped(agent, what, context.connectionId, refusedAs(outcome.kind))

  const payload = document.payload as ConfirmRequestPayload
  const now = Date.now()
  if (pastDue(payload.expiresAt, now)) return dropped(agent, what, context.connectionId, 'it is past its time')
  if (Date.parse(payload.expiresAt) > now + CONFIRM_OPEN_AT_MOST + SKEW)
    return dropped(agent, what, context.connectionId, 'it asks to stay open longer than a request may')

  const credentials = await agent.w3cCredentials.getAll()
  const prompt: ConfirmPrompt = {
    open: true,
    connectionId: context.connectionId,
    asker: resolveContactDisplayInfo(credentials, relationship.counterpartyRelationshipDid as string).name ?? '',
    note: payload.note,
    expiresAt: payload.expiresAt,
    request: document,
    receivedAt: new Date(now).toISOString(),
  }
  confirmPromptStore.set(prompt)
  await keepPrompt(agent, prompt).catch((error: unknown) =>
    agent.config?.logger?.warn(`${LOG_PREFIX} could not keep a request: ${(error as Error)?.message ?? error}`)
  )
  confirmEvents.emit('prompt', { connectionId: context.connectionId })
}

/** Bring back the requests kept on this phone (at start) that are still open and not past their time. */
export async function restoreConfirmPrompts(agent: Pick<Agent, 'genericRecords'>): Promise<void> {
  if (!isConfirmItsYouEnabled()) return
  const now = Date.now()
  for (const record of (await agent.genericRecords.findAllByQuery({ recordType: CONFIRM_PROMPT })) ?? []) {
    const prompt = record.content as unknown as ConfirmPrompt
    if (!prompt?.open || !prompt.connectionId || !prompt.expiresAt || pastDue(prompt.expiresAt, now)) continue
    if (confirmPromptStore.get(prompt.connectionId)) continue
    confirmPromptStore.set(prompt)
    confirmEvents.emit('prompt', { connectionId: prompt.connectionId })
  }
}

/** Ask the phone's owner to confirm, now: Face ID, fingerprint or passcode (ownerConfirm.confirmOwner in the app). */
export type ConfirmTheOwner = (reason: string) => Promise<OwnerConfirmation>

export type ConfirmAnswerResult = 'sent' | 'off' | 'gone' | 'cancelled' | 'failed' | 'unavailable'

/**
 * The lock an answer names, if it names one. An absent field, 'unknown' or anything off the list names no lock: it is
 * never sent and never shown as a claim. The field exists to name how the person unlocked their phone, and "couldn't
 * tell" is not a lock, so the asking phone must not be told one was used (it then says "confirmed on their phone").
 * 'unknown' stays accepted inbound, from other implementations of the spec, and reads exactly like absent.
 */
export function namedLock(kind: string | null | undefined): Exclude<ConfirmLock, 'unknown'> | undefined {
  return kind && kind !== 'unknown' && (CONFIRM_LOCKS as readonly string[]).includes(kind)
    ? (kind as Exclude<ConfirmLock, 'unknown'>)
    : undefined
}

/**
 * The person's answer, "it's me" or "not me". Either one needs the phone owner's lock first (`confirm`): a "not me"
 * matters as much as an "it's me" here, so both come from the owner. Not confirmed, nothing is sent and the request
 * stays. Then it is signed under this phone's relationship DID and sent; sent first, so a failed send leaves the
 * request to answer again.
 */
export async function answerConfirmRequest(
  agent: Agent,
  connectionId: string,
  decision: ConfirmDecision,
  confirm: ConfirmTheOwner,
  reason: string,
  confirmedWith: string | null = null
): Promise<ConfirmAnswerResult> {
  if (!isConfirmItsYouEnabled()) return 'off'
  const prompt = confirmPromptStore.get(connectionId)
  if (!prompt || !prompt.open || pastDue(prompt.expiresAt, Date.now())) return 'gone'
  const owner = await confirm(reason)
  if (!owner.ok) return owner.reason ?? 'failed'
  // The lock prompt can take a while: still open, and still on?
  if (!isConfirmItsYouEnabled()) return 'off'
  if (pastDue(prompt.expiresAt, Date.now())) return 'gone'
  const relationship = await relationshipOn(agent, connectionId)
  if (!relationship) throw new Error(`${LOG_PREFIX} no relationship to sign the answer under`)

  // Named only when it names a lock: an unknown kind is left out, never sent as 'unknown' (see namedLock).
  const lock = namedLock(confirmedWith)
  const answer: ConfirmResponsePayload = {
    decision,
    challenge: (prompt.request.payload as ConfirmRequestPayload).challenge,
    respondedAt: new Date().toISOString(),
    ...(lock ? { confirmedWith: lock } : {}),
  }
  const response = respondWith(prompt.request as never, utils.uuid(), answer as never, () =>
    new Date().toISOString()
  ) as unknown as Record<string, unknown>
  const signed = await signDocumentProof(agent, response, relationship.myRelationshipDid as string)
  const { getTrustTasksService, sendTrustTaskDocument } = ceremony()
  await getTrustTasksService(agent).retain(agent.context, signed, 'response', connectionId)
  await sendTrustTaskDocument(agent, connectionId, signed)

  confirmPromptStore.take(connectionId)
  confirmEvents.emit('promptCleared', { connectionId })
  await keepPrompt(agent, { ...prompt, open: false, answered: decision }).catch((error: unknown) =>
    agent.config?.logger?.warn(`${LOG_PREFIX} could not close a request: ${(error as Error)?.message ?? error}`)
  )
  agent.config?.logger?.info(`${LOG_PREFIX} answered on connection ${connectionId}: ${decision}`)
  return 'sent'
}
