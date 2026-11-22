/**
 * Every stored chat event, read once and kept current, for the screens that
 * show chats: the timeline, the unread counts, the chat list's preview
 * (rich-messaging-plan.md §5). One read for all of them, as the contact facts
 * are (vrc/contacts/useContactFacts), and each chat is its own slice, kept the
 * same until that chat changes, so a contacts row redraws only for its own.
 *
 * Unknown is not empty: `undefined` until the events have been read.
 *
 * It follows the repository's record events (saved, updated, deleted). So
 * every write and every delete of a chat event goes through the
 * ChatEventRepository, never the storage service directly, or this goes stale
 * until the app restarts.
 *
 * @module chat/chatEventsStore
 */

import { RepositoryEventTypes, type Agent, type BaseEvent } from '@credo-ts/core'
import { useAgent } from '@bifold/react-hooks'
import { useEffect, useSyncExternalStore } from 'react'

import { getChatEventRepository } from './ChatModule'
import { foldChatEvents, prunableOrphans } from './fold'
import { ChatEventRecord } from './records/ChatEventRecord'

// `closed` turns true when the agent stops its events (Agent.shutdown fires its stop$, and every observable ends).
type Unsubscribe = { unsubscribe: () => void; closed?: boolean }

let attached: Agent | undefined
let read = false
let byConnection = new Map<string, ChatEventRecord[]>()
let subscriptions: Unsubscribe[] = []
const listeners = new Set<() => void>()
// A failed first read is tried again, later each time, and each failure is logged: until a read succeeds every chat
// stays unknown, and what hides text while a chat is unknown (hidesText) keeps hiding it, so the log says why.
export const READ_RETRY_DELAYS_MS = [1000, 5000, 30000, 120000]
let retry: ReturnType<typeof setTimeout> | undefined
// Each chat's events are pruned of stale orphans once per run, when first read.
const pruned = new Set<string>()

// Changes that land together are told once, on the next tick (as useCommunityChanged does): marking a chat's
// fifty unread messages seen is one redraw of the timeline and of the rows watching it, not fifty.
let queued = false
const notify = () => {
  if (queued) return
  queued = true
  setTimeout(() => {
    queued = false
    listeners.forEach((listener) => listener())
  }, 0)
}

/** The chat events among a repository event's records, as Credo emits them (a deleted one may be `{ id, type }`). */
const follow = (agent: Agent, type: string, on: (record: ChatEventRecord) => void): Unsubscribe =>
  agent.events.observable<BaseEvent>(type).subscribe((event) => {
    const record = (event.payload as { record?: ChatEventRecord }).record
    if (record?.type === ChatEventRecord.type) on(record)
  })

/** One chat's slice replaced, every other kept as it was. */
const replaceChat = (connectionId: string, events: ChatEventRecord[]) => {
  const next = new Map(byConnection)
  if (events.length) next.set(connectionId, events)
  else next.delete(connectionId)
  byConnection = next
  notify()
}

const upsert = (record: ChatEventRecord) => {
  const events = byConnection.get(record.connectionId) ?? []
  replaceChat(record.connectionId, [...events.filter((e) => e.id !== record.id), record])
}

const remove = (record: { id: string; connectionId?: string }) => {
  for (const [connectionId, events] of byConnection) {
    if (events.some((e) => e.id === record.id)) {
      replaceChat(
        connectionId,
        events.filter((e) => e.id !== record.id)
      )
      return
    }
  }
}

/** Stale orphans deleted, through the repository, so the deletes come back here as record events. */
const prune = (agent: Agent, connectionId: string, events: ChatEventRecord[]) => {
  if (pruned.has(connectionId)) return
  pruned.add(connectionId)
  const stale = prunableOrphans(foldChatEvents(events).orphans)
  if (!stale.length) return
  const repository = getChatEventRepository(agent)
  void Promise.all(stale.map((record) => repository.delete(agent.context, record))).catch(() => undefined)
}

