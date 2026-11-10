/**
 * Approving for someone else's agent (trusted-approver plan §9, T2): this phone said yes to being a person's approver
 * (approverRole.ts), and that person's agent now asks it about a task.
 *
 * The request reaches this phone on its own session (the asking phone forwards its agent's signed consent requests to
 * the approvers they name, `VtaClient.relayConsentRequests`), but it is from another agent. It is shown only when:
 * the trusted-approvers switch is on; its issuer is an agent this phone agreed to approve for; and it passes the same
 * check a request from this phone's own agent passes (`checkConsentRequest`), against that issuer.
 *
 * The decision goes to the asking agent, not to this phone's own: a `task-consent/decision` signed for
 * `assertionMethod` by this phone's manager DID (the DID in that agent's approver set), sealed by the same DID (the
 * session's identity) and forwarded by DID through the mediator. A reply counts only when it is threaded to the
 * decision and comes from that agent; a version the agent does not serve steps down, as with this phone's own agent.
 *
 * @module trust-tasks/module/foreignApproval
 */
import { TRUST_TASK_V2_ENVELOPE_TYPE, signDocumentProof } from '@bifold/trust-tasks'
import { utils, type Agent } from '@credo-ts/core'
import type { DidCommV2PlaintextMessage } from '@credo-ts/didcomm'

import { approvingFor } from '../approverRole'

import { purposeForDocumentType } from './proofPurpose'
import { versionsFor } from './taskVersions'
import { isTrustedApproversEnabled } from './trustedApproversFlag'
import { VTA_TASK_VERSIONS } from './VtaClient'
import { VtiRefusal } from './vtiAgent'
import { isDigestMultibase } from './vettingShape'
import { checkVtaReply } from './vtaReplyProof'

const LOG_PREFIX = '[VTI] foreign approval'
const TASK_ERROR = 'https://trusttasks.org/spec/trust-task-error/'
const PROBLEM_REPORT = 'https://didcomm.org/report-problem/2.0/problem-report'
/**
 * task-consent/decision, newest first: the same ladder this phone's own agent is answered from. Read when a decision
 * is sent, never at import: vtaAgent imports this module, and a module that mocks or cycles through VtaClient would
 * otherwise fail to load.
 */
export const foreignDecisionTypes = (): readonly string[] => VTA_TASK_VERSIONS.consentDecision
/** How long a decision waits for the asking agent's reply. */
export const FOREIGN_REPLY_WAIT_MS = 30_000

const nowSec = () => Math.floor(Date.now() / 1000)

/** An agent this phone approves for, as its person's yes recorded it. */
export interface ApprovedAgent {
  agentDid: string
  /** The person who asked, by the name their relationship gives. */
  asker: string
  /** The DID this phone said yes as. */
  answeredAs?: string
}

/**
 * The agent a consent request is from, when it is one this phone approves for and the switch is on; else undefined
 * (the request is then checked as one from this phone's own agent, as before).
 */
export async function approvedAgentOf(
  agent: Pick<Agent, 'genericRecords'>,
  doc: Record<string, unknown>
): Promise<ApprovedAgent | undefined> {
  if (!isTrustedApproversEnabled()) return undefined
  const issuer = typeof doc.issuer === 'string' ? doc.issuer : undefined
  if (!issuer) return undefined
  const prompts = await approvingFor(agent).catch(() => [])
  const yes = prompts.find((prompt) => prompt.agentDid === issuer)
  return yes ? { agentDid: issuer, asker: yes.asker, answeredAs: yes.answeredAs } : undefined
}

/** What the decision needs of the request. */
export interface ForeignRequest {
  /** The asking agent: the request's issuer. */
  issuer: string
  challenge: string
  payloadDigest: string
}

/** What this module needs of the session with this phone's own agent. */
export interface ForeignSendPort {
  agent: Agent
  /** This phone's manager DID: the approver-set entry, the document's issuer and the envelope's sender. */
  managerDid: string
  /** Authcrypt to `peerDid` and forward through the mediator (`VtiMediatorSession.sendTo`). */
  sendTo(peerDid: string, plaintext: DidCommV2PlaintextMessage): Promise<void>
}

interface Waiter {
  from: string
  ids: Set<string>
  resolve: (plaintext: DidCommV2PlaintextMessage) => void
}
const waiters = new Set<Waiter>()

/**
 * A message this phone's session did not take: the reply to a foreign decision, if one is threaded to it and from the
 * agent it went to. Answers whether it was taken. A reply threaded to a decision but from another sender is not.
 */
