/**
 * Receiving `keyring/chat/1.0` events (rich-messaging-plan.md §4).
 *
 * The handler only validates and stores. A message's photo is written to the
 * chat's media folder before its record is stored, so a record never names a
 * file that is not there; a crash in between leaves only an orphan file, which
 * Clear chat or removing the contact clears. Folding reactions into their
 * targets, the authorship check and ordering belong to the chat service
 * built on top. The sender of a stored event is always the connection it
 * arrived on, never a member of the event.
 *
 * @module chat/inbound
 */

import type { Agent } from '@credo-ts/core'
import type { DidCommConnectionRecord } from '@credo-ts/didcomm'
import { DidCommMessageHandlerRegistry } from '@credo-ts/didcomm'

import { parseChatEvent } from './chatEvent'
import type { ChatEventRejection, ChatMessageEvent } from './chatEvent'
import { getChatEventRepository } from './ChatModule'
import { ChatEventMessage } from './messages/ChatEventMessage'
import { writeChatMedia } from './media/store'
import { ChatEventRecord } from './records/ChatEventRecord'
import type { ChatEventRecordAttachment } from './records/ChatEventRecord'
import { noteChatFromContact, setupChatCapability } from './notice'
import { isBeingSent } from './sending'

const LOG_PREFIX = '[Chat:inbound]'

/** What the handler did with one inbound message, for tests and logs. */
export type ChatInboundVerdict =
  | 'stored'
  | 'duplicate'
  | 'reused-event-id'
  | 'no-connection'
  | 'no-authenticated-sender'
  | ChatEventRejection

export interface ChatInboundMessageContext {
  message: ChatEventMessage
  connection?: DidCommConnectionRecord
  senderKey?: unknown
}

/** Validate one inbound chat message and store its event. Never throws on bad input. */
export async function receiveChatEventMessage(
  agent: Agent,
  ctx: ChatInboundMessageContext
): Promise<ChatInboundVerdict> {
  // Only an authenticated message on an existing connection is a chat event.
  // Over DIDComm v1 the senderKey check can never refuse anything: Credo finds a
  // v1 connection only from the sender and recipient keys, so a connection
  // implies a sender key. Over v2 (and TSP) a connection can be found from the
  // `from`/`to` DIDs alone, so an anoncrypt message reaches here with no
  // sender key and is dropped. This phone sends chat events on v1 connections
  // only (capability.ts), so nothing of ours takes that path; whoever enables
  // chat over v2 must decide it deliberately, not inherit it.
  if (!ctx.connection) return 'no-connection'
  if (!ctx.senderKey) return 'no-authenticated-sender'

  const parsed = parseChatEvent(ctx.message.event)
  if (!parsed.ok) return parsed.reason
  const event = parsed.event

  const repository = getChatEventRepository(agent)
  const connectionId = ctx.connection.id
  if (await repository.findEvent(agent.context, connectionId, 'received', event.eventId)) return 'duplicate'
  // An eventId is a random ULID, so a received one never matches one this phone sent, unless the peer copied it. Every
  // lookup by eventId (deletion with its dependents, the expiry sweep, replies, a reaction's target when the timeline
  // is folded) would then reach this phone's own message too: a peer could delete it, or expire it with a short timer
  // of its own. So it is refused, whatever its type, whether this phone's event is stored or still being sent (its
  // record is stored only once the send succeeds).
  if (
    isBeingSent(connectionId, event.eventId) ||
    (await repository.findEvent(agent.context, connectionId, 'sent', event.eventId))
  ) {
    return 'reused-event-id'
  }

  const attachments = event.type === 'message' ? await storeAttachments(agent, connectionId, event) : undefined
  await repository.save(
    agent.context,
    new ChatEventRecord({
      connectionId,
      role: 'received',
      eventId: event.eventId,
      eventType: event.type,
      clientTs: event.clientTs,
      ...(event.type === 'message'
        ? { content: event.content, attachments, inReplyTo: event.inReplyTo, expiresIn: event.expiresIn }
        : {}),
      ...(event.type === 'reaction' ? { target: event.target, emoji: event.emoji } : {}),
      ...(event.type === 'redaction' ? { target: event.target } : {}),
      ...(event.type === 'timer' ? { timer: event.timer } : {}),
    })
  )
  // A chat event proves the contact speaks chat, even if its notice never came (it upgraded after pairing).
  try {
    await noteChatFromContact(agent, ctx.connection)
  } catch (error) {
    agent.config.logger.warn(`${LOG_PREFIX} could not record that ${connectionId} speaks chat`, { error })
  }
  return 'stored'
}

/**
 * Write a message's checked photo and describe it for the record, which never holds the image itself. The file is
 * named by the eventId and the type read from the bytes (media/store.ts), never by anything else the sender wrote. A
 * photo that cannot be written is kept as unsupported, so its message still arrives.
 */
async function storeAttachments(
  agent: Agent,
  connectionId: string,
  event: ChatMessageEvent
): Promise<ChatEventRecordAttachment[] | undefined> {
  const attachment = event.attachments?.[0]
  if (!attachment) return undefined
  if ('unsupported' in attachment) return [attachment]
  try {
    const file = await writeChatMedia(connectionId, event.eventId, attachment.mediaType, attachment.base64)
    const { id, mediaType, byteCount, width, height } = attachment
    return [{ id, mediaType, byteCount, width, height, file }]
  } catch (error) {
    agent.config.logger.warn(`${LOG_PREFIX} a photo on connection ${connectionId} could not be written`, { error })
    return [{ id: attachment.id, unsupported: 'not-saved' }]
  }
}

/**
 * Register the inbound handlers: chat events, the capability notice and
 * problem reports (notice.ts). Called after agent initialization, because
 * the handler registry is DIDComm-module state, not container state.
 * Registration is an explicit call, never an import side effect.
 */
export function setupChatInbound(agent: Agent, onVerdict?: (verdict: ChatInboundVerdict) => void): void {
  const registry = agent.dependencyManager.container.resolve(DidCommMessageHandlerRegistry)
  registry.registerMessageHandler({
    supportedMessages: [ChatEventMessage],
    handle: async (messageContext: unknown) => {
      const ctx = messageContext as ChatInboundMessageContext
      let verdict: ChatInboundVerdict
      try {
        verdict = await receiveChatEventMessage(agent, ctx)
      } catch (error) {
        agent.config.logger.error(`${LOG_PREFIX} storing chat event ${ctx.message?.id} failed`, { error })
        return undefined
      }
      onVerdict?.(verdict)
      if (verdict === 'stored') {
        agent.config.logger.debug(`${LOG_PREFIX} chat event stored on connection ${ctx.connection?.id}`)
      } else if (verdict !== 'duplicate') {
        agent.config.logger.warn(`${LOG_PREFIX} chat message ${ctx.message?.id} refused: ${verdict}`)
      }
      return undefined
    },
  })
  setupChatCapability(agent)
}
