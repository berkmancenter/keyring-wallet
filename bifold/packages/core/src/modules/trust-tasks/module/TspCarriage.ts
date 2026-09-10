/**
 * TspCarriage — the `Carriage` port (@bifold/trust-tasks) implemented over
 * the real TSP envelope stack (HPKE-Auth, Askar custody, CESR framing —
 * `@bifold/trust-tasks`'s `tsp.pack`/`tsp.unpack`, `@bifold/credo-tsp-adapter`'s
 * Askar-backed ports), physically delivered over an EXISTING DIDComm-v1
 * connection exactly like `DidCommV1Carriage` — only the envelope format
 * changes, not the transport. `TspEnvelopeMessage` is the DIDComm-v1 body;
 * this is deliberately double-wrapped crypto (DIDComm-v1 authcrypt carrying
 * an HPKE-sealed TSP envelope), which isolates the envelope-layer swap as
 * the only new variable and needs no new transport/mediator work.
 *
 * Wallet-to-wallet only. This does NOT achieve ecosystem interop with
 * `vta-service`/`openvtc`/`pnm-cli`'s own TSP endpoints — see the parent
 * plan's §5.4 stage-4 scope correction
 * (`docs/plans/openvtc-integration-plan/2026-09-02-bam.md`) for why that
 * is a separate, still-gated concern.
 *
 * The TSP identity for both ends is derived from the DIDComm connection's
 * OWN did (`identityFromDid`/`createCredoVidResolver`,
 * `@bifold/credo-tsp-adapter`) — no separate pairing/bootstrap step, and no
 * new VID is minted. The inbound side additionally checks that the
 * envelope's cleartext-claimed sender VID matches the connection's known
 * counterparty (`connection.theirDid`), the same "reject a document whose
 * in-band identity disagrees with the connection" policy
 * `trust_tasks_subtask.md` §9 step 3 requires of the DIDComm-v1 binding too.
 *
 * @module trust-tasks/module/TspCarriage
 */

import type { Agent } from '@credo-ts/core'
import { DidCommMessageHandlerRegistry, DidCommMessageSender, DidCommOutboundMessageContext } from '@credo-ts/didcomm'
import type { Carriage, CarriageDocumentHandler, CarriagePeer } from '@bifold/trust-tasks'
import { tsp } from '@bifold/trust-tasks'
import { identityFromDid, createCredoVidResolver } from '@bifold/credo-tsp-adapter'

import { TspEnvelopeMessage } from '../messages/TspEnvelopeMessage'

const utf8 = new TextEncoder()
// `tsp.decodeUtf8Strict` (not a plain `new TextDecoder(..., { fatal: true })`)
// because React Native's Hermes runtime throws just constructing a
// `TextDecoder` with the `fatal` option — see its doc comment in
// `@bifold/trust-tasks`'s `tsp/direct.ts` for the full explanation.
const fromUtf8 = tsp.decodeUtf8Strict

/** Distinct from ceremony.ts's `[TrustTasks:Ceremony]` markers — this
 *  confirms the TSP envelope path specifically ran, not just that a
 *  document arrived (which either carriage would show). Read via
 *  `adb logcat`, same convention as `e2e/lib/flows.js`'s
 *  `assertTrustTaskExchangeMarkers`. */
const LOG_PREFIX = '[TrustTasks:TspCarriage]'

export function createTspCarriage(agent: Agent): Carriage {
  const resolver = createCredoVidResolver(agent)

  return {
    async send(document: Record<string, unknown>, peer: CarriagePeer): Promise<void> {
      const connection = await agent.modules.didcomm.connections.getById(peer.connectionId)
      const myVid = connection.did
      const theirVid = connection.theirDid
      if (!myVid || !theirVid) {
        throw new Error(`TspCarriage: connection ${peer.connectionId} is missing did/theirDid`)
      }

      const senderIdentity = await identityFromDid(agent, myVid)
      const body = utf8.encode(JSON.stringify(document))
      const packed = await tsp.pack(body, myVid, theirVid, senderIdentity, resolver)

      const messageSender = agent.dependencyManager.container.resolve(DidCommMessageSender)
      await messageSender.sendMessage(
        new DidCommOutboundMessageContext(new TspEnvelopeMessage({ envelope: packed.bytes }), {
          agentContext: agent.context,
          connection,
        })
      )
      agent.config.logger.info(`${LOG_PREFIX} envelope sent on connection ${peer.connectionId}`)
    },

    onDocument(handler: CarriageDocumentHandler): void {
      const registry = agent.dependencyManager.container.resolve(DidCommMessageHandlerRegistry)
      registry.registerMessageHandler({
        supportedMessages: [TspEnvelopeMessage],
        handle: async (messageContext: any) => {
          const envelope = (messageContext.message as TspEnvelopeMessage).envelope
          const connection = messageContext.connection
          if (!envelope || !connection?.did || !connection.theirDid) return undefined

          const receiverIdentity = await identityFromDid(agent, connection.did)
          const unpacked = await tsp.unpack(envelope, receiverIdentity, resolver)
          if (unpacked.sender !== connection.theirDid) {
            throw new Error(
              `TspCarriage: envelope's claimed sender (${unpacked.sender}) disagrees with the connection's counterparty (${connection.theirDid})`
            )
          }

          const document = JSON.parse(fromUtf8(unpacked.payload)) as Record<string, unknown>
          agent.config.logger.info(`${LOG_PREFIX} envelope received on connection ${connection.id}`)
          await handler(document, {
            connectionId: connection.id,
            senderDid: connection.theirDid,
            recipientDid: connection.did,
          })
          return undefined
        },
      })
    },
  }
}
