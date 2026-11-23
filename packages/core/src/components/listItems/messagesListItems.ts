/**
 * Rooms in the Messages list (the rooms-in-Messages design, list B): the people's conversations and the rooms the
 * member holds in one list, newest first, narrowed by a chip (All, People, or one community) and searched by name.
 *
 * Pure, and generic over the room row, so the list's rules are tested without the rooms service: a room row only
 * needs its key, its community, its names and when something last happened in it.
 *
 * @module components/listItems/messagesListItems
 */
import { foldName, searchRows } from '../../modules/vrc/contacts/messageRows'

/** What a room row brings to the list. */
export interface RoomListRow {
  key: string
  roomName: string
  communityDid: string
  communityName?: string
  lastActivityAt?: Date
}

/** One line of the list: a person's conversation or a room. Keys never collide between the two. */
export type MessagesItem<P, R> = { kind: 'person'; key: string; row: P } | { kind: 'room'; key: string; row: R }

/** The chip that narrows the list. */
export type MessagesChip = { kind: 'all' } | { kind: 'people' } | { kind: 'community'; communityDid: string }

export const ALL: MessagesChip = { kind: 'all' }

/** A community's chip: one per community that has a room in the list. */
export interface CommunityChip {
  communityDid: string
  communityName?: string
}

/**
 * People and rooms in one list, newest first. `people` come in their own order (L3's conversations, newest first),
 * and `personAt` gives each one's newest message in ms. A room with nothing in it yet goes below everything that has
 * a time. Equal times keep people before rooms, and each in their own order, so the list doesn't reshuffle between
 * equals.
 */
export function mergeByTime<P extends { key: string }, R extends RoomListRow>(
  people: readonly P[],
  personAt: (row: P) => number,
  rooms: readonly R[]
): MessagesItem<P, R>[] {
  const timed = [
    ...people.map((row, index) => ({ item: { kind: 'person', key: row.key, row } as const, at: personAt(row), index })),
    ...rooms.map((row, index) => ({
      item: { kind: 'room', key: `room:${row.key}`, row } as const,
      at: row.lastActivityAt ? row.lastActivityAt.getTime() : -Infinity,
      index: people.length + index,
    })),
  ]
  return timed.sort((a, b) => b.at - a.at || a.index - b.index).map(({ item }) => item as MessagesItem<P, R>)
}

/** The communities that have a room in the list, A to Z by name (ignoring case and accents), nameless ones last. */
export function communityChips(rooms: readonly RoomListRow[]): CommunityChip[] {
  const byDid = new Map<string, CommunityChip>()
  for (const room of rooms) {
    const known = byDid.get(room.communityDid)
    if (!known || (!known.communityName && room.communityName))
      byDid.set(room.communityDid, { communityDid: room.communityDid, communityName: room.communityName })
  }
  return [...byDid.values()].sort((a, b) => {
    if (!a.communityName || !b.communityName) return a.communityName ? -1 : b.communityName ? 1 : 0
    return foldName(a.communityName).localeCompare(foldName(b.communityName))
  })
}

/** The items a chip shows: All everything, People the conversations, a community only its rooms. */
export function itemsForChip<P, R extends RoomListRow>(
  items: readonly MessagesItem<P, R>[],
  chip: MessagesChip
): MessagesItem<P, R>[] {
  if (chip.kind === 'all') return [...items]
  if (chip.kind === 'people') return items.filter((item) => item.kind === 'person')
  return items.filter((item) => item.kind === 'room' && item.row.communityDid === chip.communityDid)
}

/**
 * Search by name, as approved: never the words of a message. It filters in place, within whatever the chip shows. A
 * person matches by the name their row shows. A room matches by its name or its community's, every word of the query
 * somewhere in them ("lab plan" finds Planning in Keyring Lab). `roomName` is the title the room's row shows (a room
 * known only by its ID shows it as one). An empty query keeps every item, in order.
 */
export function searchItems<P, R extends RoomListRow>(
  items: readonly MessagesItem<P, R>[],
  personName: (row: P) => string,
  query: string,
  roomName: (row: R) => string = (row) => row.roomName
): MessagesItem<P, R>[] {
  return searchRows(
    items,
    (item) => (item.kind === 'person' ? personName(item.row) : `${roomName(item.row)} ${item.row.communityName ?? ''}`),
    query
  )
}

/** Whether a chip is the one selected. */
export const sameChip = (a: MessagesChip, b: MessagesChip): boolean =>
  a.kind === b.kind && (a.kind !== 'community' || (b.kind === 'community' && a.communityDid === b.communityDid))
