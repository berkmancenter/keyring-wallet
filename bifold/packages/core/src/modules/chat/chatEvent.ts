/**
 * The `keyring.chat/1` event — the body every `keyring/chat/1.0` message
 * carries (rich-messaging-plan.md §4.2). The shape follows the rooms
 * subtask's `org.openvtc.msg/1` event without depending on it.
 *
 * Parsing is strict about what each event type needs and lenient about
 * members it does not know, so a later minor addition does not break an
 * older reader. A message may carry one inline image (§4.3, §4.4), checked
 * against its bytes by media/checkAttachment.ts: one that fails is kept as an
 * unsupported attachment, so the message still arrives and says so.
 *
 * @module chat/chatEvent
 */

import { normalizeEmoji } from './emoji/validate'
import { decodeUlidTime } from './eventId'
import { checkImageAttachment } from './media/checkAttachment'
import type { ImageAttachmentDescriptor, ImageCheckFailure, ImageMediaType } from './media'

/** The profile every event names (plan D3). */
export const CHAT_PROFILE = 'keyring.chat/1'

export type ChatEventType = 'message' | 'reaction' | 'redaction' | 'timer'

const EVENT_TYPES: ReadonlySet<string> = new Set<ChatEventType>(['message', 'reaction', 'redaction', 'timer'])

/** A ULID: 26 Crockford base32 characters (no I, L, O, U). */
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/

/** Longest text a message may carry, in UTF-16 code units. */
export const MAX_TEXT_LENGTH = 16384

/** Longest `emoji` value accepted before set membership is checked (plan §5). */
export const MAX_EMOJI_LENGTH = 32

/** Longest `expiresIn` a message or timer may name: 4 weeks, in seconds. */
export const MAX_EXPIRES_IN = 4 * 7 * 24 * 60 * 60

/**
 * Shortest disappearing time: 1 hour, the smallest choice the setting offers. A shorter one from a buggy or hostile
 * peer would make a message vanish as the chat opens. A timer under it is refused (the chat keeps its setting); a
 * message under it is kept and its expiresIn raised to it, since refusing would drop the person's text while their
 * phone shows it sent. 0 still means off for a timer and no timer for a message.
 */
export const MIN_EXPIRES_IN = 60 * 60

/**
 * Highest timer `version` accepted. Unbounded, one event at Number.MAX_SAFE_INTEGER would saturate the count (2^53 + 1
 * is 2^53), and every later change would tie on version and fall to the eventId tie-break, retiring the versioning.
 */
export const MAX_TIMER_VERSION = 1_000_000

/**
 * How far ahead of this phone's clock a timer event's eventId may claim to be. A chat's timer is the one outcome both
 * people's events compete for, and ties on version go to the larger eventId; an id from the far future would win
 * every later change on both phones, locking the setting. Other events are not refused for this: a reaction or
 * redaction orders only against its own author's events, and messages are ordered by local receipt, so a fast clock
 * harms only its own sender, while refusing would drop the text of anyone whose phone clock is wrong.
 */
export const MAX_EVENT_CLOCK_SKEW_MS = 24 * 60 * 60 * 1000

/** Largest serialized event without an image. */
export const MAX_EVENT_JSON_LENGTH = 65536

/**
 * Largest serialized message with an image: the base64 of the largest image
 * (256 KiB raw, §4.4) on top of everything else an event may carry.
 */
export const MAX_IMAGE_EVENT_JSON_LENGTH = Math.ceil((256 * 1024) / 3) * 4 + MAX_EVENT_JSON_LENGTH

export interface ChatMessageContent {
  format: 'text/plain'
  text: string
}

interface ChatEventBase {
  profile: typeof CHAT_PROFILE
  eventId: string
  /** Display only; never trusted for ordering (plan §4.2). */
  clientTs?: string
}

/** An inline image that passed every check: its verified type and size, and its bytes as base64 to write once. */
export interface ChatImageAttachment {
  id: string
  /** From the bytes' header, never from the sender's descriptor alone. */
  mediaType: ImageMediaType
  byteCount: number
  width: number
  height: number
  /** Display only; never used as a file name. */
  filename?: string
  base64: string
}

