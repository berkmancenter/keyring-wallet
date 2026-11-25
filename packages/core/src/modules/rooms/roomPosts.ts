/**
 * A room's records as a conversation (rooms member sprint): each record is a post, newest first. A post's words
 * are the record's body as it was written, which is how Keyring writes them from 277.8 and how every other client
 * writes a record; a post written before carries a keyring.chat/1 message, whose words are read out of it (the same
 * parser one-to-one chat uses). Either way they are inert text: shown, never followed. Nothing here throws on what
 * a room holds.
 *
 * This reads the body itself until the rooms service hands over the parsed event (`Note.event`); then `postOf`
 * takes it from there and nothing on screen changes.
 *
 * @module rooms/roomPosts
 */
import { CHAT_PROFILE, type ChatMessageEvent, parseChatEvent } from '../chat/chatEvent'

import { toInertText, type InertText } from './inertText'
import type { PostRefusal } from './postRefusal'
import type { Identity, Note, NoteSummary, RecordUnopenedReason, RoomFile } from './types'

export interface RoomPost {
  key: string
  version: number
  author?: Identity
  /** Written by an AI agent under its person's membership. */
  byAgent: boolean
  /** Written as the identity this member acts as in the room. */
  mine: boolean
  at?: Date
  /** An open room's record title, when it has one. */
  title?: InertText
  /** What the post says: a chat message's text, or the record's body. Empty for a retracted record. */
  text: InertText
  /** The body is a keyring.chat/1 message. False: shown as the record's text, as written. */
  isChatMessage: boolean
  retracted: boolean
  /** Pinned by a curator: listed first among the room's notes. */
  pinned: boolean
  /** The record could not be read; only what the listing said about it is known. */
  unread: boolean
  /** Why, when the agent said so (only on an unread post). */
  unreadWhy?: RecordUnopenedReason
  /** A post this phone is still sending, or could not send (not yet a record in the room). */
  delivery?: 'sending' | 'failed'
  /** Why a failed post can't go, when no retry would pass (postRefusal): said instead of "Tap to try again". */
  refused?: PostRefusal
  /** The files the post carries, each shown as a chip under its words. None on a retracted post. */
  files: RoomFile[]
  /** How far a sending post's file has come, 0 to 1. */
  progress?: number
  /** What the record says it is (trust-tasks-tf #1027). Only once it is read: an open set, read by `placeOf`. */
  kind?: string
  inReplyTo?: { key: string; version?: number }
  writtenAt?: string
  editedAt?: string
  /** When the host first stored the record, where an agent serves it. */
  createdAt?: string
  /** Who wrote the record's first version, where an agent serves it. */
  createdBy?: Identity
  /** It answers a reaction, which nothing may: shown nowhere, and counted as no reaction (`withRepliesToReactions`). */
  answersReaction?: true
  /** A reaction whose body, as written, a reader must not show (`reactionValueOfBody`). */
  reactionRefused?: true
}

const sameIdentity = (a?: Identity, b?: Identity): boolean => !!a && !!b && JSON.stringify(a) === JSON.stringify(b)

const dateOf = (iso?: string): Date | undefined => {
  if (!iso) return undefined
  const at = new Date(iso)
  return Number.isNaN(at.getTime()) ? undefined : at
}

/** A chat message's text, if `body` is a keyring.chat/1 message event; otherwise undefined. */
export function chatMessageText(body: string, now: number = Date.now()): string | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return undefined
  }
  const result = parseChatEvent(parsed, { now })
  if (!result.ok || result.event.type !== 'message') return undefined
  return result.event.content?.text
}

/** A post's body as Keyring wrote it before 277.8: a keyring.chat/1 message, which `chatMessageText` reads back. */
export function chatMessageBody(text: string, eventId: string, at: Date): string {
  const event: ChatMessageEvent = {
    profile: CHAT_PROFILE,
    eventId,
    type: 'message',
    content: { format: 'text/plain', text },
    clientTs: at.toISOString(),
  }
  return JSON.stringify(event)
}

