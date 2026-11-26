/**
 * Keyring's own lockout on "Connect an agent" (docs/plans/agent-connect-plan.md §3.2 step 5, §3.10):
 *
 * - three wrong numbers within 60 minutes lock the flow for 15 minutes;
 * - a wrong number made after the lock ends, while three or more are still inside the last 60 minutes, locks it
 *   for another 15 minutes;
 * - the count and its times are kept in the app's storage, apart from any connection record, and survive a restart;
 * - a cancel, a decline, or a code for a VTA the person does not manage is not a wrong number.
 *
 * So at most six numbers can be tried blind in any 60 minutes. It is anti-fumble, not a defence against the
 * person's own phone: only the owner types into it.
 *
 * The rule is a pure function of the stored times ({@link lockoutState}); {@link PairingLockout} reads and writes
 * them through an injected store, so a restart reads the same lock.
 *
 * @module connected-agents/lockout
 */

export const LOCKOUT_WINDOW_MS = 60 * 60 * 1000
export const LOCKOUT_DURATION_MS = 15 * 60 * 1000
export const LOCKOUT_THRESHOLD = 3

/** Where the wrong-number times live: the app's storage (a Credo generic record, or the key-value store). */
export interface LockoutStore {
  /** The stored times of wrong numbers, in ms since the epoch; [] when none were ever stored. */
  load(): Promise<number[]>
  save(times: number[]): Promise<void>
}

export type LockoutState = { locked: false } | { locked: true; until: number; minutesLeft: number }

/**
 * Whether the flow is locked at `now`, from the times of wrong numbers. The lock runs from the latest wrong number
 * that had at least {@link LOCKOUT_THRESHOLD} wrong numbers (itself included) within the window before it.
 */
export function lockoutState(times: readonly number[], now: number): LockoutState {
  const sorted = [...times].filter((t) => Number.isFinite(t)).sort((a, b) => a - b)
  let until = 0
  for (let i = 0; i < sorted.length; i++) {
    const t = sorted[i]
    const inWindow = sorted.filter((u) => u <= t && u > t - LOCKOUT_WINDOW_MS).length
    if (inWindow >= LOCKOUT_THRESHOLD) until = Math.max(until, t + LOCKOUT_DURATION_MS)
  }
  if (until > now) return { locked: true, until, minutesLeft: Math.ceil((until - now) / 60000) }
  return { locked: false }
}

/** The times still worth keeping at `now`: those that can still count toward a lock. */
export function pruneTimes(times: readonly number[], now: number): number[] {
  return times.filter((t) => Number.isFinite(t) && t > now - LOCKOUT_WINDOW_MS - LOCKOUT_DURATION_MS)
}

/** The lockout over a store. */
export class PairingLockout {
  public constructor(
    private readonly store: LockoutStore,
    private readonly clock: () => number
  ) {}

  public async state(): Promise<LockoutState> {
    return lockoutState(await this.store.load(), this.clock())
  }

  /** Record one wrong number, and return the state after it. */
  public async recordWrongNumber(): Promise<LockoutState> {
    const now = this.clock()
    const times = [...pruneTimes(await this.store.load(), now), now]
    await this.store.save(times)
    return lockoutState(times, now)
  }
}
