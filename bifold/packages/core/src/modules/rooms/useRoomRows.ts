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
 * A room can be hidden from Messages until someone posts in it again ({@link hideRoom}), or until the member shows it
 * again ({@link showRoom}); that is kept on this phone the same way.
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
import { failureCategory, logRef } from './roomsLogWords'
import { isNote, newestFirst, placeOf, postOf } from './roomPosts'
import type { Identity, NoteSummary, RoomsService, RoomSummary } from './types'

/** While Messages is in view: about the offers poll's idle pace, never faster. */
export const ROWS_POLL_MS = 120_000
/** How many of a room's newest records are read to find what its row shows, when the newest are shown nowhere. */
const ROW_READS_MAX = 5
/** Coming back to the app reads again, unless the last read is this recent. */
export const ROWS_RETURN_FLOOR_MS = 60_000
/** Messages coming into view reads again, unless the last read is this recent. */
export const ROWS_FOCUS_FLOOR_MS = 10_000
/** After a read that left a room unread, or failed: read again after each of these in turn, then wait as usual. */
export const ROWS_RETRY_MS = [15_000, 30_000, 60_000] as const
/**
 * How many of Messages' rooms are watched at their hosts (live delivery, `real/roomWatches.ts`): the most recently
 * active, while Messages is in view. The rest are read at {@link ROWS_POLL_MS} as before. An agent holds 64 watches a
 * member and 256 in all; 32 leaves the room screen and other clients room (Alberto's word, L2, 11-11).
 */
export const ROWS_WATCHED_MAX = 32

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
  /** A sealed room not joined yet (`RoomSummary.joined`): never read, and the row says so rather than reading. */
  notJoined?: boolean
}

interface Track {
  newest: number
  seen: number
  /** Others' posts after `seen`: key → version. */
  unread: Map<string, number>
  last?: RoomRowPost
  /** The record `last` came from: if its author takes it back, the row stops quoting it. */
  lastKey?: string
  at?: Date
  actingAs?: Identity
}

interface Feed {
  service?: RoomsService
  /** Every room read; `rows` leaves out the hidden ones. */
  all?: RoomRow[]
  rows?: RoomRow[]
  /** The rows in `all` kept from a community the last listing skipped for now, by room ID: shown, never read. */
  keptRooms: Set<string>
  failed: boolean
  asking: boolean
  /** A read was asked for while one was out: it runs when that one ends. */
  again: boolean
  lastAsk: number
  /** How many Messages screens are in view: the poll runs only while one is. */
  inView: number
  listeners: Set<() => void>
  /** The rooms the last listing showed, by room ID: a signal reads one of them alone. */
  listed?: Map<string, RoomSummary & { communityDid: string }>
  /** Rooms being read alone on a signal: one at a time each. */
  readingAlone: Set<string>
  /**
   * Rooms signalled while a read of every room was out: read alone once it ends. That read may have read the room
   * before its change, and the signal is spent (one arming, one signal), so dropping it would leave the change to the
   * next two-minute read.
   */
  signalledWhileReading: Set<string>
}

