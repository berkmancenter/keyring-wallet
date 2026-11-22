/**
 * What the records around a post say about it (trust-tasks-tf #1027, `SealedRecordBody`): the reactions beside it, what
 * a reply answers, and whether a new version came from someone else. A pure fold over the records in hand, as
 * one-to-one chat's `foldChatEvents` is, so it can be run again whenever the list changes.
 *
 * It only reads. Which records show where is `placeOf`'s; this adds what they're drawn with.
 *
 * @module rooms/roomThread
 */
import { normalizeEmoji } from '../chat/emoji/validate'

import { isChatPost, isNoteMarker, isWithdrawn, placeOf, reactionValueOf, type RoomPost } from './roomPosts'
import type { Identity } from './types'

export interface RoomReactionTally {
  /** The value in its normal form, as values are compared. */
  value: string
  /** The value as it's shown: an emoji in its fully qualified form, words as written. */
  shown: string
  /** How many people chose it, each once. */
  count: number
  /** Who chose it, other than this phone's member. */
  others: Identity[]
  mine: boolean
}

/** What this screen saw of a record first: the rules about a new version compare with it. */
export interface HeldRecord {
  author?: Identity
  kind?: string
  reactsTo?: string
}

export type RoomQuoteOf =
  | { available: true; target: RoomPost; note: boolean; changed: boolean }
  | { available: false }
  /** The target is still being read: no quote yet, as in one-to-one chat. */
  | { available: 'reading' }

export interface RoomThread {
  /** By the key of the record reacted to; emoji first, then words, each in the order they first came. */
  reactions: ReadonlyMap<string, RoomReactionTally[]>
  /** New versions a reader must not show: they changed what the record is, or what a reaction responds to. */
  refused: ReadonlySet<string>
  /**
   * This member's own reactions, by the key of what they answer, newest first: each record's key and value, every
   * one, where a chip counts a value once. Changing a reaction rewrites one of them; taking a value back empties each
   * record that holds it. Another app may have written several.
   */
  mine: ReadonlyMap<string, MyReaction[]>
}

export interface MyReaction {
  key: string
  /** In its normal form, as `RoomReactionTally.value`. */
  value: string
}

const authorId = (author: Identity): string => JSON.stringify(author)

/**
 * A record a quote or a reaction can point at. One that couldn't be read can't, unless its listing already gives its
 * title: an open room's notes are listed by title and not read for the chat.
 */
const canBeShown = (target: RoomPost | undefined): target is RoomPost =>
  !!target &&
  !target.retracted &&
  (!target.unread || !!target.title) &&
  !target.delivery &&
  !target.answersReaction &&
  target.kind !== 'reaction' &&
  !isWithdrawn(target)

/** A new version that changes `kind`, or a reaction's target, is refused alone when an earlier one was seen. */
const changesWhatItIs = (post: RoomPost, held: HeldRecord | undefined): boolean =>
  !!held &&
  !post.retracted &&
  !post.unread &&
  (held.kind !== post.kind || (post.kind === 'reaction' && held.reactsTo !== post.inReplyTo?.key))

/**
 * @param posts the records in hand, newest first, as the feed holds them
 * @param targets records read only because a reply on the page names them
 * @param held what this screen saw of each record first
 */
export function foldRoomRecords(
  posts: readonly RoomPost[],
  targets: ReadonlyMap<string, RoomPost> = new Map(),
  held: ReadonlyMap<string, HeldRecord> = new Map()
): RoomThread {
  const byKey = new Map(posts.map((post) => [post.key, post]))
  const refused = new Set(posts.filter((post) => changesWhatItIs(post, held.get(post.key))).map((post) => post.key))
  const reactions = new Map<string, RoomReactionTally[]>()
  const mine = new Map<string, MyReaction[]>()
  const seen = new Set<string>()
  // Oldest first, so chips keep the order they came in.
  for (const post of [...posts].reverse()) {
    const value = post.answersReaction || refused.has(post.key) ? undefined : reactionValueOf(post)
    const on = post.inReplyTo?.key
    // With no author to tell people apart a count means nothing: one member could fill it. Private rooms wait.
    if (value === undefined || !on || !post.author) continue
    if (refused.has(on) || !canBeShown(byKey.get(on) ?? targets.get(on))) continue
    if (post.mine) mine.set(on, [{ key: post.key, value }, ...(mine.get(on) ?? [])])
    const once = `${on}\n${value}\n${authorId(post.author)}`
    if (seen.has(once)) continue
    seen.add(once)
    const tallies = reactions.get(on) ?? []
    const tally = tallies.find((t) => t.value === value)
    const entry = tally ?? { value, shown: normalizeEmoji(value) ?? value, count: 0, others: [], mine: false }
    if (!tally) tallies.push(entry)
    entry.count++
    if (post.mine) entry.mine = true
    else entry.others.push(post.author)
    reactions.set(on, tallies)
  }
  for (const [on, tallies] of reactions) {
    const isEmoji = (t: RoomReactionTally) => normalizeEmoji(t.value) !== undefined
    reactions.set(on, [...tallies.filter(isEmoji), ...tallies.filter((t) => !isEmoji(t))])
  }
  return { reactions, refused, mine }
}

