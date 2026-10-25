/**
 * Whether a received chat message has been seen: a flag kept in the record's
 * own metadata, as a BasicMessage's is (`BasicMessageMetadata.customMetadata`).
 * There is no read mark, so no order (event ids sort by the sender's clock) can
 * make a message seen or unseen by mistake, and the flag survives a restart
 * with the event it belongs to.
 *
 * @module chat/seen
 */

import type { Agent } from '@credo-ts/core'

import { getChatEventRepository } from './ChatModule'
import type { ChatEventRecord } from './records/ChatEventRecord'

const SEEN_METADATA_KEY = '_keyring/chatSeen'

/** Whether this is a received message that counts as unread: never a reaction, a redaction or a system event. */
export function isUnreadChatEvent(record: ChatEventRecord): boolean {
  return record.role === 'received' && record.eventType === 'message' && !record.metadata.get(SEEN_METADATA_KEY)
}

/**
 * Mark every unread received message of one chat seen: called while the chat is
 * open, again whenever its timeline changes. Only the unseen ones are written,
 * and that filter is what ends it: a write updates the store, the timeline
 * changes, and the chat marks again, which then writes nothing. (Filtered on the
 * message's role and type alone, it would write and redraw for ever.)
 *
 * The writes are made together, so the store's updates land close and are told
 * as one. Each is its own write: a failure part-way leaves some still unread,
 * which the next open marks; nothing else depends on them being marked together.
 */
export async function markChatEventsSeen(agent: Agent, connectionId: string): Promise<void> {
  const repository = getChatEventRepository(agent)
  const unseen = (await repository.findByConnection(agent.context, connectionId)).filter(isUnreadChatEvent)
  const at = new Date().toISOString()
  await Promise.all(
    unseen.map((record) => {
      record.metadata.set(SEEN_METADATA_KEY, { at })
      return repository.update(agent.context, record)
    })
  )
}
