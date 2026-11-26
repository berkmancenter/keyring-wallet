/**
 * A window of a room's records (`RoomsService.listNotes`'s `head`), cut from a listing: what the real service answers
 * when the agent or host cannot list newest first, and what the sample service answers always.
 *
 * @module rooms/listingWindow
 */
import type { NoteList } from './types'

/**
 * Its records below `beforeVersion` (all, absent), newest version first, at most `size`, and `older` when more lie
 * below. What the listing said of itself (`complete`, its check, its prune) is kept.
 */
export function windowOf(list: NoteList, size: number, beforeVersion?: number): NoteList {
  const below = list.notes
    .filter((note) => beforeVersion === undefined || note.version < beforeVersion)
    .sort((a, b) => b.version - a.version)
  return { ...list, notes: below.slice(0, size), older: below.length > size }
}
