/**
 * Whether this build sends a room's replies, reactions, edits and withdrawals (`sendRecord`): two values a release
 * (an OTA included) sets, and nothing else.
 *
 * - `on`: the release's choice. It is what turns sending on.
 * - `remoteOff`: the release's kill. Set it to `true` and sending is off for everyone at the next start, whatever
 *   `on` says, until a release sets it back.
 *
 * Nothing is saved on the phone and nothing a person does changes either value. That is deliberate: a switch that
 * honours a saved "on" cannot be turned off again by a later release (`loadSwitch`'s one-way trap, 11-07), and this
 * one must stay something a release can take back. The real backend reads it on every send
 * (`agentRoomsBackend.ts`, `recordSending`), so the rooms service and every screen that asks `recordSendingOn()`
 * follow it with no other wiring.
 *
 * It fails closed: anything but both values as booleans, `on` true and `remoteOff` false, reads as off.
 *
 * Tests flip the entries and must put them back.
 *
 * @module rooms/recordSendingSwitch
 */
export const ROOMS_RECORD_SENDING: { on: boolean; remoteOff: boolean } = {
  on: true,
  remoteOff: false,
}

/** Whether a room's records may be sent now: switched on by the release, and not turned off remotely. */
export function isRoomRecordSendingOn(): boolean {
  return ROOMS_RECORD_SENDING.on === true && ROOMS_RECORD_SENDING.remoteOff === false
}
