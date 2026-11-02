/**
 * The member's rooms as Messages rows (rooms in Messages, R1, approved 2026-10-30): each room the member holds, with
 * its newest post, when, and how many posts by others came after the last one the member saw. The Messages list
 * merges these rows with its conversations; the Messages tab's badge adds their unread ({@link useRoomsUnreadCount}).
 *
 * Nothing pushes a post to a phone, and every read is a task the member's agent sends one at a time, ahead of the
 * member's own posts. So the rooms are read gently, by one poll for the whole app ({@link useRoomRowsPoll}, from the
 * tab navigator), never per screen:
 * - at once when the app starts with an agent linked, and on coming back to the app (not within
 *   {@link ROWS_RETURN_FLOOR_MS} of the last read);
 * - when Messages comes into view (not within {@link ROWS_FOCUS_FLOOR_MS}), and every {@link ROWS_POLL_MS} only while
 *   it is in view; also while it is in view, when a community a listing skipped can be read again (`onReadable`);
 * - the moment the agent is back, if a read is out or left rooms unread or failed: that read went to a session now
 *   gone, so nothing waits for its next retry;
 * - one room after another, each asked only for what came after the newest post already read; the newest of
 *   that is read in full, and only when it is newer than the post the row already shows.
 *
 * "Seen" is the newest post the member has had on screen in the room (markRoomSeen, from the room screen). It is kept
 * on this phone, per room, as a short hash of the room's ID, so a relaunch neither loses it nor counts old posts as
 * new. A room met for the first time starts seen up to its newest post: nothing written before Messages showed rooms
 * counts as unread. The member's own posts never count.
 *
 * A room can be hidden from Messages until someone posts in it again ({@link hideRoom}); that is kept on this phone
 * the same way.
 *
 * The rows show as soon as the member's rooms are listed, before any room's posts are read: a room whose posts haven't
 * been read yet is a row that says it is reading, never "No posts yet", and each row fills in as its room is read. A
 * room whose first read failed (on a cold launch the agent may not be ready) stays reading, and the rows are read
 * again soon ({@link ROWS_RETRY_MS}), not only at the next return or Messages coming into view. A read asked for while
 * one is out (Messages coming into view, a return, another agent) runs once that one ends, not never.
 *
 * Each listing of the member's rooms is also handed, whole, to whoever asked for it ({@link onRoomsListed}): the room
 * notices read access ending and access gone from it, including the rooms Messages leaves out.
 *
 * Everything else is in memory only, per rooms service, and not named `*Store`: tier.mjs reads a `.delete(` on such a
 * name as deleting stored records.
 *
 * @module rooms/useRoomRows
 */
import AsyncStorage from '@react-native-async-storage/async-storage'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import { useFocusEffect } from '@react-navigation/native'
import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { AppState } from 'react-native'

import { onSessionOpened } from './agentSession'
import type { InertText } from './inertText'
import { isNote, newestFirst, postOf } from './roomPosts'
import type { Identity, NoteSummary, RoomsService, RoomSummary } from './types'

/** While Messages is in view: about the offers poll's idle pace, never faster. */
export const ROWS_POLL_MS = 120_000
/** Coming back to the app reads again, unless the last read is this recent. */
export const ROWS_RETURN_FLOOR_MS = 60_000
/** Messages coming into view reads again, unless the last read is this recent. */
export const ROWS_FOCUS_FLOOR_MS = 10_000
/** After a read that left a room unread, or failed: read again after each of these in turn, then wait as usual. */
export const ROWS_RETRY_MS = [15_000, 30_000, 60_000] as const

/** Where the newest post seen in each room is kept: by a hash of the room's ID. */
export const ROOMS_SEEN_KEY = 'rooms.seenVersions'
/** Where hidden rooms are kept, by a hash of the room's ID: the newest post when it was hidden. */
export const ROOMS_HIDDEN_KEY = 'rooms.hiddenUntil'

