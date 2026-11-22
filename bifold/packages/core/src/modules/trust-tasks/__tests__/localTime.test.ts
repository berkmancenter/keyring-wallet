/**
 * IN-58 (a tester, 09-29): "dates and times should be shown in the user's
 * timezone, not the VTA's". Several screens showed the agent's UTC timestamp
 * cut to a string: an approval's "Expires" off by the whole offset, and a
 * date off by a day near midnight. One formatter, in the phone's time zone,
 * in the app's language.
 */
import { speak } from '../../../../__tests__/helpers/appLanguage'
import { localDate, localDateTime } from '../screens/localTime'

// Just after midnight UTC is still the evening before in Denver.
const LATE = '2026-09-29T02:30:00Z'

describe('dates in the phone’s time zone', () => {
  // The whole jest run is in UTC (jest.config.js), and a test cannot move the process's zone, so the local-day rule
  // itself (calendar fields read in the phone's zone, never the UTC date cut from the string) is utils/localDay's,
  // read through Date's local getters. These pin the UTC case and the words.
  it('a date is the calendar day and a date and time the wall clock, in the phone’s zone', () => {
    expect(new Date(LATE).getTimezoneOffset()).toBe(0)
    expect(localDate(LATE)).toBe('29 Sep 2026')
    expect(localDateTime(LATE)).toBe('29 Sep 2026, 02:30')
  })

  it('keeps what it cannot read as it came, rather than "Invalid Date"', () => {
    expect(localDate('not a date')).toBe('not a date')
    expect(localDateTime('')).toBe('')
  })

  // Hermes in a release build answered toLocaleDateString in English whatever the language; these words are ours.
  it('speaks the app’s language: French and Portuguese', async () => {
    await speak('fr')
    expect(localDate('2026-03-04T12:00:00Z')).toBe('4 mars 2026')
    expect(localDateTime('2026-03-04T12:00:00Z')).toBe('4 mars 2026 à 12:00')

    await speak('pt-BR')
    expect(localDate('2026-03-04T12:00:00Z')).toBe('4 de mar. de 2026')
    expect(localDateTime('2026-03-04T12:00:00Z')).toBe('4 de mar. de 2026 às 12:00')
    await speak('en')
  })
})
