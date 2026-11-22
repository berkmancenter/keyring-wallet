/**
 * Whether an accept goes ahead on the offer the member is looking at, read at most
 * {@link ACCEPT_FROM_PREVIEW_MAX_AGE_MS} ago, instead of reading the community's offers again first
 * (`AgentRoomsService.acceptOffer`). That read waited for the community session: 21.6 s of a 31 s accept on a tester's
 * phone, while the session signed in again after the mediator dropped a duplicate socket (YDXH-SH9W, 11-17).
 *
 * An offer older than that, or one no longer known, is read again exactly as before. What it gives up is the early
 * word on an offer withdrawn or accepted elsewhere since the preview: the community's own accept step says it instead
 * (a withdrawn offer is refused there, after the member's two cards are stored), and an offer finished elsewhere is
 * finished again, each step answering a repeat with its first answer.
 *
 * Two values a release (an OTA included) sets, and nothing else, as for `liveDeliverySwitch.ts`:
 * - `on`: the release's choice.
 * - `remoteOff`: the release's kill. Set it to `true` and every accept reads the offers again first, for everyone at
 *   the next start, whatever `on` says, until a release sets it back.
 *
 * KILL RECIPE (no kill PR is kept open): branch from current main, set `remoteOff: true` below (one line), and publish
 * it by OTA. Both are Alberto's.
 *
 * Nothing is saved on the phone and nothing a person does changes either value; it is read at each accept, never
 * cached. It fails closed: anything but both values as booleans, `on` true and `remoteOff` false, reads as off.
 *
 * Tests flip the entries and must put them back.
 *
 * @module rooms/acceptFromPreviewSwitch
 */
export const ROOMS_ACCEPT_FROM_PREVIEW: { on: boolean; remoteOff: boolean } = {
  on: true,
  remoteOff: false,
}

/** How old the offer on screen may be for an accept to go ahead on it: past this, the offers are read again. */
export const ACCEPT_FROM_PREVIEW_MAX_AGE_MS = 60_000

/** Whether an accept may go ahead on the offer read for its preview: switched on, and not turned off. */
export function isAcceptFromPreviewOn(): boolean {
  return ROOMS_ACCEPT_FROM_PREVIEW.on === true && ROOMS_ACCEPT_FROM_PREVIEW.remoteOff === false
}