export interface RoomRowPost {
  /** Who wrote it; absent when the host didn't say. */
  by?: Identity
  mine: boolean
  /** A chat message's words, a note's title, or a file's name. Empty when it couldn't be read. */
  text: string
  kind: 'chat' | 'note' | 'file'
}

export interface RoomRow {
  /** The room's ID: unique among rows, and never a contact's key. */
  key: string
  roomId: string
  roomName: InertText
  /** An ID is shown as an ID ("Room 3f9a…"), never as if the community named it. */
  nameFrom: RoomSummary['nameFrom']
  communityDid: string
  communityName?: InertText
  /** The newest post's time; what Messages sorts by. Undefined for a room with no posts read yet. */
  lastActivityAt?: Date
  /** Posts by others after the newest one the member has seen. */
  unread: number
  lastPost?: RoomRowPost
  /** Its posts not read yet: the row says it is reading, not that there are none. */
  reading?: boolean
}

interface Track {
  newest: number
  seen: number
  /** Others' posts after `seen`: key → version. */
  unread: Map<string, number>
  last?: RoomRowPost
  at?: Date
  actingAs?: Identity
}

interface Feed {
  service?: RoomsService
  /** Every room read; `rows` leaves out the hidden ones. */
  all?: RoomRow[]
  rows?: RoomRow[]
  failed: boolean
  asking: boolean
  /** A read was asked for while one was out: it runs when that one ends. */
  again: boolean
  lastAsk: number
  /** How many Messages screens are in view: the poll runs only while one is. */
  inView: number
  listeners: Set<() => void>
}

const feed: Feed = { failed: false, asking: false, again: false, lastAsk: 0, inView: 0, listeners: new Set() }
// The app's log, from the poll: one line per read, so a tester's report says when the rows came and why not.
let log: ((line: string) => void) | undefined
// Per service, so another agent (and its service) starts with none.
let tracks = new WeakMap<RoomsService, Map<string, Track>>()

const hashOf = (roomId: string) => bytesToHex(sha256(utf8ToBytes(roomId))).slice(0, 16)

let seenVersions: Record<string, number> | undefined
let hiddenUntil: Record<string, number> | undefined
let seenRead: Promise<void> | undefined

const versionsAt = async (key: string): Promise<Record<string, number>> => {
  const versions: Record<string, number> = {}
  try {
    const raw = await AsyncStorage.getItem(key)
    const kept: unknown = raw ? JSON.parse(raw) : {}
    if (kept && typeof kept === 'object')
      for (const [k, v] of Object.entries(kept as Record<string, unknown>)) if (typeof v === 'number') versions[k] = v
  } catch {
    // Nothing kept, or not readable: start from nothing.
  }
  return versions
}

const readSeen = () =>
  (seenRead ??= (async () => {
    seenVersions = await versionsAt(ROOMS_SEEN_KEY)
    hiddenUntil = await versionsAt(ROOMS_HIDDEN_KEY)
  })())

// Written whole each time, never removed key by key: a room's entry goes by writing the rest.
const keep = async (key: string, versions: Record<string, number> | undefined) => {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(versions ?? {}))
  } catch {
    // Kept in memory for this run; a relaunch starts from what was last kept.
  }
}
const keepSeen = () => keep(ROOMS_SEEN_KEY, seenVersions)
const keepHidden = () => keep(ROOMS_HIDDEN_KEY, hiddenUntil)

const without = (versions: Record<string, number> | undefined, hash: string): Record<string, number> => {
  const { [hash]: _gone, ...rest } = versions ?? {}
  return rest
}

const publish = () => feed.listeners.forEach((listener) => listener())

const rowPostOf = (note: NoteSummary, actingAs: Identity | undefined): RoomRowPost => {
  const post = postOf(note, actingAs)
  const file = post.files[0]
  if (isNote(post)) return { by: post.author, mine: post.mine, text: String(post.title ?? ''), kind: 'note' }
  if (!String(post.text) && file) return { by: post.author, mine: post.mine, text: String(file.name), kind: 'file' }
  return { by: post.author, mine: post.mine, text: String(post.text), kind: 'chat' }
}

