/**
 * A relationship or witness credential's date, in the app's language and the phone's clock: Hermes in a release build
 * answered toLocaleDateString in English whatever the language, so these words are ours (utils/localDay.ts).
 */
import { formatDateForDisplay } from '../../../../src/modules/vrc/display/types'
import { speak } from '../../../helpers/appLanguage'

// 15 October 2026, 16:01 local.
const ISSUED = new Date(2026, 9, 15, 16, 1).toISOString()

describe('a credential’s date for display', () => {
  test('French and Portuguese, by the phone’s clock', async () => {
    await speak('fr')
    expect(formatDateForDisplay(ISSUED)).toBe('15 oct. 2026 à 16:01')
    await speak('pt-BR')
    expect(formatDateForDisplay(ISSUED)).toBe('15 de out. de 2026 às 16:01')
    await speak('en')
    expect(formatDateForDisplay(ISSUED)).toBe('15 Oct 2026, 16:01')
  })

  test('what cannot be read comes back as it was, and nothing is nothing', () => {
    expect(formatDateForDisplay('not a date')).toBe('not a date')
    expect(formatDateForDisplay(undefined)).toBe('')
  })
})
