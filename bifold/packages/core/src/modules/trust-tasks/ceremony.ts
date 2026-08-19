/**
 * The relationship ceremony on Trust Tasks — milestone 2, first slice.
 *
 * Recasts the relationship-DID handshake onto the merged upstream
 * specifications (`vrc/relationships/propose` and its `#response`,
 * trustoverip/dtgwg-trust-tasks-tf #213), capability-gated so mixed fleets
 * keep working:
 *
 *  - Both peers still announce over the legacy basic-message marker
 *    (`vrc:relationshipDid:… vrc:rceVersion:N`) — old peers see nothing new.
 *  - When BOTH peers speak v4+, the deterministic proposer opens the formal
 *    Trust Task exchange with `propose`. Its document `id` becomes the
 *    exchange thread every later leg nests under (`parentThreadId`) and the
 *    id a witnessed ceremony's `taskContext` chain hangs off — the thing the
 *    legacy dance never had.
 *  - Both dialects write the SAME repository state
 *    (`RelationshipDidRepository`), so issuance and everything downstream
 *    work unchanged whichever dialect ran.
 *
 * Proposer selection needs no negotiation: the peer whose connection DID
 * sorts lexicographically lower proposes. Both sides compute the same answer
 * from the same pair; no role assumptions, no race.
 *
 * @module trust-tasks/ceremony
 */

import type { Agent } from '@credo-ts/core'
import {
  DidCommMessageHandlerRegistry,
  DidCommMessageSender,
  DidCommOutboundMessageContext,
} from '@credo-ts/didcomm'
import * as issue from '@openvtc/trust-tasks/vrc/relationships/issue/0.1/payload'
import * as propose from '@openvtc/trust-tasks/vrc/relationships/propose/0.1/payload'
import { utils } from '@credo-ts/core'

import { getOrCreateRelationshipDid } from '../vrc/vrc-manager'
import { RelationshipDidRepository } from '../vrc/repositories/RelationshipDidRepository'

import { digestMultibase, signDocumentProof, verifyDocumentProof } from './documentProof'
import { TrustTaskMessage } from './messages/TrustTaskMessage'
import { TrustTasksModule } from './module/TrustTasksModule'
import { TrustTaskDocumentRepository } from './services/TrustTaskDocumentRepository'
import { TrustTasksService, respondWith, rejectWith, extendedCode } from './services/TrustTasksService'

const LOG_PREFIX = '[TrustTasks:Ceremony]'

/** The first RCE protocol version whose peers speak the Trust Task dialect. */
export const TRUST_TASKS_MIN_RCE_VERSION = 4

/** Resolve (registering on first use) the module's service from an agent. */
export function getTrustTasksService(agent: Agent): TrustTasksService {
  const container = agent.dependencyManager.container
  if (!container.isRegistered(TrustTasksService)) {
    new TrustTasksModule().register(agent.dependencyManager)
  }
  return container.resolve(TrustTasksService)
}

/**
 * Deterministic proposer selection: both sides sort the connection-DID pair;
 * the lower one proposes. Symmetric, race-free, negotiation-free.
 */
export function isDeterministicProposer(myConnectionDid: string, theirConnectionDid: string): boolean {
  return myConnectionDid < theirConnectionDid
}

/**
 * Open the Trust Task relationship exchange toward a v4+ peer, if this side
 * is the deterministic proposer. Idempotent per connection: an exchange
 * already retained for this connection is not re-opened.
 *
 * Called from the legacy handshake handler at the moment the peer's
 * `rceVersion` becomes known — the two dialects share that trigger.
 */
export async function maybeOpenRelationshipExchange(
  agent: Agent,
  connectionId: string,
  counterpartyRceVersion: number,
  myRceVersion: number
): Promise<void> {
  if (counterpartyRceVersion < TRUST_TASKS_MIN_RCE_VERSION || myRceVersion < TRUST_TASKS_MIN_RCE_VERSION) return

  const connection = await agent.modules.didcomm.connections.getById(connectionId)
  if (!connection.did || !connection.theirDid) return
  if (!isDeterministicProposer(connection.did, connection.theirDid)) return

  const service = getTrustTasksService(agent)

  // Idempotence: one relationship exchange per connection.
  const documentRepository = agent.dependencyManager.container.resolve(TrustTaskDocumentRepository)
  const existing = await documentRepository.findByQuery(agent.context, {
    typeUri: propose.TYPE_URI,
    connectionId,
  })
  if (existing.length > 0) return

  const relationshipDid = await getOrCreateRelationshipDid(agent, connection.theirDid, connectionId)
  const exchangeId = utils.uuid()
  const document: Record<string, unknown> = {
    id: exchangeId,
    type: propose.TYPE_URI,
    threadId: exchangeId,
    issuer: connection.did,
    recipient: connection.theirDid,
    issuedAt: new Date().toISOString(),
    payload: { relationshipDid, witnessed: false },
  }

  await service.retain(agent.context, document, 'request', connectionId)
  await sendTrustTaskDocument(agent, connectionId, document)
  agent.config.logger.info(`${LOG_PREFIX} propose sent (exchange ${exchangeId}) on connection ${connectionId}`)
}

