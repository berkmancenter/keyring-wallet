/**
 * The witness ceremony on Trust Tasks — §9 step 5, wallet side.
 *
 * A witnessed relationship exchange nests one witness session PER PARTY as
 * its own thread inside the relationship exchange (parentThreadId → the
 * exchange; framework §4.9.2):
 *
 *   wallet → witness   witness/session { parties }          (thread = session id)
 *   witness → wallet   …#response { challenge, domain }     (proof REQUIRED)
 *   wallet → witness   witness/session/submit { vp }        (proof REQUIRED)
 *   witness → wallet   …#response { vwc, vwcDigestMultibase } (proof REQUIRED)
 *
 * The session REQUEST's id is the value the issued VWC carries as
 * `taskContext` (§4.9.1 — the innermost exchange that attests the
 * witnessing), and the VWC's `taskDigestMultibase` binds that document by
 * digest (§4.9.3) — an id is a name anyone can reuse on a counterfeit.
 *
 * Outcome evidence: the submit#response is retained with its proof by the
 * consume pipeline, retrievable via the session id
 * (TrustTasksService.getOutcomeEvidencePair) — the pair a VWC presentation
 * must ship.
 *
 * This half is the WALLET side. It activates only when an exchange runs
 * witnessed (`propose.payload.witnessed === true`), which stays off until
 * the witness-server speaks the dialect.
 */

import type { Agent } from '@credo-ts/core'
import { W3cCredentialRecord, utils } from '@credo-ts/core'
import * as submit from '@openvtc/trust-tasks/witness/session/submit/0.1/payload'
import * as session from '@openvtc/trust-tasks/witness/session/0.1/payload'

import { digestBytesEqual, digestMultibase, signDocumentProof, taskDigestMultibase, verifyDocumentProof } from './documentProof'

const LOG_PREFIX = '[TrustTasks:Witness]'

export interface WitnessSessionOutcome {
  /** The session document's id — the VWC's taskContext. */
  sessionId: string
  /** The issued Verifiable Witness Credential, as delivered. */
  vwc: Record<string, unknown>
}

/**
 * Responses the ceremony awaits, keyed by ceremony thread id (= session id).
 * Inbound routing (ceremony.ts) resolves these when a witness response
 * arrives; the ceremony rejects on timeout.
 */
const pendingWitnessResponses = new Map<
  string,
  { expectedType: string; resolve: (doc: Record<string, unknown>) => void; timer: ReturnType<typeof setTimeout> }
>()

/** Route an inbound witness-leg response to its awaiting ceremony, if any. */
export function resolveWitnessResponse(document: Record<string, unknown>): boolean {
  const threadId = String(document.threadId ?? '')
  const waiter = pendingWitnessResponses.get(threadId)
  if (!waiter || waiter.expectedType !== document.type) return false
  pendingWitnessResponses.delete(threadId)
  clearTimeout(waiter.timer)
  waiter.resolve(document)
  return true
}

function awaitWitnessResponse(threadId: string, expectedType: string, timeoutMs: number): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (pendingWitnessResponses.delete(threadId)) {
        reject(new Error(`timed out awaiting ${expectedType}`))
      }
    }, timeoutMs)
    pendingWitnessResponses.set(threadId, { expectedType, resolve, timer })
  })
}

export interface RunWitnessSessionOptions {
  /** The wallet's connection to the witness. */
  witnessConnectionId: string
  /** The relationship exchange thread this ceremony nests under. */
  exchangeId: string
  /** The two relationship DIDs of the exchange being witnessed. */
  parties: [string, string]
  /** This party's relationship DID — signs the submit document. */
  myRelationshipDid: string
  /**
   * Build the signed Verifiable Presentation bound to {challenge, domain}.
   * Injected so the ceremony stays free of the VP/credential machinery
   * (the witnessed-vrc-manager owns that).
   */
  buildPresentation: (challenge: string, domain: string) => Promise<Record<string, unknown>>
  /** Send a trust-task document on a connection (ceremony.ts provides this). */
  sendDocument: (agent: Agent, connectionId: string, document: Record<string, unknown>) => Promise<void>
  /** Retain a document (TrustTasksService.retain, bound by the caller). */
  retain: (document: Record<string, unknown>, role: 'request' | 'response') => Promise<unknown>
  timeoutMs?: number
}

/**
 * Run this party's witness session to completion: open, receive the
 * challenge, submit the presentation, validate and store the VWC.
 * Throws on refusal, proof failure, or a VWC whose task binding is wrong.
 */
