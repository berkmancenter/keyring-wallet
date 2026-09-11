/**
 * The Approver demo's own Trust Task ceremony: propose an access request over
 * an existing VRC relationship, register the registry entry that lets the
 * counterparty's wallet render it and answer, and send the signed decision
 * back.
 *
 * This is the concrete instance of R5's registry proving out on a NEW task
 * type end to end — nothing here touches `ceremony.ts`; every hook it needs
 * (dispatch, generic approve/deny scaffolding, signing, discovery
 * advertisement) comes from what `@bifold/core`'s trust-tasks module already
 * exports.
 *
 * @module demo-profiles/approver/ceremony
 */

import type { Agent } from '@credo-ts/core'
import { utils } from '@credo-ts/core'
import {
  RelationshipDidRepository,
  createApprovalRequestHandler,
  getTrustTasksService,
  registerTrustTask,
  respondToPendingTrustTask,
  sendTrustTaskDocument,
} from '@bifold/core'
import type { TrustTaskInboundContext as InboundContext } from '@bifold/core'
import { signDocumentProof, verifyDocumentProof } from '@bifold/trust-tasks'
import { EventEmitter } from 'events'

import { AccessRequestResponsePayload, RESPONSE_SPEC, SPEC, TYPE_URI, RESPONSE_TYPE_URI } from './accessRequestSpec'

const LOG_PREFIX = '[Approver]'

/**
 * The requester side has no generic "a response arrived" surface —
 * `trustTaskPromptStore` is for the ANSWERING side's pending prompt. This
 * small EventEmitter is this demo's own analogue for the other direction, so
 * `ApproverContactSection` (on wallet A, the requester) can show that the
 * signed decision actually landed rather than trusting the send call
 * silently succeeded. Exported so an e2e test could observe it directly if
 * it ever needed to, though the e2e in this repo asserts through the
 * rendered UI. Events carry `connectionId` so a listener scoped to one
 * contact (as `ApproverContactSection` is) can ignore decisions on other
 * contacts' connections.
 */
export interface AccessRequestDecisionEvent {
  connectionId: string
  decision: AccessRequestResponsePayload['decision']
}
export const approverDecisionEvents = new EventEmitter()

/**
 * Verify a request's proof under the sender's already-established
 * relationship DID — the exact policy `issueProofPolicy` in `ceremony.ts`
 * applies to the issue/witness-share legs, reused rather than reinvented:
 * this demo has no identity mechanism of its own, it rides the VRC
 * relationship the two wallets already hold. Resolved per-sender
 * (`createApprovalRequestHandler`'s `proofPolicy` accepts a resolver
 * function for exactly this reason — see its own doc comment).
 */
async function approverProofPolicy(agent: Agent, context: InboundContext) {
  const repository = agent.dependencyManager.container.resolve(RelationshipDidRepository)
  const record = await repository.findByConnectionDid(agent.context, context.senderDid)
  const expectedController = record?.counterpartyRelationshipDid
  if (!expectedController) return { kind: 'acceptUnverified' as const }
  return {
    kind: 'verify' as const,
    verify: {
      verify: (doc: unknown) => verifyDocumentProof(agent, doc as Record<string, unknown>, expectedController),
    },
  }
}

/**
 * Register the access-request task type into the open registry (R5). Call
 * once, from `ApproverProfile.register()` — before any document of this type
 * can arrive, matching how the Approver demo profile is applied to the
 * container at app boot.
 */
