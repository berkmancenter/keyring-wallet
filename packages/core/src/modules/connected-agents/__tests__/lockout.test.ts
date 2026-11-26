/**
 * Keyring's lockout on "Connect an agent" (plan §3.2 step 5, §3.10, §7.2).
 */
import { LOCKOUT_DURATION_MS, LockoutStore, PairingLockout, lockoutState } from '../lockout'

const MIN = 60 * 1000
const T0 = Date.parse('2026-11-25T12:00:00Z')

class MemoryStore implements LockoutStore {
  public times: number[] = []
  public async load() {
    return [...this.times]
  }
  public async save(times: number[]) {
    this.times = [...times]
  }
}

describe('lockoutState', () => {
  it('two wrong numbers do not lock; a third within 60 minutes locks for 15', () => {
    expect(lockoutState([T0, T0 + 10 * MIN], T0 + 11 * MIN)).toEqual({ locked: false })
    expect(lockoutState([T0, T0 + 10 * MIN, T0 + 59 * MIN], T0 + 60 * MIN)).toEqual({
      locked: true,
      until: T0 + 59 * MIN + LOCKOUT_DURATION_MS,
      minutesLeft: 14,
    })
  })

  it('three spread over more than 60 minutes do not lock', () => {
    expect(lockoutState([T0, T0 + 30 * MIN, T0 + 60 * MIN], T0 + 61 * MIN)).toEqual({ locked: false })
  })

  it('the lock ends after 15 minutes', () => {
    const times = [T0, T0 + MIN, T0 + 2 * MIN]
    expect(lockoutState(times, T0 + 16 * MIN).locked).toBe(true)
    expect(lockoutState(times, T0 + 17 * MIN)).toEqual({ locked: false })
  })

  it('a wrong number after the lock ends, with three still inside the hour, locks for another 15 minutes', () => {
    const times = [T0, T0 + MIN, T0 + 2 * MIN, T0 + 20 * MIN]
    expect(lockoutState(times, T0 + 21 * MIN)).toMatchObject({ locked: true, until: T0 + 35 * MIN })
    // control: the same fourth number once the first three have left the hour does not lock
    const later = [T0, T0 + MIN, T0 + 2 * MIN, T0 + 70 * MIN]
    expect(lockoutState(later, T0 + 71 * MIN)).toEqual({ locked: false })
  })

  it('allows at most six tries in any 60 minutes when each is made the moment it may be', () => {
    const times: number[] = []
    let now = T0
    for (let i = 0; i < 100 && now < T0 + 60 * MIN; i++) {
      const s = lockoutState(times, now)
      if (s.locked) now = s.until
      else {
        times.push(now)
        now += 1
      }
    }
    expect(times.filter((t) => t < T0 + 60 * MIN)).toHaveLength(6)
  })
})

describe('PairingLockout over a store', () => {
  it('survives a restart: a new instance over the same store reads the same lock', async () => {
    const store = new MemoryStore()
    let now = T0
    const first = new PairingLockout(store, () => now)
    await first.recordWrongNumber()
    now += MIN
    await first.recordWrongNumber()
    now += MIN
    expect(await first.recordWrongNumber()).toMatchObject({ locked: true })
    const restarted = new PairingLockout(store, () => now)
    expect(await restarted.state()).toMatchObject({ locked: true, minutesLeft: 15 })
    // control: an empty store is not locked
    expect(await new PairingLockout(new MemoryStore(), () => now).state()).toEqual({ locked: false })
  })
})