export function takeForeignReply(plaintext: DidCommV2PlaintextMessage): boolean {
  const refs = [
    plaintext.thid,
    (plaintext as { pthid?: string }).pthid,
    (plaintext.body as { threadId?: unknown } | undefined)?.threadId,
  ].filter((ref): ref is string => typeof ref === 'string' && ref.length > 0)
  if (!refs.length) return false
  for (const waiter of waiters) {
    if (!refs.some((ref) => waiter.ids.has(ref))) continue
    if (plaintext.from !== waiter.from) return false
    waiters.delete(waiter)
    waiter.resolve(plaintext)
    return true
  }
  return false
}

/** Tests only. */
export const forgetForeignWaiters = () => waiters.clear()

/** The asking agent's answer, as `VtaClient.task` reads one: a refusal throws; anything else is the answer. */
async function readReply(agent: Agent, reply: DidCommV2PlaintextMessage, from: string, type: string) {
  if (reply.type === PROBLEM_REPORT) {
    const p = reply.body as { code?: string; comment?: string } | undefined
    throw new VtiRefusal(p?.code ?? 'problem-report', p?.comment ?? `the agent refused ${type}`)
  }
  const body = (reply.body ?? {}) as Record<string, unknown>
  if (String(body.type ?? '').startsWith(TASK_ERROR)) {
    const p = body.payload as { code?: string; message?: string; details?: unknown } | undefined
    throw new VtiRefusal(p?.code ?? 'unknown', p?.message ?? `the agent refused ${type}`, p?.details)
  }
  // A reply not proven to be the asking agent's is not its answer (plan §9 change 2).
  const verdict = await checkVtaReply(agent, body, from)
  if (verdict.kind !== 'verified')
    throw new Error(`${LOG_PREFIX}: the reply is not the asking agent's (${verdict.kind})`)
  return body
}

/** Send one version of the decision and wait for the asking agent's reply. */
async function sendOnce(
  port: ForeignSendPort,
  request: ForeignRequest,
  type: string,
  decision: 'approve' | 'deny',
  reason: string | undefined,
  waitMs: number
): Promise<Record<string, unknown>> {
  const documentId = `urn:uuid:${utils.uuid()}`
  const envelopeId = `urn:uuid:${utils.uuid()}`
  const threadId = documentId
  const payload = {
    challenge: request.challenge,
    payloadDigest: request.payloadDigest,
    decision,
    ...(reason ? { reason } : {}),
  }
  const document = await signDocumentProof(
    port.agent,
    {
      id: documentId,
      type,
      threadId,
      payload,
      issuer: port.managerDid,
      recipient: request.issuer,
      issuedAt: new Date().toISOString(),
    },
    port.managerDid,
    { proofPurpose: purposeForDocumentType(type) }
  )
  let timer: ReturnType<typeof setTimeout> | undefined
  let waiter: Waiter | undefined
  const reply = new Promise<DidCommV2PlaintextMessage | undefined>((resolve) => {
    waiter = { from: request.issuer, ids: new Set([documentId, envelopeId, threadId]), resolve }
    waiters.add(waiter)
    timer = setTimeout(() => resolve(undefined), waitMs)
  })
  try {
    await port.sendTo(request.issuer, {
      id: envelopeId,
      typ: 'application/didcomm-plain+json',
      type: TRUST_TASK_V2_ENVELOPE_TYPE,
      from: port.managerDid,
      to: [request.issuer],
      thid: threadId,
      created_time: nowSec(),
      expires_time: nowSec() + 300,
      body: document,
    } as DidCommV2PlaintextMessage)
    const answer = await reply
    if (!answer) throw new Error(`${LOG_PREFIX}: the asking agent did not answer within ${waitMs / 1000} s`)
    return await readReply(port.agent, answer, request.issuer, type)
  } finally {
    clearTimeout(timer)
    if (waiter) waiters.delete(waiter)
  }
}

/**
 * Send this phone's decision on `request` to the agent that asked, and wait for its answer. Throws when the agent
 * refuses it, does not answer, or answers unproven; the request then waits to be answered again.
 */
export async function sendForeignDecision(
  port: ForeignSendPort,
  request: ForeignRequest,
  decision: 'approve' | 'deny',
  reason?: string,
  waitMs = FOREIGN_REPLY_WAIT_MS
): Promise<Record<string, unknown>> {
  if (!isTrustedApproversEnabled()) throw new Error(`${LOG_PREFIX}: trusted approvers are switched off`)
  // As decideConsent: a digest that is not one did not come from an agent, and nothing is signed over it.
  if (!isDigestMultibase(request.payloadDigest))
    throw new Error(`${LOG_PREFIX}: the request's payloadDigest is not a digestMultibase; not deciding it`)
  const versions = versionsFor(`foreign-decision:${request.issuer}`)
  const { answer } = await versions.ask('consentDecision', foreignDecisionTypes(), (type) =>
    sendOnce(port, request, type, decision, reason, waitMs)
  )
  return answer
}
