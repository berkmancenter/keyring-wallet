/**
 * Whether Messages' rooms are armed at their hosts whenever the app is open, not only while Messages is in view: two
 * values a release (an OTA included) sets, and nothing else, as `liveDeliverySwitch.ts`.
 *
 * A room's unread count (the number on the Messages tab and on the room's row) moves on the agent's signal only for a
 * room that is armed, and rooms were armed only at the end of a read that found Messages in view. A read that ended
 * with the person on another tab, or inside a room, armed nothing: a post then reached the count at the next read,
 * which comes when Messages is opened or the app is left and returned to. Seven of ten reports on 11-17 had no room
 * armed at all.
 *
 * With this on, every read of the rooms arms them while the app is open, wherever the person is. The two-minute read
 * stays as it was, only while Messages is in view.
 *
 * - `on`: the release's choice.
 * - `remoteOff`: the release's kill. Set it to `true` and rooms are armed only with Messages in view again, for
 *   everyone at the next start, whatever `on` says.
 *
 * Nothing is saved on the phone and nothing a person does changes either value. It fails closed to arming in view
 * only: anything but `on` true and `remoteOff` false reads as off. Live delivery's own switch still decides whether
 * anything is armed at all.
 *
 * Tests flip the entries and must put them back.
 *
 * @module rooms/watchWheneverOpenSwitch
 */
export const ROOMS_WATCH_WHENEVER_OPEN: { on: boolean; remoteOff: boolean } = {
  on: true,
  remoteOff: false,
}

/** Whether rooms are armed with Messages out of view too: switched on by the release, and not turned off remotely. */
export function isRoomWatchWheneverOpenOn(): boolean {
  return ROOMS_WATCH_WHENEVER_OPEN.on === true && ROOMS_WATCH_WHENEVER_OPEN.remoteOff === false
}