/** One record as a post. `note` is the record when it was read, or only its listing entry when it could not be. */
export function postOf(note: Note | NoteSummary, actingAs?: Identity, now: number = Date.now()): RoomPost {
  const read = 'body' in note
  const retracted = note.status === 'retracted'
  const chatText = read && !retracted ? chatMessageText(String(note.body), now) : undefined
  return {
    key: note.key,
    version: note.version,
    author: note.author,
    byAgent: !!note.byAgent,
    mine: sameIdentity(note.author, actingAs),
    // When it arrived, where the host says: an edit or a pin doesn't move it. Else when this version was stored.
    at: dateOf(note.createdAt ?? note.updatedAt),
    title: note.title,
    text: retracted || !read ? toInertText('') : chatText !== undefined ? toInertText(chatText) : note.body,
    isChatMessage: chatText !== undefined,
    retracted,
    pinned: note.pinned,
    unread: !read && !retracted,
    files: retracted ? [] : (note.files ?? []),
    ...(read && note.kind ? { kind: note.kind } : {}),
    ...(read && note.inReplyTo ? { inReplyTo: note.inReplyTo } : {}),
    ...(read && note.writtenAt ? { writtenAt: note.writtenAt } : {}),
    ...(read && note.editedAt ? { editedAt: note.editedAt } : {}),
    ...(read && note.reactionRefused ? { reactionRefused: true as const } : {}),
    ...(note.createdAt ? { createdAt: note.createdAt } : {}),
    ...(note.createdBy ? { createdBy: note.createdBy } : {}),
  }
}

/** Where a record shows: in the room's chat, on its Notes, or in neither. Kept on the feed all the same. */
export type RoomPlace = 'chat' | 'notes' | 'nowhere'

type Placed = Pick<RoomPost, 'title' | 'retracted'> &
  Partial<Pick<RoomPost, 'kind' | 'text' | 'files' | 'answersReaction'>>

/** A message its author took back: its current version has no words and no file. */
export const isWithdrawn = (post: Placed): boolean =>
  post.kind === 'message' && !post.retracted && !String(post.text ?? '') && !post.files?.length

/**
 * The one place that decides where a record shows (trust-tasks-tf #1027). `kind` is an open set: a kind this client
 * doesn't know reads as a note, and is never refused.
 *
 * - No `kind`: a title makes it a note, as a chat message never has one (data rooms mock). With no title it is a chat
 *   message, as the draft allows and every post Keyring has written relies on.
 * - Retracted: the marker stays among the notes, so the history stays honest.
 * - `message`: the chat, but a titled one goes to Notes for now. An open room's listing shows a title and not a kind, so
 *   `useRoomPosts` doesn't read a titled record for the chat, and the chat would never have it.
 * - `reaction`: neither. A reader must not show one as a note or a message.
 */
export function placeOf(post: Placed): RoomPlace {
  if (post.retracted) return 'notes'
  if (post.answersReaction) return 'nowhere'
  switch (post.kind) {
    case undefined:
      return post.title ? 'notes' : 'chat'
    case 'reaction':
      return 'nowhere'
    case 'message':
      if (post.title) return 'notes'
      return isWithdrawn(post) ? 'nowhere' : 'chat'
    default:
      return 'notes'
  }
}

/** A record that belongs in the room's Notes rather than its chat. */
export const isNote = (post: Placed): boolean => placeOf(post) === 'notes'

/** A post the room's chat draws. */
export const isChatPost = (post: Placed): boolean => placeOf(post) === 'chat'

/** A note the chat says is there, as one line: one the room still holds, not the marker of a removed one. */
export const isNoteMarker = (post: Placed): boolean => isNote(post) && !post.retracted

/**
 * Whether a record carries members this client's note editor would lose: it writes `{title, body}`, and a new version
 * must keep what the one it rewrites says it is. Until it keeps them, such a record isn't offered for editing.
 */
