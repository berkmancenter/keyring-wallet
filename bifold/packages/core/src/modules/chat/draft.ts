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
 * @module chat/draft
 */

import type { Agent } from '@credo-ts/core'

const DRAFT_TYPE = 'chat-draft'
const draftId = (connectionId: string): string => `${DRAFT_TYPE}:${connectionId}`

// One chat's reads and writes in turn: two saves at once would both find no record and both create one.
const queues = new Map<string, Promise<unknown>>()
// Every read and write not yet done, so locking can wait for them (flushChatDrafts).
const inFlight = new Set<Promise<unknown>>()
function inTurn<T>(connectionId: string, task: () => Promise<T>): Promise<T> {
  const next = (queues.get(connectionId) ?? Promise.resolve()).catch(() => undefined).then(task)
  queues.set(connectionId, next)
  inFlight.add(next)
  const done = () => {
    inFlight.delete(next)
    if (queues.get(connectionId) === next) queues.delete(connectionId)
  }
  next.then(done, done)
  return next
}

/** How long locking waits for a draft still being written. */
export const DRAFT_FLUSH_TIMEOUT_MS = 1000

/**
 * Wait for drafts still being written, for at most `timeoutMs`, so that shutting the agent down cannot cut the last
 * one off. Locking unmounts the chat (whose last save starts then) in the same moment it shuts the agent down. Nothing
 * in flight, which is the usual case since a draft is saved as the app leaves the foreground, waits for nothing.
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

/** The chat's saved draft, or undefined when there is none. */
export function loadChatDraft(agent: Agent, connectionId: string): Promise<string | undefined> {
  return inTurn(connectionId, async () => {
    const record = await agent.genericRecords.findById(draftId(connectionId))
    const text = record?.content?.text
    return typeof text === 'string' && text.trim().length > 0 ? text : undefined
  })
}

/** Keep `text` as the chat's draft. Text with nothing but spaces in it clears the draft, as the composer counts it. */
export function saveChatDraft(agent: Agent, connectionId: string, text: string): Promise<void> {
  if (text.trim().length === 0) return clearChatDraft(agent, connectionId)
  return inTurn(connectionId, async () => {
    const existing = await agent.genericRecords.findById(draftId(connectionId))
    if (existing) {
      existing.content = { text }
      await agent.genericRecords.update(existing)
      return
    }
    await agent.genericRecords.save({
      id: draftId(connectionId),
      content: { text },
      tags: { type: DRAFT_TYPE, connectionId },
    })
  })
}

/** Forget the chat's draft; nothing to forget is not a failure. */
export function clearChatDraft(agent: Agent, connectionId: string): Promise<void> {
  return inTurn(connectionId, async () => {
    const existing = await agent.genericRecords.findById(draftId(connectionId))
    if (existing) await agent.genericRecords.delete(existing)
  })
}