/** Reads one room: what came after the newest post already read, and the newest post in full when it changed. */
async function readRoom(service: RoomsService, room: RoomSummary, track: Track | undefined): Promise<Track> {
  const actingAs = track?.actingAs ?? (await service.getRoom(room.roomId)).actingAs
  const listing = await service.listNotes(room.roomId, track ? { sinceVersion: track.newest } : undefined)
  // A first listing that stopped early with nothing in it says nothing about the room: still unread, not empty. Only a
  // first read: a listing asked with `sinceVersion` is never complete (types.ts), so this on a refresh would leave every
  // room unread for ever. readAll catches it per room, so the other rooms read on.
  if (!track && listing.notes.length === 0 && !listing.complete) throw new Error('first listing stopped early')
  const kept = seenVersions?.[hashOf(room.roomId)]
  const next: Track = track
    ? { ...track, unread: new Map(track.unread) }
    : { newest: 0, seen: kept ?? Number.MAX_SAFE_INTEGER, unread: new Map(), actingAs }
  const standing = listing.notes.filter((n) => n.status !== 'retracted')
  for (const note of listing.notes) next.newest = Math.max(next.newest, note.version)
  // Met for the first time with nothing kept: seen up to its newest post.
  if (next.seen === Number.MAX_SAFE_INTEGER) {
    next.seen = next.newest
    seenVersions = { ...(seenVersions ?? {}), [hashOf(room.roomId)]: next.seen }
    void keepSeen()
  }
  for (const note of standing) {
    if (note.version <= next.seen) continue
    if (postOf(note, actingAs).mine) continue
    next.unread.set(note.key, note.version)
  }
  for (const note of listing.notes) if (note.status === 'retracted') next.unread.delete(note.key)
  // The newest of what came, read in full only if it is newer than the post the row shows: an edit to an older
  // post (a higher version, an earlier time) never takes the row back.
  const newest = newestFirst(standing)[0]
  const at = newest?.updatedAt ? new Date(newest.updatedAt) : undefined
  if (newest && (!next.at || !at || at.getTime() >= next.at.getTime())) {
    let read: NoteSummary = newest
    try {
      read = await service.readNote(room.roomId, newest.key)
    } catch {
      // Its listing entry says who and when; the words wait for a newer post.
    }
    next.last = rowPostOf(read, actingAs)
    next.at = at ?? next.at
  }
  return next
}

const rowOf = (room: RoomSummary & { communityDid: string }, track: Track | undefined): RoomRow => ({
  key: room.roomId,
  roomId: room.roomId,
  roomName: room.name,
  nameFrom: room.nameFrom,
  communityDid: room.communityDid,
  communityName: room.communityName,
  lastActivityAt: track?.at && !Number.isNaN(track.at.getTime()) ? track.at : undefined,
  unread: track?.unread.size ?? 0,
  lastPost: track?.last,
  ...(track ? {} : { reading: true }),
})

/**
 * Whether two rows read the same: the room and its community (the row reads names and petnames by the community, and
 * Messages' chips are built from it), its newest post, when, its unread and whether it is reading. `key` is the room's
 * ID.
 */
const sameRow = (a: RoomRow, b: RoomRow): boolean =>
  a.key === b.key &&
  a.communityDid === b.communityDid &&
  a.roomName === b.roomName &&
  a.communityName === b.communityName &&
  a.nameFrom === b.nameFrom &&
  !!a.reading === !!b.reading &&
  a.unread === b.unread &&
  a.lastActivityAt?.getTime() === b.lastActivityAt?.getTime() &&
  a.lastPost?.text === b.lastPost?.text &&
  a.lastPost?.kind === b.lastPost?.kind &&
  a.lastPost?.mine === b.lastPost?.mine &&
  a.lastPost?.by?.did === b.lastPost?.by?.did &&
  a.lastPost?.by?.identityWords === b.lastPost?.by?.identityWords

