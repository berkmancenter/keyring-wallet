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
  'https://trusttasks.org/spec/rooms/keys/browse/0.3',
])

export function inReadLane(type: string): boolean {
  return VTA_READ_LANE_TYPES.has(type)
}

/**
 * The tasks that go beside the queue once this session's agent threads its replies: started at once, behind
 * nothing, with nothing waiting for them. Only the presence heartbeat: saying the phone is here again changes
 * nothing a second time, no task waits on its answer, and an unanswered one held whoami and the rooms' key list for
 * its whole 30 s (a tester's run, 10-30). A heartbeat that carries the sign-in's UV key goes beside too; the sign-in
 * waits for its answer before the grant, so the order of the two is the caller's, as before.
 *
 * ROLLBACK: set {@link VTA_HEARTBEAT_BESIDE} to false (an OTA can ship that alone); the heartbeat then runs alone in
 * the queue, as before.
 */
export const VTA_HEARTBEAT_BESIDE = true
/**
 * Every heartbeat version Keyring sends (vtaDevices' ladder), newest first. One added to the ladder and missed here
 * would put the heartbeat back in the queue with nothing else failing, so the version guard reads this as a ladder,
 * and vtaClientHeartbeatBeside.test.ts holds it to each `device/heartbeat` in AGENT_DEVICE_TASK.
 *
 * @versionLadder device/heartbeat
 */
export const VTA_BESIDE_TYPES: ReadonlySet<string> = new Set([
  'https://trusttasks.org/spec/device/heartbeat/0.3',
  'https://trusttasks.org/spec/device/heartbeat/0.2',
])

export function besideQueue(type: string): boolean {
  return VTA_BESIDE_TYPES.has(type)
}
