/**
 * DidCommV2Carriage — the `Carriage` port (@bifold/trust-tasks) implemented
 * over Credo's DIDComm **v2** stack (credo-ts PR #2704): the framework's
 * `binding/didcomm/0.2` envelope (`TrustTaskEnvelopeV2Message`) on a v2
 * connection.
 *
 * Third implementor of the port after DidCommV1Carriage (binding didcomm-v1/0.2)
 * and TspCarriage; `ceremony.ts` picks between them per connection
 * (`selectCarriage`). The consumer half of the binding lives here:
 *
 *   - authcrypt only (§4): a frame with no authenticated sender never
 *     reaches the task pipeline;
 *   - thread correlation (§3.1): `thid` and the document's `threadId` — and
 *     `pthid`/`parentThreadId` — MUST agree when both are present
 *     (`malformedRequest`), and a missing member is never filled from the
 *     transport;
 *   - identity (§2): the connection's `theirDid` is the transport-
 *     authenticated sender for the framework's §4.8.1 cross-check, exactly
 *     as the v1 carriage supplies it;
 *   - first contact: a message on one of our own v2 invitations arrives with
 *     no connection (Credo never creates the inviter's record) — mint it,
 *     see `v2FirstContact.ts`.
 *
 * Measured on the snapshot in tsp-reference/ref-16 (16 checks) and, through a
 * v2 mediator, ref-17.
 *
 * @module trust-tasks/module/DidCommV2Carriage
 */

import type { Agent } from '@credo-ts/core'
import type { DidCommConnectionRecord } from '@credo-ts/didcomm'
import { DidCommMessageHandlerRegistry, DidCommMessageSender, DidCommOutboundMessageContext } from '@credo-ts/didcomm'
import type { Carriage, CarriageDocumentHandler, CarriagePeer } from '@bifold/trust-tasks'
import { checkV2ThreadCorrelation, ensureV2ConnectionForFirstContact } from '@bifold/trust-tasks'

import { TrustTaskEnvelopeV2Message } from '../messages/TrustTaskEnvelopeV2Message'

export { checkV2ThreadCorrelation, ensureV2ConnectionForFirstContact }

const LOG_PREFIX = '[TrustTasks:DidCommV2Carriage]'

/** What the inbound handler saw, for tests and logs. */
export type V2InboundVerdict =
  | 'ok'
  | 'no-authenticated-sender'
  | 'malformedRequest:thid'
  | 'malformedRequest:pthid'
  | 'no-connection'
  | 'no-document'

export interface DidCommV2InboundMessageContext {
  message: TrustTaskEnvelopeV2Message
  connection?: DidCommConnectionRecord
  senderKey?: unknown
  senderDid?: string
}

export function createDidCommV2Carriage(agent: Agent, onVerdict?: (verdict: V2InboundVerdict) => void): Carriage {
  return {
    async send(document: Record<string, unknown>, peer: CarriagePeer): Promise<void> {
      const connection = await agent.modules.didcomm.connections.getById(peer.connectionId)
      if (connection.didcommVersion !== 'v2') {
        throw new Error(
          `${LOG_PREFIX} connection ${peer.connectionId} is not a DIDComm v2 connection (${connection.didcommVersion ?? 'v1'})`
        )
      }
      const messageSender = agent.dependencyManager.container.resolve(DidCommMessageSender)
      await messageSender.sendMessage(
        new DidCommOutboundMessageContext(new TrustTaskEnvelopeV2Message({ document }), {
          agentContext: agent.context,
          connection,
        })
      )
      agent.config.logger.info(`${LOG_PREFIX} envelope sent on v2 connection ${peer.connectionId}`)
    },

    onDocument(handler: CarriageDocumentHandler): void {
      const registry = agent.dependencyManager.container.resolve(DidCommMessageHandlerRegistry)
      registry.registerMessageHandler({
        supportedMessages: [TrustTaskEnvelopeV2Message],
        handle: async (messageContext: unknown) => {
          const ctx = messageContext as DidCommV2InboundMessageContext
          const message = ctx.message
          const verdict = await receive(agent, ctx, handler)
          onVerdict?.(verdict)
          if (verdict !== 'ok') {
            agent.config.logger.warn(`${LOG_PREFIX} inbound envelope ${message.id} refused: ${verdict}`)
          }
          return undefined
        },
      })
    },
  }
}

async function receive(
  agent: Agent,
  ctx: DidCommV2InboundMessageContext,
  handler: CarriageDocumentHandler
): Promise<V2InboundVerdict> {
  const message = ctx.message
  // §4: anoncrypt / plaintext never enter the framework pipeline.
  if (!ctx.senderKey) return 'no-authenticated-sender'

  const document = message.document
  if (!document) return 'no-document'

  const thread = checkV2ThreadCorrelation(message, document)
  if (thread !== 'ok') return thread

  let connection = ctx.connection
  if (!connection) {
    const from = message.plaintextFrom ?? ctx.senderDid
    const to = message.plaintextTo?.[0]
    if (from && to) connection = await ensureV2ConnectionForFirstContact(agent as never, { from, to })
  }
  if (!connection?.did || !connection.theirDid) return 'no-connection'

  agent.config.logger.info(`${LOG_PREFIX} envelope received on v2 connection ${connection.id}`)
  await handler(document, {
    connectionId: connection.id,
    senderDid: connection.theirDid,
    recipientDid: connection.did,
  })
  return 'ok'
}
