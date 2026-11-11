/**
 * An approver's state Guardian card, carried to the phone of the person they approve for and checked there
 * (trusted-approver plan, stage 2, S1). Jordan says yes to approving for Sam; if Jordan's phone holds a Guardian card,
 * it sends the chain after the yes (approver/guardian-evidence/0.1, signed under its relationship DID). Sam's phone
 * checks it with sedi/guardian's verifyGuardian against the State roots this build trusts (sedi/guardian/stateRoots)
 * and the ward set on this phone, keeps the card and the verdict on the offer's record, and checks it again each
 * time Who approves opens (a card can expire or a root can leave the list).
 *
 * Jordan is asked first (Alberto, 2026-11-11): the card shows Sam Jordan's KERI identifier and the state's record of it,
 * so it goes only once Jordan has said yes to sending it to Sam, an answer asked once per person and kept. Never asked
 * means nothing is sent ({@link guardianCardAfterYes}).
 *
 * Behind both switches: trusted approvers (isTrustedApproversEnabled) and state-verified approvers
 * (isStateVerifiedApproversEnabled), each of which the SEDI/KERI umbrella turns off. Off, nothing is asked, nothing is
 * sent, nothing arriving is read, and nothing is shown.
 *
 * What a verified card says, and no more: a State root on this phone's list names the card's holder as the guardian
 * of this phone's ward. It does not say the contact's phone controls that holder (that waits for the approver's own
 * KERI identity, stage 3), and the ward is a Developer setting, not yet bound to the person (KH-P3).
 *
 * Every record here is changed in place, never deleted.
 *
 * @module trust-tasks/guardianEvidence
 */
import { utils, type Agent } from '@credo-ts/core'
import { EventEmitter } from 'events'

import { verifyGuardian, type ChainMaterial } from '../sedi/guardian'
import { K0_TEST_GUARDIAN_CARD } from '../sedi/guardian/k0TestCard'
import { K0_TEST_WARD, trustedStateRoots } from '../sedi/guardian/stateRoots'

import {
  ROLE_OFFER_ASK,
  approverRoleEvents,
  approvingFor,
  proofUnder,
  relationshipOn,
  writtenAsOf,
  type RoleOfferAsk,
  type RoleOfferPrompt,
} from './approverRole'
import {
  GUARDIAN_EVIDENCE_MAX_BYTES,
  GUARDIAN_EVIDENCE_SPEC,
  GUARDIAN_EVIDENCE_TYPE_URI,
  type GuardianEvidencePayload,
} from './approverRoleSpec'
import { signDocumentProof } from './documentProof'
import { isStateVerifiedApproversEnabled } from './module/stateVerifiedApproversFlag'
import { isTrustedApproversEnabled } from './module/trustedApproversFlag'
import { isTrustTestStateEnabled } from './module/trustTestStateFlag'
import type { InboundContext } from './registry'
import type { TrustTasksService } from './services/TrustTasksService'

const LOG_PREFIX = '[TrustTasks:GuardianEvidence]'

/** genericRecords recordType of the Guardian card this phone holds to send (one record, changed in place). */
export const GUARDIAN_EVIDENCE_HELD = 'keyring.sedi-guardian-evidence-held'
/** genericRecords recordType of this phone's ward for Guardian checks (one record, changed in place). */
export const STATE_WARD = 'keyring.sedi-state-ward'
/**
 * genericRecords recordType of this phone's answer to "Also send your Guardian card to <name>?": one record per
 * connection, changed in place, never deleted.
 */
export const GUARDIAN_CARD_CONSENT = 'keyring.sedi-guardian-card-consent'

/** The card itself: the Guardian credential, the holder it names, and the chain to its root. */
export type GuardianEvidence = Pick<GuardianEvidencePayload, 'guardianSaid' | 'holder' | 'kels' | 'tels' | 'creds'>

/**
 * What the last check said. `ok: true` only from verifyGuardian's valid result on a root this build trusts, and its
 * `state` is the name on this phone's list, never one the sender gave. Every other outcome is a refusal, kept with
 * its reason for the details line and the log.
 */
export type GuardianVerdict =
  | { ok: true; root: string; state: string; checkedAt: string; expires?: string }
  | { ok: false; reason: string; detail: string; checkedAt: string }

