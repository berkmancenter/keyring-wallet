/**
 * Sending chat events (rich-messaging-plan.md §4.5).
 *
 * To a contact that speaks `keyring/chat/1.0`, everything goes as a chat
 * event. To one that does not, text goes as a plain BasicMessage (a reply as
 * its text alone) and reactions are not sent at all, because a stream of
 * "reacted 👍" messages is worse than nothing.
 *
 * A sent event is stored only after the send succeeds, so a failed send
 * leaves nothing that looks delivered.
 *
 * @module chat/send
 */

import type { Agent } from '@credo-ts/core'
import { DidCommMessageSender, DidCommOutboundMessageContext } from '@credo-ts/didcomm'

import { counterpartySpeaksChat } from './capability'
import { CHAT_PROFILE, MAX_TEXT_LENGTH, isUlid } from './chatEvent'
import type { ChatEvent } from './chatEvent'
import { getChatEventRepository } from './ChatModule'
import { newEventId } from './eventId'
import { ChatEventMessage } from './messages/ChatEventMessage'
import { ChatEventRecord } from './records/ChatEventRecord'

/** How a send went out. `not-sent` is a reaction or redaction to a contact without chat. */
export type ChatSendOutcome =
  | { carriedAs: 'chat'; record: ChatEventRecord }
  | { carriedAs: 'basic' }
  | { carriedAs: 'not-sent' }

async function sendEvent(agent: Agent, connectionId: string, event: ChatEvent): Promise<ChatEventRecord> {
  const connection = await agent.modules.didcomm.connections.getById(connectionId)
  const messageSender = agent.dependencyManager.container.resolve(DidCommMessageSender)
  await messageSender.sendMessage(
    new DidCommOutboundMessageContext(new ChatEventMessage({ event }), { agentContext: agent.context, connection })
  )
  const record = new ChatEventRecord({
    connectionId,
    role: 'sent',
    eventId: event.eventId,
    eventType: event.type,
    clientTs: event.clientTs,
    ...(event.type === 'message'
      ? { content: event.content, inReplyTo: event.inReplyTo, expiresIn: event.expiresIn }
      : {}),
    ...(event.type === 'reaction' ? { target: event.target, emoji: event.emoji } : {}),
    ...(event.type === 'redaction' ? { target: event.target } : {}),
    ...(event.type === 'timer' ? { timer: event.timer } : {}),
  })
  await getChatEventRepository(agent).save(agent.context, record)
  return record
}

function base() {
  return { profile: CHAT_PROFILE, eventId: newEventId(), clientTs: new Date().toISOString() } as const
}

/** Send a text message, optionally as a reply. */
export async function sendChatText(
  agent: Agent,
  connectionId: string,
  text: string,
  options: { inReplyTo?: string } = {}
): Promise<ChatSendOutcome> {
  if (text.length === 0) throw new Error('chat: refusing to send an empty message')
  if (text.length > MAX_TEXT_LENGTH) throw new Error(`chat: message longer than ${MAX_TEXT_LENGTH} characters`)
  if (options.inReplyTo !== undefined && !isUlid(options.inReplyTo))
    throw new Error('chat: inReplyTo is not an event id')

  if (!(await counterpartySpeaksChat(agent, connectionId))) {
    await agent.modules.didcomm.basicMessages.sendMessage(connectionId, text)
    return { carriedAs: 'basic' }
  }
  const record = await sendEvent(agent, connectionId, {
    ...base(),
    type: 'message',
    content: { format: 'text/plain', text },
    ...(options.inReplyTo ? { inReplyTo: options.inReplyTo } : {}),
  })
  return { carriedAs: 'chat', record }
}

/** React to a message. Replaces this phone's earlier reaction to it, on both phones. */
export async function sendReaction(
  agent: Agent,
  connectionId: string,
  targetEventId: string,
  emoji: string
): Promise<ChatSendOutcome> {
  if (!isUlid(targetEventId)) throw new Error('chat: reaction target is not an event id')
  if (!(await counterpartySpeaksChat(agent, connectionId))) return { carriedAs: 'not-sent' }
  const record = await sendEvent(agent, connectionId, { ...base(), type: 'reaction', target: targetEventId, emoji })
  return { carriedAs: 'chat', record }
}

/** Remove this phone's reaction, by the reaction's own event id. */
export async function removeReaction(
  agent: Agent,
  connectionId: string,
  reactionEventId: string
): Promise<ChatSendOutcome> {
  if (!isUlid(reactionEventId)) throw new Error('chat: redaction target is not an event id')
  if (!(await counterpartySpeaksChat(agent, connectionId))) return { carriedAs: 'not-sent' }
  const record = await sendEvent(agent, connectionId, { ...base(), type: 'redaction', target: reactionEventId })
  return { carriedAs: 'chat', record }
}
