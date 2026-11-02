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
 * A poll that fails says so (`pollFailed`) until a listing succeeds, and `pollNow` asks again at once. Only the change
 * redraws: a failure repeated while one is already said, or a success while none is, redraws nothing.
 *
 * While the agent is being reached again (an unlock reopens its session) neither failure is said, and a listing or a
 * poll that failed is asked again once the moment a session opens after it was sent (#772, 276.9), not at a tick.
 *
 * @module rooms/useRoomPosts
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import { useAgentSession } from './agentSession'
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
  /** The version of the last prune this listing already reflects: a full listing that carried it. */
  pruneSeen?: number
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
  /** The last poll failed. Cleared by the next listing that succeeds; it changes only on that flip. */
  pollFailed: boolean
  /** Asks for new posts at once, without waiting out the ticks a failure skips. Nothing while the room isn't polled. */
  pollNow: () => void
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
  // A conflict the agent found shows at once. A partial listing can't be compared, so it never clears one; and the
  // same conflict found again is no change, so a standing one redraws nothing. `HostCheck` is exactly
  // { verdict, detail }: a field added to it must be compared here too.
  const sameCheck = newer.check.verdict === listing.check.verdict && newer.check.detail === listing.check.detail
  const check = newer.check.verdict === 'conflict' && !sameCheck ? newer.check : listing.check
  if (!changed && check === listing.check) return undefined
  return {
    listing: {
      notes: newestFirst([...byKey.values()]),
      check,
      complete: listing.complete && newer.complete,
      ...(listing.pruneSeen !== undefined ? { pruneSeen: listing.pruneSeen } : {}),
    },
    added,
  }
}

/** A full listing as held: newest first, with the prune it already reflects. */
const listingOf = (list: NoteList): Listing => ({
  notes: newestFirst(list.notes),
  check: list.check,
  complete: list.complete,
  ...(list.lastPrune ? { pruneSeen: list.lastPrune.version } : {}),
})

/**
 * Whether `newer` names a prune past what is held (browse 0.3's reader rule): records it removed never come in a
 * poll from the newest version held, so only a full listing drops them. The watermark is the newer of the newest
 * version held and the last prune already applied: a prune that took the newest post leaves the newest version held
 * below the prune's own, and the posts alone would ask for a full listing on every poll.
 */
const prunedPast = (listing: Listing, newer: NoteList): boolean =>
  !!newer.lastPrune && newer.lastPrune.version > Math.max(newestVersion(listing.notes), listing.pruneSeen ?? 0)

const readKey = (note: NoteSummary) => `${note.key}@${note.version}`

/**
 * A listing, counted in `inFlight` until it settles, even when the call throws before it returns a promise: left
 * counted, every later poll would be skipped for the life of the screen.
 */
function counted(inFlight: { current: number }, list: () => Promise<NoteList>): Promise<NoteList> {
  let asked: Promise<NoteList>
  try {
    asked = list()
  } catch (e) {
    asked = Promise.reject(e)
  }
  inFlight.current++
  return asked.finally(() => {
    inFlight.current--
  })
}