/** An attachment that failed a check (§4.3): kept so the bubble can say "Unsupported attachment". */
export interface ChatUnsupportedAttachment {
  id?: string
  unsupported: ImageCheckFailure
}

export interface ChatMessageEvent extends ChatEventBase {
  type: 'message'
  /** Absent only on a message that carries an attachment. */
  content?: ChatMessageContent
  /** At most one: several photos are sent as several messages (§4.4). */
  attachments?: [ChatImageAttachment | ChatUnsupportedAttachment]
  inReplyTo?: string
  /** Seconds until the message disappears, 0 or absent = keep (plan §4.6). */
  expiresIn?: number
}

export interface ChatReactionEvent extends ChatEventBase {
  type: 'reaction'
  target: string
  emoji: string
}

export interface ChatRedactionEvent extends ChatEventBase {
  type: 'redaction'
  target: string
}

export interface ChatTimerEvent extends ChatEventBase {
  type: 'timer'
  timer: { expiresIn: number; version: number }
}

export type ChatEvent = ChatMessageEvent | ChatReactionEvent | ChatRedactionEvent | ChatTimerEvent

/** A message as it is sent: its image travels as its §4.3 descriptor, bytes and all. */
export interface ChatOutgoingMessageEvent extends Omit<ChatMessageEvent, 'attachments'> {
  attachments?: [ImageAttachmentDescriptor]
}

/** An event as this phone sends it. */
export type ChatOutgoingEvent = Exclude<ChatEvent, ChatMessageEvent> | ChatOutgoingMessageEvent

export type ChatEventRejection =
  | 'not-an-object'
  | 'too-large'
  | 'wrong-profile'
  | 'unknown-type'
  | 'bad-event-id'
  | 'bad-client-ts'
  | 'bad-content'
  | 'bad-in-reply-to'
  | 'bad-expires-in'
  | 'bad-attachments'
  | 'bad-target'
  | 'bad-emoji'
  | 'bad-timer'
  | 'future-event'

export type ChatEventParseResult = { ok: true; event: ChatEvent } | { ok: false; reason: ChatEventRejection }

export function isUlid(value: unknown): value is string {
  return typeof value === 'string' && ULID.test(value)
}

function isExpiresIn(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_EXPIRES_IN
}

function reject(reason: ChatEventRejection): ChatEventParseResult {
  return { ok: false, reason }
}

// The image's verified type and size, or why it is unsupported. The base64 is kept only to be written once.
function toAttachment(descriptor: unknown): ChatImageAttachment | ChatUnsupportedAttachment {
  const checked = checkImageAttachment(descriptor)
  if (!checked.ok) {
    const id = (descriptor as { id?: unknown } | null)?.id
    return { ...(typeof id === 'string' && id.length <= 256 ? { id } : {}), unsupported: checked.reason }
  }
  const { image } = checked
  return {
    id: image.id,
    mediaType: image.header.mediaType,
    byteCount: image.bytes.length,
    width: image.header.width,
    height: image.header.height,
    ...(image.filename !== undefined ? { filename: image.filename } : {}),
    base64: (descriptor as { data: { base64: string } }).data.base64,
  }
}

/**
 * Validate an inbound event and return only the members this reader knows.
 * Never throws; a rejection says why, for the log.
 */