/**
 * Milestone 2, second slice: the `issue` leg, shadow mode.
 *
 * Within an accepted relationship exchange, each party delivers its signed
 * VRC to the other as `vrc/relationships/issue` on the exchange thread, and
 * the receiver answers with the digest receipt (`#response`,
 * `vrcDigestMultibase` recomputed over the credential as accepted). The spec
 * declares the request proof REQUIRED, so the document is signed
 * (eddsa-jcs-2022) with the sender's relationship DID.
 *
 * Shadow mode: the legacy issue-credential 2.0 leg remains the storage
 * authority — this leg proves delivery and receipts it, and the receiver does
 * NOT store a second copy. Flipping authority (store from the task, retire
 * the legacy leg for v4 pairs) is the contract half of the migration and a
 * later slice.
 *
 * Called from the legacy credential handler when this side's ISSUER exchange
 * reaches Done — the signed VC exists at that moment. Idempotent per
 * direction: one issue request per exchange whose `issuer` is this side.
 */
export async function maybeDeliverVrcViaTrustTask(
  agent: Agent,
  connectionId: string,
  credentialExchangeId: string
): Promise<void> {
  const logger = agent.config.logger
  const connection = await agent.modules.didcomm.connections.getById(connectionId)
  if (!connection.did || !connection.theirDid) return

  // Only within an ACCEPTED relationship exchange (which only v4↔v4 pairs open).
  const documentRepository = agent.dependencyManager.container.resolve(TrustTaskDocumentRepository)
  const proposeDocs = await documentRepository.findByQuery(agent.context, {
    typeUri: propose.TYPE_URI,
    connectionId,
    role: 'request',
  })
  if (proposeDocs.length === 0) return
  const exchangeId = String(proposeDocs[0].document.threadId ?? proposeDocs[0].document.id)
  const responses = await documentRepository.findByQuery(agent.context, {
    typeUri: propose.TYPE_URI,
    connectionId,
    role: 'response',
  })
  const accepted = responses.some((r) => (r.document as { payload?: { accept?: boolean } }).payload?.accept === true)
  if (!accepted) {
    logger.info(`${LOG_PREFIX} issue not sent — exchange ${exchangeId} has no accepted propose yet`)
    return
  }

  // Idempotence per direction: both parties' requests are retained with
  // role 'request', so discriminate by the document's issuer.
  const priorIssues = await documentRepository.findByQuery(agent.context, {
    typeUri: issue.TYPE_URI,
    connectionId,
    role: 'request',
  })
  if (priorIssues.some((r) => r.document.issuer === connection.did)) return

  // The signed VRC this side just issued over the legacy leg.
  const formatData = (await agent.modules.didcomm.credentials.getFormatData(credentialExchangeId)) as {
    credential?: Record<string, unknown>
  }
  const byFormat = formatData.credential ?? {}
  const signedVc = (byFormat.jsonld ?? Object.values(byFormat)[0]) as Record<string, unknown> | undefined
  if (!signedVc) {
    logger.warn(`${LOG_PREFIX} issue not sent — no issued credential on exchange record ${credentialExchangeId}`)
    return
  }
  const typeArray = Array.isArray(signedVc.type) ? (signedVc.type as unknown[]) : [signedVc.type]
  if (!typeArray.includes('RelationshipCredential')) return // the RCard is a VDS and never rides this task

  const relationshipRepository = agent.dependencyManager.container.resolve(RelationshipDidRepository)
  const myRecord = await relationshipRepository.findByConnectionDid(agent.context, connection.theirDid)
  const myRelationshipDid = myRecord?.myRelationshipDid
  if (!myRelationshipDid) {
    logger.warn(`${LOG_PREFIX} issue not sent — no relationshipDid for ${connection.theirDid}`)
    return
  }

  const document: Record<string, unknown> = {
    id: utils.uuid(),
    type: issue.TYPE_URI,
    threadId: exchangeId,
    issuer: connection.did,
    recipient: connection.theirDid,
    issuedAt: new Date().toISOString(),
    payload: { vrc: signedVc, vrcDigestMultibase: digestMultibase(signedVc) },
  }
  const signed = await signDocumentProof(agent, document, myRelationshipDid)

  const service = getTrustTasksService(agent)
  await service.retain(agent.context, signed, 'request', connectionId)
  await sendTrustTaskDocument(agent, connectionId, signed)
  logger.info(`${LOG_PREFIX} issue sent (exchange ${exchangeId}) on connection ${connectionId}`)
}

