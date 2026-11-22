/**
 * An OpenID credential's dates (issued, valid from, valid until), in the app's language and the phone's clock. They
 * were forced to US English; these words are ours (utils/localDay.ts).
 */
import * as RNLocalize from 'react-native-localize'

import { formatDate } from '../../../src/modules/openid/utils/utils'
import { speak } from '../../helpers/appLanguage'

// The phone's 12/24-hour setting, as a jest.fn both this file and utils/localDay share (a spy on this file's
// namespace copy would not reach localDay's).
jest.mock('react-native-localize', () => ({
  ...jest.requireActual('react-native-localize/mock'),
  uses24HourClock: jest.fn(() => true),
}))
const uses24HourClock = RNLocalize.uses24HourClock as jest.Mock

const AT = new Date(2026, 9, 15, 16, 1)

describe('an OpenID credential’s date', () => {
  test('French and Portuguese, by the phone’s clock', async () => {
    await speak('fr')
    expect(formatDate(AT)).toBe('15 oct. 2026 à 16:01')
    await speak('pt-BR')
    expect(formatDate(AT.toISOString())).toBe('15 de out. de 2026 às 16:01')
    await speak('en')
  })

  test('a 12-hour phone gets the 12-hour clock, whatever the language', async () => {
    uses24HourClock.mockReturnValue(false)
    try {
      await speak('fr')
      expect(formatDate(AT)).toBe('15 oct. 2026 à 4:01 PM')
    } finally {
      uses24HourClock.mockReturnValue(true)
      await speak('en')
    }
  })
})
