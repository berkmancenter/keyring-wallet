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
 * A photo (§4.3, §4.4) is checked by the same descriptor check a receiver
 * runs before anything is sent: one over the limit, or one whose descriptor
 * does not match its bytes, is refused here. Nothing else would say so: an
 * oversize message is accepted by the transport and dropped by the mediator
 * with no error to the sender. To a contact without chat it goes as a plain
 * message saying a photo was sent.
 *
 * @module chat/send
 */

import type { Agent } from '@credo-ts/core'
import { DidCommMessageSender, DidCommOutboundMessageContext } from '@credo-ts/didcomm'

import { counterpartySpeaksChat } from './capability'
import { CHAT_PROFILE, MAX_TEXT_LENGTH, MAX_TIMER_VERSION, isUlid } from './chatEvent'
import type { ChatOutgoingEvent } from './chatEvent'
import { getChatEventRepository } from './ChatModule'
import { normalizeEmoji } from './emoji/validate'
import { newEventId } from './eventId'
import { ChatEventMessage } from './messages/ChatEventMessage'
import { checkImageAttachment } from './media/checkAttachment'
import type { ImageAttachmentDescriptor, ImageCheckFailure } from './media/checkAttachment'
import type { PreparedPhoto } from './media/prepare'
import { removeChatMedia, writeChatMedia } from './media/store'
import { ChatEventRecord } from './records/ChatEventRecord'
import type { ChatStoredAttachment } from './records/ChatEventRecord'
import { whileSending } from './sending'
import { TIMER_CHOICES, currentTimer, nextTimerVersion } from './timer'
import { effectiveExpiresInMs } from '../../utils/e2eClocks'

/** How a send went out. `not-sent` is a reaction or redaction to a contact without chat. */
export type ChatSendOutcome =
  | { carriedAs: 'chat'; record: ChatEventRecord }
  | { carriedAs: 'basic' }
  | { carriedAs: 'not-sent' }

async function sendEvent(
  agent: Agent,
  connectionId: string,
  event: ChatOutgoingEvent,
  stored: { attachments?: ChatStoredAttachment[]; fallbackText?: string } = {}
): Promise<ChatEventRecord> {
  // Marked from before the send until the record is stored, so a peer cannot slip the same eventId in between
  // (sending.ts, inbound.ts).
  return whileSending(connectionId, event.eventId, () => sendAndStore(agent, connectionId, event, stored))
}

