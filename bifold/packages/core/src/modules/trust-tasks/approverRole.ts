/**
 * Becoming someone's trusted approver (docs/plans/trusted-approver-plan.md §4),
 * both phones: Sam asks Jordan over their VRC relationship, Jordan's phone
 * shows the offer, Jordan's answer goes back, and Sam's phone keeps a yes until
 * Sam writes the rule on Sam's agent (`VtaAgentController.setTrustedApprovers`,
 * which asks Sam to confirm).
 *
 * Every leg is signed under the sender's relationship DID and verified under
 * the DID the relationship established. Unlike the Approver demo's request,
 * nothing here is read unverified: with no relationship on the connection, the
 * document is dropped. An answer counts only against an offer this phone sent
 * on that connection, on that thread, carrying its challenge back.
 *
 * Off unless the trusted-approvers switch is on (trustedApproversFlag.ts).
 *
 * @module trust-tasks/approverRole
 */

import { TypedArrayEncoder, utils, type Agent } from '@credo-ts/core'
import { EventEmitter } from 'events'

import { RelationshipDidRepository } from '../vrc/repositories/RelationshipDidRepository'
import { resolveContactDisplayInfo } from '../vrc/utils/rcardDisplayUtils'
import { sameChallenge } from '../vrc/contacts/continuityCrypto'

import {
  RESPONSE_SPEC,
  ROLE_ACTIONS,
  SPEC,
  STEP_DOWN_SPEC,
  STEP_DOWN_TYPE_URI,
  TYPE_URI,
  type RoleOfferPayload,
  type RoleOfferResponsePayload,
  type RoleStepDownPayload,
} from './approverRoleSpec'
import { signDocumentProof, verifyDocumentProof } from './documentProof'
import { trustedKeyOf } from './module/trustedApprovers'
import { isTrustedApproversEnabled } from './module/trustedApproversFlag'
import type { GuardianOnAsk } from './guardianEvidence'
import type { InboundContext } from './registry'
import { respondWith, type TrustTasksService } from './services/TrustTasksService'

const LOG_PREFIX = '[TrustTasks:ApproverRole]'

/**
 * Why an arriving offer, answer or step-down went no further, in the log a problem report carries: never silent
 * (Alberto's two phones, 278.12, 11-10: an offer that never showed left nothing on the receiving phone). Names the
 * connection and the reason, never the contents.
 */
const dropped = (agent: Agent, what: string, connectionId: string, why: string) =>
  agent.config?.logger?.warn(`${LOG_PREFIX} ${what} on connection ${connectionId} not taken: ${why}`)
const SWITCHED_OFF = 'trusted approvers are switched off on this phone (Settings › Developer)'
const NO_RELATIONSHIP = 'no relationship with this contact to check it against'
const refusedAs = (kind: string) => `it did not pass its check (${kind})`

/**
 * genericRecords recordType of the offer this phone sent to a contact: one per connection, its state changed in place
 * (open, accepted, closed) rather than deleted, so this feature never deletes stored records and goes out over the air.
 */
export const ROLE_OFFER_ASK = 'keyring.approver-role-offer-ask'
/** genericRecords recordType of an offer from a contact to this phone's person: one per connection, as above. */
export const ROLE_OFFER_PROMPT = 'keyring.approver-role-offer-prompt'

const DAY = 24 * 60 * 60 * 1000
/** How long an offer can be answered. After that the asking phone forgets it, and the asked phone stops showing it. */
export const OFFER_OPEN_FOR = 14 * DAY
const CHALLENGE_BYTES = 32
const DID = /^did:[a-z0-9]+:.+/

export type RoleAction = (typeof ROLE_ACTIONS)[number]

/** The ceremony module, reached lazily: it registers this type, so importing it at the top would be a cycle. */
function ceremony(): typeof import('./ceremony') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  return require('./ceremony')
}

/**
 * 'offer' (a prompt arrived or was brought back), 'promptCleared' (this phone answered one), 'answered' (an answer to
 * one of my offers arrived), 'asked' (this phone sent an offer).
 */
export const approverRoleEvents = new EventEmitter()

interface Relationship {
  connectionId?: string
  myRelationshipDid?: string
  counterpartyRelationshipDid?: string
}

