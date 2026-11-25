/**
 * What the member just asked of a room's records, shown at once: a reaction, a changed or withdrawn one, an edit, a
 * withdrawn message. Each write takes several round trips through the member's agent (the keys it needs, a seal, a
 * signature, the host's put), then a read of the room before the chat drew it: 4.7 s from tap to chip on an iPhone 11
 * (278.12, 11-10). Laid over the posts the chat is drawn from, the chat shows it as soon as it is asked for.
 *
 * Kept on screen until the room's list carries what was written, at the version written or newer, and then the list
 * alone says it. A write that fails is taken off at once: the screen says why, and the post is as the room has it. One
 * the list hasn't shown a while after it was written is taken off too, so the room's own word comes back.
 *
 * In memory, per screen. Nothing here is sent or kept: what may be written is decided where it was before.
 *
 * Replies and plain posts are not here: they go through the outbox (useRoomSend), which shows them as "Sending…".
 *
 * @module rooms/pendingRecordWrites
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import { toInertText } from './inertText'
import type { RoomPost } from './roomPosts'
import type { Identity } from './types'

/** How long a write the list hasn't shown stays laid over it, once written. */
export const PENDING_WRITE_MAX_MS = 30_000

/** A reaction still on its way is drawn as a record under this key, which no room uses. */
const PENDING_REACTION = 'pending-reaction:'

export type PendingWriteAsked =
  | { type: 'reaction'; target: { key: string; version: number }; value: string; author: Identity }
  | { type: 'changeReaction'; key: string; value: string }
  | { type: 'withdraw'; key: string }
  | { type: 'edit'; key: string; body: string; at: string }

export type PendingWrite = PendingWriteAsked & {
  id: number
  /** What the room took, once it has: the record and the version it wrote. */
  written?: { key: string; version: number }
}

/** A record key the chat drew for a reaction still on its way: not one to act on. */
export const isPendingRecordKey = (key: string): boolean => key.startsWith(PENDING_REACTION)

/** Whether the room's list already carries a write: its record, at the version written or newer. */
export function landed(posts: readonly RoomPost[], write: PendingWrite): boolean {
  const written = write.written
  if (!written) return false
  return posts.some((post) => post.key === written.key && post.version >= written.version)
}

const asReaction = (write: Extract<PendingWrite, { type: 'reaction' }>): RoomPost => ({
  key: `${PENDING_REACTION}${write.id}`,
  version: 0,
  author: write.author,
  byAgent: false,
  mine: true,
  text: toInertText(write.value),
  isChatMessage: false,
  retracted: false,
  pinned: false,
  unread: false,
  files: [],
  kind: 'reaction',
  inReplyTo: write.target,
})

/** The posts, newest first, with each write the list doesn't carry yet laid over them. */
export function withPendingWrites(posts: RoomPost[], writes: readonly PendingWrite[]): RoomPost[] {
  const open = writes.filter((write) => !landed(posts, write))
  if (open.length === 0) return posts
  const laid = posts.map((post) => {
    let shown = post
    for (const write of open) {
      if (write.type === 'reaction' || write.key !== post.key) continue
      if (write.type === 'changeReaction') shown = { ...shown, text: toInertText(write.value) }
      // A withdrawn record has no words and no file: a reaction counts for nothing, a message shows nowhere.
      else if (write.type === 'withdraw') shown = { ...shown, text: toInertText(''), files: [] }
      else shown = { ...shown, text: toInertText(write.body), editedAt: write.at }
    }
    return shown
  })
  const reactions = open.flatMap((write) => (write.type === 'reaction' ? [asReaction(write)] : []))
  return reactions.length ? [...reactions.reverse(), ...laid] : laid
}

export interface PendingWrites {
  writes: readonly PendingWrite[]
  /** Lays `asked` over the posts while `run` writes it: kept once written, taken off if it fails (and rethrown). */
  track: (asked: PendingWriteAsked, run: () => Promise<{ key: string; version: number }>) => Promise<void>
}

const NO_WRITES: PendingWrite[] = []

export function usePendingWrites(posts: readonly RoomPost[] | undefined): PendingWrites {
  const [writes, setWrites] = useState<PendingWrite[]>(NO_WRITES)
  const next = useRef(0)
  const live = useRef(true)
  useEffect(
    () => () => {
      live.current = false
    },
    []
  )
  const drop = useCallback((id: number) => {
    if (live.current) setWrites((now) => (now.some((w) => w.id === id) ? now.filter((w) => w.id !== id) : now))
  }, [])

  // The list now carries it: the list alone says it.
  useEffect(() => {
    if (!posts) return
    setWrites((now) => {
      const open = now.filter((write) => !landed(posts, write))
      return open.length === now.length ? now : open
    })
  }, [posts])

  const track = useCallback(
    async (asked: PendingWriteAsked, run: () => Promise<{ key: string; version: number }>) => {
      const id = ++next.current
      if (live.current) setWrites((now) => [...now, { ...asked, id }])
      let written: { key: string; version: number }
      try {
        written = await run()
      } catch (e) {
        drop(id)
        throw e
      }
      if (live.current) setWrites((now) => now.map((w) => (w.id === id ? { ...w, written } : w)))
      setTimeout(() => drop(id), PENDING_WRITE_MAX_MS)
    },
    [drop]
  )
  return { writes, track }
}
