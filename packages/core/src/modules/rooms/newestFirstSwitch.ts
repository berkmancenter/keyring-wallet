/**
 * Whether an open room reads its newest records first (`rooms/keys/browse` 0.5/0.6, `order: newestFirst` with
 * `maxPages: 1`), rather than the whole room on every opening. Browse 0.4 has the agent follow the host's cursor to the
 * room's end before it answers, so a room's first screen waited for every record it ever held. Newest first, an opening
 * asks for {@link ROOM_HEAD_WINDOW} records, and "load older" asks for the next ones below the lowest version held
 * (0.6's `beforeVersion`). A host or agent that cannot (`unsupportedType`, `unsupportedVersion`) is read whole, as before,
 * and the window cut from that.
 *
 * Read by `useRoomPosts` at each listing and by `agentRoomsService`'s browse ladder. Off, every listing is the whole
 * room, sent exactly as before (browse 0.4 down to 0.1).
 *
 * Two values a release (an OTA included) sets, and nothing else, as for `liveDeliverySwitch.ts`:
 * - `on`: the release's choice.
 * - `remoteOff`: the release's kill. Set it to `true` and every room is read whole again, for everyone at the next
 *   start, whatever `on` says, until a release sets it back.
 *
 * KILL RECIPE (no kill PR is kept open): branch from current main, set `remoteOff: true` below (one line), and publish
 * it by OTA. Both are Alberto's.
 *
 * Nothing is saved on the phone and nothing a person does changes either value; it is read at each listing, never
 * cached. It fails closed: anything but both values as booleans, `on` true and `remoteOff` false, reads as off.
 *
 * Tests flip the entries and must put them back.
 *
 * @module rooms/newestFirstSwitch
 */
export const ROOMS_NEWEST_FIRST: { on: boolean; remoteOff: boolean } = {
  on: true,
  remoteOff: false,
}

/** Whether rooms may be read newest first now: switched on by the release, and not turned off remotely. */
export function isRoomsNewestFirstOn(): boolean {
  return ROOMS_NEWEST_FIRST.on === true && ROOMS_NEWEST_FIRST.remoteOff === false
}

/**
 * How many records an opening, and each "load older", asks for: past what the first screens draw (`POSTS_PAGE` chat
 * posts, with the notes between them) and the wallet's kept copy (`MSG_CACHE_POSTS`, 50), so one answer serves both.
 * Metadata only: each record shown is read on its own, as before. Within browse's `limit` (1 to 1000).
 */
export const ROOM_HEAD_WINDOW = 60
