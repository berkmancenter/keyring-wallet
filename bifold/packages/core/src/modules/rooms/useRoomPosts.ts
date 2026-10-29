/**
 * A room's posts as RoomView shows them: newest first, {@link POSTS_PAGE} at a time, "load older" for the next
 * page, and a refresh (pull down) that lists the room again. Nothing pushes a post to a phone, so while the room is
 * `live` (in view, the app in the foreground) it asks every {@link ROOM_POLL_MS} for the records above the newest
 * version it holds, and catches up at once on coming back. Upstream's browse says a consumer SHOULD NOT poll; the
 * poll is kept to the room the member is looking at.
 *
 * Until the rooms service pages from the newest itself, this lists the room once and reads each shown record. A read
 * is kept by key and version, so a new listing reads only what is new or changed: a refresh or a poll that finds
 * nothing new reads nothing and redraws nothing. A record that can't be read stays in its place as "couldn't be
 * read", never hiding the rest, and is read again with the next listing.
 *
 * The agent client sends one task at a time, so a poll is skipped while a listing of the room is still being asked:
 * it never queues behind itself, and a member's own post waits behind one listing at most.
 *
 * @module rooms/useRoomPosts
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import { newestFirst, postOf, type RoomPost } from './roomPosts'
import type { HostCheck, Identity, Note, NoteList, NoteSummary, RoomsService } from './types'

/**
 * The posts read on opening a room, and on each "Load older". Small on purpose: each is one task for the person's
 * agent, which the agent client sends one at a time, so a post written just after opening a room waited behind the
 * whole first page. At 30 the act took 40 s to reach the host on the lab's open room (S0.7, 10-29).
 */
export const POSTS_PAGE = 10
/** How often a room in view asks for new posts. */
export const ROOM_POLL_MS = 10_000
/** After a poll that failed, the ticks that pass before the next one. */
export const POLL_SKIPS_AFTER_FAILURE = 2

interface Listing {
  notes: NoteSummary[]
  check: HostCheck
  complete: boolean
}

export interface RoomPosts {
  /** Newest first. Undefined until the first page is read. */
  posts?: RoomPost[]
  /** More, older posts can be loaded. */
  hasOlder: boolean
  /** The agent's check of the host's answer; a `conflict` is shown above the posts. */
  check?: HostCheck
  /** The host's listing stopped early. */
  incomplete: boolean
  /** The room could not be listed; what was shown before stays. */
  failed: boolean
  refreshing: boolean
  loadingOlder: boolean
  loadOlder: () => void
  refresh: () => void
}

/** The newest version a listing holds: a poll asks for the records above it. 0 for an empty room. */
export const newestVersion = (notes: readonly NoteSummary[]): number =>
  notes.reduce((newest, note) => Math.max(newest, note.version), 0)

/**
 * A listing with what a poll found merged in: a record at a higher version replaces its key's entry (a retract is
 * one), and a new key is added. Undefined when the poll found nothing newer, so nothing is redrawn.
 */
export function mergeNewer(listing: Listing, newer: NoteList): { listing: Listing; added: number } | undefined {
  const byKey = new Map(listing.notes.map((note) => [note.key, note]))
  let added = 0
  let changed = false
  for (const note of newer.notes) {
    const held = byKey.get(note.key)
    if (held && held.version >= note.version) continue
    if (!held) added++
    byKey.set(note.key, note)
    changed = true
  }
  // A conflict the agent found shows at once. A partial listing can't be compared, so it never clears one.
  const check = newer.check.verdict === 'conflict' ? newer.check : listing.check
  if (!changed && check === listing.check) return undefined
  return {
    listing: { notes: newestFirst([...byKey.values()]), check, complete: listing.complete && newer.complete },
    added,
  }
}

const readKey = (note: NoteSummary) => `${note.key}@${note.version}`