export const carriesRecordMembers = (post: Pick<RoomPost, 'kind' | 'inReplyTo' | 'writtenAt' | 'editedAt'>): boolean =>
  !!(post.kind || post.inReplyTo || post.writtenAt || post.editedAt)

/** The longest reaction value, in code points. */
const REACTION_VALUE_MAX = 64
// The rule's own list: U+000B and U+000C are control characters on purpose.
// eslint-disable-next-line no-control-regex
const LINE_TERMINATOR = /[\n\r\u000B\u000C\u0085\u2028\u2029]/
const VARIATION_SELECTORS = /[\uFE0E\uFE0F]/g

/**
 * A reaction's body in its normal form (NFC, without the emoji variation selectors), as values are compared and counted,
 * or undefined when it is one a reader must not show: nothing but white space (a reaction its author took back), over 64
 * code points or holding a line terminator.
 */
export function reactionValueOfBody(body: string): string | undefined {
  const value = body.normalize('NFC').replace(VARIATION_SELECTORS, '')
  if (!value.trim() || LINE_TERMINATOR.test(value) || [...value].length > REACTION_VALUE_MAX) return undefined
  return value
}

/**
 * A reaction's value, or undefined when a reader must not show it, which refuses that record alone. Also none without a
 * target. Text from a room reaches a post inert, with some line terminators gone, so whoever makes it inert asks
 * `reactionValueOfBody` first and says so (`reactionRefused`): "a\fb" must not read as "ab".
 */
export function reactionValueOf(
  post: Pick<RoomPost, 'kind' | 'text' | 'inReplyTo' | 'retracted' | 'reactionRefused'>
): string | undefined {
  if (post.kind !== 'reaction' || post.retracted || !post.inReplyTo || post.reactionRefused) return undefined
  return reactionValueOfBody(String(post.text))
}

/**
 * Marks the records that name a reaction as what they answer. Nothing may answer one: a reader ignores such a record,
 * shows it nowhere and counts it as no reaction. Only against the records in hand: a reader fetches nothing for it.
 */
export function withRepliesToReactions(posts: RoomPost[]): RoomPost[] {
  const reactions = new Set(posts.filter((post) => post.kind === 'reaction').map((post) => post.key))
  if (reactions.size === 0) return posts
  return posts.map((post) =>
    post.inReplyTo && reactions.has(post.inReplyTo.key) ? { ...post, answersReaction: true as const } : post
  )
}

/** Newest first: by time, then by version, so records with no time keep a stable order. */
/**
 * Newest first, by when the host first stored each record (`createdAt`) where it says, else by its last change
 * (`updatedAt`), as before: an edit or a curation does not move an old message to the top (chat plan §7 decision 3).
 *
 * One room's page can hold both kinds. A host serves no `createdAt` on a record it stored before it kept one, even after
 * that record is edited, and never guesses it (vti-rooms `Record::created_at` at VTI 0.79). Each record still has exactly
 * one time it is placed by, so this is one consistent order: a record from before is placed by its last change, as it
 * was before `createdAt` existed, since nothing better is known of it. Times are compared as instants, not as text, so
 * two spellings of one time (a fractional second, an offset) place alike. A time that can't be read counts as absent,
 * so the next one stands in (a malformed `createdAt` falls back to `updatedAt`), and no comparison ever meets NaN, which
 * would make the order depend on the sort's internals. One with no readable time at all goes last, by version.
 */
export const newestFirst = <T extends Pick<NoteSummary, 'updatedAt' | 'version'> & { createdAt?: string }>(
  notes: T[]
): T[] => {
  const instant = (s: string | undefined) => (s === undefined ? NaN : Date.parse(s))
  const at = (n: T) => {
    const created = instant(n.createdAt)
    if (!Number.isNaN(created)) return created
    const updated = instant(n.updatedAt)
    return Number.isNaN(updated) ? -Infinity : updated
  }
  return [...notes].sort((a, b) => (at(b) === at(a) ? b.version - a.version : at(b) > at(a) ? 1 : -1))
}
