/**
 * Whether what the person has read in a room is kept by their own agent (`rooms/keys/read-marker/set/0.1`,
 * `real/readMarkers.ts`), so that their phone, their browser and any other device of theirs agree on what is unread:
 * two values a release (an OTA included) sets, and nothing else, as `liveWatchSwitch.ts`.
 *
 * Off, what was read is kept on this phone alone (`rooms.seenVersions`), exactly as before this switch existed: no
 * set is sent, and no marker the agent holds is taken.
 *
 * - `on`: the release's choice.
 * - `remoteOff`: the release's kill. Set it to `true` and, for everyone at the next start, no set goes out and no
 *   marker is adopted, whatever `on` says. What the agent already holds stays there, unused by this phone.
 *
 * KILL RECIPE (no kill PR is kept open): branch from current main, set `remoteOff: true` below (one line), and publish
 * it by OTA. Both are Alberto's.
 *
 * Nothing is saved on the phone and nothing a person does changes either value; it is read at each set and each marker
 * heard, never cached. It fails closed: anything but both values as booleans, `on` true and `remoteOff` false, reads
 * as off.
 *
 * Tests flip the entries and must put them back.
 *
 * @module rooms/readMarkerSwitch
 */
export const ROOMS_READ_MARKER: { on: boolean; remoteOff: boolean } = {
  on: true,
  remoteOff: false,
}

/** Whether read markers are kept at the agent now: switched on by the release, and not turned off remotely. */
export function isRoomReadMarkerOn(): boolean {
  return ROOMS_READ_MARKER.on === true && ROOMS_READ_MARKER.remoteOff === false
}
