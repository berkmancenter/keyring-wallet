/**
 * Whether a read of every room in Messages (`useRoomRows`) reads several rooms at once, the room open on screen first,
 * rather than one after another as listed. One at a time, 281.2 took 26 s to read four rooms (IN-724), every row
 * reading until its turn came, while the agent's read lane (VtaClient, VTA_READ_LANE_SIZE) runs three reads beside each
 * other.
 *
 * What changes when it is on, and nothing else does: up to {@link ROWS_READ_TOGETHER} rooms are read at once, each
 * starting as a place frees, in this order: the room open on screen (RoomsService.isRoomInView), then the most recently
 * active as last read or last kept, then the rest as listed. Each room's own read stays in order (its listing, then
 * its newest post), and its row is drawn the moment it ends. Where the agent's lane is one, its queue still runs them
 * one at a time. Off, every room is read one after another in the listing's order, exactly as before.
 *
 * Two values a release (an OTA included) sets, and nothing else, as for `partialListingSwitch.ts`:
 * - `on`: the release's choice.
 * - `remoteOff`: the release's kill. Set it to `true` and Messages reads its rooms one after another again, for
 *   everyone at the next read, whatever `on` says, until a release sets it back.
 *
 * KILL RECIPE (no kill PR is kept open): branch from current main, set `remoteOff: true` below (one line), and publish
 * it by OTA. Both are Alberto's. Its proof is useRoomRowsTogether.test.tsx's switch-off rows.
 *
 * Nothing is saved on the phone and nothing a person does changes either value; it is read at each read of the rooms,
 * never cached. It fails closed: anything but `on` true and `remoteOff` false reads as off.
 *
 * Tests flip the entries and must put them back.
 *
 * @module rooms/rowsTogetherSwitch
 */
export const ROOMS_ROWS_TOGETHER: { on: boolean; remoteOff: boolean } = {
  on: true,
  remoteOff: false,
}

/** Whether Messages may read several rooms at once now: switched on, and not turned off. */
export function isRoomsRowsTogetherOn(): boolean {
  return ROOMS_ROWS_TOGETHER.on === true && ROOMS_ROWS_TOGETHER.remoteOff === false
}

/** How many rooms are read at once when it is on: the agent's read lane's size. */
export const ROWS_READ_TOGETHER = 3
