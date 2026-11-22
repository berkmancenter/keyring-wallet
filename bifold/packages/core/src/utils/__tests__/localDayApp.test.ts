/**
 * The date words where no hook can be used (`appDateWords`): the app's own i18n instance, in whatever language the
 * app speaks, and English from our own locale file before that instance is set up. Order matters in this file: the
 * first test runs before the instance is initialised, the rest after.
 */
import i18n from 'i18next'
import * as RNLocalize from 'react-native-localize'

import { speak } from '../../../__tests__/helpers/appLanguage'
import { absoluteDate, appDateWords, dateTime, phoneUses24HourClock, shortDate, wholeDaysBetween } from '../localDay'

// The phone's 12/24-hour setting, as a jest.fn both this file and utils/localDay share (a spy on this file's
// namespace copy would not reach localDay's).
jest.mock('react-native-localize', () => ({
  ...jest.requireActual('react-native-localize/mock'),
  uses24HourClock: jest.fn(() => true),
}))
const uses24HourClock = RNLocalize.uses24HourClock as jest.Mock

// Thursday 15 October 2026, 16:01 local.
const at = new Date(2026, 9, 15, 16, 1)

describe('date words outside a component', () => {
  test('before the app’s i18n is set up, they are English, from our own locale file', () => {
    expect(i18n.isInitialized).toBeFalsy()
    expect(absoluteDate(at, appDateWords())).toBe('15 Oct 2026')
  })

  test('they follow the language the app speaks', async () => {
    await speak('fr')
    expect(absoluteDate(at, appDateWords())).toBe('15 oct. 2026')
    expect(dateTime(at, appDateWords(), true)).toBe('15 oct. 2026 à 16:01')

    await speak('pt-BR')
    expect(absoluteDate(at, appDateWords())).toBe('15 de out. de 2026')
    expect(shortDate(at, appDateWords(), 'never')).toBe('15 de out.')

    await speak('en')
    expect(absoluteDate(at, appDateWords())).toBe('15 Oct 2026')
  })

  test('the clock is the phone’s setting', () => {
    uses24HourClock.mockReturnValue(false)
    try {
      expect(phoneUses24HourClock()).toBe(false)
      expect(dateTime(at, appDateWords(), phoneUses24HourClock())).toBe('15 Oct 2026, 4:01 PM')
    } finally {
      uses24HourClock.mockReturnValue(true)
    }
    expect(phoneUses24HourClock()).toBe(true)
  })

  // On a phone, English before i18n is set up would look like the Hermes bug, so it is logged once; jest stays quiet.
  test('outside jest, English before i18n is set up is logged, once', () => {
    const worker = process.env.JEST_WORKER_ID
    delete process.env.JEST_WORKER_ID
    try {
      jest.isolateModules(() => {
        const { bifoldLoggerInstance } = require('../../services/bifoldLogger')
        const warn = jest.spyOn(bifoldLoggerInstance, 'warn').mockImplementation(() => undefined)
        const fresh = require('../localDay') as typeof import('../localDay')
        expect(require('i18next').isInitialized).toBeFalsy()

        fresh.appDateWords()
        fresh.appDateWords()

        expect(warn).toHaveBeenCalledTimes(1)
        expect(warn).toHaveBeenCalledWith("[dates] date words read before the app's i18n was set up; English used")
      })
    } finally {
      process.env.JEST_WORKER_ID = worker
    }
  }, 20_000)
})

// The run is in UTC (jest.config.js), where no day has 23 or 25 hours, so the rounding is held to it here, at the
// arithmetic, rather than through a clock change no test can reach.
describe('whole days between two local midnights', () => {
  const HOUR = 3_600_000
  test('a day of 23 or 25 hours (a clock change) is still one day, and two such days are two', () => {
    expect(wholeDaysBetween(0, 24 * HOUR)).toBe(1)
    expect(wholeDaysBetween(0, 23 * HOUR)).toBe(1)
    expect(wholeDaysBetween(0, 25 * HOUR)).toBe(1)
    expect(wholeDaysBetween(0, 47 * HOUR)).toBe(2)
    expect(wholeDaysBetween(0, 0)).toBe(0)
  })
})