/** Pack a document onto the binding-0.2 carriage and send it over a connection. */
export async function sendTrustTaskDocument(
  agent: Agent,
  connectionId: string,
  document: Record<string, unknown>
): Promise<void> {
  const connection = await agent.modules.didcomm.connections.getById(connectionId)
  const messageSender = agent.dependencyManager.container.resolve(DidCommMessageSender)
  await messageSender.sendMessage(
    new DidCommOutboundMessageContext(new TrustTaskMessage({ document }), {
      agentContext: agent.context,
      connection,
    })
  )
}

/**
 * Register the inbound side: the binding-0.2 message handler, routing
 * documents to the ceremony logic. Call once per agent, beside
 * `setupVrcConnectionHandler`.
 */
export function setupTrustTasksInbound(agent: Agent): void {
  const service = getTrustTasksService(agent)
  const registry = agent.dependencyManager.container.resolve(DidCommMessageHandlerRegistry)

  TrustTasksModule.registerMessageHandler(registry, async (document, context) => {
    const type = String(document.type ?? '')
    const logger = agent.config.logger

    // Case 2 (binding §4.8.1): the dedicated carriage delivers even when the
    // sender binds to no known connection. Retain for diagnostics; never act.
    if (!context.senderDid || !context.recipientDid || !context.connectionId) {
      logger.warn(`${LOG_PREFIX} document ${document.id} arrived without an authenticated connection — retained, not processed`)
      await service.retain(agent.context, document, 'request')
      return
    }

    if (type === propose.TYPE_URI) {
      await handleInboundPropose(agent, service, document, {
        connectionId: context.connectionId,
        senderDid: context.senderDid,
        recipientDid: context.recipientDid,
      })
      return
    }
    if (type === `${propose.TYPE_URI}#response`) {
      await handleInboundProposeResponse(agent, service, document, {
        connectionId: context.connectionId,
        senderDid: context.senderDid,
        recipientDid: context.recipientDid,
      })
      return
    }

    if (type === issue.TYPE_URI) {
      await handleInboundIssue(agent, service, document, {
        connectionId: context.connectionId,
        senderDid: context.senderDid,
        recipientDid: context.recipientDid,
      })
      return
    }
    if (type === `${issue.TYPE_URI}#response`) {
      await handleInboundIssueReceipt(agent, service, document, {
        connectionId: context.connectionId,
        senderDid: context.senderDid,
        recipientDid: context.recipientDid,
      })
      return
    }

    // Future legs (witness/session…) land in later milestones —
    // retain so nothing is lost, complain so nothing is silent.
    logger.info(`${LOG_PREFIX} unhandled trust-task type ${type} — retained`)
    await service.retain(agent.context, document, 'request', context.connectionId)
  })

  agent.config.logger.info(`${LOG_PREFIX} inbound carriage handler registered (binding 0.2)`)
}

interface InboundContext {
  connectionId: string
  senderDid: string
  recipientDid: string
}

