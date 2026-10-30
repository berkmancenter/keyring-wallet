/**
 * A room's records as a conversation (rooms member sprint): each record is a post, newest first. A post's words
 * are its keyring.chat/1 message when its body is one (the same parser one-to-one chat uses), and otherwise the
 * record's body as it was written. Either way they are inert text: shown, never followed. Nothing here throws on
 * what a room holds.
 *
 * This reads the body itself until the rooms service hands over the parsed event (`Note.event`); then `postOf`
 * takes it from there and nothing on screen changes.
 *
 * @module rooms/roomPosts
 */
import { CHAT_PROFILE, type ChatMessageEvent, parseChatEvent } from '../chat/chatEvent'

import { toInertText, type InertText } from './inertText'
import type { Identity, Note, NoteSummary, RoomFile } from './types'

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
  /** A post this phone is still sending, or could not send (not yet a record in the room). */
  delivery?: 'sending' | 'failed'
  /** The files the post carries, each shown as a chip under its words. None on a retracted post. */
  files: RoomFile[]
  /** How far a sending post's file has come, 0 to 1. */
  progress?: number
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

/** A post's body as it is written to the room: a keyring.chat/1 message, which `chatMessageText` reads back. */
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
    at: dateOf(note.updatedAt),
    title: note.title,
    text: retracted || !read ? toInertText('') : chatText !== undefined ? toInertText(chatText) : note.body,
    isChatMessage: chatText !== undefined,
    retracted,
    pinned: note.pinned,
    unread: !read && !retracted,
    files: retracted ? [] : (note.files ?? []),
  }
}

/**
 * A record that belongs in the room's Notes rather than its chat (data rooms mock): one with a title, which a chat
 * message never has, or one a curator removed, whose marker stays among the notes so the history stays honest. A
 * record with neither stays in the chat, shown as written.
 */
export const isNote = (post: Pick<RoomPost, 'title' | 'retracted'>): boolean => !!post.title || post.retracted

/** A post the room's chat draws: any record that is not a note. */
export const isChatPost = (post: Pick<RoomPost, 'title' | 'retracted'>): boolean => !isNote(post)

/** Newest first: by time, then by version, so records with no time keep a stable order. */
export const newestFirst = <T extends Pick<NoteSummary, 'updatedAt' | 'version'>>(notes: T[]): T[] =>
  [...notes].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '') || b.version - a.version)