/**
 * The rows Messages shows: every room read but the hidden ones. A hidden room someone has posted in since is back,
 * and its entry goes.
 */
function showRows(service: RoomsService): void {
  const byRoom = tracks.get(service)
  let back = false
  feed.rows = (feed.all ?? []).filter((row) => {
    const hash = hashOf(row.roomId)
    const until = hiddenUntil?.[hash]
    if (until === undefined) return true
    if ((byRoom?.get(row.roomId)?.newest ?? 0) <= until) return false
    hiddenUntil = without(hiddenUntil, hash)
    back = true
    return true
  })
  if (back) void keepHidden()
}

const shown = (room: RoomSummary): room is RoomSummary & { communityDid: string } =>
  room.source === 'community' && room.standing === 'member' && !!room.communityDid

type Listed = (service: RoomsService, rooms: RoomSummary[]) => void
const listedListeners = new Set<Listed>()

/** Told of each listing of the member's rooms the poll reads, all of it, the rooms Messages leaves out included. */
export function onRoomsListed(listener: Listed): () => void {
  listedListeners.add(listener)
  return () => void listedListeners.delete(listener)
}

/** Reads every room once, one after another. A room that can't be read keeps what was read of it before. */
async function readAll(service: RoomsService): Promise<void> {
  feed.asking = true
  feed.lastAsk = Date.now()
  const began = feed.lastAsk
  try {
    await readSeen()
    const listed = await service.listMyRooms()
    if (feed.service === service)
      for (const listener of listedListeners) {
        try {
          listener(service, listed)
        } catch {
          // A listener's failure is its own; the rows read on.
        }
      }
    const rooms = listed.filter(shown)
    let byRoom = tracks.get(service)
    if (!byRoom) tracks.set(service, (byRoom = new Map()))
    const known = byRoom
    // Shown as listed, then again as each room is read: a slow agent delays a room's posts, never its row.
    // Messages and the tab's badge re-render on each publish, so a room whose row reads the same publishes nothing. A
    // failure shown before still clears: the read's `finally` publishes once it ends.
    const show = () => {
      const next = rooms.map((room) => rowOf(room, known.get(room.roomId)))
      const before = feed.all
      feed.failed = false
      if (before && next.length === before.length && next.every((row, i) => sameRow(row, before[i]))) return
      feed.all = next
      showRows(service)
      publish()
    }
    if (feed.service !== service) return
    show()
    for (const room of rooms) {
      if (feed.service !== service) return
      try {
        byRoom.set(room.roomId, await readRoom(service, room, byRoom.get(room.roomId)))
      } catch {
        // The next read tries again.
      }
      if (feed.service !== service) return
      show()
    }
    const reading = (feed.all ?? []).filter((row) => row.reading).length
    log?.(`[Rooms:rows] ${rooms.length} rooms listed, ${reading} not read yet, in ${Date.now() - began} ms`)
    retrySoon(service, reading > 0)
  } catch {
    if (feed.service === service) {
      log?.(`[Rooms:rows] the rooms were not listed (${Date.now() - began} ms); the rows read before stay`)
      feed.failed = true
      retrySoon(service, true)
    }
  } finally {
    feed.asking = false
    publish()
    if (feed.again) {
      feed.again = false
      refreshRoomRows()
    }
  }
}

const retry: { timer?: ReturnType<typeof setTimeout>; tries: number; pending?: boolean } = { tries: 0 }

/**
 * After a read that left a room unread, or failed, reads again after the next of {@link ROWS_RETRY_MS}; after the
 * last, it waits for the usual moments. A read that has every room read starts the count again. A retry due while a
 * read is out reads nothing and isn't counted: that read ends by arming the next retry itself, so a retry never queues
 * a read behind one that has just done its work (an ask does: {@link refreshRoomRows}). One due while the app is away reads
 * nothing and waits, with no timer, for the app to come back, which then reads at once (no return floor) and counts it:
 * a cold launch sent straight to the background still has its retries, and nothing wakes the app while it is away.
 */
