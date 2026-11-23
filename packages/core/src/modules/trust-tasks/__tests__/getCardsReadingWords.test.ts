import i18next from 'i18next'

import en from '../../../localization/en/en.json'
import fr from '../../../localization/fr/fr.json'
import ptBr from '../../../localization/pt-br/pt-br.json'

// Bring back's progress line through real i18next (the jest mock of react-i18next returns keys), at the first card
// read, where a noun agreeing with the count read would be wrong: "1 cartes".
describe('bring back says how many cards it is reading, at one card and at many', () => {
  const i18n = i18next.createInstance()
  beforeAll(async () => {
    await i18n.init({
      lng: 'en',
      resources: { en: { translation: en }, fr: { translation: fr }, 'pt-BR': { translation: ptBr } },
    })
  })
  const line = (lng: string, read: number, found: number) =>
    i18n.getFixedT(lng)('VtaLink.GetCardsReading', { read, found })

  it('French puts the counts after the noun, so it reads right at 1', () => {
    expect(line('fr', 1, 88)).toBe('Lecture des cartes de votre agent : 1 sur 88…')
    expect(line('fr', 1, 88)).not.toMatch(/\b1 cartes\b/)
    expect(line('fr', 12, 88)).toBe('Lecture des cartes de votre agent : 12 sur 88…')
  })

  it('English and Portuguese count "of N cards", which reads right at 1', () => {
    expect(line('en', 1, 88)).toBe('Reading 1 of 88 cards from your agent…')
    expect(line('pt-BR', 1, 88)).toBe('Lendo 1 de 88 cartões do seu agente…')
  })
})
