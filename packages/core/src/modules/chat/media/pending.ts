/**
 * Photos on their way, per chat, for the screen to show at once (rich-messaging-plan.md §5, the photo-sending mock):
 * from the moment one is picked, while it is made ready and sent, and, when a send fails, until the person tries again
 * or deletes it.
 *
 * Kept in memory only, while the app is open: nothing here is stored, so nothing that failed ever looks delivered, and
 * closing the app drops it. A photo that went shows as its stored message (send.ts), and leaves this list.
 *
 * @module chat/media/pending
 */
import { useSyncExternalStore } from 'react'

export type PendingStage = 'preparing' | 'sending' | 'failed'

export interface PendingPhoto {
  id: string
  connectionId: string
  /** The picked photo, to show before it is made ready: a local file. */
  uri: string
  width: number
  height: number
  createdAt: number
  stage: PendingStage
  /** On a failed send: sends the same prepared photo again, resolving to whether it went. */
  retry?: () => Promise<boolean>
}

const byChat = new Map<string, PendingPhoto[]>()
const listeners = new Set<() => void>()
const EMPTY: PendingPhoto[] = []
let next = 0

const changed = () => listeners.forEach((l) => l())

const put = (connectionId: string, list: PendingPhoto[]) => {
  if (list.length) byChat.set(connectionId, list)
  else byChat.delete(connectionId)
  changed()
}

/** A photo just picked in `connectionId`: shown at once, as being made ready. Returns its id. */
export function addPendingPhoto(
  connectionId: string,
  photo: { uri: string; width: number; height: number },
  now: number = Date.now()
): string {
  const id = `pending-photo-${++next}`
  put(connectionId, [
    ...(byChat.get(connectionId) ?? []),
    { id, connectionId, ...photo, createdAt: now, stage: 'preparing' },
  ])
  return id
}

/** Change a pending photo; one that is gone stays gone. */
export function updatePendingPhoto(connectionId: string, id: string, patch: Partial<Omit<PendingPhoto, 'id'>>): void {
  const list = byChat.get(connectionId)
  if (!list?.some((p) => p.id === id)) return
  put(
    connectionId,
    list.map((p) => (p.id === id ? { ...p, ...patch } : p))
  )
}

export function removePendingPhoto(connectionId: string, id: string): void {
  const list = byChat.get(connectionId)
  if (!list?.some((p) => p.id === id)) return
  put(
    connectionId,
    list.filter((p) => p.id !== id)
  )
}

export function pendingPhoto(connectionId: string, id: string): PendingPhoto | undefined {
  return byChat.get(connectionId)?.find((p) => p.id === id)
}

/** The photos on their way in a chat, oldest first. */
export function usePendingPhotos(connectionId: string): PendingPhoto[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => byChat.get(connectionId) ?? EMPTY
  )
}

/** Forget every pending photo (tests). */
export function resetPendingPhotos(): void {
  byChat.clear()
  changed()
}