export function parseChatEvent(input: unknown, { now = Date.now() }: { now?: number } = {}): ChatEventParseResult {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return reject('not-an-object')

  let serialized: string
  try {
    serialized = JSON.stringify(input)
  } catch {
    return reject('not-an-object')
  }
  const raw = input as Record<string, unknown>
  // An empty list is no attachment; anything else present is checked as one.
  const hasAttachments =
    raw.type === 'message' &&
    raw.attachments !== undefined &&
    !(Array.isArray(raw.attachments) && raw.attachments.length === 0)
  if (serialized.length > (hasAttachments ? MAX_IMAGE_EVENT_JSON_LENGTH : MAX_EVENT_JSON_LENGTH)) {
    return reject('too-large')
  }

  if (raw.profile !== CHAT_PROFILE) return reject('wrong-profile')
  if (typeof raw.type !== 'string' || !EVENT_TYPES.has(raw.type)) return reject('unknown-type')
  if (!isUlid(raw.eventId)) return reject('bad-event-id')
  if (raw.clientTs !== undefined && (typeof raw.clientTs !== 'string' || raw.clientTs.length > 40)) {
    return reject('bad-client-ts')
  }

  const base: ChatEventBase = {
    profile: CHAT_PROFILE,
    eventId: raw.eventId,
    ...(typeof raw.clientTs === 'string' ? { clientTs: raw.clientTs } : {}),
  }

  switch (raw.type as ChatEventType) {
    case 'message': {
      let attachments: ChatMessageEvent['attachments']
      if (hasAttachments) {
        if (!Array.isArray(raw.attachments) || raw.attachments.length !== 1) return reject('bad-attachments')
        attachments = [toAttachment(raw.attachments[0])]
      }
      const content = raw.content as Record<string, unknown> | undefined
      if (content !== undefined || !attachments) {
        if (
          typeof content !== 'object' ||
          content === null ||
          content.format !== 'text/plain' ||
          typeof content.text !== 'string' ||
          content.text.length === 0 ||
          content.text.length > MAX_TEXT_LENGTH
        ) {
          return reject('bad-content')
        }
      }
      if (raw.inReplyTo !== undefined && !isUlid(raw.inReplyTo)) return reject('bad-in-reply-to')
      if (raw.expiresIn !== undefined && !isExpiresIn(raw.expiresIn)) return reject('bad-expires-in')
      return {
        ok: true,
        event: {
          ...base,
          type: 'message',
          ...(content ? { content: { format: 'text/plain' as const, text: content.text as string } } : {}),
          ...(attachments ? { attachments } : {}),
          ...(raw.inReplyTo !== undefined ? { inReplyTo: raw.inReplyTo as string } : {}),
          ...(raw.expiresIn ? { expiresIn: Math.max(raw.expiresIn as number, MIN_EXPIRES_IN) } : {}),
        },
      }
    }
    case 'reaction': {
      if (!isUlid(raw.target)) return reject('bad-target')
      if (typeof raw.emoji !== 'string' || raw.emoji.length === 0 || raw.emoji.length > MAX_EMOJI_LENGTH) {
        return reject('bad-emoji')
      }
      // Only one emoji of the pinned set, stored fully-qualified ("❤" becomes "❤️"), so two forms of the
      // same emoji fold together and nothing else reaches the screen (plan §5, "Emoji validation").
      const emoji = normalizeEmoji(raw.emoji)
      if (!emoji) return reject('bad-emoji')
      return { ok: true, event: { ...base, type: 'reaction', target: raw.target, emoji } }
    }
    case 'redaction': {
      if (!isUlid(raw.target)) return reject('bad-target')
      return { ok: true, event: { ...base, type: 'redaction', target: raw.target } }
    }
    case 'timer': {
      const timer = raw.timer as Record<string, unknown> | undefined
      if (
        typeof timer !== 'object' ||
        timer === null ||
        !isExpiresIn(timer.expiresIn) ||
        (timer.expiresIn !== 0 && timer.expiresIn < MIN_EXPIRES_IN) ||
        typeof timer.version !== 'number' ||
        !Number.isInteger(timer.version) ||
        timer.version < 0 ||
        timer.version > MAX_TIMER_VERSION
      ) {
        return reject('bad-timer')
      }
      if (decodeUlidTime(base.eventId) > now + MAX_EVENT_CLOCK_SKEW_MS) return reject('future-event')
      return {
        ok: true,
        event: { ...base, type: 'timer', timer: { expiresIn: timer.expiresIn, version: timer.version } },
      }
    }
  }
}
