/**
 * The agent chats as rows of the Messages list (plan §3.14, §7.9; backlog 2, fb-C4): `useAgentMessageRows()`.
 *
 * One row per agent the Contacts list shows (fb's `agentContacts`: "Connected", "Connected until", "Not connected
 * right now" and "Revoke not confirmed"; an expired, revoked, unfinished or pairing agent has no row), with its chat's
 * last message, if any: its text and `lastAt`, the ISO instant it was sent or stored. A row's kind in
 * `messagesListItems` is {@link AGENT_MESSAGE_ROW_KIND}; the UI/UX lane merges the rows into `mergeByTime` in
 * `Messages.tsx` (R3), ordered by `lastAt` among the people and rooms. A message with no text (a photo the agent sent,
 * not carried in P0) gives the row its time and no text.
 *
 * **Behind the switch.** With `isAgentConnectEnabled()` false the hook returns no row and reads nothing, so Messages is
 * as on the tip. With no {@link AgentChatProvider} mounted it returns no row either.
 *
 * @module connected-agents/chat/messageRows
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'

import { foldChatEvents } from '../../chat/fold'
import type { ChatEventRecord } from '../../chat/records/ChatEventRecord'
import { isAgentConnectEnabled } from '../agentConnectFlag'
import { agentContacts } from '../status'
import type { AgentConnection } from '../types'
import { chatConnectionOf, useAgentChatService } from './useAgentChat'

/** The row kind the agent chats take in `messagesListItems` (§3.14). */
export const AGENT_MESSAGE_ROW_KIND = 'agent' as const

export interface AgentMessageRow {
  agentId: string
  name: string
  lastText?: string
  /** ISO instant of the last message. */
  lastAt?: string
}

const NO_ROWS: AgentMessageRow[] = []

/** The rows, from the agents' records and every chat's events (undefined until read: rows with no last message). */
export function agentMessageRows(
  records: readonly AgentConnection[],
  events: ReadonlyMap<string, ChatEventRecord[]> | undefined,
  now: number
): AgentMessageRow[] {
  const byId = new Map(records.map((r) => [r.id, r]))
  return agentContacts(records, now).map(({ agentId, name }) => {
    const record = byId.get(agentId) as AgentConnection
    const chat = events?.get(chatConnectionOf(record))
    const messages = chat ? foldChatEvents([...chat]).messages : []
    const last = messages[messages.length - 1]
    if (!last) return { agentId, name }
    return {
      agentId,
      name,
      ...(last.content?.text !== undefined ? { lastText: last.content.text } : {}),
      lastAt: last.sentTime.toISOString(),
    }
  })
}

const noSubscribe = () => () => undefined
const noEvents = () => undefined
const noVersion = () => 0

/** The agent chats' rows for Messages: empty with the flag off. */
export function useAgentMessageRows(): AgentMessageRow[] {
  const mounted = useAgentChatService()
  const chat = isAgentConnectEnabled() ? mounted : undefined
  const version = useSyncExternalStore(chat ? chat.subscribe : noSubscribe, chat ? chat.getVersion : noVersion)
  const subscribeEvents = useCallback(
    (listener: () => void) => (chat ? chat.deps.events.subscribe(listener) : noSubscribe()),
    [chat]
  )
  const events = useSyncExternalStore(subscribeEvents, chat ? () => chat.deps.events.all() : noEvents)
  const [records, setRecords] = useState<AgentConnection[]>([])
  useEffect(() => {
    if (!chat) return
    let live = true
    void chat.deps.store.list().then(
      (r) => live && setRecords(r),
      () => undefined
    )
    return () => {
      live = false
    }
  }, [chat, version, events])
  if (!chat) return NO_ROWS
  return agentMessageRows(records, events, (chat.deps.now ?? Date.now)())
}