function retrySoon(service: RoomsService, needed: boolean): void {
  if (retry.timer) clearTimeout(retry.timer)
  retry.timer = undefined
  if (!needed) {
    retry.tries = 0
    return
  }
  if (retry.tries >= ROWS_RETRY_MS.length) return
  const delay = ROWS_RETRY_MS[retry.tries]
  const due = () => {
    retry.timer = undefined
    if (feed.service !== service || feed.asking) return
    if (AppState.currentState !== 'active') {
      retry.pending = true
      return
    }
    retry.tries++
    refreshRoomRows()
  }
  retry.timer = setTimeout(due, delay)
}

const stopRetrying = () => {
  if (retry.timer) clearTimeout(retry.timer)
  retry.timer = undefined
  retry.tries = 0
  retry.pending = false
}

/** Coming back to the app: a retry that came due while away reads now, else a read unless the last is recent. */
const readOnReturn = () => {
  if (!retry.pending) return refreshRoomRows(ROWS_RETURN_FLOOR_MS)
  retry.pending = false
  retry.tries++
  refreshRoomRows()
}

/** The two-minute read, and the same read when a skipped community can be read: only in view, with the app open. */
const readInView = () => {
  if (feed.inView > 0 && AppState.currentState === 'active') refreshRoomRows()
}

/**
 * The agent is back: a read that failed or left a room unread reads now rather than at its retry, and one still out
 * reads again when it ends, since it may have gone to the session just replaced. Rows all read ask nothing.
 */
const readOnAgentBack = () => {
  if (AppState.currentState !== 'active') return
  if (feed.asking || feed.failed || feed.all?.some((row) => row.reading)) refreshRoomRows()
}

/** Reads again, unless the last one is under `floor` old. With one out, again once it ends. */
export function refreshRoomRows(floor = 0): void {
  const service = feed.service
  if (!service) return
  if (Date.now() - feed.lastAsk < floor) return
  if (feed.asking) {
    feed.again = true
    return
  }
  void readAll(service)
}

/**
 * The room screen tells the rows the newest post it has shown: the posts up to it are seen. Kept on this phone, so
 * the count is right after a relaunch too.
 */
export function markRoomSeen(service: RoomsService | undefined, roomId: string, version: number): void {
  if (!service || service !== feed.service) return
  const track = tracks.get(service)?.get(roomId)
  const before = seenVersions?.[hashOf(roomId)] ?? 0
  if (version <= before && (!track || version <= track.seen)) return
  seenVersions = { ...(seenVersions ?? {}), [hashOf(roomId)]: Math.max(version, before) }
  void keepSeen()
  if (!track) return
  track.seen = Math.max(track.seen, version)
  for (const [key, v] of [...track.unread]) if (v <= track.seen) track.unread.delete(key)
  recount(service, roomId, track)
}

function recount(service: RoomsService, roomId: string, track: Track): void {
  feed.all = feed.all?.map((row) => (row.roomId === roomId ? { ...row, unread: track.unread.size } : row))
  showRows(service)
  publish()
}

/**
 * Hide: takes a room off Messages until someone posts in it again (rooms in Messages, R3). Put away as read: when it
 * comes back, only what came after counts. Kept on this phone. The room stays under My Agent and on its community.
 * Returns the Undo, which puts back exactly what was there.
 */
/** Whether Messages has this room as a row, so that hiding it there means something. */
export const canHideRoom = (roomId: string): boolean => {
  const service = feed.service
  return !!service && !!tracks.get(service)?.has(roomId)
}

