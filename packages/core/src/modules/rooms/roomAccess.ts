/**
 * Which room access notice to say, if any (room notices, batch 2): access ending soon, and access gone.
 *
 * Nothing announces either to a member's phone. The community's record of the member's rooms, which the rows poll
 * already lists (useRoomRows, at start, on return and on Messages coming into view), carries both: each room's
 * `validUntil`, and a removed member's room stays listed as removed. An entry that expires is set to removed by the
 * community too, so a room past its `validUntil` is gone whichever the record says yet.
 *
 * - Ending: at 7 days left (a room with 2 to 7 calendar days to go), and again at 1 (today or tomorrow). Each once
 *   per room and `validUntil`, so a renewal that later nears its end again is said again. A room first met with a
 *   day left says only that one.
 * - Gone: a room this phone has seen as a member, now removed or past its end. Said once. A room first met already
 *   gone (a fresh install, a new phone) says nothing: there is no change to tell.
 *
 * A room missing from a listing is not gone. Only a room listed as removed, or listed past its end, is: a listing that
 * comes back short (a community that didn't answer, as acl/list did in 276) must never say "You no longer have
 * access". So this never compares a listing with the one before it.
 *
 * Only a community's rooms: a room known from the agent's own keys alone has no record, so no end and no standing.
 * One notice at a time, the most pressing kind: the rooms gone, else those ending. A kind left unsaid waits for the
 * next listing.
 *
 * What is kept on this phone, as short hashes: the rooms seen as members, and the notices said. The hashes keep a plain
 * list of the member's room IDs out of the app's storage, against a casual look at it or a device transfer. They are
 * no secret from anyone who holds the community's list of rooms: 64 bits of a known ID can be matched by trying each.
 *
 * @module rooms/roomAccess
 */
import AsyncStorage from '@react-native-async-storage/async-storage'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'

import { startOfLocalDay, wholeDaysBetween } from '../../utils/localDay'

import type { RoomSummary } from './types'

/** Where the rooms seen as members, and the access notices said, are kept. */
export const ACCESS_KEPT_KEY = 'rooms.accessNotices'

/** The most kept of each: the oldest are let go first. */
export const ACCESS_KEPT_MAX = 300

export interface AccessKept {
  /** Rooms seen as members, not yet said gone. */
  known: string[]
  /** Ending notices said, per room, threshold and end. */
  said: string[]
}

export type AccessNotice =
  | { kind: 'gone'; rooms: { room: RoomSummary; ended: boolean }[] }
  | { kind: 'ending'; rooms: { room: RoomSummary; days: number }[] }

const hash = (text: string) => bytesToHex(sha256(utf8ToBytes(text))).slice(0, 16)
const capped = (list: string[]) => list.slice(-ACCESS_KEPT_MAX)

/** Calendar days from today to the day access ends (0: today). Undefined when no end is known. */
export function daysLeft(validUntil: string | undefined, now: Date): number | undefined {
  if (!validUntil) return undefined
  const until = new Date(validUntil)
  if (Number.isNaN(until.getTime())) return undefined
  return wholeDaysBetween(startOfLocalDay(now), startOfLocalDay(until))
}

const ended = (room: RoomSummary, now: Date) => {
  const until = room.validUntil ? new Date(room.validUntil).getTime() : NaN
  return !Number.isNaN(until) && until <= now.getTime()
}

/** The notice to say for this listing, and what is kept once it is said. Pure: the caller keeps `kept`. */
export function accessNoticeFor(
  rooms: RoomSummary[],
  now: Date,
  kept: AccessKept
): { notice?: AccessNotice; kept: AccessKept } {
  const known = new Set(kept.known)
  const said = new Set(kept.said)
  const gone: { room: RoomSummary; ended: boolean }[] = []
  const ending: { room: RoomSummary; days: number; marks: string[] }[] = []

  for (const room of rooms) {
    if (room.source !== 'community') continue
    const id = hash(room.roomId)
    const isEnded = ended(room, now)
    if (room.standing === 'removed' || isEnded) {
      if (known.has(id)) gone.push({ room, ended: isEnded })
      continue
    }
    known.add(id)
    const days = daysLeft(room.validUntil, now)
    if (days === undefined || days > 7) continue
    const at7 = hash(`${room.roomId}:7:${room.validUntil}`)
    const at1 = hash(`${room.roomId}:1:${room.validUntil}`)
    if (days <= 1 && !said.has(at1)) ending.push({ room, days, marks: [at1, at7] })
    else if (days > 1 && !said.has(at7)) ending.push({ room, days, marks: [at7] })
  }

  if (gone.length > 0) {
    // Said once by leaving `known`, not by joining `said`: a room admitted again is known again, and its next
    // removal is said. Marking it said instead would silence that.
    const goneIds = new Set(gone.map(({ room }) => hash(room.roomId)))
    return {
      notice: { kind: 'gone', rooms: gone },
      kept: { known: capped([...known].filter((id) => !goneIds.has(id))), said: kept.said },
    }
  }
  if (ending.length > 0)
    return {
      notice: { kind: 'ending', rooms: ending.map(({ room, days }) => ({ room, days })) },
      kept: { known: capped([...known]), said: capped([...said, ...ending.flatMap(({ marks }) => marks)]) },
    }
  return { kept: { known: capped([...known]), said: kept.said } }
}

let kept: AccessKept | undefined
let reading: Promise<void> | undefined
// One listing at a time, so two arriving together can't both say the same notice.
let turn: Promise<unknown> = Promise.resolve()

const readKept = () =>
  (reading ??= (async () => {
    try {
      const raw = await AsyncStorage.getItem(ACCESS_KEPT_KEY)
      const value: unknown = raw ? JSON.parse(raw) : {}
      const list = (v: unknown) => (Array.isArray(v) ? v.filter((h): h is string => typeof h === 'string') : [])
      const record = (value ?? {}) as Record<string, unknown>
      kept = { known: list(record.known), said: list(record.said) }
    } catch {
      kept = { known: [], said: [] }
    }
  })())

/** The notice for this listing, if any, now kept as said. */
export function nextAccessNotice(rooms: RoomSummary[], now: Date = new Date()): Promise<AccessNotice | undefined> {
  const next = turn.then(async () => {
    await readKept()
    const result = accessNoticeFor(rooms, now, kept ?? { known: [], said: [] })
    const changed = JSON.stringify(result.kept) !== JSON.stringify(kept)
    kept = result.kept
    if (changed) {
      try {
        await AsyncStorage.setItem(ACCESS_KEPT_KEY, JSON.stringify(kept))
      } catch {
        // Kept in memory for this run; a relaunch may say a notice once more.
      }
    }
    return result.notice
  })
  turn = next.catch(() => undefined)
  return next
}

/** For tests: read the kept lists again. */
export function resetAccessKept(): void {
  kept = undefined
  reading = undefined
  turn = Promise.resolve()
}
