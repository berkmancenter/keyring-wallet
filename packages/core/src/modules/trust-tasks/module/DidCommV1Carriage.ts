/**
 * DidCommV1Carriage — the `Carriage` port (@bifold/trust-tasks) implemented
 * over Credo's DIDComm v1 stack: the binding-0.2 `~attach` carriage
 * (`TrustTaskMessage`) on an existing connection.
 *
 * Extracted so the send path and inbound registration have one seam
 * (openvtc-integration-plan.md review A1 / trust_tasks_subtask.md §9 step 1):
 * `ceremony.ts` depends on this port's shape, not on `DidCommMessageSender`
 * directly, so a later carriage (TSP, DIDComm v2) implements the same
 * interface without touching the task model or its call sites.
 *
 * @module trust-tasks/module/DidCommV1Carriage
 */

import type { Agent } from '@credo-ts/core'
import { DidCommMessageHandlerRegistry, DidCommMessageSender, DidCommOutboundMessageContext } from '@credo-ts/didcomm'
import type { Carriage, CarriageDocumentHandler, CarriagePeer } from '@bifold/trust-tasks'

import { TrustTaskMessage } from '../messages/TrustTaskMessage'
import { TrustTasksModule } from './TrustTasksModule'

export function createDidCommV1Carriage(agent: Agent): Carriage {
  return {
    async send(document: Record<string, unknown>, peer: CarriagePeer): Promise<void> {
      const connection = await agent.modules.didcomm.connections.getById(peer.connectionId)
      const messageSender = agent.dependencyManager.container.resolve(DidCommMessageSender)
      await messageSender.sendMessage(
        new DidCommOutboundMessageContext(new TrustTaskMessage({ document }), {
          agentContext: agent.context,
          connection,
        })
      )
    },

    onDocument(handler: CarriageDocumentHandler): void {
      const registry = agent.dependencyManager.container.resolve(DidCommMessageHandlerRegistry)
      TrustTasksModule.registerMessageHandler(registry, handler)
    },
  }
}
