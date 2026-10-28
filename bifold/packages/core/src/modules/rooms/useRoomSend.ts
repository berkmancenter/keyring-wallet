/**
 * Posting to a room (rooms member sprint, S4): what the composer sends, and the posts still on their way. A post is
 * a keyring.chat/1 message, written through the member's agent in the service's two steps: `prepareWrite` names
 * exactly what will be written, `confirmWrite` writes it. The room's header has already named who the member posts
 * as, so a post goes out on Send, with no sheet in between.
 *
 * A post shows at once, marked "Sending…", and stays until the room's own list carries it. One that fails stays,
 * marked, with its words, so the member can send it again; a retry writes the same event (same eventId), so a post
 * that did reach the room before an answer was lost can be told for the same one.
 *
 * @module rooms/useRoomSend
 */
import { useCallback, useRef, useState } from 'react'

import { MAX_TEXT_LENGTH } from '../chat/chatEvent'
import { newEventId } from '../chat/eventId'

import { chatMessageBody } from './roomPosts'
import type { RoomsService } from './types'

/** The longest post, in characters: the chat's own limit (keyring.chat/1), within the sprint's 16 KiB cap. */
export const MAX_POST_LENGTH = MAX_TEXT_LENGTH

export interface PendingPost {
  /** The post's eventId, which also names it on screen until the room has it. */
  localId: string
  text: string
  body: string
  at: Date
  state: 'sending' | 'failed' | 'sent'
  /** The record's key, once written: the post leaves this list when the room's list shows that key. */
  key?: string
}

export interface RoomSend {
  /** Newest first. */
  pending: PendingPost[]
  /** Sends `text` (trimmed); false when there is nothing to send. */
  send: (text: string) => boolean
  /** Sends a failed post again, as the same event. */
  retry: (localId: string) => void
  /** Forgets sent posts the room's list now shows. */
  settle: (shownKeys: Set<string>) => void
}

const isExpired = (e: unknown): boolean => e instanceof Error && e.name === 'RoomsPreviewExpired'

export function useRoomSend(service: RoomsService | undefined, roomId: string, onSent: () => void): RoomSend {
  const [pending, setPending] = useState<PendingPost[]>([])
  const pendingRef = useRef(pending)
  pendingRef.current = pending
  const onSentRef = useRef(onSent)
  onSentRef.current = onSent

  const update = (localId: string, change: Partial<PendingPost>) =>
    setPending((all) => all.map((p) => (p.localId === localId ? { ...p, ...change } : p)))

  const deliver = useCallback(
    async (post: PendingPost) => {
      if (!service) return
      const write = async () => {
        const preview = await service.prepareWrite(roomId, { title: '', body: post.body })
        return service.confirmWrite(preview.token)
      }
      try {
        let written: { key: string }
        try {
          written = await write()
        } catch (e) {
          // A preview gone stale between the two steps (an app sent to the background): prepare it once more.
          if (!isExpired(e)) throw e
          written = await write()
        }
        update(post.localId, { state: 'sent', key: written.key })
        onSentRef.current()
      } catch {
        update(post.localId, { state: 'failed' })
      }
    },
    [service, roomId]
  )

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim().slice(0, MAX_POST_LENGTH)
      if (!trimmed || !service) return false
      const localId = newEventId()
      const at = new Date()
      const post: PendingPost = {
        localId,
        text: trimmed,
        body: chatMessageBody(trimmed, localId, at),
        at,
        state: 'sending',
      }
      setPending((all) => [post, ...all])
      void deliver(post)
      return true
    },
    [service, deliver]
  )

  const retry = useCallback(
    (localId: string) => {
      const post = pendingRef.current.find((p) => p.localId === localId)
      if (!post || post.state !== 'failed') return
      update(localId, { state: 'sending' })
      void deliver(post)
    },
    [deliver]
  )

  const settle = useCallback((shownKeys: Set<string>) => {
    if (!pendingRef.current.some((p) => p.key && shownKeys.has(p.key))) return
    setPending((all) => all.filter((p) => !(p.key && shownKeys.has(p.key))))
  }, [])

  return { pending, send, retry, settle }
}