/** Whether a reply's target was edited after the reply: never because its version moved, which a curator's pin also does. */
const changedSince = (reply: RoomPost, target: RoomPost): boolean => {
  if (reply.inReplyTo?.version !== undefined && reply.inReplyTo.version === target.version) return false
  if (!target.editedAt || !reply.writtenAt) return false
  return new Date(target.editedAt).getTime() > new Date(reply.writtenAt).getTime()
}

/**
 * What a reply's quote shows, or undefined for a post that answers nothing.
 *
 * @param missing the keys that couldn't be read: their replies stay, marked as answering what isn't available
 */
export function quoteOf(
  post: RoomPost,
  posts: readonly RoomPost[],
  targets: ReadonlyMap<string, RoomPost>,
  missing: ReadonlySet<string>,
  thread: RoomThread
): RoomQuoteOf | undefined {
  const key = post.inReplyTo?.key
  if (!key) return undefined
  if (missing.has(key) || thread.refused.has(key)) return { available: false }
  const target = posts.find((p) => p.key === key) ?? targets.get(key)
  if (!target) return { available: 'reading' }
  if (!canBeShown(target)) return { available: false }
  return { available: true, target, note: placeOf(target) === 'notes', changed: changedSince(post, target) }
}

/** The words a quote shows of its target: a note's title, a post's words, or a photo's name when it has no caption. */
export const quotedWords = (target: RoomPost): string => {
  const words = String(target.title ?? target.text)
  return words || String(target.files[0]?.name ?? '')
}

/**
 * Who a new version took over from, when its author isn't the record's first: shown as that member's rewrite, never as
 * an edit by the first author. The host's `createdBy` where a listing gives it, else what this screen saw first.
 */
export function rewroteFrom(post: RoomPost, held: HeldRecord | undefined): Identity | undefined {
  const first = post.createdBy ?? held?.author
  if (!first || !post.author) return undefined
  return authorId(first) === authorId(post.author) ? undefined : first
}

/** A message retracted by a curator, known to be one because this screen saw it: it stays where the message was. */
export const isRemovedMessage = (post: RoomPost, held: HeldRecord | undefined): boolean =>
  post.retracted && !!held && (held.kind === 'message' || held.kind === undefined) && !post.title

/**
 * Whether the room's chat draws a record: a message or a note's line, a withdrawn message in its place, and a message a
 * curator removed once this screen saw it. Never a version a reader has to refuse.
 */
export const drawnInChat = (post: RoomPost, thread: Pick<RoomThread, 'refused'>, held?: HeldRecord): boolean =>
  !thread.refused.has(post.key) &&
  (isChatPost(post) || isNoteMarker(post) || (isWithdrawn(post) && !post.title) || isRemovedMessage(post, held))

/** A claimed writing time this far before the room received a record has to be said. */
const LATE_AFTER_MS = 24 * 60 * 60 * 1000

/** When a record says it was written, if that's so long before it arrived that the reader has to say. */
export function arrivedLate(post: Pick<RoomPost, 'writtenAt' | 'createdAt'>): Date | undefined {
  if (!post.writtenAt || !post.createdAt) return undefined
  const written = new Date(post.writtenAt)
  const arrived = new Date(post.createdAt).getTime()
  if (Number.isNaN(written.getTime()) || Number.isNaN(arrived)) return undefined
  return arrived - written.getTime() > LATE_AFTER_MS ? written : undefined
}

/**
 * Newest arrival first, where the host says when a record arrived. Posts that don't say keep the feed's order, so a room
 * whose agent doesn't serve the arrival time reads exactly as before.
 */
export function byArrival<T extends Pick<RoomPost, 'createdAt' | 'at'>>(posts: readonly T[]): T[] {
  if (!posts.some((post) => post.createdAt)) return [...posts]
  const time = (post: T): number => (post.at ? post.at.getTime() : 0)
  return [...posts].sort((a, b) => time(b) - time(a))
}
