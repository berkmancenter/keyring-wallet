/**
 * The `keyring.chat/1` event — the body every `keyring/chat/1.0` message
 * carries (rich-messaging-plan.md §4.2). The shape follows the rooms
 * subtask's `org.openvtc.msg/1` event without depending on it.
 *
 * Parsing is strict about what each event type needs and lenient about
 * members it does not know, so a later minor addition does not break an
 * older reader. Attachments (§4.3) are refused until Step 3 ships them:
 * a message that carries one is rejected rather than shown without it.
 *
 * @module chat/chatEvent
 */

import { decodeUlidTime } from './eventId'

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

/** Largest serialized event accepted while attachments are not supported. */
export const MAX_EVENT_JSON_LENGTH = 65536

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

export interface ChatMessageEvent extends ChatEventBase {
  type: 'message'
  content: ChatMessageContent
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
  | 'attachments-unsupported'
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
  if (serialized.length > MAX_EVENT_JSON_LENGTH) return reject('too-large')

  const raw = input as Record<string, unknown>
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
      if (Array.isArray(raw.attachments) && raw.attachments.length > 0) return reject('attachments-unsupported')
      const content = raw.content as Record<string, unknown> | undefined
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
      if (raw.inReplyTo !== undefined && !isUlid(raw.inReplyTo)) return reject('bad-in-reply-to')
      if (raw.expiresIn !== undefined && !isExpiresIn(raw.expiresIn)) return reject('bad-expires-in')
      return {
        ok: true,
        event: {
          ...base,
          type: 'message',
          content: { format: 'text/plain', text: content.text },
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
      return { ok: true, event: { ...base, type: 'reaction', target: raw.target, emoji: raw.emoji } }
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