export async function runWitnessSession(agent: Agent, options: RunWitnessSessionOptions): Promise<WitnessSessionOutcome> {
  const logger = agent.config.logger
  const timeoutMs = options.timeoutMs ?? 60_000
  const witnessConnection = await agent.modules.didcomm.connections.getById(options.witnessConnectionId)
  if (!witnessConnection.did || !witnessConnection.theirDid) {
    throw new Error('witness connection has no DIDs')
  }

  // ---- open the session (its own thread, nested in the exchange) ----------
  const sessionId = utils.uuid()
  const sessionDoc: Record<string, unknown> = {
    id: sessionId,
    type: session.TYPE_URI,
    threadId: sessionId,
    parentThreadId: options.exchangeId,
    issuer: witnessConnection.did,
    recipient: witnessConnection.theirDid,
    issuedAt: new Date().toISOString(),
    payload: { parties: options.parties },
  }
  await options.retain(sessionDoc, 'request')
  const challengePromise = awaitWitnessResponse(sessionId, `${session.TYPE_URI}#response`, timeoutMs)
  await options.sendDocument(agent, options.witnessConnectionId, sessionDoc)
  logger.info(`${LOG_PREFIX} session opened (${sessionId}) under exchange ${options.exchangeId}`)

  // ---- the challenge (proof REQUIRED — verify under the witness's DID) ----
  const challengeDoc = await challengePromise
  if (!(await verifyDocumentProof(agent, challengeDoc, witnessConnection.theirDid))) {
    throw new Error('session challenge proof did not verify under the witness DID')
  }
  const challengePayload = (challengeDoc as { payload?: { challenge?: string; domain?: string } }).payload
  if (!challengePayload?.challenge || !challengePayload.domain) {
    throw new Error('session challenge payload incomplete')
  }
  logger.info(`${LOG_PREFIX} challenge received (session ${sessionId})`)

  // ---- submit the presentation bound to {challenge, domain} ---------------
  const vp = await options.buildPresentation(challengePayload.challenge, challengePayload.domain)
  const submitDoc: Record<string, unknown> = {
    id: utils.uuid(),
    type: submit.TYPE_URI,
    threadId: sessionId,
    parentThreadId: options.exchangeId,
    issuer: witnessConnection.did,
    recipient: witnessConnection.theirDid,
    issuedAt: new Date().toISOString(),
    payload: { vp },
  }
  const signedSubmit = await signDocumentProof(agent, submitDoc, options.myRelationshipDid)
  await options.retain(signedSubmit, 'request')
  const vwcPromise = awaitWitnessResponse(sessionId, `${submit.TYPE_URI}#response`, timeoutMs)
  await options.sendDocument(agent, options.witnessConnectionId, signedSubmit)
  logger.info(`${LOG_PREFIX} presentation submitted (session ${sessionId})`)

  // ---- the VWC: verify its proof, its task binding, then store ------------
  const vwcDoc = await vwcPromise
  if (!(await verifyDocumentProof(agent, vwcDoc, witnessConnection.theirDid))) {
    throw new Error('submit#response proof did not verify under the witness DID')
  }
  const vwcPayload = (vwcDoc as { payload?: { vwc?: Record<string, unknown>; vwcDigestMultibase?: string } }).payload
  const vwc = vwcPayload?.vwc
  if (!vwc) throw new Error('submit#response carries no VWC')
  if (!vwcPayload.vwcDigestMultibase || !digestBytesEqual(vwcPayload.vwcDigestMultibase, digestMultibase(vwc))) {
    throw new Error('vwcDigestMultibase does not match the delivered VWC')
  }
  const subject = Array.isArray(vwc.credentialSubject) ? vwc.credentialSubject[0] : vwc.credentialSubject
  const taskContext = (subject as { taskContext?: string } | undefined)?.taskContext
  if (taskContext !== sessionId) {
    throw new Error(`VWC taskContext ${taskContext ?? 'absent'} does not name this session (${sessionId})`)
  }
  const taskDigest = (subject as { taskDigestMultibase?: string } | undefined)?.taskDigestMultibase
  // §4.9.3: the task digest excludes the document's top-level proof, and
  // digests compare as decoded multihash bytes, never encoded strings.
  if (!taskDigest || !digestBytesEqual(taskDigest, taskDigestMultibase(sessionDoc))) {
    throw new Error('VWC taskDigestMultibase does not bind this session document')
  }

  await agent.w3cCredentials.store({
    record: new W3cCredentialRecord({ credentialInstances: [{ credential: vwc as never }] }),
  })
  logger.info(`${LOG_PREFIX} VWC stored — taskContext bound to session ${sessionId} (outcome evidence retained)`)

  return { sessionId, vwc }
}

/** Test seam: the number of ceremonies still awaiting a witness response. */
export function pendingWitnessResponseCount(): number {
  return pendingWitnessResponses.size
}
