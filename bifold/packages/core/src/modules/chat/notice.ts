/**
 * The chat capability notice, and reading problem reports
 * (rich-messaging-plan.md §4.5).
 *
 * Contacts made before a build that speaks `keyring/chat/1.0` never learn of
 * it from the relationship handshake, which is sent once per relationship.
 * So a phone sends its own notice the first time the person opens the chat
 * with a contact stored below CHAT_MIN_RCE_VERSION, and answers a notice it
 * receives once. Nothing is sent to contacts nobody chats with: every notice
 * to an older build costs a queued message, maybe an empty wake, and a
 * problem report back.
 *
 * An older build answers an unknown message type with a generic
 * `notification/1.0` problem report threaded to the message's `@id`. Credo
 * registers no handler for that type. Registering one that returns nothing is
 * the pattern Credo itself uses for the same reason
 * (DidCommMessagePickupV4ProblemReportHandler: "Registering the type stops
 * the dispatcher from replying to the mediator's problem report with another
 * problem report"). The handler acts only on ids this phone sent on the
 * connection the report arrived on.
 *
 * @module chat/notice
 */

import type { Agent } from '@credo-ts/core'
import type { DidCommConnectionRecord } from '@credo-ts/didcomm'
import {
  DidCommMessageHandlerRegistry,
  DidCommMessageSender,
  DidCommOutboundMessageContext,
  DidCommProblemReportMessage,
} from '@credo-ts/didcomm'

import { RCE_PROTOCOL_VERSION } from '../vrc/vrc-manager'
import { RelationshipDidRepository } from '../vrc/repositories/RelationshipDidRepository'
import { counterpartySpeaksChat } from './capability'
import { getChatEventRepository, getChatPeerRepository } from './ChatModule'
import { deleteChatMessages } from './history'
import { ChatCapabilityMessage } from './messages/ChatCapabilityMessage'
import { ChatPeerRecord } from './records/ChatPeerRecord'

const LOG_PREFIX = '[Chat:notice]'

/** How long after a notice another one may be sent to the same contact. */
export const NOTICE_RETRY_MS = 7 * 24 * 60 * 60 * 1000

/** Highest RCE version a notice may announce; anything above is malformed. */
const MAX_ANNOUNCED_RCE_VERSION = 1000

export type ChatNoticeSendOutcome = 'sent' | 'not-needed' | 'not-v1' | 'recent'

export type ChatNoticeVerdict =
  | 'raised'
  | 'unchanged'
  | 'no-connection'
  | 'no-authenticated-sender'
  | 'bad-version'
  | 'no-relationship'

export type ChatProblemReportVerdict = 'notice-refused' | 'chat-refused' | 'ignored'

export interface ChatNoticeMessageContext {
  message: ChatCapabilityMessage
  connection?: DidCommConnectionRecord
  senderKey?: unknown
}

export interface ChatProblemReportMessageContext {
  message: DidCommProblemReportMessage
  connection?: DidCommConnectionRecord
}

async function peerRecord(agent: Agent, connectionId: string): Promise<ChatPeerRecord> {
  const repository = getChatPeerRepository(agent)
  const existing = await repository.findByConnection(agent.context, connectionId)
  if (existing) return existing
  const created = new ChatPeerRecord({ connectionId })
  await repository.save(agent.context, created)
  return created
}

async function sendNotice(agent: Agent, connection: DidCommConnectionRecord, reply: boolean, now: number) {
  const message = new ChatCapabilityMessage({ rceVersion: RCE_PROTOCOL_VERSION, reply })
  const messageSender = agent.dependencyManager.container.resolve(DidCommMessageSender)
  await messageSender.sendMessage(
    new DidCommOutboundMessageContext(message, { agentContext: agent.context, connection })
  )
  const peer = await peerRecord(agent, connection.id)
  peer.noticeId = message.id
  peer.noticeSentAt = new Date(now)
  await getChatPeerRepository(agent).update(agent.context, peer)
}

/**
 * Called when the person opens a chat. Sends this phone's notice when the
 * contact is not known to speak chat and no notice went out in the last
 * {@link NOTICE_RETRY_MS}.
 */
export async function sendCapabilityNoticeIfNeeded(
  agent: Agent,
  connectionId: string,
  now: number = Date.now()
): Promise<ChatNoticeSendOutcome> {
  const connection = await agent.modules.didcomm.connections.getById(connectionId)
  // Chat rides DIDComm v1 only, for now (plan §4.1).
  if (connection.didcommVersion === 'v2') return 'not-v1'
  if (await counterpartySpeaksChat(agent, connectionId)) return 'not-needed'
  const existing = await getChatPeerRepository(agent).findByConnection(agent.context, connectionId)
  if (existing?.noticeSentAt && now - existing.noticeSentAt.getTime() < NOTICE_RETRY_MS) return 'recent'
  await sendNotice(agent, connection, false, now)
  return 'sent'
}