const feed: Feed = {
  keptRooms: new Set(),
  failed: false,
  asking: false,
  again: false,
  lastAsk: 0,
  inView: 0,
  listeners: new Set(),
  readingAlone: new Set(),
  signalledWhileReading: new Set(),
}
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
  // A record shown nowhere (a reaction, a withdrawn message) is not the row's: the last thing that is shows instead, or
  // what the row had. A listing's entry can't tell one on a sealed room, so it takes a read each, a few at most.
  for (const candidate of newestFirst(standing).slice(0, ROW_READS_MAX)) {
    const at = candidate.updatedAt ? new Date(candidate.updatedAt) : undefined
    if (next.at && at && at.getTime() < next.at.getTime()) break
    let read: NoteSummary = candidate
    try {
      read = await service.readNote(room.roomId, candidate.key)
    } catch {
      // Its listing entry says who and when; the words wait for a newer post.
    }
    const post = postOf(read, actingAs)
    if (placeOf(post) === 'nowhere') {
      if (candidate.key === next.lastKey) {
        next.last = undefined
        next.lastKey = undefined
      }
      continue
    }
    next.last = rowPostOf(read, actingAs)
    next.lastKey = candidate.key
    next.at = at ?? next.at
    break
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
  ...(room.joined === false ? { notJoined: true } : track ? {} : { reading: true }),
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
  !!a.notJoined === !!b.notJoined &&
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
    if (feed.service === service) feed.listed = new Map(rooms.map((room) => [room.roomId, room]))
    // A community this listing skipped for now (a step kept its session as another identity: `heldBack`) keeps the
    // rows already read of it, as they were, until a listing reads it again. Without them its rooms and its chip went
    // from Messages at every such listing, so two communities seldom showed together (1 listing in 12, 277.11). By the
    // community's DID, whichever it is. Nothing more is asked for them: they are shown, not read.
    const skipped = new Set((service.heldBack?.() ?? []).map((c) => c.communityDid))
    const listedIds = new Set(rooms.map((room) => room.roomId))
    let byRoom = tracks.get(service)
    if (!byRoom) tracks.set(service, (byRoom = new Map()))
    const known = byRoom
    // Shown as listed, then again as each room is read: a slow agent delays a room's posts, never its row.
    // Messages and the tab's badge re-render on each publish, so a room whose row reads the same publishes nothing. A
    // failure shown before still clears: the read's `finally` publishes once it ends.
    const show = () => {
      const kept = (feed.all ?? []).filter((row) => skipped.has(row.communityDid) && !listedIds.has(row.roomId))
      feed.keptRooms = new Set(kept.map((row) => row.roomId))
      const next = [...rooms.map((room) => rowOf(room, known.get(room.roomId))), ...kept]
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
      // Not joined: there are no keys to read it with, and asking again every poll only fails again.
      if (room.joined === false) continue
      try {
        byRoom.set(room.roomId, await readRoom(service, room, byRoom.get(room.roomId)))
      } catch (e) {
        // The next read tries again. Why it did not read is said, by kind only: a row that stayed "reading" through a
        // whole report said nothing of why (34VR-Y58H, 11-03).
        log?.(`[Rooms:rows] ${logRef(room.roomId)} of ${logRef(room.communityDid)} not read: ${failureCategory(e)}`)
      }
      if (feed.service !== service) return
      show()
    }
    if (feed.service === service) watchActive(service)
    // A kept row is not this listing's: it neither asks a retry nor counts as not read, as it did not when it went.
    const reading = (feed.all ?? []).filter((row) => row.reading && !feed.keptRooms.has(row.roomId)).length
    const keptLine = feed.keptRooms.size > 0 ? `, ${feed.keptRooms.size} kept as read before` : ''
    log?.(`[Rooms:rows] ${rooms.length} rooms listed, ${reading} not read yet${keptLine}, in ${Date.now() - began} ms`)
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
      // The read asked for reads every room; what was signalled meanwhile waits for it to end, then reads alone.
      refreshRoomRows()
    } else readSignalledWhileReading(service)
  }
}

/** The rooms signalled during a read of every room, each read alone now that it has ended (readOneOnSignal). */
function readSignalledWhileReading(service: RoomsService): void {
  if (feed.service !== service) return
  const signalled = [...feed.signalledWhileReading]
  feed.signalledWhileReading.clear()
  for (const roomId of signalled) void readOneOnSignal(service, roomId)
}

/**
 * While Messages is in view, the {@link ROWS_WATCHED_MAX} most recently active rooms read are armed at their hosts, from
 * the newest version read, so a post in one reaches its row on the agent's signal rather than at the next two-minute
 * read. Arming one already armed from that version sends nothing (roomWatches). Where the agent, the host or the release
 * switch can't watch, nothing is armed and the rows read as before.
 *
 * The cap bounds what each call arms, not what stays armed: a room that leaves the top ones, or Messages closing, leaves
 * its watch to lapse at its lease (a week) or fire once. Past the agent's 64 a member, it refuses with `limitReached`
 * and that room is polled (roomWatches), so the cost of a residue is polling, never a missed post.
 */
function watchActive(service: RoomsService): void {
  if (!service.watchRoom || feed.inView === 0 || AppState.currentState !== 'active') return
  const byRoom = tracks.get(service)
  if (!byRoom) return
  const active = [...(feed.listed?.keys() ?? [])]
    .flatMap((roomId) => {
      const track = byRoom.get(roomId)
      return track ? [{ roomId, track }] : []
    })
    .sort((a, b) => (b.track.at?.getTime() ?? -Infinity) - (a.track.at?.getTime() ?? -Infinity))
    .slice(0, ROWS_WATCHED_MAX)
  for (const { roomId, track } of active) service.watchRoom(roomId, track.newest)
}

