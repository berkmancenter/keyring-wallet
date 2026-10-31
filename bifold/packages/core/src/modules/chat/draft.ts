/**
 * A chat's unsent text, kept per conversation so it outlives the Chat screen.
 * Unlocking after the app locks resets navigation, and the draft lived only in
 * gifted-chat's state, so it was lost (271 and 272).
 *
 * It is message content, so it is kept where the messages are: the agent's own
 * encrypted store, as a generic record, not AsyncStorage. A draft in a
 * disappearing-messages chat is kept too: it has not been sent, so no clock has
 * started on it.
 *
 * Saved as it changes (the screen debounces, useChatDraft.ts), restored when
 * the chat opens, and cleared when it is sent (the composer empties), by Clear
 * chat and by removing the contact (history.ts). Locking waits for a draft
 * still being written before it shuts the agent down (RootStack.tsx).
 *
 * A room's composer keeps its unsent post the same way, per room: an
 * inactivity lock brings the person back to the open room (#772), and the post
 * they were writing comes back with it. Only the text is kept, not a picked
 * file. Locking waits for a room's draft too.
 *
 * @module chat/draft
 */

import type { Agent } from '@credo-ts/core'

import { createKeyLock } from '../../utils/keyLock'

/** Whose draft it is: a chat's, by its connection, or a room's, by its id. */
export type DraftKind = 'chat' | 'room'

const DRAFT_TYPE: Record<DraftKind, string> = { chat: 'chat-draft', room: 'room-draft' }
const draftId = (kind: DraftKind, id: string): string => `${DRAFT_TYPE[kind]}:${id}`

// One draft's reads and writes in turn: two saves at once would both find no record and both create one.
const lock = createKeyLock()
// Every draft read and write not yet done, so locking can wait for them (flushChatDrafts). Drafts' own, not the lock's:
// locking unmounts the composer and shuts the agent down in the same moment, so a composer's last save races the
// shutdown. Other modules' writes on their own locks (a petname, a directory name) are made from a sheet, with no such
// race, and locking doesn't wait for them.
const inFlight = new Set<Promise<unknown>>()
function inTurn<T>(key: string, task: () => Promise<T>): Promise<T> {
  const next = lock(key, task)
  inFlight.add(next)
  const done = () => inFlight.delete(next)
  next.then(done, done)
  return next
}

/** How long locking waits for a draft still being written. */
export const DRAFT_FLUSH_TIMEOUT_MS = 1000

/**
 * Wait for drafts still being written, chats' and rooms', for at most `timeoutMs`, so that shutting the agent down
 * cannot cut the last one off. Locking unmounts the chat (whose last save starts then) in the same moment it shuts the
 * agent down. Nothing in flight, which is the usual case since a draft is saved as the app leaves the foreground, waits
 * for nothing.
 */
export async function flushChatDrafts(timeoutMs: number = DRAFT_FLUSH_TIMEOUT_MS): Promise<void> {
  if (inFlight.size === 0) return
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<void>((resolve) => (timer = setTimeout(resolve, timeoutMs)))
  await Promise.race([Promise.allSettled([...inFlight]), late])
  clearTimeout(timer)
}

/** Run `shutdown` once the drafts being written are done (or have had their time); `shutdown` always runs. */
export function afterChatDrafts(shutdown: () => Promise<unknown> | unknown): Promise<void> {
  return flushChatDrafts().then(
    async () => void (await shutdown()),
    async () => void (await shutdown())
  )
}

/** The saved draft, or undefined when there is none. */
export function loadDraft(agent: Agent, kind: DraftKind, id: string): Promise<string | undefined> {
  return inTurn(draftId(kind, id), async () => {
    const record = await agent.genericRecords.findById(draftId(kind, id))
    const text = record?.content?.text
    return typeof text === 'string' && text.trim().length > 0 ? text : undefined
  })
}

/** Keep `text` as the draft. Text with nothing but spaces in it clears the draft, as the composer counts it. */
export function saveDraft(agent: Agent, kind: DraftKind, id: string, text: string): Promise<void> {
  if (text.trim().length === 0) return clearDraft(agent, kind, id)
  return inTurn(draftId(kind, id), async () => {
    const existing = await agent.genericRecords.findById(draftId(kind, id))
    if (existing) {
      existing.content = { text }
      await agent.genericRecords.update(existing)
      return
    }
    await agent.genericRecords.save({
      id: draftId(kind, id),
      content: { text },
      // Each kind's tags spelled out, so a query by `connectionId` or `roomId` finds them by name.
      tags: kind === 'room' ? { type: DRAFT_TYPE.room, roomId: id } : { type: DRAFT_TYPE.chat, connectionId: id },
    })
  })
}

/** Forget the draft; nothing to forget is not a failure. */
export function clearDraft(agent: Agent, kind: DraftKind, id: string): Promise<void> {
  return inTurn(draftId(kind, id), async () => {
    const existing = await agent.genericRecords.findById(draftId(kind, id))
    if (existing) await agent.genericRecords.delete(existing)
  })
}

/** The chat's saved draft, or undefined when there is none. */
export const loadChatDraft = (agent: Agent, connectionId: string): Promise<string | undefined> =>
  loadDraft(agent, 'chat', connectionId)

/** Keep `text` as the chat's draft. Text with nothing but spaces in it clears the draft, as the composer counts it. */
export const saveChatDraft = (agent: Agent, connectionId: string, text: string): Promise<void> =>
  saveDraft(agent, 'chat', connectionId, text)

/** Forget the chat's draft; nothing to forget is not a failure. */
export const clearChatDraft = (agent: Agent, connectionId: string): Promise<void> =>
  clearDraft(agent, 'chat', connectionId)
