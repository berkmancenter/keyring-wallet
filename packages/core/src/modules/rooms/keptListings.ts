import { DeviceEventEmitter } from 'react-native'

import { WALLET_LOCKED_EVENT } from '../../utils/walletLocked'

/**
 * Each room's last listing, kept in memory while the app runs, so a room opened again shows its posts at once and
 * reads what is new behind them (`useRoomPosts`). Every opening waited for a full listing first, the same room's of a
 * moment before included (11-17). What is kept is the listing (each record's key, version and metadata), never a post's
 * words: those come from the service's own opened records, as before, which a lock drops as it drops these.
 *
 * Per service, so another agent (and its service) keeps none of these; per room; at most {@link KEPT_LISTINGS_MAX}
 * rooms, the one used longest ago going first. Nothing is written to the phone. A lock forgets them all, and a room
 * whose listing fails is forgotten (left since, or no longer readable).
 *
 * Two values a release (an OTA included) sets, and nothing else, as for `liveDeliverySwitch.ts`:
 * - `on`: the release's choice.
 * - `remoteOff`: the release's kill. Set it to `true` and every room opens on a full listing again, keeping nothing,
 *   for everyone at the next start, whatever `on` says, until a release sets it back.
 *
 * KILL RECIPE (no kill PR is kept open): branch from current main, set `remoteOff: true` below (one line), and publish
 * it by OTA. Both are Alberto's.
 *
 * Nothing a person does changes either value; it is read at each opening and each keeping, never cached. It fails
 * closed: anything but both values as booleans, `on` true and `remoteOff` false, reads as off.
 *
 * Tests flip the entries and must put them back.
 *
 * @module rooms/keptListings
 */
export const ROOMS_KEPT_LISTINGS: { on: boolean; remoteOff: boolean } = {
  on: true,
  remoteOff: false,
}

/** Whether a room may open on its last listing now: switched on, and not turned off. */
export function isKeptListingsOn(): boolean {
  return ROOMS_KEPT_LISTINGS.on === true && ROOMS_KEPT_LISTINGS.remoteOff === false
}

/** How many rooms' listings are kept at most. */
export const KEPT_LISTINGS_MAX = 32

let kept = new WeakMap<object, Map<string, unknown>>()
let hearingLock = false

const dropAll = () => {
  kept = new WeakMap()
}

/** The room's last listing kept for `service`, when one is and the switch is on. */
export function keptListing<T>(service: object | undefined, roomId: string): T | undefined {
  if (!service || !isKeptListingsOn()) return undefined
  const byRoom = kept.get(service)
  const listing = byRoom?.get(roomId)
  if (listing === undefined || !byRoom) return undefined
  // Used now: it goes last.
  byRoom.delete(roomId)
  byRoom.set(roomId, listing)
  return listing as T
}

/** Keeps the room's listing for `service`, when the switch is on. */
export function keepListing(service: object | undefined, roomId: string, listing: unknown): void {
  if (!service || !isKeptListingsOn()) return
  if (!hearingLock) {
    hearingLock = true
    DeviceEventEmitter.addListener(WALLET_LOCKED_EVENT, dropAll)
  }
  let byRoom = kept.get(service)
  if (!byRoom) kept.set(service, (byRoom = new Map()))
  byRoom.delete(roomId)
  byRoom.set(roomId, listing)
  while (byRoom.size > KEPT_LISTINGS_MAX) byRoom.delete(byRoom.keys().next().value as string)
}

/** Forgets the room's listing for `service`: it could not be read again. */
export function dropKeptListing(service: object | undefined, roomId: string): void {
  if (service) kept.get(service)?.delete(roomId)
}

/** For tests: forget every listing kept. */
export function resetKeptListings(): void {
  dropAll()
}
