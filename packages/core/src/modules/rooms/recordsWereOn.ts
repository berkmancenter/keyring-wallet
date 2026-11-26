/**
 * The rooms where this phone saw replies and reactions on, so that a room which stops taking them can say so ("were on
 * in this room and are off now") instead of "aren't on in this room yet", which is wrong for a room where they were.
 *
 * Kept per room and member: the room epoch at which a current profile last permitted them, nothing else. A community
 * that drops the profile's `recordMembers` (an admin's choice, or a details edit that doesn't carry them over) turns them
 * off; which of those it was, the app can't tell, so the words name no cause.
 *
 * Kept as short hashes, as `roomAccess` keeps rooms: the member's room IDs stay out of the app's storage in plain form.
 * No secret from anyone holding the community's list of rooms.
 *
 * Fails closed by doing nothing: it only changes which words say "not on", never whether anything is sent. A store that
 * can't be read reads as empty, so a room says today's words; one that can't be written is kept in memory for this run.
 *
 * @module rooms/recordsWereOn
 */
import AsyncStorage from '@react-native-async-storage/async-storage'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'

/** Where the rooms seen taking replies or reactions are kept. */
export const RECORDS_ON_KEPT_KEY = 'rooms.recordsWereOn'

/** The most rooms kept: the oldest are let go first. */
export const RECORDS_ON_KEPT_MAX = 300

/** Per hashed room and member: the epoch replies or reactions were last seen on at, or null where none was known. */
type Kept = Record<string, number | null>

const hash = (roomId: string, member: string) => bytesToHex(sha256(utf8ToBytes(`${roomId}\n${member}`))).slice(0, 16)

let kept: Kept | undefined
let reading: Promise<Kept> | undefined
// One change at a time, so two reads arriving together can't each write over the other's.
let turn: Promise<unknown> = Promise.resolve()

const readKept = (): Promise<Kept> =>
  (reading ??= (async () => {
    try {
      const raw: unknown = await AsyncStorage.getItem(RECORDS_ON_KEPT_KEY)
      const value: unknown = typeof raw === 'string' && raw ? JSON.parse(raw) : {}
      const read: Kept = {}
      if (value && typeof value === 'object' && !Array.isArray(value))
        for (const [k, v] of Object.entries(value as Record<string, unknown>))
          if (v === null || (typeof v === 'number' && Number.isInteger(v) && v >= 0)) read[k] = v
      kept = read
    } catch {
      kept = {}
    }
    return kept
  })())

/** The epoch this room's replies or reactions were last seen on at (null: on, epoch unknown); undefined: never seen on. */
export async function recordsWereOnAt(roomId: string, member: string): Promise<number | null | undefined> {
  const now = await readKept()
  const at = now[hash(roomId, member)]
  return at === undefined ? undefined : at
}

/** Keeps that this room's replies or reactions are on at `epoch`. Writes only on a change. */
export function keepRecordsOn(roomId: string, member: string, epoch: number | undefined): Promise<void> {
  const next = turn.then(async () => {
    const now = await readKept()
    const k = hash(roomId, member)
    const at = epoch ?? null
    if (k in now && now[k] === at) return
    // Re-added last, so the cap lets go of the rooms seen on longest ago.
    const { [k]: _drop, ...rest } = now
    const entries = Object.entries({ ...rest, [k]: at }).slice(-RECORDS_ON_KEPT_MAX)
    kept = Object.fromEntries(entries)
    reading = Promise.resolve(kept)
    try {
      await AsyncStorage.setItem(RECORDS_ON_KEPT_KEY, JSON.stringify(kept))
    } catch {
      // Kept in memory for this run; after a relaunch the room says today's words until it is seen on again.
    }
  })
  turn = next.catch(() => undefined)
  return next
}

/** For tests: read the store again. */
export function resetRecordsOnKept(): void {
  kept = undefined
  reading = undefined
  turn = Promise.resolve()
}