/** Counterparty proposes: validate, store their relationship DID, accept with ours. */
async function handleInboundPropose(
  agent: Agent,
  service: TrustTasksService,
  document: Record<string, unknown>,
  context: InboundContext
): Promise<void> {
  const outcome = await service.consume(agent.context, {
    spec: propose.SPEC as never,
    document,
    myDid: context.recipientDid,
    senderDid: context.senderDid,
    connectionId: context.connectionId,
    handler: async (doc) => {
      const payload = (doc as { payload: { relationshipDid: string } }).payload
      const repository = agent.dependencyManager.container.resolve(RelationshipDidRepository)
      await repository.updateCounterpartyRelationshipDid(
        agent.context,
        context.senderDid,
        payload.relationshipDid,
        TRUST_TASKS_MIN_RCE_VERSION
      )
      const myRelationshipDid = await getOrCreateRelationshipDid(agent, context.senderDid, context.connectionId)
      return respondWith(doc as never, utils.uuid(), {
        accept: true,
        relationshipDid: myRelationshipDid,
        witnessed: (doc as { payload: { witnessed?: boolean } }).payload.witnessed === true,
      }, () => new Date().toISOString())
    },
  })

  if (outcome.kind === 'handled' && outcome.response) {
    await sendTrustTaskDocument(agent, context.connectionId, outcome.response as Record<string, unknown>)
    agent.config.logger.info(`${LOG_PREFIX} propose accepted; response sent (exchange ${document.threadId ?? document.id})`)
  } else if (outcome.kind === 'rejected') {
    agent.config.logger.warn(`${LOG_PREFIX} propose rejected: ${JSON.stringify((outcome as { error?: { payload?: unknown } }).error?.payload)}`)
  }
}

/**
 * Proof policy for the issue legs: verify eddsa-jcs-2022 under the sender's
 * relationship DID (milestone 3's verifier, replacing `acceptUnverified`).
 * Without a relationship record there is no expected controller — accept
 * unverified and let the handler's party-binding check refuse `notAccepted`.
 * The propose legs stay on the service default: their proofs are OPTIONAL and
 * unsigned today, and at propose time the counterparty's relationship DID —
 * the would-be controller — is exactly what the document is delivering.
 */
async function issueProofPolicy(
  agent: Agent,
  senderDid: string
): Promise<{ kind: 'verify'; verify: { verify: (doc: unknown) => Promise<boolean> } } | { kind: 'acceptUnverified' }> {
  const repository = agent.dependencyManager.container.resolve(RelationshipDidRepository)
  const record = await repository.findByConnectionDid(agent.context, senderDid)
  const expectedController = record?.counterpartyRelationshipDid
  if (!expectedController) return { kind: 'acceptUnverified' }
  return {
    kind: 'verify',
    verify: {
      verify: (doc: unknown) => verifyDocumentProof(agent, doc as Record<string, unknown>, expectedController),
    },
  }
}

/**
 * Counterparty delivers their signed VRC (`vrc/relationships/issue`).
 *
 * Conformance (spec, receiving party): verify the credential's party bindings
 * against the accepted proposal BEFORE returning a receipt; on acceptance,
 * answer with `vrcDigestMultibase` recomputed over the credential as
 * accepted; on refusal, a trust-task-error with `notAccepted`. Shadow mode:
 * storage stays with the legacy leg — this receipts the delivery.
 */
async function handleInboundIssue(
  agent: Agent,
  service: TrustTasksService,
  document: Record<string, unknown>,
  context: InboundContext
): Promise<void> {
  const logger = agent.config.logger
  const outcome = await service.consume(agent.context, {
    spec: issue.SPEC as never,
    document,
    myDid: context.recipientDid,
    senderDid: context.senderDid,
    connectionId: context.connectionId,
    // The eddsa-jcs-2022 verifier: the proof must verify under the sender's
    // relationship DID as the accepted proposal established it. When no
    // relationship record exists yet, fall through to the handler, whose
    // party-binding check refuses with the spec's `notAccepted` — the more
    // accurate error than `proofInvalid` for a delivery outside any accepted
    // exchange.
    proofPolicy: await issueProofPolicy(agent, context.senderDid),
    handler: async (doc) => {
      const payload = (doc as { payload: { vrc?: Record<string, unknown> } }).payload
      const vc = payload.vrc
      const notAccepted = (message: string) =>
        rejectWith(doc as never, utils.uuid(), {
          code: extendedCode(issue.TYPE_URI, 'notAccepted'),
          message,
          retryable: false,
        })
      if (!vc) return notAccepted('payload carries no credential')

      // Party bindings against the accepted proposal: the credential's issuer
      // must be the counterparty's relationship DID, its subject ours.
      const repository = agent.dependencyManager.container.resolve(RelationshipDidRepository)
      const record = await repository.findByConnectionDid(agent.context, context.senderDid)
      const vcIssuer = typeof vc.issuer === 'object' && vc.issuer !== null ? (vc.issuer as { id?: string }).id : vc.issuer
      const subject = Array.isArray(vc.credentialSubject) ? vc.credentialSubject[0] : vc.credentialSubject
      const subjectId = (subject as { id?: string } | undefined)?.id
      if (!record?.counterpartyRelationshipDid || vcIssuer !== record.counterpartyRelationshipDid) {
        return notAccepted('credential issuer is not the proposal counterparty relationship DID')
      }
      if (!record.myRelationshipDid || subjectId !== record.myRelationshipDid) {
        return notAccepted('credential subject is not this party relationship DID')
      }

      return respondWith(doc as never, utils.uuid(), { vrcDigestMultibase: digestMultibase(vc) }, () =>
        new Date().toISOString()
      )
    },
  })

  if (outcome.kind === 'handled' && outcome.response) {
    await sendTrustTaskDocument(agent, context.connectionId, outcome.response as Record<string, unknown>)
    logger.info(`${LOG_PREFIX} issue receipt sent (exchange ${document.threadId ?? document.id})`)
  } else if (outcome.kind === 'rejected') {
    // Handler refusals (notAccepted) and pipeline rejections (proofRequired…)
    // both surface here as a ready trust-task-error document — the binding
    // returns it on the same connection rather than going silent.
    const error = (outcome as { error?: Record<string, unknown> }).error
    if (error) await sendTrustTaskDocument(agent, context.connectionId, error)
    logger.warn(
      `${LOG_PREFIX} issue refused (exchange ${document.threadId ?? document.id}): ${JSON.stringify((error as { payload?: unknown } | undefined)?.payload)}`
    )
  }
}

