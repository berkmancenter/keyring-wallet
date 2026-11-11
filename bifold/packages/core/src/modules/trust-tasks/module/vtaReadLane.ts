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

/**
 * The tasks that may share the lane: reads only, by exact type and version. Every browse version the ladder may send
 * is here, newest first, so a newer one added to the ladder fails the version guard until it is added here too.
 *
 * What may share the lane, not what is sent: browse 0.2 is held here, and the ladder (`browseType`) sends 0.3 or 0.1.
 *
 * @versionCoverage rooms/keys/browse
 */
export const VTA_READ_LANE_TYPES: ReadonlySet<string> = new Set([
  'https://trusttasks.org/spec/rooms/keys/read/0.1',
  'https://trusttasks.org/spec/rooms/keys/browse/0.3',
  'https://trusttasks.org/spec/rooms/keys/browse/0.2',
  'https://trusttasks.org/spec/rooms/keys/browse/0.1',
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
 * would put the heartbeat back in the queue with nothing else failing, so the version guard holds this to the newest,
 * and vtaClientHeartbeatBeside.test.ts holds it to each `device/heartbeat` in AGENT_DEVICE_TASK.
 *
 * @versionCoverage device/heartbeat
 */
export const VTA_BESIDE_TYPES: ReadonlySet<string> = new Set([
  'https://trusttasks.org/spec/device/heartbeat/0.3',
  'https://trusttasks.org/spec/device/heartbeat/0.2',
])

export function besideQueue(type: string): boolean {
  return VTA_BESIDE_TYPES.has(type)
}

/**
 * The tasks a member's own write makes, which go ahead of what is queued: its seal, and the agent completing its
 * `rooms/records/put`. A reply, reaction, edit or withdrawal waited behind the rooms' background reads, each queued
 * browse or read holding the seal back (278.12, iPhone 11: 0.1–0.8 s per send, in every one of three). They start
 * before every queued task that isn't one, keep their own order, and never cut short a task already on the wire: a
 * write still runs alone. A background poll waits a little longer; the person's tap does not.
 *
 * Unbounded by design: a person sending quickly keeps a queued read waiting for as long as their writes keep coming.
 * In a human-paced chat a read still runs between taps, and the writer's own posts show at once (pendingRecordWrites).
 * The "goes ahead of N queued" line (VtaClient) is how a report would show it if N ever stayed high.
 *
 * ROLLBACK: set {@link VTA_SENDS_FIRST} to false (an OTA can ship that alone); every task then keeps the order asked.
 */
export const VTA_SENDS_FIRST = true

/**
 * Every seal version Keyring sends (`sealType`'s ladder), newest first.
 *
 * @versionCoverage rooms/keys/seal
 */
export const VTA_SEND_SEAL_TYPES: ReadonlySet<string> = new Set([
  'https://trusttasks.org/spec/rooms/keys/seal/0.3',
  'https://trusttasks.org/spec/rooms/keys/seal/0.2',
])

/**
 * Every `rooms/keys/act` version the rooms client sends (`KEYS_ACT_TYPES`), newest first. Only an act that completes a
 * member's write goes first: the same task also completes background reads (`vtc/rooms/offers/list`), which keep their
 * place.
 *
 * @versionCoverage rooms/keys/act
 */
export const VTA_SEND_ACT_TYPES: ReadonlySet<string> = new Set([
  'https://trusttasks.org/spec/rooms/keys/act/0.9',
  'https://trusttasks.org/spec/rooms/keys/act/0.8',
  'https://trusttasks.org/spec/rooms/keys/act/0.6',
  'https://trusttasks.org/spec/rooms/keys/act/0.5',
])

const RECORDS_PUT = /^https:\/\/trusttasks\.org\/spec\/rooms\/records\/put\/[\d.]+$/

/** Whether a task is part of a member's own write, which goes ahead of what is queued ({@link VTA_SENDS_FIRST}). */
export function goesFirst(type: string, payload: Record<string, unknown> | undefined): boolean {
  if (!VTA_SENDS_FIRST) return false
  if (VTA_SEND_SEAL_TYPES.has(type)) return true
  if (!VTA_SEND_ACT_TYPES.has(type)) return false
  const document = payload?.document
  const completes = document && typeof document === 'object' ? (document as { type?: unknown }).type : undefined
  return typeof completes === 'string' && RECORDS_PUT.test(completes)
}
