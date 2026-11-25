/**
 * Whether the key copies a session fetches when it opens go to the agent side by side, and how many at once. Two
 * values a release (an OTA included) sets, and nothing else:
 *
 * - `on`: the release's choice.
 * - `remoteOff`: the release's kill. Set it to `true` and every copy is fetched one at a time and runs alone on the
 *   agent's channel again, from the next start, whatever `on` says, until a release sets it back.
 *
 * Why: a phone holds its identities' keys in memory only, so each session fetches them again
 * (EphemeralKeyManagementService, "#10, plan part C"). `keys/export-secret/0.1` releases one key per task, the sweep
 * asked for them one identity after another, and the agent's channel ran each alone: 8 copies took 3.3 to 4.2 s on a
 * phone with four identities, about 0.35 to 0.5 s each (reports DDTB-QVVX and GH5F-WDE3, 11-17).
 *
 * What changes when it is on, and nothing else does:
 * - the sweep (vtaAgent.holdPersonaKeys) fetches the first identity's copies alone, then the rest up to
 *   {@link KEY_COPIES_AT_ONCE} identities at a time. The first goes alone so that whatever the agent has to say about
 *   this phone (it was removed, it wants a step-up or an approval) is said once, to one ask, before any go together;
 * - an export may share the agent channel's read lane (VtaClient `sharesLane`), under the lane's own rules: only once
 *   this session's agent has threaded a reply, never past the lane's size, and reads count against the same size;
 * - step-ups on one agent channel are answered one at a time (VtaClient `stepUpInTurn`). Tasks side by side can each be
 *   refused with a step-up at once, and the person is shown one card at a time: one that comes while another is being
 *   answered waits for it, then is sent again, and asks the person only if the agent still wants it.
 *
 * What does not change: which keys are asked for, each ask and its answer, where a copy is kept (memory only), and
 * the agent's own check and record of every export. A task that is not in the lane still runs alone and still holds
 * back everything asked after it until it is answered; the sweep never has more than {@link KEY_COPIES_AT_ONCE}
 * identities' asks in the queue, so such a task waits for the copies on the wire and no others
 * (keyCopiesTogether.test.ts holds that order).
 *
 * `VTA_READ_LANE_TYPES` is deliberately not changed: what reads it (the open room's read going first, rooms' own
 * ordering) must not start treating an export as a read.
 *
 * Nothing is saved on the phone and nothing a person does changes either value; it is read at each sweep and each
 * queueing. It fails closed to one at a time: anything but `on` true and `remoteOff` false reads as off.
 *
 * THE KILL IS A RECIPE, NOT A KEPT PULL REQUEST: branch from current main, set `KEY_COPIES_TOGETHER.remoteOff` to
 * `true` in this file (packages/core/src/modules/trust-tasks/module/keyCopySweep.ts) and change nothing else; merge,
 * pin, cut, and Alberto publishes. Its proof is keyCopiesTogether.test.ts's remoteOff rows.
 *
 * Tests flip the entries and must put them back.
 *
 * @module trust-tasks/module/keyCopySweep
 */
export const KEY_COPIES_TOGETHER: { on: boolean; remoteOff: boolean } = { on: true, remoteOff: false }

/** Whether key copies may be fetched side by side, now. */
export function isKeyCopiesTogetherOn(): boolean {
  return KEY_COPIES_TOGETHER.on === true && KEY_COPIES_TOGETHER.remoteOff === false
}

/** How many identities' copies the sweep fetches at once, after the first. The read lane's own size. */
export const KEY_COPIES_AT_ONCE = 3

/** What one identity's fetch says to the sweep: go on, or stop (the agent refused this phone). */
export type SweepStep = 'go' | 'stop'

/**
 * Run `fetch` for each of `items`, in order: one at a time when `atOnce` is 1 or less, exactly as a plain loop;
 * otherwise the first alone, then up to `atOnce` side by side, each started in order as a place frees.
 *
 * A fetch that answers `stop` ends the sweep: nothing more is started, and what is already running is waited for.
 * A fetch that throws ends it the same way, and the sweep then throws what it threw: never while others are still
 * running, and never leaving any to go on starting more.
 */
export async function sweepKeyCopies<T>(
  items: readonly T[],
  fetch: (item: T) => Promise<SweepStep>,
  atOnce: number
): Promise<void> {
  if (atOnce <= 1) {
    for (const item of items) if ((await fetch(item)) === 'stop') return
    return
  }
  if (items.length === 0) return
  if ((await fetch(items[0])) === 'stop') return
  let next = 1
  let stopped = false
  const worker = async (): Promise<void> => {
    while (!stopped && next < items.length) {
      const item = items[next++]
      try {
        if ((await fetch(item)) === 'stop') stopped = true
      } catch (error) {
        stopped = true
        throw error
      }
    }
  }
  const ended = await Promise.allSettled(Array.from({ length: Math.min(atOnce, items.length - 1) }, worker))
  const threw = ended.find((one): one is PromiseRejectedResult => one.status === 'rejected')
  if (threw) throw threw.reason
}
