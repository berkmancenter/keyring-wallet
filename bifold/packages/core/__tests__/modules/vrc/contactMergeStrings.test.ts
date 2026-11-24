/**
 * The merged-removal strings resolve through real i18next, as the app sets it up (translationResources, plural
 * suffixes), not the test mock that returns keys: a missing key, or a plural that resolves to the key itself, fails
 * here.
 */
import i18next from 'i18next'

import { translationResources } from '../../../src/localization'

const words = (count: number) => ({ name: 'Alice Smith', count, interpolation: { escapeValue: false } })

async function instance(lng: string) {
  const i18n = i18next.createInstance()
  await i18n.init({ lng, fallbackLng: 'en', resources: translationResources })
  return i18n
}

describe('merged-removal strings', () => {
  test('English: the sentence the person reads, with the count, for two relationships', async () => {
    const i18n = await instance('en')
    expect(i18n.t('ContactDetails.MergedRemoveBody', words(2))).toBe(
      "This removes 2 relationships with Alice Smith, including the cards from all of them, and can't be undone. If they're different people, separate them first."
    )
    expect(i18n.t('ContactDetails.MergedRemoveConfirm', words(2))).toBe('Remove all 2')
    expect(i18n.t('ContactDetails.MergedRemoveTitle', words(2))).toBe('Remove Alice Smith?')
    expect(i18n.t('ContactDetails.MergedRemoveSeparate')).toBe('Separate them instead')
  })

  test.each(['en', 'fr', 'pt-BR'])('%s: every merged-removal string resolves, singular and plural', async (lng) => {
    const i18n = await instance(lng)
    // A key missing from fr or pt-BR falls back to English and would still look resolved; it must be its own words.
    const english = await instance('en')
    for (const key of ['MergedRemoveTitle', 'MergedRemoveBody', 'MergedRemoveConfirm', 'MergedRemoveSeparate']) {
      for (const count of [1, 2, 3]) {
        const text = i18n.t(`ContactDetails.${key}`, words(count))
        expect(text).not.toContain('ContactDetails.')
        expect(text).not.toContain('{{')
        if (key === 'MergedRemoveBody' || key === 'MergedRemoveConfirm') expect(text).toContain(String(count))
        if (lng !== 'en') expect(text).not.toBe(english.t(`ContactDetails.${key}`, words(count)))
      }
    }
  })
})

describe('merge-all strings', () => {
  const all = (count: number) => ({ name: 'Alice Smith', count, interpolation: { escapeValue: false } })

  test('English: the offer counts the other contacts, the confirmation counts all of them', async () => {
    const i18n = await instance('en')
    expect(i18n.t('ContactDetails.MergeAllOfferBody', all(2))).toBe(
      "You have 2 other contacts named Alice Smith. If they're all the same person, merge them into one contact. Nothing is deleted, and you can separate them again."
    )
    expect(i18n.t('ContactDetails.MergeAllConfirmTitle', all(3))).toBe('Merge all 3 Alice Smith contacts?')
    expect(i18n.t('ContactDetails.MergeAll')).toBe('Merge all')
  })

  test.each(['en', 'fr', 'pt-BR'])('%s: every merge-all string resolves, in its own words', async (lng) => {
    const i18n = await instance(lng)
    const english = await instance('en')
    for (const key of ['MergeAll', 'MergeAllOfferBody', 'MergeAllConfirmTitle', 'MergeAllConfirmBody']) {
      const text = i18n.t(`ContactDetails.${key}`, all(3))
      expect(text).not.toContain('ContactDetails.')
      expect(text).not.toContain('{{')
      if (key !== 'MergeAll' && key !== 'MergeAllConfirmBody') expect(text).toContain('3')
      if (lng !== 'en') expect(text).not.toBe(english.t(`ContactDetails.${key}`, all(3)))
    }
  })
})
