/**
 * The Messages list's rows: one per contact, as the Contacts list groups them (contactLinks.ts), not one per
 * connection. Every exchange with someone is its own connection and relationship DID, so a merged contact has
 * several; the list showed each as its own conversation.
 *
 * A row stands for its contact's connections together, and carries every connection's id, for the unread count
 * summed over them and for anything else that acts on the whole contact. It shows and opens one of them
 * (`connectionToOpen`): one holding unread messages when any does, since a chat shows, and marks seen, only its
 * own connection's messages, so opening any other would leave those unread for good. A connection whose
 * relationship is not known (not read yet, or none recorded) is its own row: grouping only ever joins rows, never
 * hides one.
 *
 * @module vrc/contacts/messageRows
 */
import type { DidCommConnectionRecord } from '@credo-ts/didcomm'

import { type ContactLinks, contactIdOf } from './contactLinks'

export interface MessageRow {
  /** The contact's id, or the connection's own for a connection with no known relationship. */
  key: string
  /** The connection the row shows and opens (`connectionToOpen`). */
  connection: DidCommConnectionRecord
  /** Every connection of the contact, the shown one included, in list order. */
  connectionIds: string[]
}

/**
 * Which of a contact's connections to show and open: of those holding unread messages, the one with the newest
 * activity; when none does, the newest of all. A tie keeps the earlier connection, so the choice does not flip
 * between equals. The Messages row and the contact page's Message action both use it, so they open the same chat.
 */
export function connectionToOpen<T>(
  members: readonly T[],
  lastActivity: (member: T) => number,
  unread: (member: T) => number
): T {
  const withUnread = members.filter((member) => unread(member) > 0)
  const candidates = withUnread.length > 0 ? withUnread : members
  let chosen = candidates[0]
  for (const member of candidates.slice(1)) if (lastActivity(member) > lastActivity(chosen)) chosen = member
  return chosen
}

/**
 * Group `connections` (already filtered, in list order) by contact. `lastActivity` gives a connection's newest
 * activity in ms, `unread` its unread messages. Rows keep the order of each contact's first connection.
 */
export function messageRows(
  connections: readonly DidCommConnectionRecord[],
  relationshipOf: ReadonlyMap<string, string> | undefined,
  links: ContactLinks,
  lastActivity: (connection: DidCommConnectionRecord) => number,
  unread: (connection: DidCommConnectionRecord) => number = () => 0
): MessageRow[] {
  const groups = new Map<string, DidCommConnectionRecord[]>()
  for (const connection of connections) {
    const relationship = relationshipOf?.get(connection.id)
    const key = relationship ? `contact:${contactIdOf(links, relationship)}` : `connection:${connection.id}`
    groups.set(key, [...(groups.get(key) ?? []), connection])
  }
  return [...groups].map(([key, members]) => ({
    key,
    connection: connectionToOpen(members, lastActivity, unread),
    connectionIds: members.map((m) => m.id),
  }))
}
