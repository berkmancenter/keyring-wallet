/**
 * A profile's label as this phone shows it: the stored default ("My Profile", data, in English) in the app's language,
 * and a label the person chose exactly as they wrote it.
 */
import i18next, { type TFunction } from 'i18next'

import en from '../../../src/localization/en/en.json'
import fr from '../../../src/localization/fr/fr.json'
import ptBr from '../../../src/localization/pt-br/pt-br.json'
import { DEFAULT_LABEL, profileLabel } from '../../../src/modules/vrc/types/rcard'

function tIn(language: string, translation: object): TFunction {
  const i18n = i18next.createInstance()
  i18n.init({ lng: language, resources: { [language]: { translation } }, initImmediate: false })
  return i18n.t.bind(i18n) as TFunction
}

describe('a profile label', () => {
  test.each([
    ['en', en, 'My Profile'],
    ['fr', fr, 'Mon profil'],
    ['pt-BR', ptBr, 'Meu perfil'],
  ])('the stored default reads in %s', (language, translation, expected) => {
    expect(profileLabel(DEFAULT_LABEL, tIn(language, translation))).toBe(expected)
    expect(profileLabel(undefined, tIn(language, translation))).toBe(expected)
  })

  test('a label the person chose is never translated', () => {
    expect(profileLabel('Work', tIn('fr', fr))).toBe('Work')
    expect(profileLabel('My profile', tIn('fr', fr))).toBe('My profile')
  })
})
