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
import type { ChatEventRecord } from './records/ChatEventRecord'

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

/** What Delete for me removes: chat events by eventId, and plain BasicMessages by record id. */
export interface ChatMessageIds {
  eventIds?: string[]
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
  const eventsDoomed = ids ? withDependents(events, new Set(ids.eventIds ?? [])) : events
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
  const messageIds = new Set(eventsDoomed.filter((r) => r.eventType === 'message').map((r) => r.eventId))
  if (messageIds.size === 0 || !(await RNFS.exists(folder))) return
  for (const file of await RNFS.readDir(folder)) {
    const stem = file.name.includes('.') ? file.name.slice(0, file.name.indexOf('.')) : file.name
    if (messageIds.has(stem)) await RNFS.unlink(file.path)
  }
}

/**
 * The events named, plus everything that targets them, transitively: a message's reactions and any redaction of it,
 * and the redactions of those reactions.
 */
function withDependents(events: ChatEventRecord[], named: Set<string>): ChatEventRecord[] {
  const doomed = new Set([...named].filter((id) => events.some((e) => e.eventId === id)))
  let grew = true
  while (grew) {
    grew = false
    for (const e of events) {
      if (!doomed.has(e.eventId) && e.target !== undefined && doomed.has(e.target)) {
        doomed.add(e.eventId)
        grew = true
      }
    }
  }
  return events.filter((e) => doomed.has(e.eventId))
}
