/**
 * Chat history deleted on this phone (rich-messaging-plan.md §4.6): Delete for me, Clear chat, and removing a
 * contact. Nothing here sends anything.
 *
 * A message goes together with what hangs off it: the reactions folded into it, the redactions of those reactions,
 * and its media file. Quote snippets are not stored (a reply reads its original when it is drawn), so a reply whose
 * original is gone shows the original as unavailable.
 *
 * @module chat/history
 */

import type { Agent } from '@credo-ts/core'
import { DidCommBasicMessageRepository } from '@credo-ts/didcomm'
import { Platform } from 'react-native'
import RNFS from 'react-native-fs'

import { getChatEventRepository } from './ChatModule'
import { forgetExpired } from './expired'
import type { ChatEventRecord, ChatEventRole } from './records/ChatEventRecord'

/**
 * The folder that holds one chat's media files (rich-messaging-plan.md §5): app-private, out of backups and device
 * transfers. Each file is named by its message's eventId.
 */
export function chatMediaFolder(connectionId: string): string {
  const base = Platform.OS === 'ios' ? `${RNFS.LibraryDirectoryPath}/Application Support` : RNFS.DocumentDirectoryPath
  return `${base}/chat-media/${connectionId}`
}

/**
 * A record that is already gone is what deletion wants, so it is not a failure. Anything else (a store that cannot be
 * read or written) is rethrown, so the caller reports failure instead of success over what it never deleted. The
 * name check covers a RecordNotFoundError from another copy of @credo-ts/core, which instanceof would miss.
 */
function unlessAlreadyGone(error: unknown): void {
  if ((error as Error | undefined)?.name === 'RecordNotFoundError') return
  throw error
}

/**
 * One chat event, named by who sent it and its eventId. The role is part of the name: an eventId is chosen by its
 * sender, so a peer can reuse one this phone sent, and a name without the role would then pick both records.
 * A ChatEventRecord is one.
 */
export interface ChatEventKey {
  role: ChatEventRole
  eventId: string
}

/** What Delete for me removes: chat events by role and eventId, and plain BasicMessages by record id. */
export interface ChatMessageIds {
  events?: ChatEventKey[]
  basicMessageIds?: string[]
}

/**
 * Delete chat history on this phone. With `ids`, those messages and what hangs off them (Delete for me); without,
 * every message, event and media file of the chat (Clear chat, and removing a contact). Only records of
 * `connectionId` are touched, whatever ids are passed.
 *
 * Every record goes through its repository's `delete(record)`, whose RecordDeleted event carries the whole record
 * (its connectionId included), so the chat list and unread counts that follow those events update at once.
 * `deleteById` would announce only the id and type.
 */
export async function deleteChatMessages(agent: Agent, connectionId: string, ids?: ChatMessageIds): Promise<void> {
  const basicMessages = agent.dependencyManager.resolve(DidCommBasicMessageRepository)
  const chatEvents = getChatEventRepository(agent)

  const basic = await basicMessages.findByQuery(agent.context, { connectionId })
  const basicDoomed = ids ? basic.filter((r) => ids.basicMessageIds?.includes(r.id)) : basic
  for (const record of basicDoomed) {
    await basicMessages.delete(agent.context, record).catch(unlessAlreadyGone)
  }

  const events = await chatEvents.findByConnection(agent.context, connectionId)
  const eventsDoomed = ids ? withDependents(events, ids.events ?? []) : events
  for (const record of eventsDoomed) {
    await chatEvents.delete(agent.context, record).catch(unlessAlreadyGone)
  }

  const folder = chatMediaFolder(connectionId)
  if (!ids) {
    if (await RNFS.exists(folder)) await RNFS.unlink(folder)
    // Housekeeping only: a stale tombstone can change nothing but the wording for an id that no longer exists, so it
    // never fails a clear.
    await forgetExpired(connectionId).catch(() => undefined)
    return
  }
  // A media file is named by its message's eventId alone, so a file whose name a kept message shares is kept with it.
  const kept = new Set(
    events.filter((r) => r.eventType === 'message' && !eventsDoomed.includes(r)).map((r) => r.eventId)
  )
  const messageIds = new Set(
    eventsDoomed.filter((r) => r.eventType === 'message' && !kept.has(r.eventId)).map((r) => r.eventId)
  )
  if (messageIds.size === 0 || !(await RNFS.exists(folder))) return
  for (const file of await RNFS.readDir(folder)) {
    const stem = file.name.includes('.') ? file.name.slice(0, file.name.indexOf('.')) : file.name
    if (messageIds.has(stem)) await RNFS.unlink(file.path)
  }
}

/**
 * The events named, plus everything that targets them, transitively: a message's reactions and any redaction of it,
 * and the redactions of those reactions.
 *
 * The named events match on role and eventId, so a received event that reuses the eventId of one this phone sent
 * (or the reverse) is never taken with it: Delete for me on the peer's message, or its timer, cannot remove this
 * phone's own. Inbound refuses such a pair (inbound.ts), but a phone that already holds one is not repaired by that.
 * Following targets stays role-blind, as it must: a reaction from the peer targets a message this phone sent. So in a
 * pair that predates that refusal, a reaction to the kept half may still go with the deleted one: a target carries no
 * role, and nothing records which half it meant. The messages themselves are safe.
 */
function withDependents(events: ChatEventRecord[], named: ChatEventKey[]): ChatEventRecord[] {
  const doomed = new Set(events.filter((e) => named.some((n) => n.role === e.role && n.eventId === e.eventId)))
  const targets = new Set([...doomed].map((e) => e.eventId))
  let grew = true
  while (grew) {
    grew = false
    for (const e of events) {
      if (!doomed.has(e) && e.target !== undefined && targets.has(e.target)) {
        doomed.add(e)
        targets.add(e.eventId)
        grew = true
      }
    }
  }
  return events.filter((e) => doomed.has(e))
}
