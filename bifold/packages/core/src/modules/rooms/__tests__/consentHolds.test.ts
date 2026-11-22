/**
 * When the agent last held a rooms task for consent, kept across launches: read at use against the clock, by agent and
 * type, and read as held whenever it can't be read at all.
 */
import { CONSENT_HOLD_BACKOFF_MS, storedConsentHolds } from '../real/consentHolds'

const READ02 = 'https://trusttasks.org/spec/rooms/keys/read/0.2'
const WATCH = 'https://trusttasks.org/spec/rooms/keys/watch/0.1'
const A = 'did:webvh:agent:a'
const T0 = Date.parse('2026-11-10T20:00:00Z')

const disk = (initial?: string) => {
  const kept = new Map<string, string>(initial === undefined ? [] : [['rooms.consentHolds.v1', initial]])
  return {
    kept,
    getItem: jest.fn(async (key: string) => kept.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => void kept.set(key, value)),
  }
}

describe('storedConsentHolds', () => {
  test('a hold noted is read back by a new store over the same storage, and ends a day later', async () => {
    const storage = disk()
    await storedConsentHolds(() => A, storage).noteHeld(READ02, T0)
    const relaunched = storedConsentHolds(() => A, storage)
    expect(await relaunched.heldRecently(READ02, T0 + 1)).toBe(true)
    expect(await relaunched.heldRecently(READ02, T0 + CONSENT_HOLD_BACKOFF_MS - 1)).toBe(true)
    expect(await relaunched.heldRecently(READ02, T0 + CONSENT_HOLD_BACKOFF_MS)).toBe(false)
  })

  test('by type: a held read says nothing of a watch (control)', async () => {
    const storage = disk()
    await storedConsentHolds(() => A, storage).noteHeld(READ02, T0)
    expect(await storedConsentHolds(() => A, storage).heldRecently(WATCH, T0 + 1)).toBe(false)
  })

  test('nothing stored is no hold (control)', async () => {
    expect(await storedConsentHolds(() => A, disk()).heldRecently(READ02, T0)).toBe(false)
  })

  test.each([
    ['not JSON', '{nope'],
    ['an array', '[]'],
    ['an agent row that is not an object', JSON.stringify({ [A]: 5 })],
    ['a time that is not a number', JSON.stringify({ [A]: { [READ02]: 'yesterday' } })],
  ])('what is stored is %s: read as held', async (_, raw) => {
    expect(await storedConsentHolds(() => A, disk(raw)).heldRecently(READ02, T0)).toBe(true)
  })

  test('a store that answers undefined (no real one does): read as held, never as nothing stored', async () => {
    const odd = { getItem: async () => undefined as unknown as string | null, setItem: jest.fn(async () => undefined) }
    expect(await storedConsentHolds(() => A, odd).heldRecently(READ02, T0)).toBe(true)
  })

  test('no agent linked: read as held, and nothing is written', async () => {
    const storage = disk()
    const holds = storedConsentHolds(() => undefined, storage)
    expect(await holds.heldRecently(READ02, T0)).toBe(true)
    await holds.noteHeld(READ02, T0)
    expect(storage.setItem).not.toHaveBeenCalled()
  })

  test('a hold noted over what could not be read replaces it, and reads as held', async () => {
    const storage = disk('{nope')
    await storedConsentHolds(() => A, storage).noteHeld(READ02, T0)
    expect(JSON.parse(storage.kept.get('rooms.consentHolds.v1') as string)).toEqual({ [A]: { [READ02]: T0 } })
  })

  test('a note drops what has ended and keeps what has not', async () => {
    const storage = disk(
      JSON.stringify({
        [A]: { [WATCH]: T0 - CONSENT_HOLD_BACKOFF_MS - 1 },
        'did:webvh:agent:b': { [READ02]: T0 - 1000 },
      })
    )
    await storedConsentHolds(() => A, storage).noteHeld(READ02, T0)
    expect(JSON.parse(storage.kept.get('rooms.consentHolds.v1') as string)).toEqual({
      [A]: { [READ02]: T0 },
      'did:webvh:agent:b': { [READ02]: T0 - 1000 },
    })
  })

  test('a hold noted ahead of the clock (the clock set back) still ends a day after it was noted', async () => {
    const storage = disk(JSON.stringify({ [A]: { [READ02]: T0 + 3600_000 } }))
    const holds = storedConsentHolds(() => A, storage)
    expect(await holds.heldRecently(READ02, T0)).toBe(true)
    expect(await holds.heldRecently(READ02, T0 + 3600_000 + CONSENT_HOLD_BACKOFF_MS)).toBe(false)
  })
})
