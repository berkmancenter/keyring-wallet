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
 * The posts on their way are kept per room, in memory only, not by the screen: one still sending when the member
 * leaves the room carries on, and one that fails then is said in a notice ({@link ROOM_POST_FAILED_EVENT}) that can
 * send it again from anywhere. Back in the room, it shows as it is.
 *
 * @module rooms/useRoomSend
 */
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import { DeviceEventEmitter } from 'react-native'

import { MAX_TEXT_LENGTH } from '../chat/chatEvent'
import { newEventId } from '../chat/eventId'

import { chatMessageBody } from './roomPosts'
import type { RoomsAttachment, RoomsService, RoomsTransferProgress } from './types'

/** The longest post, in characters: the chat's own limit (keyring.chat/1), within the sprint's 16 KiB cap. */
export const MAX_POST_LENGTH = MAX_TEXT_LENGTH

/** A post failed while its room was not on screen: the notice says so, and can send it again. */
export const ROOM_POST_FAILED_EVENT = 'rooms:post-failed'

export interface RoomPostFailed {
  service: RoomsService
  roomId: string
  localId: string
  /** The room's name as its screen last showed it, when it has been open. */
  roomName?: string
}

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

interface Outbox {
  posts: PendingPost[]
  listeners: Set<() => void>
  /** The room screen's refresh, while it is open: a post written shows in its list. */
  onSent?: () => void
  /** Whether the room is on screen, where a post that fails is marked and needs no notice. */
  onScreen: boolean
  name?: string
}

const NO_POSTS: PendingPost[] = []

// Per service, so a new agent (and its service) starts with none, and per room. These two maps are in memory only,
// never a stored record: tier.mjs reads a `.delete(` on a name like `outboxStore` as deleting stored records, so a
// rename to `*Store` would move this file out of an OTA.
const outboxes = new WeakMap<RoomsService, Map<string, Outbox>>()
// By post: an upload's Cancel.
const controllers = new Map<string, AbortController>()

function outboxOf(service: RoomsService, roomId: string): Outbox {
  let rooms = outboxes.get(service)
  if (!rooms) outboxes.set(service, (rooms = new Map()))
  let box = rooms.get(roomId)
  if (!box) rooms.set(roomId, (box = { posts: NO_POSTS, listeners: new Set(), onScreen: false }))
  return box
}

function change(box: Outbox, next: (posts: PendingPost[]) => PendingPost[]) {
  box.posts = next(box.posts)
  box.listeners.forEach((listener) => listener())
}

const update = (box: Outbox, localId: string, values: Partial<PendingPost>) =>
  change(box, (all) => all.map((p) => (p.localId === localId ? { ...p, ...values } : p)))

const isExpired = (e: unknown): boolean => e instanceof Error && e.name === 'RoomsPreviewExpired'
const isAbort = (e: unknown): boolean => e instanceof Error && e.name === 'AbortError'

async function deliver(service: RoomsService, roomId: string, post: PendingPost) {
  const box = outboxOf(service, roomId)
  const abort = new AbortController()
  controllers.set(post.localId, abort)
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
              if (!abort.signal.aborted) update(box, post.localId, { progress })
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
    update(box, post.localId, { state: 'sent', key: written.key, progress: undefined })
    box.onSent?.()
  } catch (e) {
    // A cancelled upload is gone already (`cancel` took it off); anything else stays, to send again.
    if (!isAbort(e) && !abort.signal.aborted) {
      update(box, post.localId, { state: 'failed', progress: undefined })
      if (!box.onScreen) {
        const failed: RoomPostFailed = { service, roomId, localId: post.localId, roomName: box.name }
        DeviceEventEmitter.emit(ROOM_POST_FAILED_EVENT, failed)
      }
    }
  } finally {
    if (controllers.get(post.localId) === abort) controllers.delete(post.localId)
  }
}

/** Sends a failed post again, as the same event: from its room, or from the notice that it failed. */
export function retryRoomPost(service: RoomsService, roomId: string, localId: string): void {
  const box = outboxOf(service, roomId)
  const post = box.posts.find((p) => p.localId === localId)
  if (!post || post.state !== 'failed') return
  update(box, localId, { state: 'sending' })
  void deliver(service, roomId, post)
}

export function useRoomSend(
  service: RoomsService | undefined,
  roomId: string,
  onSent: () => void,
  /** Whether the room is on screen now, and its name: for the notice of a post that fails while it is not. */
  where: { onScreen?: boolean; roomName?: string } = {}
): RoomSend {
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!service) return () => undefined
      const { listeners } = outboxOf(service, roomId)
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    [service, roomId]
  )
  const pending = useSyncExternalStore(subscribe, () =>
    service ? (outboxes.get(service)?.get(roomId)?.posts ?? NO_POSTS) : NO_POSTS
  )
  const onSentRef = useRef(onSent)
  onSentRef.current = onSent
  const { onScreen = false, roomName } = where

  useEffect(() => {
    if (!service) return
    const box = outboxOf(service, roomId)
    const refresh = () => onSentRef.current()
    box.onSent = refresh
    return () => {
      if (box.onSent === refresh) box.onSent = undefined
    }
  }, [service, roomId])

  useEffect(() => {
    if (!service) return
    const box = outboxOf(service, roomId)
    box.onScreen = onScreen
    return () => {
      box.onScreen = false
    }
  }, [service, roomId, onScreen])

  useEffect(() => {
    if (service && roomName) outboxOf(service, roomId).name = roomName
  }, [service, roomId, roomName])

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
      change(outboxOf(service, roomId), (all) => [post, ...all])
      void deliver(service, roomId, post)
      return true
    },
    [service, roomId]
  )

  const retry = useCallback(
    (localId: string) => {
      if (service) retryRoomPost(service, roomId, localId)
    },
    [service, roomId]
  )

  const cancel = useCallback(
    (localId: string) => {
      controllers.get(localId)?.abort()
      controllers.delete(localId)
      if (service) change(outboxOf(service, roomId), (all) => all.filter((p) => p.localId !== localId))
    },
    [service, roomId]
  )

  const settle = useCallback(
    (shownKeys: Set<string>) => {
      if (!service) return
      const box = outboxOf(service, roomId)
      if (!box.posts.some((p) => p.key && shownKeys.has(p.key))) return
      change(box, (all) => all.filter((p) => !(p.key && shownKeys.has(p.key))))
    },
    [service, roomId]
  )

  return { pending, send, retry, cancel, settle }
}