export function hideRoom(roomId: string): (() => void) | undefined {
  const service = feed.service
  const track = service ? tracks.get(service)?.get(roomId) : undefined
  if (!service || !track) return undefined
  const hash = hashOf(roomId)
  const before = { hidden: hiddenUntil?.[hash], seen: track.seen, kept: seenVersions?.[hash], unread: track.unread }
  hiddenUntil = { ...(hiddenUntil ?? {}), [hash]: track.newest }
  track.seen = Math.max(track.seen, track.newest)
  track.unread = new Map()
  seenVersions = { ...(seenVersions ?? {}), [hash]: track.seen }
  void keepHidden()
  void keepSeen()
  recount(service, roomId, track)
  return () => {
    hiddenUntil = before.hidden === undefined ? without(hiddenUntil, hash) : { ...hiddenUntil, [hash]: before.hidden }
    seenVersions = before.kept === undefined ? without(seenVersions, hash) : { ...seenVersions, [hash]: before.kept }
    track.seen = before.seen
    track.unread = before.unread
    void keepHidden()
    void keepSeen()
    if (feed.service === service) recount(service, roomId, track)
  }
}

/** For tests: forget everything read and kept in memory. */
export function resetRoomRows(): void {
  feed.service = undefined
  feed.all = undefined
  feed.rows = undefined
  feed.failed = false
  feed.asking = false
  feed.again = false
  feed.lastAsk = 0
  feed.inView = 0
  log = undefined
  tracks = new WeakMap()
  stopRetrying()
  seenVersions = undefined
  hiddenUntil = undefined
  seenRead = undefined
}

const subscribe = (listener: () => void) => {
  feed.listeners.add(listener)
  return () => void feed.listeners.delete(listener)
}

/**
 * The one poll, from the tab navigator: starts reading when an agent is linked and the rooms flag is on (a service
 * exists), reads again on coming back to the app, every {@link ROWS_POLL_MS} while Messages is in view, and when the
 * agent is back or a skipped community can be read. Told, not watched in a render: the tab navigator stays as it is.
 */
export function useRoomRowsPoll(
  service: RoomsService | undefined,
  linked: boolean,
  logLine?: (line: string) => void
): void {
  useEffect(() => {
    log = logLine
  }, [logLine])

  useEffect(() => {
    const next = service && linked ? service : undefined
    if (feed.service === next) return
    feed.service = next
    stopRetrying()
    feed.all = undefined
    feed.rows = undefined
    feed.failed = false
    feed.lastAsk = 0
    publish()
    if (next) refreshRoomRows()
  }, [service, linked])

  useEffect(() => service?.onReadable?.(readInView), [service])

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') readOnReturn()
    })
    const timer = setInterval(readInView, ROWS_POLL_MS)
    const stopWatching = onSessionOpened(readOnAgentBack)
    return () => {
      sub?.remove()
      clearInterval(timer)
      stopWatching()
      // Nothing scheduled outlives the poll: a retry due after it unmounts would read for no one.
      stopRetrying()
    }
  }, [])
}

export interface RoomRows {
  /** Empty until the first read answers, and when no agent is linked or the rooms flag is off. */
  rows: readonly RoomRow[]
  /** Reads again at once (pull to refresh). */
  reload(): void
  /** The last read of the member's rooms failed; the rows read before stay. */
  failed: boolean
}

const NO_ROWS: readonly RoomRow[] = []

/** The rows, for Messages: in view, it reads again (within a floor) and keeps the poll going. */
export function useRoomRows(): RoomRows {
  const rows = useSyncExternalStore(subscribe, () => feed.rows ?? NO_ROWS)
  const failed = useSyncExternalStore(subscribe, () => feed.failed)
  useFocusEffect(
    useCallback(() => {
      feed.inView++
      refreshRoomRows(ROWS_FOCUS_FLOOR_MS)
      return () => {
        feed.inView = Math.max(0, feed.inView - 1)
      }
    }, [])
  )
  const reload = useCallback(() => refreshRoomRows(), [])
  return { rows, reload, failed }
}

/** What the rooms add to the Messages tab's badge: their posts by others the member hasn't seen. */
export function useRoomsUnreadCount(): number {
  return useSyncExternalStore(subscribe, () => (feed.rows ?? NO_ROWS).reduce((sum, row) => sum + row.unread, 0))
}
