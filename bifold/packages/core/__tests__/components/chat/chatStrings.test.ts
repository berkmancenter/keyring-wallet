import i18next from 'i18next'

import en from '../../../src/localization/en/en.json'

// The real English strings through real i18next (the jest mock of react-i18next returns keys and ignores options).
describe('chat strings that carry a contact name', () => {
  const i18n = i18next.createInstance()
  beforeAll(async () => {
    await i18n.init({ lng: 'en', resources: { en: { translation: en } } })
  })

  it('shows the name as typed when escaping is off, as Chat.tsx asks', () => {
    expect(i18n.t('Chat.ReactionNeedsUpdate', { name: 'Ana/Bea & Co', interpolation: { escapeValue: false } })).toBe(
      'Reactions need Ana/Bea & Co to update Keyring.'
    )
  })

  it('would show entities with the default escaping, which is why the option is passed', () => {
    expect(i18n.t('Chat.ReactionNeedsUpdate', { name: 'Ana/Bea & Co' })).toContain('&#x2F;')
  })

  it('has no placeholder left unfilled', () => {
    expect(i18n.t('Chat.ReactionNeedsUpdate', { name: 'Ana', interpolation: { escapeValue: false } })).not.toMatch(
      /\{\{|\}\}/
    )
  })
})
