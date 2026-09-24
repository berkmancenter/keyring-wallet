/**
 * 218 feedback: "This community needs 1 statement(s) verifying: name.legal."
 * A claim reads as words, never as its key, and counts are plural properly.
 */
import i18n from 'i18next'

import en from '../../../localization/en/en.json'
import { claimList, claimWords, needWords } from '../screens/claimWords'

beforeAll(async () => {
  await i18n.init({ lng: 'en', resources: { en: { translation: en } }, interpolation: { escapeValue: false } })
})
const t = i18n.t.bind(i18n)

describe('claims in words', () => {
  it('a known claim has its own words', () => {
    expect(claimWords('name.legal', t)).toBe('your legal name')
  })
  it('an unknown claim is spelt out from its key, never dotted', () => {
    expect(claimWords('address.postal', t)).toBe('your address postal')
    expect(claimWords('dateOfBirth', t)).toBe('your date of birth')
    expect(claimWords('x.y_z', t)).not.toMatch(/[._]/)
  })
  it('several read as one phrase', () => {
    expect(claimList(['name.legal'], t)).toBe('your legal name')
    expect(claimList(['name.legal', 'dateOfBirth'], t)).toBe('your legal name and your date of birth')
  })
})

describe('what the screen says', () => {
  it('the requirement Alberto saw, as he asked for it', () => {
    expect(t('Vetting.Requirements', { count: 1, claims: claimList(['name.legal'], t) })).toBe(
      'This community needs 1 vetter to confirm your legal name.'
    )
  })
  it('counts past one stay right, without "(s)"', () => {
    expect(t('Vetting.Requirements', { count: 3, claims: 'your legal name' })).toBe(
      'This community needs 3 vetters to confirm your legal name.'
    )
    expect(t('Vetting.NeedsStatements', { count: 1 })).toBe('1 more statement')
    expect(t('Vetting.NeedsStatements', { count: 2 })).toBe('2 more statements')
    expect(t('Vetting.Discounted', { count: 2 })).toMatch(/^2 statements will not count/)
    expect(t('Vetting.GrantUnchecked', { count: 2 })).toMatch(/^2 vetters' grants could not be checked/)
  })
  it('no "(s)" left anywhere in the vetting copy', () => {
    expect(JSON.stringify(en.Vetting)).not.toMatch(/\(s\)/)
  })
})

describe('what a community asked for when it deferred', () => {
  it('reads its keys as words', () => {
    expect(needWords('vetting:statements:1', t)).toBe('1 more statement')
    expect(needWords('vetting:statements:2', t)).toBe('2 more statements')
    expect(needWords('claim:name.legal', t)).toBe('your legal name')
    expect(needWords('something:odd.key', t)).toBe('something odd key')
  })
})
