/**
 * Deleting a chat from the Messages list, with Undo (the Messages list redesign, L4, approved 2026-10-25): once the
 * person confirms, the row leaves the list at once, and the chat is deleted from this phone only when the Undo
 * window ends, the way Telegram does it. No "recently deleted" copy is kept.
 *
 * The window lives here, not in the list: it ends, and the delete runs, even if the person has left the screen.
 * A chat is deleted once: a second request for one already waiting or being deleted does nothing, and Undo after
 * the delete has started cannot stop it. If the delete fails, the row comes back and `onFailed` says so.
 *
 * A pending delete is deliberately kept in memory only, never persisted. If the app is closed or killed inside the
 * window, the delete never runs and the chat is still there on the next start. That is the safe way round: persisting
 * it would complete, after a restart, a delete the person may have been about to undo, with no window left to undo it.
 *
 * @module chat/pendingChatDeletes
 */

/** How long Undo is offered before the chat is deleted. */
export const UNDO_WINDOW_MS = 5000
/**
 * After a delete, how long its row stays hidden while the message stores catch up, so it does not flash back
 * between the delete and the list reading that nothing is left in it.
 */
export const SETTLE_MS = 2000

interface Pending {
  connectionIds: readonly string[]
  timer?: ReturnType<typeof setTimeout>
  committing: boolean
}

const pending = new Map<string, Pending>()
const listeners = new Set<() => void>()
let snapshot: ReadonlySet<string> = new Set()

function changed(): void {
  snapshot = new Set([...pending.values()].flatMap((p) => p.connectionIds))
  listeners.forEach((listener) => listener())
}

export interface ChatDeleteRequest {
  /** The row's key: one request per contact, whatever its number of connections. */
  key: string
  /** Every connection of the contact, each chat deleted in turn. */
  connectionIds: readonly string[]
  /** Deletes one connection's chat (deleteChatMessages with no ids, which clears its draft too). */
  deleteChat: (connectionId: string) => Promise<void>
  /** Called when a delete fails: the row is already back. */
  onFailed?: (error: unknown) => void
  windowMs?: number
}

/** Hide the row now and delete when the window ends. False when this chat is already on its way out. */
export function scheduleChatDelete({
  key,
  connectionIds,
  deleteChat,
  onFailed,
  windowMs = UNDO_WINDOW_MS,
}: ChatDeleteRequest): boolean {
  if (pending.has(key)) return false
  const entry: Pending = { connectionIds, committing: false }
  pending.set(key, entry)
  entry.timer = setTimeout(() => {
    entry.committing = true
    void (async () => {
      try {
        for (const connectionId of connectionIds) await deleteChat(connectionId)
      } catch (error) {
        // Nothing, or not everything, was deleted: the row comes back with whatever is left.
        pending.delete(key)
        changed()
        onFailed?.(error)
        return
      }
      // Deleted: the row stays out of the list because nothing is said in it any more (conversations only), once the
      // message stores have caught up.
      entry.timer = setTimeout(() => {
        pending.delete(key)
        changed()
      }, SETTLE_MS)
    })()
  }, windowMs)
  changed()
  return true
}

/** Undo: the row comes back and nothing is deleted. False once the delete has started (or nothing was waiting). */
export function cancelChatDelete(key: string): boolean {
  const entry = pending.get(key)
  if (!entry || entry.committing) return false
  clearTimeout(entry.timer)
  pending.delete(key)
  changed()
  return true
}

/** The connections whose chats are waiting to be deleted, or being deleted: their rows stay out of the list. */
export const pendingChatDeletes = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  get(): ReadonlySet<string> {
    return snapshot
  },
}

/** For tests: forget every pending delete, without running any. */
export function resetPendingChatDeletes(): void {
  pending.forEach((entry) => clearTimeout(entry.timer))
  pending.clear()
  changed()
}