/** Every chat event, read once; a failed read is logged and tried again later, then given up on until re-attached. */
const readAll = (agent: Agent, repository: ReturnType<typeof getChatEventRepository>, attempt: number) => {
  void repository
    .getAll(agent.context)
    .then((all) => {
      if (attached !== agent) return
      const grouped = new Map<string, ChatEventRecord[]>()
      for (const record of all) grouped.set(record.connectionId, [...(grouped.get(record.connectionId) ?? []), record])
      // What arrived while the read ran is kept: the read cannot know of it.
      for (const [connectionId, events] of byConnection) {
        const ids = new Set((grouped.get(connectionId) ?? []).map((e) => e.id))
        grouped.set(connectionId, [...(grouped.get(connectionId) ?? []), ...events.filter((e) => !ids.has(e.id))])
      }
      byConnection = grouped
      read = true
      notify()
      for (const [connectionId, events] of grouped) prune(agent, connectionId, events)
    })
    .catch((error) => {
      if (attached !== agent) return
      // Unread, not empty: the screens keep saying so. Said in the log too, and tried again.
      const delay = READ_RETRY_DELAYS_MS[attempt]
      agent.config?.logger?.warn?.(
        `[chat] reading chat events failed (attempt ${attempt + 1}): ${
          delay === undefined ? 'not trying again until the wallet reconnects' : `trying again in ${delay / 1000} s`
        }`,
        { error }
      )
      if (delay === undefined) return
      retry = setTimeout(() => {
        retry = undefined
        if (attached === agent && !read) readAll(agent, repository, attempt + 1)
      }, delay)
    })
}

export const chatEventsStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },

  /**
   * Read every chat event for `agent`, once, and follow it from then on. Another agent starts afresh, and so does the
   * same agent started again: a lock shuts it down, which ends every subscription to its events, and the unlock
   * initializes that same instance (useBifoldAgentSetup's restart). Kept as it was, every chat stayed frozen at the
   * lock: messages stored after it were never shown until the app was closed (275).
   */
  attach(agent: Agent): void {
    if (attached === agent && !subscriptions.some((s) => s.closed)) return
    chatEventsStore.forget()
    attached = agent
    let repository: ReturnType<typeof getChatEventRepository>
    try {
      subscriptions = [
        follow(agent, RepositoryEventTypes.RecordSaved, upsert),
        follow(agent, RepositoryEventTypes.RecordUpdated, upsert),
        follow(agent, RepositoryEventTypes.RecordDeleted, remove),
      ]
      repository = getChatEventRepository(agent)
    } catch (error) {
      // An agent with no event bus or chat storage: a test's stand-in, or a build where the chat module was never
      // registered. The chats stay unread, never shown empty, and the log says why.
      agent.config?.logger?.warn?.('[chat] no chat storage on this agent: chats stay unknown', { error })
      return
    }
    readAll(agent, repository, 0)
  },

  /** One chat's events, or undefined until they have been read. The same array until that chat changes. */
  chat(connectionId: string | undefined): ChatEventRecord[] | undefined {
    if (!read) return undefined
    return (connectionId && byConnection.get(connectionId)) || NONE
  },

  /** Every chat's events, or undefined until read. A new map whenever any chat changes. */
  all(): ReadonlyMap<string, ChatEventRecord[]> | undefined {
    return read ? byConnection : undefined
  },

  /** Stop following and forget: no agent, or a new one. */
  forget(): void {
    if (retry) clearTimeout(retry)
    retry = undefined
    subscriptions.forEach((s) => s.unsubscribe())
    subscriptions = []
    attached = undefined
    read = false
    byConnection = new Map()
    pruned.clear()
    notify()
  },
}

// The same empty slice for every chat with no events, so its identity is stable too.
const NONE: ChatEventRecord[] = []

/** Read the store for the agent of this screen. */
function useAttached(): void {
  const { agent } = useAgent()
  useEffect(() => {
    if (agent) chatEventsStore.attach(agent as unknown as Agent)
  }, [agent])
}

/** One chat's events: undefined until read. */
export function useChatEvents(connectionId: string | undefined): ChatEventRecord[] | undefined {
  useAttached()
  return useSyncExternalStore(chatEventsStore.subscribe, () => chatEventsStore.chat(connectionId))
}

/** Every chat's events, by connection: undefined until read. */
export function useAllChatEvents(): ReadonlyMap<string, ChatEventRecord[]> | undefined {
  useAttached()
  return useSyncExternalStore(chatEventsStore.subscribe, chatEventsStore.all)
}
