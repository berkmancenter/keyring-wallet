/**
 * Whether Messages asks for room offers again when it comes into focus, and when the member taps to try the rooms
 * again (`askOffersAgain`, read by `useRoomRows`). Nothing pushes an offer to a phone (upstream notifies elections
 * only), and the poll asks every two minutes while none wait (useRoomOffersCount), so a new invite could take two
 * minutes to show on a phone open on Messages (11-17). A member looking for an invite looks there. The poll's own
 * floor still holds: no ask within 10 s of the last, and none while one is out.
 *
 * Two values a release (an OTA included) sets, and nothing else, as for `liveDeliverySwitch.ts`:
 * - `on`: the release's choice.
 * - `remoteOff`: the release's kill. Set it to `true` and Messages asks nothing of the offers again, for everyone at
 *   the next start, whatever `on` says, until a release sets it back: the poll asks as before.
 *
 * KILL RECIPE (no kill PR is kept open): branch from current main, set `remoteOff: true` below (one line), and publish
 * it by OTA. Both are Alberto's.
 *
 * Nothing is saved on the phone and nothing a person does changes either value; it is read at each ask, never cached.
 * It fails closed: anything but both values as booleans, `on` true and `remoteOff` false, reads as off.
 *
 * Tests flip the entries and must put them back.
 *
 * @module rooms/offersOnMessagesSwitch
 */
export const ROOMS_OFFERS_ON_MESSAGES: { on: boolean; remoteOff: boolean } = {
  on: true,
  remoteOff: false,
}

/** Whether Messages may ask for offers again now: switched on, and not turned off. */
export function isOffersOnMessagesOn(): boolean {
  return ROOMS_OFFERS_ON_MESSAGES.on === true && ROOMS_OFFERS_ON_MESSAGES.remoteOff === false
}