export function useRoomPosts(
  service: RoomsService | undefined,
  roomId: string,
  actingAs: Identity | undefined,
  enabled: boolean,
  live = false,
  /**
   * The posts a page is counted in, when the screen draws only some of them: a room's chat leaves its notes out, so
   * its page is POSTS_PAGE chat posts, and the notes among them are read too. Every post counts when absent.
   */
  counts?: (post: RoomPost) => boolean
): RoomPosts {
  const [listing, setListing] = useState<Listing>()
  // Records read and drawn: `wanted` counted posts, and as many more records as it takes to reach them.
  const [shown, setShown] = useState(POSTS_PAGE)
  const wanted = useRef(POSTS_PAGE)
  const countsNow = useRef(counts)
  countsNow.current = counts
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
  // Ticks still to pass after a failed poll. Kept across leaving and coming back, so a member whose agent is failing
  // doesn't ask again on every return; a listing that succeeds clears them.
  const skips = useRef(0)
  // Whether the last poll failed, as said on screen. Mirrored in a ref so that only a flip sets state.
  const [pollFailed, setPollFailed] = useState(false)
  const pollFailedNow = useRef(false)
  const notePoll = useCallback((failedNow: boolean) => {
    if (pollFailedNow.current === failedNow) return
    pollFailedNow.current = failedNow
    setPollFailed(failedNow)
  }, [])
  // The poll of the room while it is polled, for `pollNow`.
  const tickNow = useRef<(() => void) | undefined>(undefined)
  const reads = useRef<{ service?: RoomsService; roomId: string; notes: Map<string, Note> }>({
    roomId,
    notes: new Map(),
  })
  if (reads.current.service !== service || reads.current.roomId !== roomId)
    reads.current = { service, roomId, notes: new Map() }
  const session = useAgentSession()
  // The agent session each failed ask was sent on: a session opened since asks again.
  const openedAt = useRef(session.openedAt)
  openedAt.current = session.openedAt
  const listFailedOn = useRef<number | undefined>(undefined)
  const pollFailedOn = useRef<number | undefined>(undefined)

  useEffect(() => {
    if (!service || !enabled) return
    let current = true
    const sentOn = openedAt.current
    counted(listingsInFlight, () => service.listNotes(roomId)).then(
      (list) => {
        skips.current = 0
        if (!current) return
        setListing(listingOf(list))
        setFailed(false)
        notePoll(false)
      },
      () => {
        if (!current) return
        listFailedOn.current = sentOn
        setFailed(true)
        setRefreshing(false)
      }
    )
    return () => {
      current = false
    }
  }, [service, roomId, enabled, generation, notePoll])

  const listed = !!listing
  useEffect(() => {
    if (!service || !enabled || !live || !listed) return
    let current = true
    const tick = () => {
      if (skips.current > 0) {
        skips.current--
        return
      }
      if (listingsInFlight.current > 0) return
      const sentOn = openedAt.current
      counted(listingsInFlight, () =>
        service.listNotes(roomId, { sinceVersion: newestVersion(listingNow.current?.notes ?? []) })
      ).then(
        (newer) => {
          if (current) notePoll(false)
          const now = listingNow.current
          if (current && now && prunedPast(now, newer)) {
            // Pruned past what is held: one full listing replaces it, new posts in this poll included. Its failure is
            // the poll's, on the session it was sent on, so only a session opened since asks again at once.
            const fullOn = openedAt.current
            counted(listingsInFlight, () => service.listNotes(roomId)).then(
              (full) => {
                if (current) setListing(listingOf(full))
              },
              () => {
                skips.current = POLL_SKIPS_AFTER_FAILURE
                pollFailedOn.current = fullOn
                if (current) notePoll(true)
              }
            )
            return
          }
          const merged = current && now ? mergeNewer(now, newer) : undefined
          if (!merged) return
          setListing(merged.listing)
          // New posts go first (the chat draws them at its bottom); the posts already shown stay shown.
          if (merged.added > 0) setShown((n) => n + merged.added)
        },
        () => {
          // What is shown stays, and the next ticks give the agent room. The first failure is said; more say nothing.
          skips.current = POLL_SKIPS_AFTER_FAILURE
          pollFailedOn.current = sentOn
          if (current) notePoll(true)
        }
      )
    }
    // No catch-up while a failure's ticks are still owed: they pass first, up to (skips + 1) ticks. "Try again"
    // (`pollNow`) is the member's way out at once, and a listing that succeeds clears them.
    if (resumed.current && skips.current === 0) tick()
    resumed.current = false
    const timer = setInterval(tick, ROOM_POLL_MS)
    tickNow.current = () => {
      skips.current = 0
      tick()
    }
    return () => {
      current = false
      clearInterval(timer)
      resumed.current = true
      tickNow.current = undefined
    }
  }, [service, roomId, enabled, live, listed, notePoll])

  useEffect(() => {
    if (!service || !listing) return
    let current = true
    const read = reads.current.notes
    const page = listing.notes.slice(0, shown)
    const postsOf = (notes: NoteSummary[]) =>
      notes.map((summary) => postOf(read.get(readKey(summary)) ?? summary, actingAs))
    const draw = (notes: NoteSummary[]) => setPosts(postsOf(notes))
    const show = () => {
      const drawn = postsOf(page)
      setPosts(drawn)
      // A page short of the posts it is counted in, with records left, reads on by the shortfall. Only once a page
      // is read: on a private room a note's title is sealed with its body, so the listing cannot tell one. On an open
      // room the notes it can tell were never read, so a shortfall round reads only what may be a chat post.
      const counted = countsNow.current ? drawn.filter(countsNow.current).length : drawn.length
      if (counted < wanted.current && listing.notes.length > page.length) {
        setShown(page.length + wanted.current - counted)
        return
      }
      setRefreshing(false)
      setLoadingOlder(false)
    }
    // A record its listing already shows is not counted is not read for this page: an open room lists a note's title
    // in cleartext, and the chat leaves notes out (the Notes part reads them for itself). Where a listing carries no
    // title (attributed and private rooms seal it with the body), each record is read to tell, as before.
    const leftOut = (summary: NoteSummary) => !!countsNow.current && !countsNow.current(postOf(summary, actingAs))
    const ready = (summary: NoteSummary) =>
      summary.status === 'retracted' || read.has(readKey(summary)) || leftOut(summary)
    // The posts that can be drawn now: newest first, up to the first one still being read.
    const readSoFar = () => {
      const waiting = page.findIndex((summary) => !ready(summary))
      return waiting === -1 ? page : page.slice(0, waiting)
    }
    const unread = page.filter((summary) => !ready(summary))
    if (unread.length === 0) {
      show()
      return
    }
    // Each post is drawn as its read lands rather than once every read has: the list grows only at its oldest end
    // (the top of the chat, drawn bottom up), so nothing shown moves. What was drawn before is not drawn again, and a
    // read that fails holds the rest until every read has answered; then the page is drawn whole, the failed post
    // marked as unread.
    let drawn = readSoFar().length
    const asks = unread.map((summary) =>
      service.readNote(roomId, summary.key).then((note) => {
        read.set(readKey(summary), note)
        if (!current) return
        const soFar = readSoFar()
        if (soFar.length > drawn && soFar.length < page.length) {
          drawn = soFar.length
          draw(soFar)
        }
      })
    )
    void Promise.allSettled(asks).then(() => {
      if (current) show()
    })
    return () => {
      current = false
    }
  }, [service, roomId, listing, shown, actingAs])

  const loadOlder = useCallback(() => {
    setLoadingOlder(true)
    wanted.current += POSTS_PAGE
    setShown((n) => n + POSTS_PAGE)
  }, [])
  const refresh = useCallback(() => {
    setRefreshing(true)
    wanted.current = POSTS_PAGE
    setShown(POSTS_PAGE)
    setGeneration((g) => g + 1)
  }, [])
  const pollNow = useCallback(() => tickNow.current?.(), [])

  // The agent is back: a first listing that failed is asked again, else a poll that did. Once per session opened.
  const back = session.openedAt
  useEffect(() => {
    if (back === undefined) return
    if (failed && !listing && back !== listFailedOn.current) {
      listFailedOn.current = back
      setGeneration((g) => g + 1)
    } else if (pollFailed && back !== pollFailedOn.current && tickNow.current) {
      pollFailedOn.current = back
      tickNow.current?.()
    }
  }, [back, failed, listing, pollFailed])

  return {
    posts,
    hasOlder: !!listing && listing.notes.length > shown,
    check: listing?.check,
    incomplete: !!listing && !listing.complete,
    failed: failed && !session.reconnecting,
    refreshing,
    loadingOlder,
    loadOlder,
    refresh,
    pollFailed: pollFailed && !session.reconnecting,
    pollNow,
  }
}
