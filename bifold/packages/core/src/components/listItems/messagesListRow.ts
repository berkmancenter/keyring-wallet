/**
 * What a Messages row says (the Messages list redesign, L2, approved 2026-10-25): the newest thing in the chat as one
 * line, and when, in the app's words.
 *
 * - The newest message: its text; a photo as "📷" and its caption or the photo label; "You: …" for one you sent.
 * - A reaction newer than that message: "Lena reacted 💜 to “Congrats!”", or "You reacted …".
 * - In a chat whose text stays inside it (a disappearing message, or the timer on or not known yet: hidesText), no
 *   words of any message: the hidden label, and a reaction without its quote.
 * - The time as the chat says it: the time today, "Yesterday", the weekday within the week, then "12 Oct".
 *
 * @module components/listItems/messagesListRow
 */
import type { ExtendedChatMessage } from '../chat/ChatMessage'
import { hidesText } from '../chat/disappearing'
import { messageTextOf } from '../chat/messageText'
import { foldChatEvents } from '../../modules/chat/fold'
import type { ChatEventRecord } from '../../modules/chat/records/ChatEventRecord'
import type { ChatTimer } from '../../modules/chat/timer'
import { Role } from '../../types/chat'
import { daysAgo, shortDate, timeLabel, type DateWords } from '../../utils/localDay'

export type RowPreview =
  | { kind: 'none' }
  /** A message whose words stay inside the chat. */
  | { kind: 'hidden' }
  | { kind: 'message'; mine: boolean; text: string; photo: boolean }
  /** `quoted` is the reacted-to message's words; absent when they stay inside the chat or it has none. */
  | { kind: 'reaction'; mine: boolean; emoji: string; quoted?: string; at: Date }

export interface RowPreviewInput {
  /** The newest message, never a line about the chat itself. */
  message?: ExtendedChatMessage
  /** The chat's events, for its reactions. */
  events?: readonly ChatEventRecord[]
  /** The chat's timer: null when it has none, undefined while it is not known yet (hidesText). */
  timer: ChatTimer | null | undefined
  /** The words a photo or an unsupported attachment is said with. */
  labels: { photo: string; unsupported: string }
}

/** The newest reaction still standing (not removed), when it is newer than the newest message. */
function newestReaction(events: readonly ChatEventRecord[], after?: Date): ChatEventRecord | undefined {
  const standing = new Set<string>()
  for (const list of foldChatEvents([...events]).reactions.values()) for (const r of list) standing.add(r.eventId)
  let newest: ChatEventRecord | undefined
  for (const event of events) {
    if (event.eventType !== 'reaction' || !standing.has(event.eventId)) continue
    if (
      !newest ||
      event.sentTime.getTime() > newest.sentTime.getTime() ||
      (event.sentTime.getTime() === newest.sentTime.getTime() && event.eventId > newest.eventId)
    )
      newest = event
  }
  return newest && (!after || newest.sentTime.getTime() > after.getTime()) ? newest : undefined
}

export function rowPreview({ message, events, timer, labels }: RowPreviewInput): RowPreview {
  const reaction = events ? newestReaction(events, message?.createdAt) : undefined
  if (reaction?.emoji) {
    const target = events?.find((e) => e.eventType === 'message' && e.eventId === reaction.target)
    // The quote follows its own message's rule, which may differ from the newest message's.
    const quoted = target && !hidesText(timer, target.expiresIn) ? messageTextOf(target, labels) : ''
    return {
      kind: 'reaction',
      mine: reaction.role === 'sent',
      emoji: reaction.emoji,
      quoted: quoted || undefined,
      at: reaction.sentTime,
    }
  }
  if (!message) return { kind: 'none' }
  if (hidesText(timer, message.expiresIn)) return { kind: 'hidden' }
  const text = typeof message.text === 'string' ? message.text : ''
  return { kind: 'message', mine: message.user._id === Role.me, text, photo: Boolean(message.image) }
}

/** When, as the chat says it: the time today, "Yesterday", the weekday within the week, then "12 Oct". */
export function rowTime(date: Date, words: DateWords, use24h: boolean, now: Date = new Date()): string {
  const ago = daysAgo(date, now)
  if (ago <= 0) return timeLabel(date, words, use24h)
  if (ago === 1) return words.yesterday
  if (ago < 7 && words.weekdaysLong[date.getDay()]) return words.weekdaysLong[date.getDay()]
  return shortDate(date, words, 'auto', now)
}
