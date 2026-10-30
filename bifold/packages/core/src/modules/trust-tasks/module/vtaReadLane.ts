/**
 * The agent tasks a phone may have on the wire side by side, and how many at once. Everything else goes one at a time,
 * alone, as it always has.
 *
 * Why: opening a room reads its first page one record per task, and the agent client sent one task at a time, so ten
 * posts took about 5 s (lab sim, 10-30: 0.47–0.84 s a read). Three at a time takes about 2 s. Only reads are here, by
 * exact type, because their answers change nothing and their order does not matter; a write, a step-up or a consent
 * wait still runs alone (VtaClient's queue). The agent's replies are matched by thread, so the lane opens only once
 * this session's agent has threaded a reply, and closes for the session on any reply that is not threaded.
 *
 * ROLLBACK: set {@link VTA_READ_LANE_SIZE} to 1 (an OTA can ship that alone). With 1, every task runs one at a time in
 * the order asked, exactly as before the lane (vtaClientReadLane.test.ts proves the two the same).
 *
 * Upstream has no batch read (`rooms/keys/read/0.1` takes one key; upstream-findings VTI-88), which would replace this
 * and spare the agent the parallel host fetches.
 *
 * @module trust-tasks/module/vtaReadLane
 */

/** How many lane tasks may be on the wire at once. 1 turns the lane off. */
export const VTA_READ_LANE_SIZE = 3

/** The tasks that may share the lane: reads only, by exact type and version. */
export const VTA_READ_LANE_TYPES: ReadonlySet<string> = new Set([
  'https://trusttasks.org/spec/rooms/keys/read/0.1',
  'https://trusttasks.org/spec/rooms/keys/browse/0.1',
  'https://trusttasks.org/spec/rooms/keys/browse/0.2',
])

export function inReadLane(type: string): boolean {
  return VTA_READ_LANE_TYPES.has(type)
}