async function sendAndStore(
  agent: Agent,
  connectionId: string,
  event: ChatOutgoingEvent,
  stored: { attachments?: ChatStoredAttachment[]; fallbackText?: string }
): Promise<ChatEventRecord> {
  const connection = await agent.modules.didcomm.connections.getById(connectionId)
  const messageSender = agent.dependencyManager.container.resolve(DidCommMessageSender)
  await messageSender.sendMessage(
    new DidCommOutboundMessageContext(new ChatEventMessage({ event }), { agentContext: agent.context, connection })
  )
  const sentAt = new Date()
  const record = new ChatEventRecord({
    connectionId,
    role: 'sent',
    sentTime: sentAt,
    eventId: event.eventId,
    eventType: event.type,
    clientTs: event.clientTs,
    ...(event.type === 'message'
      ? {
          content: event.content,
          attachments: stored.attachments,
          fallbackText: stored.fallbackText,
          inReplyTo: event.inReplyTo,
          expiresIn: event.expiresIn,
          // D4: the sender's copy starts its clock at send.
          ...(event.expiresIn ? { expiresAt: new Date(sentAt.getTime() + effectiveExpiresInMs(event.expiresIn)) } : {}),
        }
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
  // The chat's timer applies to messages sent from now on; each message carries the expiresIn it was sent with.
  const timer = await currentTimer(agent, connectionId)
  const record = await sendEvent(agent, connectionId, {
    ...base(),
    type: 'message',
    content: { format: 'text/plain', text },
    ...(options.inReplyTo ? { inReplyTo: options.inReplyTo } : {}),
    ...(timer && timer.expiresIn > 0 ? { expiresIn: timer.expiresIn } : {}),
  })
  return { carriedAs: 'chat', record }
}

/** A photo refused before sending: the reason the receiver's own check would give. */
export class ChatPhotoRefusedError extends Error {
  constructor(public readonly reason: ImageCheckFailure) {
    super(`chat: photo refused before sending (${reason})`)
    this.name = 'ChatPhotoRefusedError'
  }
}

/**
 * Send one prepared photo (media/prepare.ts), with an optional caption. The descriptor is checked as a receiver
 * would check it before anything is sent or written. To a contact that speaks chat, this phone's copy is written to
 * the chat's media folder first, then the message is sent, then its record is stored. To one that does not,
 * `fallbackText` ("📷 Photo — update Keyring to see it", in this phone's language) goes as a plain message, with the
 * caption after it.
 */
export async function sendChatPhoto(
  agent: Agent,
  connectionId: string,
  photo: PreparedPhoto,
  options: { fallbackText: string; caption?: string }
): Promise<ChatSendOutcome> {
  const descriptor: ImageAttachmentDescriptor = {
    id: 'a1',
    mediaType: photo.mediaType,
    byteCount: photo.byteCount,
    width: photo.width,
    height: photo.height,
    data: { base64: photo.base64 },
  }
  const checked = checkImageAttachment(descriptor)
  if (!checked.ok) throw new ChatPhotoRefusedError(checked.reason)
  const caption = options.caption?.trim()
  if (caption && caption.length > MAX_TEXT_LENGTH)
    throw new Error(`chat: caption longer than ${MAX_TEXT_LENGTH} characters`)

  // The same words go to a contact without chat now, and to one that refuses the chat event later (notice.ts).
  const fallbackText = caption ? `${options.fallbackText}\n\n${caption}` : options.fallbackText
  if (!(await counterpartySpeaksChat(agent, connectionId))) {
    await agent.modules.didcomm.basicMessages.sendMessage(connectionId, fallbackText)
    return { carriedAs: 'basic' }
  }

  const timer = await currentTimer(agent, connectionId)
  const event = {
    ...base(),
    type: 'message' as const,
    ...(caption ? { content: { format: 'text/plain' as const, text: caption } } : {}),
    attachments: [descriptor] as [ImageAttachmentDescriptor],
    ...(timer && timer.expiresIn > 0 ? { expiresIn: timer.expiresIn } : {}),
  }
  // The type and size the check read from the bytes, as a receiver keeps them.
  const { header } = checked.image
  // Written first, so a stored record never names a file that is not there; removed again if the send fails, since no
  // record is stored then and nothing would ever lead a deletion to it.
  const file = await writeChatMedia(connectionId, event.eventId, header.mediaType, photo.base64)
  let record: ChatEventRecord
  try {
    record = await sendEvent(agent, connectionId, event, {
      fallbackText,
      attachments: [
        {
          id: descriptor.id,
          mediaType: header.mediaType,
          byteCount: photo.byteCount,
          width: header.width,
          height: header.height,
          file,
        },
      ],
    })
  } catch (error) {
    await removeChatMedia(connectionId, file).catch(() => undefined)
    throw error
  }
  return { carriedAs: 'chat', record }
}

/**
 * Set this chat's disappearing-messages timer on both phones: `expiresIn` seconds (one of TIMER_CHOICES; 0 turns it
 * off). Only to a contact that speaks chat; a plain BasicMessage cannot carry a timer, so it is `not-sent` otherwise.
 */
export async function setChatTimer(agent: Agent, connectionId: string, expiresIn: number): Promise<ChatSendOutcome> {
  if (!TIMER_CHOICES.includes(expiresIn)) throw new Error(`chat: ${expiresIn} is not a timer choice`)
  if (!(await counterpartySpeaksChat(agent, connectionId))) return { carriedAs: 'not-sent' }
  const events = await getChatEventRepository(agent).findByConnection(agent.context, connectionId)
  // At the cap every change ties on version and the eventId tie-break decides, so the later change wins. Never a
  // refusal: one peer event at the cap would otherwise lock the setting on both phones for good.
  const version = Math.min(nextTimerVersion(events), MAX_TIMER_VERSION)
  const record = await sendEvent(agent, connectionId, {
    ...base(),
    type: 'timer',
    timer: { expiresIn, version },
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
  // The receiver accepts only one emoji of the pinned set; send it in the same fully-qualified form.
  const reaction = normalizeEmoji(emoji)
  if (!reaction) throw new Error('chat: reaction is not one emoji of the pinned set')
  if (!(await counterpartySpeaksChat(agent, connectionId))) return { carriedAs: 'not-sent' }
  const record = await sendEvent(agent, connectionId, {
    ...base(),
    type: 'reaction',
    target: targetEventId,
    emoji: reaction,
  })
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