/**
 * The counterparty's receipt for OUR delivery: correlate its recomputed
 * digest against the delivery we retained — a receipt whose digest matches no
 * delivery of ours acknowledges nothing (spec, issuing party item 4).
 */
async function handleInboundIssueReceipt(
  agent: Agent,
  service: TrustTasksService,
  document: Record<string, unknown>,
  context: InboundContext
): Promise<void> {
  const logger = agent.config.logger
  const outcome = await service.consume(agent.context, {
    spec: issue.RESPONSE_SPEC as never,
    document,
    myDid: context.recipientDid,
    senderDid: context.senderDid,
    connectionId: context.connectionId,
    // Receipt proofs are OPTIONAL (we send ours unsigned); the verify policy
    // still checks one when a peer supplies it.
    proofPolicy: await issueProofPolicy(agent, context.senderDid),
    handler: async (doc) => doc,
  })
  if (outcome.kind !== 'handled') return

  const receiptDigest = (document as { payload?: { vrcDigestMultibase?: string } }).payload?.vrcDigestMultibase
  const documentRepository = agent.dependencyManager.container.resolve(TrustTaskDocumentRepository)
  const myConnectionDid = context.recipientDid
  const requests = await documentRepository.findByQuery(agent.context, {
    typeUri: issue.TYPE_URI,
    connectionId: context.connectionId,
    role: 'request',
  })
  const mine = requests.find((r) => r.document.issuer === myConnectionDid)
  const myDigest = (mine?.document as { payload?: { vrcDigestMultibase?: string } } | undefined)?.payload
    ?.vrcDigestMultibase
  if (receiptDigest && myDigest && receiptDigest === myDigest) {
    logger.info(`${LOG_PREFIX} issue receipt matched — VRC delivery acknowledged (exchange ${document.threadId ?? document.id})`)
  } else {
    logger.warn(
      `${LOG_PREFIX} issue receipt digest matches no delivery of ours (exchange ${document.threadId ?? document.id}) — not acknowledged`
    )
  }
}

/** The counterparty accepted our propose: store their relationship DID. */
async function handleInboundProposeResponse(
  agent: Agent,
  service: TrustTasksService,
  document: Record<string, unknown>,
  context: InboundContext
): Promise<void> {
  const outcome = await service.consume(agent.context, {
    spec: propose.RESPONSE_SPEC as never,
    document,
    myDid: context.recipientDid,
    senderDid: context.senderDid,
    connectionId: context.connectionId,
    handler: async (doc) => {
      const payload = (doc as { payload: { relationshipDid: string; accept: boolean } }).payload
      const repository = agent.dependencyManager.container.resolve(RelationshipDidRepository)
      await repository.updateCounterpartyRelationshipDid(
        agent.context,
        context.senderDid,
        payload.relationshipDid,
        TRUST_TASKS_MIN_RCE_VERSION
      )
      return doc
    },
  })

  if (outcome.kind === 'handled') {
    agent.config.logger.info(`${LOG_PREFIX} propose#response consumed; relationship established (exchange ${document.threadId ?? document.id})`)
  }
}