export function registerApproverTaskType(): void {
  registerTrustTask({
    typeUri: TYPE_URI,
    spec: SPEC as never,
    responseSpec: RESPONSE_SPEC as never,
    orchestration: {
      // Always user-initiated (someone taps "Request access") — never an
      // automatic tie-broken proposal like vrc/relationships/propose, so
      // this demo declares no isDeterministicProposer and no
      // requiresDiscovery: both wallets in the demo run the same build, so
      // "does the peer support this type" is known by construction rather
      // than needing a discovery round trip.
      requiresDiscovery: false,
    },
    handleRequest: createApprovalRequestHandler({
      spec: SPEC as never,
      summarize: (payload) => String((payload as { resource?: string }).resource ?? 'an access request'),
      proofPolicy: approverProofPolicy,
    }),
    // The requester side's receipt: verify the signed decision under the
    // same per-sender relationship-DID policy as the request leg, then emit
    // it on approverDecisionEvents so the UI can show it landed.
    handleResponse: async (agent, service, document, context) => {
      const proofPolicy = await approverProofPolicy(agent, context)
      const outcome = await service.consume(agent.context, {
        spec: RESPONSE_SPEC as never,
        document,
        myDid: context.recipientDid,
        senderDid: context.senderDid,
        connectionId: context.connectionId,
        proofPolicy,
        handler: async (doc) => doc,
      })
      if (outcome.kind !== 'handled') {
        agent.config.logger.warn(`${LOG_PREFIX} decision receipt not consumed (${outcome.kind})`)
        return
      }
      const decision = (document as { payload?: AccessRequestResponsePayload }).payload?.decision
      agent.config.logger.info(`${LOG_PREFIX} decision received on connection ${context.connectionId}: ${decision}`)
      approverDecisionEvents.emit('decision', {
        connectionId: context.connectionId,
        decision,
      } as AccessRequestDecisionEvent)
    },
  })
}

/**
 * Propose an access request to a contact over an established VRC
 * relationship. There is no idempotence guard here the way
 * `openRelationshipExchange` has one — unlike the once-per-relationship VRC
 * handshake, sending a second, distinct access request on the same
 * connection is a legitimate thing to do (a different resource, or the same
 * one again later), so this demo does not try to collapse repeats the way
 * the one-shot relationship proposal does.
 */
export async function proposeAccessRequest(
  agent: Agent,
  connectionId: string,
  resource: string,
  reason?: string
): Promise<void> {
  const logger = agent.config.logger
  const connection = await agent.modules.didcomm.connections.getById(connectionId)
  if (!connection.did || !connection.theirDid) return

  const repository = agent.dependencyManager.container.resolve(RelationshipDidRepository)
  const record = await repository.findByConnectionDid(agent.context, connection.theirDid)
  if (!record?.myRelationshipDid) {
    logger.warn(`${LOG_PREFIX} no established VRC relationship on connection ${connectionId} — cannot sign a request`)
    return
  }

  const document: Record<string, unknown> = {
    id: utils.uuid(),
    type: TYPE_URI,
    threadId: utils.uuid(),
    issuer: connection.did,
    recipient: connection.theirDid,
    issuedAt: new Date().toISOString(),
    payload: reason ? { resource, reason } : { resource },
  }
  const signed = await signDocumentProof(agent, document, record.myRelationshipDid)

  const service = getTrustTasksService(agent)
  await service.retain(agent.context, signed, 'request', connectionId)
  await sendTrustTaskDocument(agent, connectionId, signed)
  logger.info(`${LOG_PREFIX} access request sent on connection ${connectionId}: ${resource}`)
}

/**
 * The person's decision on a pending access request — approve or deny,
 * signed under this wallet's own relationship DID with the counterparty
 * (same signing identity `deliverVrcViaTrustTaskForExchange` uses for the
 * issue leg), and sent back.
 */
export async function respondToAccessRequest(
  agent: Agent,
  connectionId: string,
  decision: 'approved' | 'denied'
): Promise<void> {
  const connection = await agent.modules.didcomm.connections.getById(connectionId)
  const repository = agent.dependencyManager.container.resolve(RelationshipDidRepository)
  const record = connection.theirDid ? await repository.findByConnectionDid(agent.context, connection.theirDid) : null

  await respondToPendingTrustTask(
    agent,
    connectionId,
    TYPE_URI,
    decision,
    (d) => ({ decision: d, respondedAt: new Date().toISOString() }),
    record?.myRelationshipDid
  )
}

export { TYPE_URI, RESPONSE_TYPE_URI }
