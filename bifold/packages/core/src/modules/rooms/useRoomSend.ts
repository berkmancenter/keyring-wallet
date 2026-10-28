/**
 * Posting to a room (rooms member sprint, S4): what the composer sends, and the posts still on their way. A post is
 * a keyring.chat/1 message, written through the member's agent in the service's two steps: `prepareWrite` names
 * exactly what will be written, `confirmWrite` writes it. The room's header has already named who the member posts
 * as, so a post goes out on Send, with no sheet in between.
 *
 * A post shows at once, marked "Sending…", and stays until the room's own list carries it. One that fails stays,
 * marked, with its words, so the member can send it again. Every post carries its own id as the write's idempotency
 * key, the same on each retry, so a post that did reach the room before an answer was lost is not written twice
 * (words, a file, or both).
 *
 * A post may carry one file (picked and size-checked by `pickRoomFile`), with or without words. While it uploads,
 * the post shows how far it has come, and Cancel stops it: nothing is written, and the post is gone.
 *
 * @module rooms/useRoomSend
 */
import { useCallback, useRef, useState } from 'react'

import { MAX_TEXT_LENGTH } from '../chat/chatEvent'
import { newEventId } from '../chat/eventId'

import { chatMessageBody } from './roomPosts'
import type { RoomsAttachment, RoomsService, RoomsTransferProgress } from './types'

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
  /** The file it carries, if any. */
  file?: RoomsAttachment
  /** How far the file's upload has come, while sending. */
  progress?: RoomsTransferProgress
}

export interface RoomSend {
  /** Newest first. */
  pending: PendingPost[]
  /** Sends `text` (trimmed) and `file`, either or both; false when there is nothing to send. */
  send: (text: string, file?: RoomsAttachment) => boolean
  /** Stops a post's upload: nothing is written, and the post is gone. */
  cancel: (localId: string) => void
  /** Sends a failed post again, as the same event. */
  retry: (localId: string) => void
  /** Forgets sent posts the room's list now shows. */
  settle: (shownKeys: Set<string>) => void
}

const isExpired = (e: unknown): boolean => e instanceof Error && e.name === 'RoomsPreviewExpired'
const isAbort = (e: unknown): boolean => e instanceof Error && e.name === 'AbortError'

export function useRoomSend(service: RoomsService | undefined, roomId: string, onSent: () => void): RoomSend {
  const [pending, setPending] = useState<PendingPost[]>([])
  const pendingRef = useRef(pending)
  pendingRef.current = pending
  const onSentRef = useRef(onSent)
  onSentRef.current = onSent
  const controllers = useRef(new Map<string, AbortController>())

  const update = (localId: string, change: Partial<PendingPost>) =>
    setPending((all) => all.map((p) => (p.localId === localId ? { ...p, ...change } : p)))

  const deliver = useCallback(
    async (post: PendingPost) => {
      if (!service) return
      const abort = new AbortController()
      controllers.current.set(post.localId, abort)
      const write = async () => {
        const preview = await service.prepareWrite(roomId, {
          title: '',
          body: post.body,
          idempotencyKey: post.localId,
          ...(post.file ? { attachment: post.file } : {}),
        })
        return service.confirmWrite(
          preview.token,
          post.file
            ? {
                signal: abort.signal,
                onProgress: (progress) => {
                  if (!abort.signal.aborted) update(post.localId, { progress })
                },
              }
            : undefined
        )
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
        update(post.localId, { state: 'sent', key: written.key, progress: undefined })
        onSentRef.current()
      } catch (e) {
        // A cancelled upload is gone already (`cancel` took it off); anything else stays, to send again.
        if (!isAbort(e) && !abort.signal.aborted) update(post.localId, { state: 'failed', progress: undefined })
      } finally {
        if (controllers.current.get(post.localId) === abort) controllers.current.delete(post.localId)
      }
    },
    [service, roomId]
  )

  const send = useCallback(
    (text: string, file?: RoomsAttachment) => {
      const trimmed = text.trim().slice(0, MAX_POST_LENGTH)
      if ((!trimmed && !file) || !service) return false
      const localId = newEventId()
      const at = new Date()
      const post: PendingPost = {
        localId,
        text: trimmed,
        // A file with no words is a record with an empty body: keyring.chat/1 has no hosted-file message, and the
        // record's own file details (its blobs) are what the room shows.
        body: trimmed ? chatMessageBody(trimmed, localId, at) : '',
        at,
        state: 'sending',
        ...(file ? { file } : {}),
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

  const cancel = useCallback((localId: string) => {
    controllers.current.get(localId)?.abort()
    controllers.current.delete(localId)
    setPending((all) => all.filter((p) => p.localId !== localId))
  }, [])

  const settle = useCallback((shownKeys: Set<string>) => {
    if (!pendingRef.current.some((p) => p.key && shownKeys.has(p.key))) return
    setPending((all) => all.filter((p) => !(p.key && shownKeys.has(p.key))))
  }, [])

  return { pending, send, retry, cancel, settle }
}