/** The relationship on `connectionId`, with both relationship DIDs, if any (shared with guardianEvidence.ts). */
export async function relationshipOn(agent: Agent, connectionId: string): Promise<Relationship | undefined> {
  const all: Relationship[] = await agent.dependencyManager.resolve(RelationshipDidRepository).getAll(agent.context)
  const found = all.find((record) => record.connectionId === connectionId)
  return found?.myRelationshipDid && found.counterpartyRelationshipDid ? found : undefined
}

/** A proof policy: the document is signed under `controller` (shared with guardianEvidence.ts). */
export const proofUnder = (agent: Agent, controller: string) => ({
  kind: 'verify' as const,
  verify: { verify: (doc: unknown) => verifyDocumentProof(agent, doc as Record<string, unknown>, controller) },
})

const lapsed = (at: string, now = Date.now()) => !(now - Date.parse(at) < OFFER_OPEN_FOR)

/** The one record of `recordType` on `connectionId`, its content replaced; saved the first time. */
async function keepOn(
  agent: Pick<Agent, 'genericRecords'>,
  recordType: string,
  connectionId: string,
  content: object
): Promise<void> {
  const [existing] = (await agent.genericRecords.findAllByQuery({ recordType, connectionId })) ?? []
  if (existing) {
    existing.content = { ...content }
    await agent.genericRecords.update(existing)
  } else {
    await agent.genericRecords.save({ content: { ...content }, tags: { recordType, connectionId } })
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Asking (Sam's phone)

/** The offer this phone sent to a contact. `accepted`: a yes not yet written on the agent. */
export interface RoleOfferAsk {
  state: 'open' | 'accepted' | 'closed'
  connectionId: string
  threadId: string
  agentDid: string
  actions: RoleAction[]
  challenge: string
  askedAt: string
  /** Set when the contact said yes: the DID their phone approves as. */
  acceptedAs?: string
  /** Closed with the yes written on the agent: the contact approves for this person (as far as this phone wrote). */
  written?: boolean
  /**
   * The arrangement written on the agent, kept apart from the offer: the DID it names and the actions it was written
   * for. A re-offer ("Change what … approves") replaces the offer fields (state, actions, challenge, acceptedAs) but
   * never these, so the approver in force is still known, named and able to step down while a new offer is open.
   * Cleared only by {@link approverRemoved}.
   */
  writtenAs?: string
  writtenActions?: RoleAction[]
  /**
   * When the contact said they no longer approve (a verified step-down). Only told: the agent keeps them until this
   * phone writes them off, which the person confirms on Who approves.
   */
  steppedDown?: string
  /**
   * The state Guardian card the contact sent after their yes, and its last verdict (guardianEvidence.ts). Shown only
   * beside the DID it was sent as.
   */
  guardian?: GuardianOnAsk
}

/** The DID written on the agent for this contact, if any (a record from before writtenAs: its acceptedAs). */
export const writtenAsOf = (ask: RoleOfferAsk): string | undefined =>
  ask.written ? (ask.writtenAs ?? ask.acceptedAs) : undefined

/** The actions written on the agent for this contact (a record from before writtenActions: its actions). */
export const writtenActionsOf = (ask: RoleOfferAsk): RoleAction[] =>
  ask.written ? (ask.writtenActions ?? ask.actions) : []

export type OfferResult = 'sent' | 'off' | 'noRelationship'

/**
 * Ask the contact on `connectionId` to approve `actions` on the agent `agentDid`. A new offer replaces the earlier
 * one on the same connection, answered or not: an answer to the earlier one then counts for nothing. Refuses an unknown action or an agent that is not a DID before sending.
 */
export async function offerApproverRole(
  agent: Agent,
  connectionId: string,
  agentDid: string,
  actions: readonly RoleAction[]
): Promise<OfferResult> {
  if (!isTrustedApproversEnabled()) return 'off'
  if (!DID.test(agentDid)) throw new Error(`${LOG_PREFIX} the agent is not a DID: ${agentDid}`)
  const chosen = [...new Set(actions)]
  if (chosen.length === 0) throw new Error(`${LOG_PREFIX} no action to offer`)
  for (const action of chosen)
    if (!ROLE_ACTIONS.includes(action)) throw new Error(`${LOG_PREFIX} unknown action: ${String(action)}`)

  const relationship = await relationshipOn(agent, connectionId)
  if (!relationship) return 'noRelationship'
  const connection = await agent.modules.didcomm.connections.getById(connectionId)
  if (!connection.did || !connection.theirDid) return 'noRelationship'

  const challenge = TypedArrayEncoder.toBase64Url(agent.kms.randomBytes({ length: CHALLENGE_BYTES }))
  const id = utils.uuid()
  const payload: RoleOfferPayload = { agent: agentDid, actions: chosen, challenge }
  const document: Record<string, unknown> = {
    id,
    type: TYPE_URI,
    threadId: id,
    issuer: connection.did,
    recipient: connection.theirDid,
    issuedAt: new Date().toISOString(),
    payload,
  }
  const signed = await signDocumentProof(agent, document, relationship.myRelationshipDid as string)

  // A re-offer replaces the offer, never the arrangement already written on the agent (writtenAs / writtenActions).
  const [earlier] = (await agent.genericRecords.findAllByQuery({ recordType: ROLE_OFFER_ASK, connectionId })) ?? []
  const before = earlier?.content as unknown as RoleOfferAsk | undefined
  const inForce = before && writtenAsOf(before)
  const ask: RoleOfferAsk = {
    state: 'open',
    connectionId,
    threadId: id,
    agentDid,
    actions: chosen,
    challenge,
    askedAt: new Date().toISOString(),
    ...(before && inForce
      ? { written: true, writtenAs: inForce, writtenActions: writtenActionsOf(before), steppedDown: before.steppedDown }
      : {}),
    // The card sent as the approver in force stays with them; a card sent as anyone else answers nothing now.
    ...(before?.guardian && inForce && before.guardian.approver === inForce ? { guardian: before.guardian } : {}),
  }
  await keepOn(agent, ROLE_OFFER_ASK, connectionId, ask)
  const { getTrustTasksService, sendTrustTaskDocument } = ceremony()
  await getTrustTasksService(agent).retain(agent.context, signed, 'request', connectionId)
  await sendTrustTaskDocument(agent, connectionId, signed)
  agent.config?.logger?.info(`${LOG_PREFIX} offer sent on connection ${connectionId}: ${chosen.join(', ')}`)
  approverRoleEvents.emit('asked', { connectionId })
  return 'sent'
}

/** The contact's answer to my offer arrives: a yes is kept (to be written on the agent), a no closes the offer. */
export async function handleRoleOfferResponse(
  agent: Agent,
  service: TrustTasksService,
  document: Record<string, unknown>,
  context: InboundContext
): Promise<void> {
  if (!isTrustedApproversEnabled())
    return dropped(agent, 'an answer to my approver offer', context.connectionId, SWITCHED_OFF)
  const relationship = await relationshipOn(agent, context.connectionId)
  if (!relationship) return dropped(agent, 'an answer to my approver offer', context.connectionId, NO_RELATIONSHIP)
  const outcome = await service.consume(agent.context, {
    spec: RESPONSE_SPEC as never,
    document,
    myDid: context.recipientDid,
    senderDid: context.senderDid,
    connectionId: context.connectionId,
    proofPolicy: proofUnder(agent, relationship.counterpartyRelationshipDid as string),
    handler: async (doc) => doc,
  })
  if (outcome.kind !== 'handled')
    return dropped(agent, 'an answer to my approver offer', context.connectionId, refusedAs(outcome.kind))

  const [record] =
    (await agent.genericRecords.findAllByQuery({ recordType: ROLE_OFFER_ASK, connectionId: context.connectionId })) ??
    []
  if (!record) return
  const ask = record.content as unknown as RoleOfferAsk
  if (ask.state !== 'open' || ask.threadId !== String(document.threadId ?? '') || lapsed(ask.askedAt))
    return dropped(
      agent,
      'an answer to my approver offer',
      context.connectionId,
      'it answers an offer that is no longer open here'
    )
  const answer = document.payload as RoleOfferResponsePayload
  // An answer that does not carry this offer's challenge back answers nothing; the offer stays for the real one.
  // Refused on an empty challenge too: sameChallenge holds for two empty strings, and this check must not rest on
  // every offer having one.
  if (!ask.challenge || !sameChallenge(ask.challenge, String(answer?.challenge ?? ''))) return

  if (answer.decision === 'accepted') {
    if (!answer.approver || !DID.test(answer.approver)) return
    record.content = { ...ask, state: 'accepted', acceptedAs: answer.approver }
  } else {
    record.content = { ...ask, state: 'closed' }
  }
  await agent.genericRecords.update(record)
  approverRoleEvents.emit('answered', { connectionId: context.connectionId, decision: answer.decision })
}

/** The yeses waiting to be written on my agent. */
export async function acceptedRoleOffers(agent: Pick<Agent, 'genericRecords'>): Promise<RoleOfferAsk[]> {
  const records = (await agent.genericRecords.findAllByQuery({ recordType: ROLE_OFFER_ASK })) ?? []
  return records
    .map((record) => record.content as unknown as RoleOfferAsk)
    .filter((ask) => ask.state === 'accepted' && !!ask.acceptedAs)
}

/**
 * Close the offer on `connectionId`: `written` once its yes is written on the agent, else the person chose not to
 * write it.
 */
export async function closeRoleOffer(
  agent: Pick<Agent, 'genericRecords'>,
  connectionId: string,
  written = false
): Promise<void> {
  const [record] = (await agent.genericRecords.findAllByQuery({ recordType: ROLE_OFFER_ASK, connectionId })) ?? []
  if (!record) return
  const ask = record.content as unknown as RoleOfferAsk
  record.content = written
    ? { ...ask, state: 'closed', written: true, writtenAs: ask.acceptedAs, writtenActions: ask.actions }
    : // Not written now: an arrangement written earlier (a re-offer the person chose not to add) stays as it was.
      { ...ask, state: 'closed', written: !!ask.writtenAs || !!ask.written }
  await agent.genericRecords.update(record)
  approverRoleEvents.emit('asked', { connectionId })
}

/** `did` was taken off the agent's approvers: the offer it said yes to no longer reads as written. */
export async function approverRemoved(agent: Pick<Agent, 'genericRecords'>, did: string): Promise<void> {
  for (const record of (await agent.genericRecords.findAllByQuery({ recordType: ROLE_OFFER_ASK })) ?? []) {
    const ask = record.content as unknown as RoleOfferAsk
    if (writtenAsOf(ask) !== did) continue
    record.content = { ...ask, written: false, writtenAs: undefined, writtenActions: undefined }
    await agent.genericRecords.update(record)
    approverRoleEvents.emit('asked', { connectionId: ask.connectionId })
  }
}

/**
 * Who approves, and for what, once `ask`'s yes is added to what the agent holds now: the approver joins the one
 * set, and the actions are those already held plus the ones offered. The set approves every action it holds.
 */
export function approversWithAccepted(
  held: { approvers: readonly string[]; keys: readonly RoleAction[] },
  ask: Pick<RoleOfferAsk, 'acceptedAs' | 'actions'>
): { approvers: string[]; keys: RoleAction[] } {
  if (!ask.acceptedAs) return { approvers: [...held.approvers], keys: [...held.keys] }
  const keys = ROLE_ACTIONS.filter((action) => held.keys.includes(action) || ask.actions.includes(action))
  return { approvers: [...new Set([...held.approvers, ask.acceptedAs])], keys }
}

/**
 * The DIDs this phone knows the contact on `ask` approves as: the one written on the agent, and the one their last yes
 * named. Only these can be matched against the agent's rules: the agent lists approvers by the DID each said yes as,
 * which is not a DID of the relationship, so with no record this phone cannot tell which listed approver is this
 * contact.
 */
export const approverDidsOf = (ask: RoleOfferAsk | undefined): string[] =>
  ask ? [...new Set([writtenAsOf(ask), ask.acceptedAs].filter((did): did is string => !!did))] : []

/**
 * Whether the agent's own rules, as just read, list the contact on `ask` as an approver. No read (it failed, is still
 * running, or was not made: `view` null) WITHHOLDS: never a yes.
 */
export function agentListsApprover(
  view: { approvers: readonly string[] } | null,
  ask: RoleOfferAsk | undefined
): boolean {
  if (!view) return false
  return approverDidsOf(ask).some((did) => view.approvers.includes(did))
}

/**
 * Whether asking the contact on `ask` for `actions` would ask for nothing new: the agent's rules, as just read, list
 * them, and already hold every one of `actions` (the one set approves every action it holds). Then no offer is sent.
 * No read (`view` null) is never "nothing new", so the offer goes as it always did.
 *
 * This depends on the agent's model being ONE approver set that approves every action it holds (see
 * {@link approversWithAccepted}): a listed approver then covers every held action. If the agent ever gains
 * per-approver scopes, this becomes wrong in the dangerous direction (it would call an action covered that this
 * approver does not hold, and suppress the ask); it must then read that approver's own actions.
 */
export function agentAlreadyCovers(
  view: { approvers: readonly string[]; keys: readonly RoleAction[] } | null,
  ask: RoleOfferAsk | undefined,
  actions: readonly RoleAction[]
): boolean {
  if (!view || !agentListsApprover(view, ask)) return false
  return actions.every((action) => view.keys.includes(action))
}

/** The offer this phone sent on `connectionId`, if any, in whatever state it is now (the contact's row reads it). */
export async function roleOfferAskOn(
  agent: Pick<Agent, 'genericRecords'>,
  connectionId: string
): Promise<RoleOfferAsk | undefined> {
  const [record] = (await agent.genericRecords.findAllByQuery({ recordType: ROLE_OFFER_ASK, connectionId })) ?? []
  const ask = record?.content as unknown as RoleOfferAsk | undefined
  if (!ask) return undefined
  // An open offer past its time answers nothing (handleRoleOfferResponse): it reads as closed, so it can be sent again.
  return ask.state === 'open' && lapsed(ask.askedAt) ? { ...ask, state: 'closed' } : ask
}

/**
 * What to write on the agent once `ask`'s yes is taken: {@link approversWithAccepted}, less any action another rule
 * already holds (the agent's rule there is someone else's, and `withTrustedApprovers` refuses to cover it).
 */
export function nextTrustedRules(
  view: { approvers: readonly string[]; keys: readonly RoleAction[]; heldElsewhere: readonly RoleAction[] },
  ask: Pick<RoleOfferAsk, 'acceptedAs' | 'actions'>
): { approvers: string[]; keys: RoleAction[] } {
  const next = approversWithAccepted(view, ask)
  return { approvers: next.approvers, keys: next.keys.filter((key) => !view.heldElsewhere.includes(key)) }
}

/** What to write on the agent to take `did` off: the others keep every action; with nobody left, nothing is held. */
export function withoutApprover(
  view: { approvers: readonly string[]; keys: readonly RoleAction[] },
  did: string
): { approvers: string[]; keys: RoleAction[] } {
  const approvers = view.approvers.filter((member) => member !== did)
  return { approvers, keys: approvers.length ? [...view.keys] : [] }
}

/**
 * Names for the approvers this phone has offered the role to, by the DID each said yes as: the contact's name from
 * the relationship. An approver set on the agent some other way has no name here; the screen says so.
 */
export async function approverNames(agent: Agent): Promise<Record<string, string>> {
  const records = (await agent.genericRecords.findAllByQuery({ recordType: ROLE_OFFER_ASK })) ?? []
  const asks = records
    .map((record) => record.content as unknown as RoleOfferAsk)
    .filter((ask) => !!ask.acceptedAs || !!writtenAsOf(ask))
  if (!asks.length) return {}
  const relationships: Relationship[] = await agent.dependencyManager
    .resolve(RelationshipDidRepository)
    .getAll(agent.context)
  const credentials = await agent.w3cCredentials.getAll()
  const names: Record<string, string> = {}
  for (const ask of asks) {
    const theirs = relationships.find((r) => r.connectionId === ask.connectionId)?.counterpartyRelationshipDid
    const name = theirs ? resolveContactDisplayInfo(credentials, theirs).name : undefined
    if (!name) continue
    if (ask.acceptedAs) names[ask.acceptedAs] = name
    const inForce = writtenAsOf(ask)
    if (inForce) names[inForce] = name
  }
  return names
}

// ---------------------------------------------------------------------------------------------------------------
// Answering (Jordan's phone)

/** An offer from a contact. `open` until this phone's person answers it. */
export interface RoleOfferPrompt {
  open: boolean
  connectionId: string
  /** The asking contact's name, from the relationship. */
  asker: string
  agentDid: string
  actions: RoleAction[]
  request: Record<string, unknown>
  receivedAt: string
  /** Set once this phone's person answered; with `accepted`, the DID the yes named. `steppedDown`: a yes taken back. */
  answered?: 'accepted' | 'declined' | 'steppedDown'
  answeredAs?: string
}

class RoleOfferPromptStore {
  private prompts = new Map<string, RoleOfferPrompt>()
  set(prompt: RoleOfferPrompt) {
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
  list() {
    return [...this.prompts.values()]
  }
  /** Tests only. */
  clear() {
    this.prompts.clear()
  }
}

export const roleOfferPromptStore = new RoleOfferPromptStore()

/** An offer arrives: verified under the asker's relationship DID, then shown (and kept across a restart). */
export async function handleRoleOfferRequest(
  agent: Agent,
  service: TrustTasksService,
  document: Record<string, unknown>,
  context: InboundContext
): Promise<void> {
  if (!isTrustedApproversEnabled()) return dropped(agent, 'an approver offer', context.connectionId, SWITCHED_OFF)
  const relationship = await relationshipOn(agent, context.connectionId)
  if (!relationship) return dropped(agent, 'an approver offer', context.connectionId, NO_RELATIONSHIP)
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
    return dropped(agent, 'an approver offer', context.connectionId, refusedAs(outcome.kind))

  const payload = document.payload as RoleOfferPayload
  const credentials = await agent.w3cCredentials.getAll()
  const prompt: RoleOfferPrompt = {
    open: true,
    connectionId: context.connectionId,
    asker: resolveContactDisplayInfo(credentials, relationship.counterpartyRelationshipDid as string).name ?? '',
    agentDid: payload.agent,
    actions: [...payload.actions],
    request: document,
    receivedAt: new Date().toISOString(),
  }
  roleOfferPromptStore.set(prompt)
  await keepPrompt(agent, prompt).catch((error: unknown) =>
    agent.config?.logger?.warn(`${LOG_PREFIX} could not keep an offer: ${(error as Error)?.message ?? error}`)
  )
  approverRoleEvents.emit('offer', { connectionId: context.connectionId })
}

const keepPrompt = (agent: Pick<Agent, 'genericRecords'>, prompt: RoleOfferPrompt) =>
  keepOn(agent, ROLE_OFFER_PROMPT, prompt.connectionId, prompt)

/** Bring back the offers kept on this phone (at start) that are still open. A lapsed one is not shown. */
export async function restoreRoleOfferPrompts(agent: Pick<Agent, 'genericRecords'>): Promise<void> {
  for (const record of (await agent.genericRecords.findAllByQuery({ recordType: ROLE_OFFER_PROMPT })) ?? []) {
    const prompt = record.content as unknown as RoleOfferPrompt
    if (!prompt?.open || !prompt.connectionId || !prompt.receivedAt || lapsed(prompt.receivedAt)) continue
    if (roleOfferPromptStore.get(prompt.connectionId)) continue
    roleOfferPromptStore.set(prompt)
    approverRoleEvents.emit('offer', { connectionId: prompt.connectionId })
  }
}

/**
 * The person's answer to an offer, signed under this phone's relationship DID and sent back: a yes names
 * `approverDid`, the DID this phone approves as; a no is sent too. Sent first: if sending fails, the offer stays and
 * the person can answer again.
 */
export async function respondToRoleOffer(
  agent: Agent,
  connectionId: string,
  accept: boolean,
  approverDid?: string
): Promise<void> {
  const prompt = roleOfferPromptStore.get(connectionId)
  if (!prompt) return
  if (accept && !(approverDid && DID.test(approverDid)))
    throw new Error(`${LOG_PREFIX} a yes needs the DID this phone approves as`)
  const relationship = await relationshipOn(agent, connectionId)
  if (!relationship) throw new Error(`${LOG_PREFIX} no relationship to sign the answer under`)

  const answer: RoleOfferResponsePayload = {
    decision: accept ? 'accepted' : 'declined',
    challenge: (prompt.request.payload as RoleOfferPayload).challenge,
    ...(accept ? { approver: approverDid } : {}),
    respondedAt: new Date().toISOString(),
  }
  const response = respondWith(prompt.request as never, utils.uuid(), answer as never, () =>
    new Date().toISOString()
  ) as unknown as Record<string, unknown>
  const signed = await signDocumentProof(agent, response, relationship.myRelationshipDid as string)
  const { getTrustTasksService, sendTrustTaskDocument } = ceremony()
  await getTrustTasksService(agent).retain(agent.context, signed, 'response', connectionId)
  await sendTrustTaskDocument(agent, connectionId, signed)

  roleOfferPromptStore.take(connectionId)
  approverRoleEvents.emit('promptCleared', { connectionId })
  const kept: RoleOfferPrompt = {
    ...prompt,
    open: false,
    answered: accept ? 'accepted' : 'declined',
    ...(accept ? { answeredAs: approverDid } : {}),
  }
  await keepPrompt(agent, kept).catch((error: unknown) =>
    agent.config?.logger?.warn(`${LOG_PREFIX} could not close an offer: ${(error as Error)?.message ?? error}`)
  )
  // After the yes, and only after it is sent and kept: this phone's state Guardian card, if it holds one and its person
  // said yes to sending it to this contact; never asked, they are asked and nothing goes (guardianEvidence.ts; nothing
  // with either switch off). The yes stands whatever happens to the card, a no to sending it included.
  if (accept)
    await guardianEvidence()
      .guardianCardAfterYes(agent, prompt, approverDid as string)
      .catch((error: unknown) =>
        agent.config?.logger?.warn(
          `${LOG_PREFIX} could not send the guardian card: ${(error as Error)?.message ?? error}`
        )
      )
}

/** The Guardian card module, reached lazily: it reads this module's records, so importing it at the top is a cycle. */
function guardianEvidence(): typeof import('./guardianEvidence') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  return require('./guardianEvidence')
}

/**
 * The people this phone's person said yes to ("People I approve for"), newest first. Only what this phone answered:
 * whether the asker then wrote the rule on their agent is theirs to say.
 */
export async function approvingFor(agent: Pick<Agent, 'genericRecords'>): Promise<RoleOfferPrompt[]> {
  const records = (await agent.genericRecords.findAllByQuery({ recordType: ROLE_OFFER_PROMPT })) ?? []
  return records
    .map((record) => record.content as unknown as RoleOfferPrompt)
    .filter((prompt) => prompt?.answered === 'accepted')
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
}

// ---------------------------------------------------------------------------------------------------------------
// Stepping down (Jordan's phone tells Sam's)

/**
 * This phone's person no longer approves for the contact on `connectionId`: a step-down, signed under this phone's
 * relationship DID, goes to the contact's phone, and the yes kept here reads as taken back, so requests from that
 * agent are no longer shown (foreignApproval.ts reads {@link approvingFor}). Sent first: if sending fails, nothing
 * changes and the person can try again. The record's state is changed in place, never deleted.
 */
export async function stepDownAsApprover(agent: Agent, connectionId: string): Promise<'sent' | 'off' | 'notApproving'> {
  if (!isTrustedApproversEnabled()) return 'off'
  const [record] = (await agent.genericRecords.findAllByQuery({ recordType: ROLE_OFFER_PROMPT, connectionId })) ?? []
  const prompt = record?.content as unknown as RoleOfferPrompt | undefined
  if (!prompt || prompt.answered !== 'accepted' || !prompt.answeredAs) return 'notApproving'
  const relationship = await relationshipOn(agent, connectionId)
  if (!relationship) throw new Error(`${LOG_PREFIX} no relationship to sign the step-down under`)
  const connection = await agent.modules.didcomm.connections.getById(connectionId)
  if (!connection.did || !connection.theirDid) throw new Error(`${LOG_PREFIX} the connection has no DIDs`)

  const id = utils.uuid()
  const payload: RoleStepDownPayload = {
    agent: prompt.agentDid,
    approver: prompt.answeredAs,
    steppedDownAt: new Date().toISOString(),
  }
  const document: Record<string, unknown> = {
    id,
    type: STEP_DOWN_TYPE_URI,
    threadId: id,
    issuer: connection.did,
    recipient: connection.theirDid,
    issuedAt: new Date().toISOString(),
    payload,
  }
  const signed = await signDocumentProof(agent, document, relationship.myRelationshipDid as string)
  const { getTrustTasksService, sendTrustTaskDocument } = ceremony()
  await getTrustTasksService(agent).retain(agent.context, signed, 'request', connectionId)
  await sendTrustTaskDocument(agent, connectionId, signed)

  await keepPrompt(agent, { ...prompt, answered: 'steppedDown' })
  agent.config?.logger?.info(`${LOG_PREFIX} stepped down on connection ${connectionId}`)
  approverRoleEvents.emit('promptCleared', { connectionId })
  return 'sent'
}

/**
 * A contact's step-down arrives: verified under their relationship DID, it marks the offer they had said yes to as
 * stepped down. It counts only for the DID they said yes as and the agent the offer named; anything else is dropped.
 * Nothing is written on the agent here: removing them is the person's to confirm, on Who approves.
 */
export async function handleRoleStepDown(
  agent: Agent,
  service: TrustTasksService,
  document: Record<string, unknown>,
  context: InboundContext
): Promise<void> {
  if (!isTrustedApproversEnabled()) return dropped(agent, 'a step-down', context.connectionId, SWITCHED_OFF)
  const relationship = await relationshipOn(agent, context.connectionId)
  if (!relationship) return dropped(agent, 'a step-down', context.connectionId, NO_RELATIONSHIP)
  const outcome = await service.consume(agent.context, {
    spec: STEP_DOWN_SPEC as never,
    document,
    myDid: context.recipientDid,
    senderDid: context.senderDid,
    connectionId: context.connectionId,
    proofPolicy: proofUnder(agent, relationship.counterpartyRelationshipDid as string),
    handler: async () => undefined,
  })
  if (outcome.kind !== 'accepted' && outcome.kind !== 'handled')
    return dropped(agent, 'a step-down', context.connectionId, refusedAs(outcome.kind))

  const payload = document.payload as RoleStepDownPayload
  const [record] =
    (await agent.genericRecords.findAllByQuery({ recordType: ROLE_OFFER_ASK, connectionId: context.connectionId })) ??
    []
  const ask = record?.content as unknown as RoleOfferAsk | undefined
  if (!record || !ask || ask.agentDid !== payload.agent) return
  // The approver in force is matched first: the DID written on the agent, kept apart from any newer offer.
  const inForce = writtenAsOf(ask)
  if (inForce && inForce === payload.approver) {
    // A step-down from the written arrangement is never lost to a newer offer. It can only be sent while the
    // approver's prompt reads accepted, and a new offer resets that prompt, so a step-down while a re-offer is open
    // means the approver had not seen the re-offer: a withdrawal from approving for this person, not an answer to
    // the new set. So the re-offer closes too, and Who approves asks the person to remove them.
    record.content = { ...ask, state: 'closed', steppedDown: payload.steppedDownAt }
  } else {
    if (!ask.acceptedAs || ask.acceptedAs !== payload.approver) return
    // A first offer still open names nothing written: a step-down never counts against it (the in-flight crossing of
    // a first offer and a step-down; nothing is held for this contact then).
    if (ask.state === 'open') return
    // A yes not yet written is simply taken back.
    record.content = {
      ...ask,
      ...(ask.state === 'accepted' ? { state: 'closed' } : {}),
      steppedDown: payload.steppedDownAt,
    }
  }
  await agent.genericRecords.update(record)
  agent.config?.logger?.info(`${LOG_PREFIX} a contact stepped down on connection ${context.connectionId}`)
  approverRoleEvents.emit('answered', { connectionId: context.connectionId, decision: 'steppedDown' })
}

/**
 * The approvers this phone wrote on its agent who cover `taskType` (by the actions each was offered), by name: who a
 * task held for consent is waiting on, as far as this phone knows. Empty when the task is not a trusted action or no
 * written approver covers it; then the hold is some other rule's, and nothing here names it.
 */
export async function approversWaitedOn(agent: Agent, taskType: string): Promise<string[]> {
  const key = trustedKeyOf(taskType)
  if (!key) return []
  const records = (await agent.genericRecords.findAllByQuery({ recordType: ROLE_OFFER_ASK })) ?? []
  const asks = records.map((record) => record.content as unknown as RoleOfferAsk)
  const written = asks.filter((ask) => !!writtenAsOf(ask))
  // The one set approves every action it holds: one written approver covering it means all of them are asked.
  if (!written.some((ask) => writtenActionsOf(ask).includes(key))) return []
  const names = await approverNames(agent)
  return written.map((ask) => names[writtenAsOf(ask) as string]).filter((name): name is string => !!name)
}

/** The DIDs of approvers still written on the agent who said they stepped down: theirs to remove, on Who approves. */
export async function steppedDownApprovers(agent: Pick<Agent, 'genericRecords'>): Promise<string[]> {
  const records = (await agent.genericRecords.findAllByQuery({ recordType: ROLE_OFFER_ASK })) ?? []
  return records
    .map((record) => record.content as unknown as RoleOfferAsk)
    .filter((ask) => ask.steppedDown && !!writtenAsOf(ask))
    .map((ask) => writtenAsOf(ask) as string)
}
