/**
 * v2Binding — the consumer-side rules of the framework's `binding/didcomm 0.2`
 * that every Keyring party (wallet, witness-server) applies the same way,
 * kept beside the envelope message so both run one implementation:
 *
 *   - thread correlation (§3.1): `thid`/`threadId` and `pthid`/`parentThreadId`
 *     MUST agree when both are present (`malformedRequest`, never
 *     `identityMismatch`); a missing member is never filled from the transport;
 *   - first contact: DIDComm v2 OOB has no handshake. Credo (PR #2704) creates
 *     the inviter's connection when the invitee's first authenticated message
 *     arrives ONLY with `connections.autoCreateConnectionOnFirstMessage: true`
 *     (default false — which is what tsp-reference/ref-15 finding 1 and ref-17
 *     finding 3 observed). Every Keyring party sets that option; this helper
 *     is the fallback for a party that does not, minting the same record
 *     Credo's `DidCommMessageReceiver` would (role Responder: the inviter
 *     answers), through the public `DidCommConnectionService`.
 *
 * Platform-neutral: Credo imports only, as `TrustTaskMessage.ts` already has.
 *
 * @module v2Binding
 */

import type { AgentContext } from '@credo-ts/core'
import type { DidCommConnectionRecord, DidCommOutOfBandRecord } from '@credo-ts/didcomm'
import {
  DidCommConnectionService,
  DidCommDidExchangeRole,
  DidCommDidExchangeState,
  DidCommHandshakeProtocol,
  DidCommOutOfBandRepository,
  DidCommOutOfBandRole,
} from '@credo-ts/didcomm'

export type V2ThreadVerdict = 'ok' | 'malformedRequest:thid' | 'malformedRequest:pthid'

/** Binding §3.1, pure: compare only when BOTH the header and the member are present; never fill. */
export function checkV2ThreadCorrelation(
  message: { threadId?: string; thread?: { parentThreadId?: string } },
  document: Record<string, unknown>
): V2ThreadVerdict {
  const thid = message.threadId
  const pthid = message.thread?.parentThreadId
  const threadId = document.threadId as string | undefined
  const parentThreadId = document.parentThreadId as string | undefined
  if (thid !== undefined && threadId !== undefined && thid !== threadId) return 'malformedRequest:thid'
  if (pthid !== undefined && parentThreadId !== undefined && pthid !== parentThreadId) return 'malformedRequest:pthid'
  return 'ok'
}

/** The smallest slice of an agent these helpers need (a real `Agent` satisfies it; tests fake it). */
export interface V2BindingAgent {
  context: AgentContext
  dependencyManager: { container: { resolve<T>(token: unknown): T } }
  config: { logger: { info(message: string): void } }
}

export interface V2FirstContact {
  /** The sender's DID as the authenticated v2 plaintext carried it. */
  from: string
  /** Our DID as the plaintext carried it — must be one of our v2 invitation DIDs. */
  to: string
}

/** Our sender-role OOB record whose v2 invitation was issued from `did`, if any. */
export async function findOwnV2InvitationRecord(
  agent: V2BindingAgent,
  did: string
): Promise<DidCommOutOfBandRecord | undefined> {
  const repository = agent.dependencyManager.container.resolve<DidCommOutOfBandRepository>(DidCommOutOfBandRepository)
  const records = await repository.findByQuery(agent.context, { role: DidCommOutOfBandRole.Sender })
  return records.find((record) => record.outOfBandInvitation.v2Invitation?.from === did)
}

/**
 * The connection for an authenticated v2 message that arrived with none,
 * created when the message is the first contact on one of our invitations.
 * Undefined when `to` is not an invitation of ours — the caller must then
 * treat the message as unassociated.
 */
export async function ensureV2ConnectionForFirstContact(
  agent: V2BindingAgent,
  contact: V2FirstContact
): Promise<DidCommConnectionRecord | undefined> {
  const connectionService =
    agent.dependencyManager.container.resolve<DidCommConnectionService>(DidCommConnectionService)

  const existing = await connectionService.findByDids(agent.context, { ourDid: contact.to, theirDid: contact.from })
  if (existing) return existing

  const invitationRecord = await findOwnV2InvitationRecord(agent, contact.to)
  if (!invitationRecord) return undefined

  agent.config.logger.info(
    `[TrustTasks:v2FirstContact] first message from ${contact.from.slice(0, 32)}… on our invitation ${invitationRecord.id} — creating the inviter-side connection`
  )
  return connectionService.createConnection(
    agent.context,
    {
      protocol: DidCommHandshakeProtocol.None,
      // Same as Credo's own first-message creation: the inviter is the responder.
      role: DidCommDidExchangeRole.Responder,
      state: DidCommDidExchangeState.Completed,
      did: contact.to,
      theirDid: contact.from,
      outOfBandId: invitationRecord.id,
      invitationDid: contact.to,
      theirLabel: invitationRecord.outOfBandInvitation.v2Invitation?.body?.goal,
      didcommVersion: 'v2',
    },
    true
  )
}
