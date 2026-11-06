/**
 * The confirm screen's "This code expires …" line. A link may run up to seven days, so a time alone on another day
 * reads as already past once that hour has gone by today, and the person may cancel a code that still works. The
 * words are ours and the clock is the phone's setting (utils/localDay.ts).
 *
 * What jest can't see: on a phone, the JS engine's toLocaleTimeString came out in English whatever the language.
 * Node's ICU localises it, so these rows pin the text to the app's own words, which stands in for that check
 * without observing it. Only a device or emulator frame observes it.
 */
import type { TFunction } from 'i18next'
import * as RNLocalize from 'react-native-localize'

import { speak } from '../../../../__tests__/helpers/appLanguage'
import { expiryText } from '../screens/SharedConnect'

// The phone's 12/24-hour setting, as a jest.fn both this file and utils/localDay share (a spy on this file's
// namespace copy would not reach localDay's).
jest.mock('react-native-localize', () => ({
  ...jest.requireActual('react-native-localize/mock'),
  uses24HourClock: jest.fn(() => true),
}))
const uses24HourClock = RNLocalize.uses24HourClock as jest.Mock

const t = ((key: string, options?: { time?: string; when?: string }) =>
  `${key}(${options?.time ?? options?.when ?? ''})`) as unknown as TFunction

const seconds = (date: Date): number => date.getTime() / 1000

// Friday 6 November 2026, 14:00 local: "now" for the rows, after 08:59 on the same day.
const NOW = new Date(2026, 10, 6, 14, 0)

afterEach(async () => {
  uses24HourClock.mockReturnValue(true)
  await speak('en')
})

describe('when a shared-connect code expires', () => {
  test('a code that ends later today: the time alone, by a 24-hour phone', async () => {
    await speak('en')
    expect(expiryText(seconds(new Date(2026, 10, 6, 18, 59)), t, NOW)).toBe('SharedConnect.Expires(18:59)')
  })

  test('on a 12-hour phone: the app’s 12-hour words, in French and Portuguese too', async () => {
    uses24HourClock.mockReturnValue(false)
    const exp = seconds(new Date(2026, 10, 6, 18, 59))
    await speak('en')
    expect(expiryText(exp, t, NOW)).toBe('SharedConnect.Expires(6:59 PM)')
    await speak('fr')
    expect(expiryText(exp, t, NOW)).toBe('SharedConnect.Expires(6:59 PM)')
    await speak('pt-BR')
    expect(expiryText(exp, t, NOW)).toBe('SharedConnect.Expires(6:59 PM)')
  })

  test('six days ahead, read after that hour today: the day is named, so it does not read as past', async () => {
    const exp = seconds(new Date(2026, 10, 12, 8, 59))
    await speak('en')
    expect(expiryText(exp, t, NOW)).toBe('SharedConnect.ExpiresOn(12 Nov, 08:59)')
    await speak('fr')
    expect(expiryText(exp, t, NOW)).toBe('SharedConnect.ExpiresOn(12 nov. à 08:59)')
    await speak('pt-BR')
    expect(expiryText(exp, t, NOW)).toBe('SharedConnect.ExpiresOn(12 de nov. às 08:59)')
  })

  test('just past midnight: tomorrow is another day', async () => {
    await speak('en')
    const lateEvening = new Date(2026, 10, 6, 23, 50)
    expect(expiryText(seconds(new Date(2026, 10, 7, 0, 30)), t, lateEvening)).toBe(
      'SharedConnect.ExpiresOn(7 Nov, 00:30)'
    )
  })

  test('into next year: with its year', async () => {
    await speak('en')
    const newYearsEve = new Date(2026, 11, 31, 20, 0)
    expect(expiryText(seconds(new Date(2027, 0, 2, 8, 59)), t, newYearsEve)).toBe(
      'SharedConnect.ExpiresOn(2 Jan 2027, 08:59)'
    )
  })
})