/** Kept on the offer's record (RoleOfferAsk.guardian): the card a contact sent, as whom, and the last verdict. */
export interface GuardianOnAsk {
  approver: string
  evidence: GuardianEvidence
  receivedAt: string
  verdict: GuardianVerdict
}

/**
 * What Who approves shows beside an approver: a card from a named state ("Has a Guardian card from <state>"), or could
 * not verify, with the outcome. An approver who sent no card (never asked, or chose not to) has no standing at all, so
 * no line: not sharing is a choice, never shown as a failed check.
 */
export type GuardianStanding = { kind: 'verified'; state: string } | { kind: 'unverified'; outcome: string }

const OFF = 'state-verified approvers are switched off on this phone (Settings › Developer)'
const warn = (agent: Pick<Agent, 'config'>, message: string) => agent.config?.logger?.warn(`${LOG_PREFIX} ${message}`)
const isOn = () => isTrustedApproversEnabled() && isStateVerifiedApproversEnabled()

const te = new TextEncoder()

/** The size the cap reads: kels, tels and creds as UTF-8 JSON. Never throws on a shape it does not expect. */
export function evidenceBytes(
  evidence: Partial<Pick<GuardianEvidence, 'kels' | 'tels' | 'creds'>> | undefined
): number {
  const json = JSON.stringify({ kels: evidence?.kels, tels: evidence?.tels, creds: evidence?.creds })
  return te.encode(json ?? '').length
}

const evidenceOf = (from: GuardianEvidence): GuardianEvidence => ({
  guardianSaid: from.guardianSaid,
  holder: from.holder,
  kels: from.kels,
  tels: from.tels,
  creds: from.creds,
})

/**
 * Check a card against this phone's ward and trusted roots. Never throws, and never returns `ok: true` from a catch:
 * verifyGuardian still throws on an error it does not expect (only unreadable material and unknown digest codes are
 * refusals), and such a throw is a refusal here (`checkFailed`), logged through `onThrow`.
 */
export function checkGuardianEvidence(
  evidence: GuardianEvidence,
  ward: string | null,
  now: Date,
  onThrow: (message: string) => void
): GuardianVerdict {
  const checkedAt = now.toISOString()
  const refuse = (reason: string, detail: string): GuardianVerdict => ({ ok: false, reason, detail, checkedAt })
  if (!ward) return refuse('noWard', 'no ward is set on this phone (Settings › Developer)')
  if (evidenceBytes(evidence) > GUARDIAN_EVIDENCE_MAX_BYTES)
    return refuse('tooLarge', `the card is over ${GUARDIAN_EVIDENCE_MAX_BYTES} bytes`)
  try {
    const roots = trustedStateRoots()
    const material: ChainMaterial = {
      kels: evidence.kels.map((kel) => te.encode(kel)),
      tels: evidence.tels.map((tel) => ({ ripText: tel.ripText, updateTexts: [...tel.updateTexts] })),
      creds: [...evidence.creds],
    }
    const result = verifyGuardian(
      material,
      evidence.guardianSaid,
      { holder: evidence.holder, ward },
      { trustedRoots: roots.map((root) => root.aid), now }
    )
    if (result.ok !== true) return refuse(result.reason, result.detail)
    const root = roots.find((known) => known.aid === result.root)
    if (!root) return refuse('untrustedRoot', `root ${result.root} is not on this phone's list`)
    return {
      ok: true,
      root: root.aid,
      state: root.name,
      checkedAt,
      ...(result.expires ? { expires: result.expires } : {}),
    }
  } catch (e) {
    const message = `the check stopped on an error: ${(e as Error)?.message ?? String(e)}`
    onThrow(message)
    return refuse('checkFailed', message)
  }
}

