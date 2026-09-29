/**
 * IN-58 (a tester, 09-29): "dates and times should be shown in the user's
 * timezone, not the VTA's". Several screens showed the agent's UTC timestamp
 * cut to a string — an approval's "Expires" off by the whole offset, and a
 * date off by a day near midnight. One formatter, in the phone's time zone.
 */
import { localDate, localDateTime } from '../screens/localTime'

// Just after midnight UTC is still the evening before in Denver.
const LATE = '2026-09-29T02:30:00Z'

describe('dates in the phone’s time zone', () => {
  it('a date is the local day, not the UTC one', () => {
    expect(localDate(LATE, { timeZone: 'America/Denver' })).toMatch(/28/)
    expect(localDate(LATE, { timeZone: 'UTC' })).toMatch(/29/)
  })

  it('a date and time is the local wall clock', () => {
    const denver = localDateTime(LATE, { timeZone: 'America/Denver' })
    expect(denver).toMatch(/28/)
    expect(denver).toMatch(/8:30|20:30/)
    expect(localDateTime(LATE, { timeZone: 'Europe/Prague' })).toMatch(/4:30|04:30/)
  })

  it('names the month, so a date is never read the wrong way round', () => {
    expect(localDate('2026-03-04T12:00:00Z', { timeZone: 'UTC' })).toMatch(/Mar/)
  })

  it('keeps what it cannot read as it came, rather than "Invalid Date"', () => {
    expect(localDate('not a date')).toBe('not a date')
    expect(localDateTime('')).toBe('')
  })

  it('uses the phone’s own zone when none is given', () => {
    const d = new Date(LATE)
    expect(localDate(LATE)).toBe(d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }))
  })
})
