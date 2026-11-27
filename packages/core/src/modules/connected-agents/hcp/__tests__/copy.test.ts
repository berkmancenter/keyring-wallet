/**
 * `copy.ts` held to the brief's "Copy" table: every key present and no other, the three languages non-empty and
 * distinct, the same placeholder names in all three, and none of the words plan §6's copy rules forbid.
 */
import { HCP_COPY, HCP_REFUSAL_KEYS, type HcpCopyKey, hcpPlaceholders, hcpText } from '../copy'

const KEYS: HcpCopyKey[] = [
  'ApproveTitle',
  'ApproveOwnTerminal',
  'Approve',
  'CodeExpired',
  'WrongNumber',
  'Locked',
  'StatusConnectedUntil',
  'StatusExpired',
  'StatusRevoked',
  'RevokeTelling',
  'RevokeTold',
  'RevokeNotTold',
  'RevokeTitle',
  'RevokeBody',
  'Revoke',
  'Keep',
  'RevokeUnreachable',
  'RevokeRefused',
  'NewMemoryTitle',
  'NewMemoryField',
  'NewMemoryHelper',
  'NewMemorySave',
  'MemoryNotSaved',
  // Added at review, beyond the brief's table: the refusals.
  'MemoryRefused',
  // Added at review: no manager DID, so not signed in to a VTA.
  'MemoryNoVta',
]
/** An offer of another attempt, in any of the three languages. */
const RETRY = /try again|again|retry|réessa|relance|de nouveau|à nouveau|tente de novo|novamente|de novo/i
const FORBIDDEN = /instant|encrypted|private|no trace/i

describe('HCP_COPY', () => {
  it('has exactly the keys of the brief’s table, and the three keys added at review', () => {
    expect(Object.keys(HCP_COPY).sort()).toEqual([...KEYS].sort())
  })

  it.each(KEYS)('%s: three non-empty, distinct strings with the same placeholders', (key) => {
    const { en, fr, ptBr, source } = HCP_COPY[key]
    for (const text of [en, fr, ptBr]) expect(text.trim()).not.toBe('')
    expect(new Set([en, fr, ptBr]).size).toBe(3)
    expect(hcpPlaceholders(fr)).toEqual(hcpPlaceholders(en))
    expect(hcpPlaceholders(ptBr)).toEqual(hcpPlaceholders(en))
    expect(['companion finding 6', 'plan §6', 'PROPOSED']).toContain(source)
  })

  it.each(KEYS)('%s: none of the forbidden words', (key) => {
    const { en, fr, ptBr } = HCP_COPY[key]
    for (const text of [en, fr, ptBr]) expect(text).not.toMatch(FORBIDDEN)
  })

  it('holds the brief’s English for the strings the plan and the companion fixed', () => {
    expect(HCP_COPY.ApproveTitle.en).toBe('Connect "{{name}}"?')
    expect(HCP_COPY.RevokeTold.en).toBe('Revoked. "{{name}}" was told at {{time}}.')
    expect(HCP_COPY.RevokeTelling.en).toBe('Revoked. Telling "{{name}}"…')
    expect(HCP_COPY.MemoryNotSaved.source).toBe('PROPOSED')
  })

  it('control: the checks bite on a string that breaks them', () => {
    expect('Gone in an instant').toMatch(FORBIDDEN)
    expect(hcpPlaceholders('Révoqué. « {{nom}} »')).not.toEqual(hcpPlaceholders(HCP_COPY.RevokeTitle.en))
  })

  it('a refusal has its own key per case, PROPOSED, and offers no retry in any language', () => {
    expect([...HCP_REFUSAL_KEYS].sort()).toEqual(['MemoryRefused', 'RevokeRefused'])
    for (const key of HCP_REFUSAL_KEYS) {
      const { en, fr, ptBr, source } = HCP_COPY[key]
      expect(source).toBe('PROPOSED')
      for (const text of [en, fr, ptBr]) expect(text).not.toMatch(RETRY)
    }
    // Not the unreachable strings under another name.
    expect(HCP_COPY.RevokeRefused.en).not.toBe(HCP_COPY.RevokeUnreachable.en)
    expect(HCP_COPY.MemoryRefused.en).not.toBe(HCP_COPY.MemoryNotSaved.en)
    expect(hcpPlaceholders(HCP_COPY.RevokeRefused.en)).toEqual(['name'])
  })

  it('no manager DID has its own key, PROPOSED, not the unreachable or refused strings, and offers no retry', () => {
    const { en, fr, ptBr, source } = HCP_COPY.MemoryNoVta
    expect(source).toBe('PROPOSED')
    for (const text of [en, fr, ptBr]) expect(text).not.toMatch(RETRY)
    for (const lang of ['en', 'fr', 'ptBr'] as const) {
      expect(HCP_COPY.MemoryNoVta[lang]).not.toBe(HCP_COPY.MemoryNotSaved[lang])
      expect(HCP_COPY.MemoryNoVta[lang]).not.toBe(HCP_COPY.MemoryRefused[lang])
    }
    expect(en).not.toMatch(/couldn't reach/i)
  })

  // control: the retry check bites, in each language, on the strings that do offer another attempt.
  it('control: the retry check matches an offer of another attempt in each language', () => {
    expect(HCP_COPY.Locked.en).toMatch(RETRY)
    expect(HCP_COPY.Locked.fr).toMatch(RETRY)
    expect(HCP_COPY.Locked.ptBr).toMatch(RETRY)
    expect(HCP_COPY.CodeExpired.en).toMatch(RETRY)
    expect(HCP_COPY.CodeExpired.fr).toMatch(RETRY)
    expect(HCP_COPY.CodeExpired.ptBr).toMatch(RETRY)
  })
})

describe('hcpText', () => {
  it('fills the placeholders, in each language', () => {
    expect(hcpText('RevokeTold', 'en', { name: 'hcp-demo', time: '10:07' })).toBe(
      'Revoked. "hcp-demo" was told at 10:07.'
    )
    expect(hcpText('Locked', 'fr', { n: '5' })).toBe('Trop de numéros erronés. Réessayez dans 5 minutes.')
    expect(hcpText('ApproveTitle', 'ptBr', { name: 'x' })).toBe('Conectar "x"?')
  })

  it('control: leaves a placeholder with no value as it is', () => {
    expect(hcpText('ApproveTitle', 'en')).toBe('Connect "{{name}}"?')
  })
})