/**
 * A contact's notice: raise its stored version (never lower it, never open
 * a relationship exchange), clear any refusal, and answer an initial notice
 * once with this phone's own.
 */
export async function receiveCapabilityNotice(
  agent: Agent,
  ctx: ChatNoticeMessageContext,
  now: number = Date.now()
): Promise<ChatNoticeVerdict> {
  if (!ctx.connection) return 'no-connection'
  if (!ctx.senderKey) return 'no-authenticated-sender'
  const version = ctx.message.rceVersion
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1 || version > MAX_ANNOUNCED_RCE_VERSION) {
    return 'bad-version'
  }
  const connection = ctx.connection
  if (!connection.theirDid) return 'no-relationship'

  const relationships = agent.dependencyManager.resolve(RelationshipDidRepository)
  const relationship = await relationships.findByConnectionDid(agent.context, connection.theirDid)
  if (!relationship) return 'no-relationship'

  const previous = relationship.counterpartyRceVersion ?? 1
  if (version > previous) {
    relationship.counterpartyRceVersion = version
    await relationships.update(agent.context, relationship)
  }

  const peer = await getChatPeerRepository(agent).findByConnection(agent.context, connection.id)
  if (peer?.chatRefusedAt) {
    peer.chatRefusedAt = undefined
    await getChatPeerRepository(agent).update(agent.context, peer)
  }

  if (ctx.message.reply !== true && connection.didcommVersion !== 'v2') {
    await sendNotice(agent, connection, true, now)
  }
  return version > previous ? 'raised' : 'unchanged'
}

/**
 * A generic problem report. Acts only when its parent id is a notice or a
 * chat event this phone sent on the same connection; otherwise ignores it.
 */
export async function receiveChatProblemReport(
  agent: Agent,
  ctx: ChatProblemReportMessageContext,
  now: number = Date.now()
): Promise<ChatProblemReportVerdict> {
  const connection = ctx.connection
  const parentId = ctx.message.thread?.parentThreadId
  if (!connection || !parentId) return 'ignored'

  const peers = getChatPeerRepository(agent)
  const peer = await peers.findByConnection(agent.context, connection.id)
  if (peer?.noticeId === parentId) return 'notice-refused'

  const events = getChatEventRepository(agent)
  const refused = await events.findEvent(agent.context, connection.id, 'sent', parentId)
  if (!refused) return 'ignored'

  const record = peer ?? (await peerRecord(agent, connection.id))
  record.chatRefusedAt = new Date(now)
  await peers.update(agent.context, record)

  // Resend before deleting: if the resend fails, the chat copy stays (sent but
  // not delivered, still visible) instead of the message vanishing from both
  // phones. A failed delete after a good resend only leaves a visible duplicate.
  if (refused.eventType === 'message') {
    const text = refused.content?.text
    // Nothing to resend: keep the event rather than delete it with nothing sent.
    if (!text) return 'chat-refused'
    await agent.modules.didcomm.basicMessages.sendMessage(connection.id, text)
  }
  // The other phone never showed it, so it leaves this phone's timeline too, with whatever hangs off it (its
  // reactions and their redactions, its media file), the same way Delete for me removes a message.
  await deleteChatMessages(agent, connection.id, { eventIds: [refused.eventId] })
  return 'chat-refused'
}

/** Register the notice and problem-report handlers. Explicit, never an import side effect. */
export function setupChatCapability(agent: Agent): void {
  const registry = agent.dependencyManager.container.resolve(DidCommMessageHandlerRegistry)
  registry.registerMessageHandler({
    supportedMessages: [ChatCapabilityMessage],
    handle: async (messageContext: unknown) => {
      const ctx = messageContext as ChatNoticeMessageContext
      try {
        const verdict = await receiveCapabilityNotice(agent, ctx)
        agent.config.logger.debug(`${LOG_PREFIX} notice on connection ${ctx.connection?.id}: ${verdict}`)
      } catch (error) {
        agent.config.logger.error(`${LOG_PREFIX} handling notice ${ctx.message?.id} failed`, { error })
      }
      return undefined
    },
  })
  registry.registerMessageHandler({
    supportedMessages: [DidCommProblemReportMessage],
    handle: async (messageContext: unknown) => {
      const ctx = messageContext as ChatProblemReportMessageContext
      try {
        const verdict = await receiveChatProblemReport(agent, ctx)
        if (verdict !== 'ignored') {
          agent.config.logger.info(`${LOG_PREFIX} problem report on connection ${ctx.connection?.id}: ${verdict}`)
        }
      } catch (error) {
        agent.config.logger.error(`${LOG_PREFIX} handling problem report ${ctx.message?.id} failed`, { error })
      }
      return undefined
    },
  })
}