/** The one record of `recordType`, its content replaced; saved the first time. */
async function keepOne(agent: Pick<Agent, 'genericRecords'>, recordType: string, content: object): Promise<void> {
  const [existing] = (await agent.genericRecords.findAllByQuery({ recordType })) ?? []
  if (existing) {
    existing.content = { ...content }
    await agent.genericRecords.update(existing)
  } else {
    await agent.genericRecords.save({ content: { ...content }, tags: { recordType } })
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The approver's phone (Jordan)

/**
 * Hold a Guardian card on this phone, to send after a yes (Developer setting: there is no wallet flow that receives a
 * card yet). Refused over the cap, so a card that cannot go is never kept.
 */
export async function holdGuardianEvidence(
  agent: Pick<Agent, 'genericRecords'>,
  evidence: GuardianEvidence
): Promise<'held' | 'tooLarge'> {
  if (evidenceBytes(evidence) > GUARDIAN_EVIDENCE_MAX_BYTES) return 'tooLarge'
  await keepOne(agent, GUARDIAN_EVIDENCE_HELD, { ...evidenceOf(evidence), heldAt: new Date().toISOString() })
  return 'held'
}

/** The card this phone holds to send, if any. */
export async function heldGuardianEvidence(
  agent: Pick<Agent, 'genericRecords'>
): Promise<GuardianEvidence | undefined> {
  const [record] = (await agent.genericRecords.findAllByQuery({ recordType: GUARDIAN_EVIDENCE_HELD })) ?? []
  const held = record?.content as unknown as GuardianEvidence | undefined
  return held?.guardianSaid ? evidenceOf(held) : undefined
}

export type EvidenceSendResult = 'sent' | 'off' | 'none' | 'tooLarge' | 'noRelationship'

/**
 * After a yes as `approverDid` to approve for the agent `agentDid`: send the card this phone holds to the contact on
 * `connectionId`. Nothing goes with either switch off or no card held, or over the cap.
 */
export async function sendGuardianEvidence(
  agent: Agent,
  connectionId: string,
  agentDid: string,
  approverDid: string
): Promise<EvidenceSendResult> {
  if (!isOn()) return 'off'
  const held = await heldGuardianEvidence(agent)
  if (!held) return 'none'
  if (evidenceBytes(held) > GUARDIAN_EVIDENCE_MAX_BYTES) {
    warn(agent, `the card held here is over ${GUARDIAN_EVIDENCE_MAX_BYTES} bytes; not sent on ${connectionId}`)
    return 'tooLarge'
  }
  const relationship = await relationshipOn(agent, connectionId)
  if (!relationship) return 'noRelationship'
  const connection = await agent.modules.didcomm.connections.getById(connectionId)
  if (!connection.did || !connection.theirDid) return 'noRelationship'

  const id = utils.uuid()
  const payload: GuardianEvidencePayload = {
    agent: agentDid,
    approver: approverDid,
    ...held,
    sentAt: new Date().toISOString(),
  }
  const document: Record<string, unknown> = {
    id,
    type: GUARDIAN_EVIDENCE_TYPE_URI,
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
  agent.config?.logger?.info(`${LOG_PREFIX} guardian card sent on connection ${connectionId}`)
  return 'sent'
}

/** The ceremony module, reached lazily: it registers this type, so importing it at the top would be a cycle. */
function ceremony(): typeof import('./ceremony') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  return require('./ceremony')
}

// ---------------------------------------------------------------------------------------------------------------
// Asking Jordan first: "Also send your Guardian card to <name>?"

/** This phone's answer for one person: send the card to them, or not. No answer: never asked, and nothing is sent. */
export type CardConsent = 'yes' | 'no'

/**
 * This phone's answer for the contact on `connectionId`, if it gave one.
 *
 * Persisted, on purpose: an answer is the person's decision, not a computation, so it must outlive a restart and an
 * OTA, and a no must never be forgotten into a re-ask until they say yes. (A Guardian verdict is the opposite: it is
 * computed by one version of the checker, so it is never kept as an answer to reuse across an update.)
 *
 * Keyed by the connection, not by a DID. A relationship DID that rotates on the same connection keeps the answer, so
 * a no stays a no. A new connection (a reconnect, which may be another phone or another person) has no answer and is
 * asked again; with no answer nothing is sent, so a re-ask can only withhold.
 */
export async function cardConsentOn(
  agent: Pick<Agent, 'genericRecords'>,
  connectionId: string
): Promise<CardConsent | undefined> {
  const [record] =
    (await agent.genericRecords.findAllByQuery({ recordType: GUARDIAN_CARD_CONSENT, connectionId })) ?? []
  const answer = (record?.content as { answer?: unknown } | undefined)?.answer
  return answer === 'yes' || answer === 'no' ? answer : undefined
}

/** Keep this phone's answer for the contact on `connectionId` (changed in place; saved the first time). */
export async function setCardConsent(
  agent: Pick<Agent, 'genericRecords'>,
  connectionId: string,
  answer: CardConsent
): Promise<void> {
  const content = { connectionId, answer, answeredAt: new Date().toISOString() }
  const [existing] =
    (await agent.genericRecords.findAllByQuery({ recordType: GUARDIAN_CARD_CONSENT, connectionId })) ?? []
  if (existing) {
    existing.content = { ...content }
    await agent.genericRecords.update(existing)
  } else {
    await agent.genericRecords.save({
      content: { ...content },
      tags: { recordType: GUARDIAN_CARD_CONSENT, connectionId },
    })
  }
}

/** Every answer this phone gave, by connection (for People I approve for). */
export async function cardConsents(agent: Pick<Agent, 'genericRecords'>): Promise<Record<string, CardConsent>> {
  const records = (await agent.genericRecords.findAllByQuery({ recordType: GUARDIAN_CARD_CONSENT })) ?? []
  const answers: Record<string, CardConsent> = {}
  for (const record of records) {
    const { connectionId, answer } = (record.content ?? {}) as { connectionId?: unknown; answer?: unknown }
    if (typeof connectionId === 'string' && (answer === 'yes' || answer === 'no')) answers[connectionId] = answer
  }
  return answers
}

/** "Also send your Guardian card to <asker>?", waiting for this phone's person. */
export interface CardQuestion {
  connectionId: string
  asker: string
  /** The state named on this phone's own list for the card's root, if it is on the list. */
  state?: string
}

class CardQuestionStore {
  private questions = new Map<string, CardQuestion>()
  set(question: CardQuestion) {
    this.questions.set(question.connectionId, question)
  }
  take(connectionId: string) {
    this.questions.delete(connectionId)
  }
  first(): CardQuestion | undefined {
    return [...this.questions.values()][0]
  }
  /** Tests only. */
  reset() {
    this.questions.clear()
  }
}

/** The questions asked this run. Not kept: one not answered before a restart is answered on People I approve for. */
export const cardQuestions = new CardQuestionStore()
/** 'question': a question was added or answered. */
export const guardianCardEvents = new EventEmitter()

/** The state this phone's own list names for the card's root, if the root is on the list; never the card's word. */
function stateNameOf(evidence: GuardianEvidence): string | undefined {
  return trustedStateRoots().find((root) => evidence.kels.some((kel) => kel.includes(`"i":"${root.aid}"`)))?.name
}

/** The card this phone could share, and the state it is from: none with either switch off or no card held. */
export async function cardToShare(agent: Pick<Agent, 'genericRecords'>): Promise<{ state?: string } | undefined> {
  if (!isOn()) return undefined
  const held = await heldGuardianEvidence(agent)
  if (!held) return undefined
  const state = stateNameOf(held)
  return state ? { state } : {}
}

export type CardAfterYesResult = EvidenceSendResult | 'declined' | 'asked' | 'notApproving'

/**
 * After a yes to approve for the contact on `prompt.connectionId`: send the card this phone holds only if its person
 * already said yes to sending it to this contact. Said no: nothing goes, and nothing is asked again. Never asked:
 * nothing goes, and the question is put to the person ({@link cardQuestions}). Either switch off: nothing is asked
 * and nothing goes. The approval itself is never touched here.
 */
export async function guardianCardAfterYes(
  agent: Agent,
  prompt: Pick<RoleOfferPrompt, 'connectionId' | 'agentDid' | 'asker'>,
  approverDid: string
): Promise<CardAfterYesResult> {
  if (!isOn()) return 'off'
  const held = await heldGuardianEvidence(agent)
  if (!held) return 'none'
  const consent = await cardConsentOn(agent, prompt.connectionId)
  if (consent === 'yes') return sendGuardianEvidence(agent, prompt.connectionId, prompt.agentDid, approverDid)
  if (consent === 'no') return 'declined'
  const state = stateNameOf(held)
  cardQuestions.set({ connectionId: prompt.connectionId, asker: prompt.asker, ...(state ? { state } : {}) })
  guardianCardEvents.emit('question', { connectionId: prompt.connectionId })
  return 'asked'
}

/**
 * This phone's person answers "Also send your Guardian card to <name>?" (the question after a yes, or the button on
 * People I approve for): the answer is kept, and a yes sends the card now, for the agent and as the DID of the yes
 * kept here. Either switch off: nothing is kept and nothing goes.
 */
export async function shareGuardianCard(
  agent: Agent,
  connectionId: string,
  send: boolean
): Promise<CardAfterYesResult> {
  if (!isOn()) return 'off'
  await setCardConsent(agent, connectionId, send ? 'yes' : 'no')
  cardQuestions.take(connectionId)
  guardianCardEvents.emit('question', { connectionId })
  if (!send) return 'declined'
  const yes = (await approvingFor(agent)).find((prompt) => prompt.connectionId === connectionId)
  if (!yes?.answeredAs) return 'notApproving'
  return sendGuardianEvidence(agent, connectionId, yes.agentDid, yes.answeredAs)
}

// ---------------------------------------------------------------------------------------------------------------
// Developer actions for a tester build: the K0 test card and the K0 test ward

/** What a Developer action did: done, or nothing because "Trust the test state (K0)" (or a switch under it) is off. */
export type TestStateActionResult = 'done' | 'off'

/**
 * Developer action "Hold the test Guardian card (K0)", on an approver's phone: keep the K0 kit's Guardian card as the
 * card this phone sends after a yes. Does nothing unless "Trust the test state (K0)" holds (so trusted approvers and
 * state-verified approvers are both on, and no remote off is set).
 */
export async function holdK0TestGuardianCard(agent: Pick<Agent, 'genericRecords'>): Promise<TestStateActionResult> {
  if (!isTrustTestStateEnabled()) return 'off'
  return (await holdGuardianEvidence(agent, K0_TEST_GUARDIAN_CARD)) === 'held' ? 'done' : 'off'
}

/**
 * Developer action "I'm the test ward (K0)", on the person's phone: set this phone's ward to the K0 kit's ward (Sam),
 * so a K0 card checks as naming it. Does nothing unless "Trust the test state (K0)" holds.
 */
export async function becomeK0TestWard(agent: Pick<Agent, 'genericRecords'>): Promise<TestStateActionResult> {
  if (!isTrustTestStateEnabled()) return 'off'
  await setStateWard(agent, K0_TEST_WARD)
  return 'done'
}

// ---------------------------------------------------------------------------------------------------------------
// The person's phone (Sam)

/**
 * Set this phone's ward for Guardian checks (Developer setting; the K0 kit's is K0_TEST_WARD). A card is checked as
 * naming this AID. Not a binding to the person: that waits for stage 3 (KH-P3).
 */
export async function setStateWard(agent: Pick<Agent, 'genericRecords'>, ward: string): Promise<void> {
  await keepOne(agent, STATE_WARD, { ward, setAt: new Date().toISOString() })
}

/** This phone's ward for Guardian checks, or null when none is set (then no card verifies). */
export async function stateWardOf(agent: Pick<Agent, 'genericRecords'>): Promise<string | null> {
  const [record] = (await agent.genericRecords.findAllByQuery({ recordType: STATE_WARD })) ?? []
  const ward = (record?.content as { ward?: unknown } | undefined)?.ward
  return typeof ward === 'string' && ward.length > 0 ? ward : null
}

const dropped = (agent: Agent, connectionId: string, why: string) =>
  warn(agent, `a guardian card on connection ${connectionId} not taken: ${why}`)

/**
 * A contact's Guardian card arrives: refused over the cap before anything else, verified under their relationship
 * DID, then checked and kept with its verdict on the offer this phone sent on that connection (for the agent the
 * offer named). Kept whatever the verdict, so Who approves can say it could not verify; shown only beside the DID the
 * contact said yes as (see {@link guardianStandings}), so a card that overtakes the yes is not lost.
 */
export async function handleGuardianEvidence(
  agent: Agent,
  service: TrustTasksService,
  document: Record<string, unknown>,
  context: InboundContext
): Promise<void> {
  if (!isOn()) return dropped(agent, context.connectionId, OFF)
  const size = evidenceBytes(document?.payload as GuardianEvidencePayload | undefined)
  if (size > GUARDIAN_EVIDENCE_MAX_BYTES)
    return dropped(agent, context.connectionId, `it is ${size} bytes, over the ${GUARDIAN_EVIDENCE_MAX_BYTES} cap`)
  const relationship = await relationshipOn(agent, context.connectionId)
  if (!relationship)
    return dropped(agent, context.connectionId, 'no relationship with this contact to check it against')
  const outcome = await service.consume(agent.context, {
    spec: GUARDIAN_EVIDENCE_SPEC as never,
    document,
    myDid: context.recipientDid,
    senderDid: context.senderDid,
    connectionId: context.connectionId,
    proofPolicy: proofUnder(agent, relationship.counterpartyRelationshipDid as string),
    handler: async () => undefined,
  })
  if (outcome.kind !== 'accepted' && outcome.kind !== 'handled')
    return dropped(agent, context.connectionId, `it did not pass its check (${outcome.kind})`)

  const payload = document.payload as GuardianEvidencePayload
  const [record] =
    (await agent.genericRecords.findAllByQuery({ recordType: ROLE_OFFER_ASK, connectionId: context.connectionId })) ??
    []
  const ask = record?.content as unknown as RoleOfferAsk | undefined
  if (!record || !ask || ask.agentDid !== payload.agent)
    return dropped(agent, context.connectionId, 'it names no offer this phone sent on this connection')

  const evidence = evidenceOf(payload)
  const verdict = checkGuardianEvidence(evidence, await stateWardOf(agent), new Date(), (m) => warn(agent, m))
  const guardian: GuardianOnAsk = {
    approver: payload.approver,
    evidence,
    receivedAt: new Date().toISOString(),
    verdict,
  }
  record.content = { ...ask, guardian }
  await agent.genericRecords.update(record)
  agent.config?.logger?.info(
    `${LOG_PREFIX} guardian card kept on connection ${context.connectionId}: ${verdict.ok ? 'valid' : verdict.reason}`
  )
  approverRoleEvents.emit('answered', { connectionId: context.connectionId, decision: 'guardianCard' })
}

/** The DID a kept card is shown beside: the one written on the agent, or a yes not yet written; else none. */
function shownBeside(ask: RoleOfferAsk, guardian: GuardianOnAsk): string | undefined {
  if (writtenAsOf(ask) === guardian.approver) return guardian.approver
  if (ask.state === 'accepted' && ask.acceptedAs === guardian.approver) return guardian.approver
  return undefined
}

const sameVerdict = (a: GuardianVerdict | undefined, b: GuardianVerdict) =>
  !!a &&
  a.ok === b.ok &&
  (a.ok === true && b.ok === true
    ? a.root === b.root && a.state === b.state && a.expires === b.expires
    : a.ok === false && b.ok === false && a.reason === b.reason && a.detail === b.detail)

/**
 * Who approves, on open: each kept card checked again now (expiry, the roots this build trusts, the ward set now),
 * by the approver DID it is shown beside. A verdict that changed is written back in place; if that write fails, the
 * fresh verdict is still what shows. Empty with either switch off, and an approver with no card has no entry.
 */
export async function guardianStandings(agent: Agent): Promise<Record<string, GuardianStanding>> {
  if (!isOn()) return {}
  const records = (await agent.genericRecords.findAllByQuery({ recordType: ROLE_OFFER_ASK })) ?? []
  const ward = await stateWardOf(agent)
  const standings: Record<string, GuardianStanding> = {}
  for (const record of records) {
    const ask = record.content as unknown as RoleOfferAsk
    const guardian = ask?.guardian
    if (!guardian) continue
    const beside = shownBeside(ask, guardian)
    if (!beside) continue
    const verdict = checkGuardianEvidence(guardian.evidence, ward, new Date(), (m) => warn(agent, m))
    if (!sameVerdict(guardian.verdict, verdict)) {
      record.content = { ...ask, guardian: { ...guardian, verdict } }
      await agent.genericRecords
        .update(record)
        .catch((e: unknown) => warn(agent, `could not keep a new verdict: ${(e as Error)?.message ?? e}`))
    }
    standings[beside] =
      verdict.ok === true ? { kind: 'verified', state: verdict.state } : { kind: 'unverified', outcome: verdict.reason }
  }
  return standings
}
