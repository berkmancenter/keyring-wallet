/**
 * Whether Messages shows each community's rooms as that community answers, rather than once every community has
 * (`AgentRoomsService.listMyRooms`'s `onPartial`, read by `useRoomRows`). Every community is asked together and the
 * listing waits for all of them, so one that never answers kept every other community's rows off the screen until it
 * was given up on: 43 s of a 53 s cold start on Alberto's phone, the SEDI rooms among them (QG4P-MQCT, 11-17).
 *
 * Each community that answers puts its rooms on screen and has them read; the rows of the communities still to answer
 * stay as they were (the last run's, or the last listing's). Nothing else changes: the listing that ends is the one
 * kept and acted on, exactly as before. Nothing is written from a partial one: no rows kept for the next start, no
 * listing handed to the listeners (rooms/messageCache's emptyings among them), nothing taken as the member's rooms.
 * BC46-XSQD (279.x): one community held the fresh list for 74 s while the other three had answered within seconds.
 *
 * Two values a release (an OTA included) sets, and nothing else, as for `liveDeliverySwitch.ts`:
 * - `on`: the release's choice.
 * - `remoteOff`: the release's kill. Set it to `true` and Messages waits for every community again, for everyone at the
 *   next start, whatever `on` says, until a release sets it back.
 *
 * KILL RECIPE (no kill PR is kept open): branch from current main, set `remoteOff: true` below (one line), and publish
 * it by OTA. Both are Alberto's.
 *
 * Nothing is saved on the phone and nothing a person does changes either value; it is read at each listing, never
 * cached. It fails closed: anything but both values as booleans, `on` true and `remoteOff` false, reads as off.
 *
 * Tests flip the entries and must put them back.
 *
 * @module rooms/partialListingSwitch
 */
export const ROOMS_PARTIAL_LISTING: { on: boolean; remoteOff: boolean } = {
  on: true,
  remoteOff: false,
}

/** Whether a listing's rooms may be shown community by community now: switched on, and not turned off. */
export function isRoomsPartialListingOn(): boolean {
  return ROOMS_PARTIAL_LISTING.on === true && ROOMS_PARTIAL_LISTING.remoteOff === false
}