/**
 * A room's watch said it changed: read that room alone, show its row, and arm it again from what was read. One read at a
 * time for each room. While a read of every room is out, the room is kept and read alone once that read ends, as any
 * read asked for meanwhile is (`feed.again`): the pass may already have read it before the change.
 *
 * A signal is acted on whenever it comes, Messages in view or not, for as long as the watch armed in view lasts: it
 * costs one read of a room the member is in. A read that fails leaves the room unarmed, on the two-minute read, which
 * arms it again in view (watchActive); nothing retries it sooner.
 */
async function readOneOnSignal(service: RoomsService, roomId: string): Promise<void> {
  const room = feed.listed?.get(roomId)
  const byRoom = tracks.get(service)
  if (feed.service !== service || !room || !byRoom) return
  // Kept, never dropped: the signal is spent, so a change it names would otherwise wait for the two-minute read. During
  // a pass, the pass's end reads it; during this room's own read (a read lane that runs reads side by side lets a pass
  // re-arm it meanwhile), that read's end does.
  if (feed.asking || feed.readingAlone.has(roomId)) {
    feed.signalledWhileReading.add(roomId)
    return
  }
  if (room.joined === false) return
  feed.readingAlone.add(roomId)
  try {
    const track = await readRoom(service, room, byRoom.get(roomId))
    if (feed.service !== service) return
    byRoom.set(roomId, track)
    const all = feed.all ?? []
    const at = all.findIndex((row) => row.roomId === roomId)
    if (at >= 0) {
      const next = rowOf(room, track)
      if (!sameRow(next, all[at])) {
        feed.all = [...all.slice(0, at), next, ...all.slice(at + 1)]
        showRows(service)
        publish()
      }
    }
    service.watchRoom?.(roomId, track.newest)
  } catch (e) {
    log?.(`[Rooms:rows] ${logRef(roomId)} not read on its signal: ${failureCategory(e)}`)
  } finally {
    feed.readingAlone.delete(roomId)
    // Signalled again while this read was out, and no pass is out to read it: read it again now.
    if (!feed.asking && feed.service === service && feed.signalledWhileReading.delete(roomId))
      void readOneOnSignal(service, roomId)
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
  if (feed.asking || feed.failed || feed.all?.some((row) => row.reading && !feed.keptRooms.has(row.roomId)))
    refreshRoomRows()
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

/**
 * Show: puts a hidden room back on Messages now, rather than at the next post (tester feedback, 11-02: there was no
 * way back). What was put away as read stays read. False when the room isn't hidden.
 */
export function showRoom(roomId: string): boolean {
  const hash = hashOf(roomId)
  if (hiddenUntil?.[hash] === undefined) return false
  hiddenUntil = without(hiddenUntil, hash)
  void keepHidden()
  const service = feed.service
  if (service) showRows(service)
  publish()
  return true
}

/** Whether the member hid this room from Messages and nobody has posted in it since. */
export const isRoomHidden = (roomId: string): boolean => hiddenUntil?.[hashOf(roomId)] !== undefined

/** {@link isRoomHidden}, kept current for a screen. */
export function useRoomHidden(roomId: string): boolean {
  return useSyncExternalStore(subscribe, () => isRoomHidden(roomId))
}

/** How many of the member's rooms Messages leaves out because they are hidden: for its "rooms hidden" line. */
export function useHiddenRoomCount(): number {
  return useSyncExternalStore(subscribe, () => (feed.all ?? NO_ROWS).filter((row) => isRoomHidden(row.roomId)).length)
}

/** For tests: forget everything read and kept in memory. */
export function resetRoomRows(): void {
  feed.service = undefined
  feed.all = undefined
  feed.rows = undefined
  feed.keptRooms = new Set()
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
    feed.keptRooms = new Set()
    feed.listed = undefined
    feed.readingAlone = new Set()
    feed.signalledWhileReading = new Set()
    feed.failed = false
    feed.lastAsk = 0
    publish()
    if (next) refreshRoomRows()
  }, [service, linked])

  useEffect(() => service?.onReadable?.(readInView), [service])

  // A watched room's change, told by the agent: that row reads at once (watchActive arms them).
  useEffect(() => {
    if (!service || !linked) return
    return service.onRoomChanged?.((roomId) => void readOneOnSignal(service, roomId))
  }, [service, linked])

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
