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
import * as propose from '@openvtc/trust-tasks/vrc/relationships/propose/0.1/payload'
import { utils } from '@credo-ts/core'

import { getOrCreateRelationshipDid } from '../vrc/vrc-manager'
import { RelationshipDidRepository } from '../vrc/repositories/RelationshipDidRepository'

import { TrustTaskMessage } from './messages/TrustTaskMessage'
import { TrustTasksModule } from './module/TrustTasksModule'
import { TrustTaskDocumentRepository } from './services/TrustTaskDocumentRepository'
import { TrustTasksService, respondWith } from './services/TrustTasksService'

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

    // Future legs (issue, witness/session…) land in later milestones —
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
