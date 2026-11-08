/**
 * What a room's screen may offer to write beyond a plain post: replies, reactions, and a member's edit or withdrawal
 * of their own message (trust-tasks-tf #1027; `real/recordWrites.ts`). Three things decide it, and each one alone
 * keeps the room as it is today, Copy only:
 *
 * - the build: `RoomsService.recordSendingOn`, which nothing turns on yet. Off, the room's profile isn't even read.
 * - the room: Keyring writes these only in an attributed room the member has joined.
 * - the room's profile: a writer may use a member only when the profile lists it and the member's agent seals it.
 *
 * With sending on and a room that doesn't take them, the screen says so ("aren't on in this room yet").
 *
 * @module rooms/useRecordSending
 */
import { useCallback, useEffect, useState } from 'react'

import type { RoomPost } from './roomPosts'
import type { RecordFeatures, RecordWrite, Room, RoomsService } from './types'

export interface RecordSending {
  /** Sending is on, in a room Keyring writes these to: the sheet may offer more than Copy. */
  on: boolean
  /** On, and the room's profile has been read (or couldn't be). */
  ready: boolean
  replies: boolean
  reactions: boolean
  /** A plain post goes as a record that says it's a message, so its author can later edit or withdraw it. */
  typedMessages: boolean
  /** On, read, and the room takes neither replies nor reactions: the sheet says they aren't on here yet. */
  notOn: boolean
  /** Whether the member may edit or withdraw this post of theirs. */
  canChange: (post: RoomPost) => boolean
  send: (write: RecordWrite) => Promise<{ key: string; version: number }>
  /**
   * After a write the room or the agent refused for its members: what the refusal says the room takes now, or, when
   * it says nothing, a fresh read. Within one room epoch a fresh read gives back the profile already held.
   */
  learn: (features?: RecordFeatures) => void
}

/** What a member needs listed, and sealed, for each write (`messageMembers`, `keptMembers`, a reaction's members). */
const NEEDS = {
  reply: ['inReplyTo'],
  reaction: ['kind', 'inReplyTo', 'writtenAt'],
  typed: ['kind'],
} as const

const permits = (features: RecordFeatures | undefined, members: readonly string[]): boolean =>
  !!features && features.canSeal && members.every((m) => features.listed.includes(m))

const NOT_SENT = (): Promise<never> => Promise.reject(new Error('record sending is not on here'))

export function useRecordSending(service: RoomsService | undefined, room: Room | undefined): RecordSending {
  const roomId = room?.roomId
  const on =
    !!service &&
    !!roomId &&
    service.recordSendingOn?.() === true &&
    !!service.recordFeaturesIn &&
    !!service.sendRecord &&
    room?.tier === 'attributed' &&
    room.joined !== false
  const [features, setFeatures] = useState<{ roomId: string; features: RecordFeatures }>()
  const [asked, setAsked] = useState(0)

  useEffect(() => {
    if (!on || !service?.recordFeaturesIn || !roomId) return
    let live = true
    service
      .recordFeaturesIn(roomId)
      .then(
        (read) => read,
        // Unread is unread: a profile that can't be read permits none.
        (): RecordFeatures => ({ listed: [], canSeal: false, unresolved: true })
      )
      .then((read) => live && setFeatures({ roomId, features: read }))
    return () => {
      live = false
    }
  }, [on, service, roomId, asked])

  const read = on && features?.roomId === roomId ? features.features : undefined
  const replies = permits(read, NEEDS.reply)
  const reactions = permits(read, NEEDS.reaction)
  const typedMessages = permits(read, NEEDS.typed)

  const canChange = useCallback(
    (post: RoomPost) =>
      !!post.mine &&
      post.kind === 'message' &&
      !post.retracted &&
      !post.delivery &&
      permits(read, ['kind', ...(post.inReplyTo ? ['inReplyTo'] : []), ...(post.writtenAt ? ['writtenAt'] : [])]),
    [read]
  )

  const send = useCallback(
    (write: RecordWrite) => (on && service?.sendRecord && roomId ? service.sendRecord(roomId, write) : NOT_SENT()),
    [on, service, roomId]
  )
  const learn = useCallback(
    (told?: RecordFeatures) => {
      if (told && roomId) setFeatures({ roomId, features: told })
      else setAsked((n) => n + 1)
    },
    [roomId]
  )

  return {
    on,
    ready: !!read,
    replies,
    reactions,
    typedMessages,
    notOn: !!read && !replies && !reactions,
    canChange,
    send,
    learn,
  }
}
