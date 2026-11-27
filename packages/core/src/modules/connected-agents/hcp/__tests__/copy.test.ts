/**
 * `copy.ts` held to the brief's "Copy" table: every key present and no other, the three languages non-empty and
 * distinct, the same placeholder names in all three, and none of the words plan §6's copy rules forbid.
 */
import { HCP_COPY, type HcpCopyKey, hcpPlaceholders, hcpText } from '../copy'

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
  'NewMemoryTitle',
  'NewMemoryField',
  'NewMemoryHelper',
  'NewMemorySave',
  'MemoryNotSaved',
]
const FORBIDDEN = /instant|encrypted|private|no trace/i

describe('HCP_COPY', () => {
  it('has exactly the keys of the brief’s table', () => {
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
