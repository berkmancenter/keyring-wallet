/**
 * Times and dates on the agent and vetting screens, in the app's language and the phone's clock: Hermes in a release
 * build answered toLocaleTimeString/toLocaleDateString in English whatever the language, so these words are ours
 * (utils/localDay.ts).
 */
import type { TFunction } from 'i18next'
import * as RNLocalize from 'react-native-localize'

import { speak } from '../../../../__tests__/helpers/appLanguage'
import { connectionText } from '../screens/VtaStatus'
import { whenShown } from '../screens/VtiVetting'

// The phone's 12/24-hour setting, as a jest.fn both this file and utils/localDay share (a spy on this file's
// namespace copy would not reach localDay's).
jest.mock('react-native-localize', () => ({
  ...jest.requireActual('react-native-localize/mock'),
  uses24HourClock: jest.fn(() => true),
}))
const uses24HourClock = RNLocalize.uses24HourClock as jest.Mock

// Thursday 15 October 2026, 16:01 local; "now" two days on.
const AT = new Date(2026, 9, 15, 16, 1).toISOString()
const LATER = new Date(2026, 9, 17, 9, 0)
const SAME_DAY = new Date(2026, 9, 15, 20, 0)
const t = ((key: string, options?: { time?: string }) => (options?.time ? `${key}(${options.time})` : key)) as TFunction

describe('when a vetting step was shown', () => {
  test('today: the time alone; another day: its date and time', async () => {
    await speak('en')
    expect(whenShown(AT, SAME_DAY)).toBe('16:01')
    expect(whenShown(AT, LATER)).toBe('15 Oct, 16:01')
  })

  test('in French and Portuguese', async () => {
    await speak('fr')
    expect(whenShown(AT, LATER)).toBe('15 oct. à 16:01')
    await speak('pt-BR')
    expect(whenShown(AT, LATER)).toBe('15 de out. às 16:01')
    await speak('en')
  })

  test('on a 12-hour phone', async () => {
    uses24HourClock.mockReturnValue(false)
    try {
      expect(whenShown(AT, SAME_DAY)).toBe('4:01 PM')
    } finally {
      uses24HourClock.mockReturnValue(true)
    }
  })
})

describe('the agent offline since', () => {
  test('a time by the phone’s clock, in the app’s words', async () => {
    const since = new Date(2026, 9, 15, 14, 2).getTime()
    await speak('fr')
    expect(connectionText({ kind: 'offline', since } as never, t)).toBe('VtaLink.StatusOfflineSince(14:02)')
    uses24HourClock.mockReturnValue(false)
    try {
      await speak('pt-BR')
      expect(connectionText({ kind: 'offline', since } as never, t)).toBe('VtaLink.StatusOfflineSince(2:02 PM)')
    } finally {
      uses24HourClock.mockReturnValue(true)
      await speak('en')
    }
  })
})
