/**
 * Whether this build watches rooms at their hosts and reads them on the agent's signal (live delivery,
 * `real/roomWatches.ts`): two values a release (an OTA included) sets, and nothing else.
 *
 * - `on`: the release's choice. It is what turns live delivery on.
 * - `remoteOff`: the release's kill. Set it to `true` and no room is armed and no signal is acted on for everyone at the
 *   next start, whatever `on` says, until a release sets it back. Every room then polls as it did before live delivery.
 *
 * Nothing is saved on the phone and nothing a person does changes either value, as for `recordSendingSwitch.ts`: a
 * switch that honours a saved "on" cannot be turned off again by a later release (`loadSwitch`'s one-way trap, 11-07).
 * The real backend reads it at each arming and each signal (`agentRoomsBackend.ts`, `liveDelivery`).
 *
 * It fails closed: anything but both values as booleans, `on` true and `remoteOff` false, reads as off.
 *
 * Tests flip the entries and must put them back.
 *
 * @module rooms/liveDeliverySwitch
 */
export const ROOMS_LIVE_DELIVERY: { on: boolean; remoteOff: boolean } = {
  on: true,
  remoteOff: false,
}

/** Whether rooms may be watched and their signals read now: switched on by the release, and not turned off remotely. */
export function isRoomLiveDeliveryOn(): boolean {
  return ROOMS_LIVE_DELIVERY.on === true && ROOMS_LIVE_DELIVERY.remoteOff === false
}
