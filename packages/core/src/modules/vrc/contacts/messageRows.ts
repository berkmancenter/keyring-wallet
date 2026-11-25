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
import { DidCommConnectionType, DidCommDidExchangeState, type DidCommConnectionRecord } from '@credo-ts/didcomm'

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

/**
 * Whether a connection is someone to talk to: a completed connection that is not infrastructure. Never the mediator,
 * never a witness service, never one the app hides by name, in developer mode as well. One rule for the Messages
 * list and its New message picker (the user's own agent is reached over TSP, not a DIDComm connection, so it is
 * never one of these).
 */
export function isConversationPartner(record: DidCommConnectionRecord, hideList?: readonly string[]): boolean {
  if (record.state !== DidCommDidExchangeState.Completed) return false
  if (record.connectionTypes.includes(DidCommConnectionType.Mediator)) return false
  if (record.metadata?.get('witnessConnection') != null) return false
  return !hideList?.includes((record.theirLabel || record.alias) ?? '')
}

/**
 * The conversations among `rows` (the Messages list redesign, L3): a contact appears once a message has been
 * exchanged on any of its connections, newest first. `lastMessageAt` gives a connection's newest message in ms, or
 * -Infinity when it has none; so a chat cleared on this phone leaves the list until either side writes again.
 * Equal times keep their order.
 */
export function conversations(
  rows: readonly MessageRow[],
  lastMessageAt: (connectionId: string) => number
): MessageRow[] {
  return rows
    .map((row, index) => ({ row, index, at: Math.max(...row.connectionIds.map(lastMessageAt)) }))
    .filter(({ at }) => at > -Infinity)
    .sort((a, b) => b.at - a.at || a.index - b.index)
    .map(({ row }) => row)
}

/** For matching names: lower case, accents taken off ("Zoé" and "zoe" match), spaces kept. */
export function foldName(text: string): string {
  let folded = text.toLowerCase()
  try {
    folded = folded.normalize('NFD').replace(/[̀-ͯ]/g, '')
  } catch {
    // An engine without normalize: case is still ignored.
  }
  return folded.trim()
}

/**
 * The rows whose contact's name matches `query` (the Messages list redesign, L5): names only, as approved, never
 * the words of any message. Every word of the query must appear in the name ("ana rib" finds "Ana Ribeiro"),
 * ignoring case and accents; an empty query keeps every row, in order.
 */
export function searchRows<T>(rows: readonly T[], nameOf: (row: T) => string, query: string): T[] {
  const words = foldName(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) return [...rows]
  return rows.filter((row) => {
    const name = foldName(nameOf(row))
    return words.every((word) => name.includes(word))
  })
}
