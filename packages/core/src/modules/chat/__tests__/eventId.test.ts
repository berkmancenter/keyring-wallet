import { isUlid } from '../chatEvent'
import { createEventIdFactory, newEventId } from '../eventId'

const fixedRandom = (fill: number) => (bytes: Uint8Array) => bytes.fill(fill)

describe('event ids', () => {
  it('are valid ULIDs from the real random source', () => {
    const id = newEventId()
    expect(isUlid(id)).toBe(true)
    expect(id).toHaveLength(26)
  })

  it('encode the time so later ids sort after earlier ones', () => {
    let t = 1_700_000_000_000
    const next = createEventIdFactory({ now: () => t, random: fixedRandom(7) })
    const first = next()
    t += 1
    const second = next()
    expect(second > first).toBe(true)
  })

  it('stay strictly increasing within one millisecond', () => {
    const next = createEventIdFactory({ now: () => 1_700_000_000_000, random: fixedRandom(3) })
    const ids = Array.from({ length: 50 }, () => next())
    expect([...ids].sort()).toEqual(ids)
    expect(new Set(ids).size).toBe(50)
  })

  it('stay increasing when the clock steps backwards', () => {
    let t = 1_700_000_000_500
    const next = createEventIdFactory({ now: () => t, random: fixedRandom(1) })
    const first = next()
    t -= 400
    expect(next() > first).toBe(true)
  })

  it('move to the next millisecond when the random part overflows', () => {
    const next = createEventIdFactory({ now: () => 1_700_000_000_000, random: fixedRandom(31) })
    const first = next()
    const second = next()
    expect(second > first).toBe(true)
    expect(second.slice(0, 10) > first.slice(0, 10)).toBe(true)
  })
})
