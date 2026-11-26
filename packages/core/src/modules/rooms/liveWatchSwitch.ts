/**
 * Whether the room on screen is watched live (`rooms/keys/watch/0.2`, `real/roomWatches.ts`): two values a release (an
 * OTA included) sets, and nothing else, as `liveDeliverySwitch.ts`.
 *
 * A one-shot watch signals once and is armed again after each read. A live watch signals every change, at most one a
 * second, for as long as the phone renews it (about once a minute), so a room used as a conversation needs no arming
 * between messages. A host arms one only where the room's signal delay is `none`; everywhere else the one-shot watch is
 * kept, exactly as before this switch existed.
 *
 * - `on`: the release's choice.
 * - `remoteOff`: the release's kill. Set it to `true` and no live watch is asked for or renewed for everyone at the
 *   next start, whatever `on` says: every room is watched one signal at a time again. A live watch already at a host
 *   lapses within two minutes of its last renewal.
 *
 * KILL RECIPE (no kill PR is kept open): branch from current main, set `remoteOff: true` below (one line), and publish
 * it by OTA. Both are Alberto's.
 *
 * Nothing is saved on the phone and nothing a person does changes either value; it is read at each arming, never
 * cached. It fails closed: anything but both values as booleans, `on` true and `remoteOff` false, reads as off. Live
 * delivery's own switch still decides whether anything is watched at all.
 *
 * Tests flip the entries and must put them back.
 *
 * @module rooms/liveWatchSwitch
 */
export const ROOMS_LIVE_WATCH: { on: boolean; remoteOff: boolean } = {
  on: true,
  remoteOff: false,
}

/** Whether the room on screen may be watched live now: switched on by the release, and not turned off remotely. */
export function isRoomLiveWatchOn(): boolean {
  return ROOMS_LIVE_WATCH.on === true && ROOMS_LIVE_WATCH.remoteOff === false
}
