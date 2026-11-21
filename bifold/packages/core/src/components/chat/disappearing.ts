/**
 * Disappearing messages in words (rich-messaging-plan.md §4.6): a timer's length, and the line a timer change
 * leaves in the chat.
 *
 * @module components/chat/disappearing
 */

import type { TFunction } from 'i18next'

import type { ChatEventRecord } from '../../modules/chat/records/ChatEventRecord'
import type { ChatTimer } from '../../modules/chat/timer'

// A contact's name is shown as they wrote it: "A/B" stays "A/B", never "A&#x2F;B".
const asWritten = { interpolation: { escapeValue: false } }

const PARTS: [key: string, minutes: number][] = [
  ['Chat.DurationWeeks', 7 * 24 * 60],
  ['Chat.DurationDays', 24 * 60],
  ['Chat.DurationHours', 60],
  ['Chat.DurationMinutes', 1],
]

/**
 * A timer's length in words: "1 hour", "4 weeks". A peer may set any length from 1 hour to 4 weeks, not only the
 * choices offered here, so every part is named ("3 hours 26 minutes"). Seconds are rounded up to the minute: a
 * message may go a little before the length said, never after it.
 */
export function formatExpiresIn(t: TFunction, seconds: number): string {
  let minutes = Math.ceil(seconds / 60)
  const words: string[] = []
  for (const [key, size] of PARTS) {
    const count = Math.floor(minutes / size)
    minutes -= count * size
    if (count > 0) words.push(t(key, { count }))
  }
  return words.join(' ')
}

/**
 * Whether a message's text stays inside its chat (rich-messaging-plan.md §4.6, §5): it was sent with a timer, or its
 * chat has one on, or the chat's timer is not known yet (`undefined`). The one rule for every place a message is
 * shown outside its chat, the chat list's preview and the message toast, so they cannot drift apart.
 */
export function hidesText(chatTimer: ChatTimer | null | undefined, expiresIn: number | undefined): boolean {
  return chatTimer === undefined || (chatTimer?.expiresIn ?? 0) > 0 || (expiresIn ?? 0) > 0
}

/** The line a timer change leaves in the chat: who set it, and to what. Empty for any other event. */
export function timerLine(t: TFunction, record: ChatEventRecord, name: string): string {
  if (record.eventType !== 'timer' || !record.timer) return ''
  const mine = record.role === 'sent'
  if (record.timer.expiresIn === 0) {
    return mine ? t('Chat.TimerOffByYou') : t('Chat.TimerOffByThem', { name, ...asWritten })
  }
  const period = formatExpiresIn(t, record.timer.expiresIn)
  return mine
    ? t('Chat.TimerSetByYou', { period, ...asWritten })
    : t('Chat.TimerSetByThem', { name, period, ...asWritten })
}
