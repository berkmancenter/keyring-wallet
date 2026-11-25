/**
 * Folding one chat's stored events into what the timeline shows
 * (rich-messaging-plan.md §4.2). Pure: it reads records and returns a view;
 * it never writes.
 *
 * Rules:
 * - A reaction counts only on a stored `message` in the same chat.
 * - A redaction counts only when its sender is the author of the event it
 *   removes. In a one-to-one chat the author is the record's role: what this
 *   phone sent, or what it received. So the other person can never remove
 *   your reaction.
 * - Each person has at most one reaction per message. Their latest reaction
 *   (by event id, which sorts in the order that sender made them) wins; if
 *   that one was removed, they have none. An older reaction never comes back.
 * - A reaction or redaction whose target is not stored yet is kept, unused,
 *   until the target arrives: it simply has no effect until then. `prunableOrphans`
 *   bounds how long and how many.
 *
 * Removing a message for everyone is not part of the minimum, so a redaction
 * that targets a message is ignored here.
 *
 * System events (`SYSTEM_EVENT_TYPES`: a timer set, today) are passed through,
 * every one, in timeline order; which of them is in force is not decided here.
 *
 * The timeline's order is deliberately this phone's: `sentTime`, set when the
 * event was sent or stored here, then the event id. It is never the sender's
 * claimed time (`clientTs`), which is another phone's clock.
 *
 * @module chat/fold
 */

import { normalizeEmoji } from './emoji/validate'
import type { ChatEventRecord, ChatEventRole } from './records/ChatEventRecord'
import { SYSTEM_EVENT_TYPES } from './systemEvents'

/** How long an event with no stored target is kept, in milliseconds (the mediator's own retention). */
export const ORPHAN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

/** How many events with no stored target one chat keeps. */
export const ORPHAN_MAX_COUNT = 200

export interface ChatReaction {
  author: ChatEventRole
  emoji: string
  /** The reaction event's id, which a later redaction targets. */
  eventId: string
}

export interface FoldedChat {
  /** The chat's messages, in timeline order (sentTime, then event id). */
  messages: ChatEventRecord[]
  /** Current reactions per message event id, at most one per author. */
  reactions: Map<string, ChatReaction[]>
  /** Reactions and redactions whose target is not stored (yet). */
  orphans: ChatEventRecord[]
  /** The chat's system events (a timer set), every one, in timeline order. */
  systems: ChatEventRecord[]
}

const byEventId = (a: ChatEventRecord, b: ChatEventRecord) =>
  a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0

export function foldChatEvents(records: ChatEventRecord[]): FoldedChat {
  const messages = records.filter((r) => r.eventType === 'message')
  const messageIds = new Set(messages.map((m) => m.eventId))

  const reactionRecords = records.filter((r) => r.eventType === 'reaction')
  const reactionsById = new Map(reactionRecords.map((r) => [r.eventId, r]))

  // A redaction is honoured only when it comes from the author of the reaction it targets.
  const redactedReactionIds = new Set<string>()
  const orphans: ChatEventRecord[] = []
  for (const redaction of records.filter((r) => r.eventType === 'redaction')) {
    const target = redaction.target ? reactionsById.get(redaction.target) : undefined
    if (target) {
      if (target.role === redaction.role) redactedReactionIds.add(target.eventId)
    } else if (redaction.target && !messageIds.has(redaction.target)) {
      orphans.push(redaction)
    }
  }

  // Latest reaction per (message, author), dropped if removed.
  const latest = new Map<string, ChatEventRecord>()
  for (const reaction of [...reactionRecords].sort(byEventId)) {
    if (!reaction.target || !messageIds.has(reaction.target)) {
      orphans.push(reaction)
      continue
    }
    latest.set(`${reaction.target}\u0000${reaction.role}`, reaction)
  }
  const reactions = new Map<string, ChatReaction[]>()
  for (const reaction of latest.values()) {
    // Normalised on read too: a reaction stored before validation existed may be in another form
    // ("❤" rather than "❤️") or not an emoji at all; the first folds into its chip, the second is skipped.
    // This runs after the latest-per-author choice, so an invalid newest reaction shows as no reaction
    // (it is that person's current intent), never as their older one. Only a value stored before
    // inbound validation can be invalid; no shipped build stored chat events before it existed.
    const emoji = reaction.emoji ? normalizeEmoji(reaction.emoji) : undefined
    if (redactedReactionIds.has(reaction.eventId) || !emoji) continue
    const list = reactions.get(reaction.target as string) ?? []
    list.push({ author: reaction.role, emoji, eventId: reaction.eventId })
    reactions.set(reaction.target as string, list)
  }

  const inOrder = (a: ChatEventRecord, b: ChatEventRecord) =>
    a.sentTime.getTime() - b.sentTime.getTime() || byEventId(a, b)
  messages.sort(inOrder)
  const systems = records.filter((r) => SYSTEM_EVENT_TYPES.has(r.eventType)).sort(inOrder)
  return { messages, reactions, orphans, systems }
}

/**
 * The orphans to delete: any older than {@link ORPHAN_MAX_AGE_MS}, and beyond
 * that, the oldest ones past {@link ORPHAN_MAX_COUNT}.
 */
export function prunableOrphans(orphans: ChatEventRecord[], now: number = Date.now()): ChatEventRecord[] {
  const expired = orphans.filter((o) => now - o.sentTime.getTime() > ORPHAN_MAX_AGE_MS)
  const kept = orphans
    .filter((o) => now - o.sentTime.getTime() <= ORPHAN_MAX_AGE_MS)
    .sort((a, b) => b.sentTime.getTime() - a.sentTime.getTime())
  return [...expired, ...kept.slice(ORPHAN_MAX_COUNT)]
}