export function useRoomPosts(
  service: RoomsService | undefined,
  roomId: string,
  actingAs: Identity | undefined,
  enabled: boolean,
  live = false
): RoomPosts {
  const [listing, setListing] = useState<Listing>()
  const [shown, setShown] = useState(POSTS_PAGE)
  const [posts, setPosts] = useState<RoomPost[]>()
  const [failed, setFailed] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [generation, setGeneration] = useState(0)
  const listingNow = useRef(listing)
  listingNow.current = listing
  // Listings of this room being asked now (a first read, a refresh, a poll).
  const listingsInFlight = useRef(0)
  // Coming back into view catches up at once instead of a tick later.
  const resumed = useRef(false)
  const reads = useRef<{ service?: RoomsService; roomId: string; notes: Map<string, Note> }>({
    roomId,
    notes: new Map(),
  })
  if (reads.current.service !== service || reads.current.roomId !== roomId)
    reads.current = { service, roomId, notes: new Map() }

  useEffect(() => {
    if (!service || !enabled) return
    let current = true
    listingsInFlight.current++
    service
      .listNotes(roomId)
      .then(
        (list) => {
          if (!current) return
          setListing({ notes: newestFirst(list.notes), check: list.check, complete: list.complete })
          setFailed(false)
        },
        () => {
          if (!current) return
          setFailed(true)
          setRefreshing(false)
        }
      )
      .finally(() => listingsInFlight.current--)
    return () => {
      current = false
    }
  }, [service, roomId, enabled, generation])

  const listed = !!listing
  useEffect(() => {
    if (!service || !enabled || !live || !listed) return
    let current = true
    let skips = 0
    const tick = () => {
      if (skips > 0) {
        skips--
        return
      }
      if (listingsInFlight.current > 0) return
      listingsInFlight.current++
      service
        .listNotes(roomId, { sinceVersion: newestVersion(listingNow.current?.notes ?? []) })
        .then(
          (newer) => {
            const now = listingNow.current
            const merged = current && now ? mergeNewer(now, newer) : undefined
            if (!merged) return
            setListing(merged.listing)
            // New posts go on top; the posts already shown stay shown.
            if (merged.added > 0) setShown((n) => n + merged.added)
          },
          () => {
            // Quietly: what is shown stays, and the next ticks give the agent room.
            skips = POLL_SKIPS_AFTER_FAILURE
          }
        )
        .finally(() => listingsInFlight.current--)
    }
    if (resumed.current) tick()
    resumed.current = false
    const timer = setInterval(tick, ROOM_POLL_MS)
    return () => {
      current = false
      clearInterval(timer)
      resumed.current = true
    }
  }, [service, roomId, enabled, live, listed])

  useEffect(() => {
    if (!service || !listing) return
    let current = true
    const read = reads.current.notes
    const page = listing.notes.slice(0, shown)
    const show = () => {
      setPosts(page.map((summary) => postOf(read.get(readKey(summary)) ?? summary, actingAs)))
      setRefreshing(false)
      setLoadingOlder(false)
    }
    const unread = page.filter((summary) => summary.status !== 'retracted' && !read.has(readKey(summary)))
    if (unread.length === 0) {
      show()
      return
    }
    void Promise.allSettled(unread.map((summary) => service.readNote(roomId, summary.key))).then((results) => {
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') read.set(readKey(unread[i]), r.value)
      })
      if (current) show()
    })
    return () => {
      current = false
    }
  }, [service, roomId, listing, shown, actingAs])

  const loadOlder = useCallback(() => {
    setLoadingOlder(true)
    setShown((n) => n + POSTS_PAGE)
  }, [])
  const refresh = useCallback(() => {
    setRefreshing(true)
    setShown(POSTS_PAGE)
    setGeneration((g) => g + 1)
  }, [])

  return {
    posts,
    hasOlder: !!listing && listing.notes.length > shown,
    check: listing?.check,
    incomplete: !!listing && !listing.complete,
    failed,
    refreshing,
    loadingOlder,
    loadOlder,
    refresh,
  }
}
