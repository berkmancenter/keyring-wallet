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
  // Added at review: the approve flow's failed and cancelled, one key per case.
  'ApproveNotApproved',
  'ApproveNotRecorded',
  'ApproveDeclined',
  'ApproveAnsweredElsewhere',
  'ApproveCancelled',
  // Added for backlog 2, track 5: nothing was disclosed under the grant, so "Revoked." alone.
  'RevokeNothingDisclosed',
  // Added for the VTI hcp.md §5.1 contract: the request names no purpose, so the purposes approving allows.
  'ApproveAllowsPurposes',
  // Added at review: terms V0 cannot approve (not temporary; an expiry outside the next 24 hours).
  'ApproveNotTemporary',
  'ApproveBadTerm',
  // Added for the VTI hcp.md §5.1 contract: "not signing in" is Keyring's own line, no longer an effect.
  'ApproveNotSignIn',
  // Added for the "Telling…" rule: not told with the time past; already expired; already disconnected.
  'RevokeNotToldPast',
  'RevokeAlreadyEnded',
  'RevokeAlreadyDisconnected',
  // Added at review of the §5.1 alignment: a revoke with nothing sent, the grant not yet issued or not told apart.
  'RevokeNotYetIssued',
  'RevokeGrantAmbiguous',
]
const APPROVE_ENDINGS = [
  'ApproveNotApproved',
  'ApproveNotRecorded',
  'ApproveDeclined',
  'ApproveAnsweredElsewhere',
  'ApproveCancelled',
] as const satisfies readonly HcpCopyKey[]
/** An offer of another attempt, in any of the three languages. */
const RETRY = /try again|again|retry|réessa|relance|de nouveau|à nouveau|tente de novo|novamente|de novo/i
const FORBIDDEN = /instant|encrypted|private|no trace/i

describe('HCP_COPY', () => {
  it('has exactly the keys of the brief’s table, and the keys added at review', () => {
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

  it('"Revoked." alone is PROPOSED, names no one, and is the opening of the other notice lines in each language', () => {
    const line = HCP_COPY.RevokeNothingDisclosed
    expect(line.en).toBe('Revoked.')
    expect(line.source).toBe('PROPOSED')
    expect(hcpPlaceholders(line.en)).toEqual([])
    for (const lang of ['en', 'fr', 'ptBr'] as const) {
      for (const key of ['RevokeTelling', 'RevokeTold', 'RevokeNotTold', 'RevokeNotToldPast'] as const) {
        expect(HCP_COPY[key][lang].startsWith(`${line[lang]} `)).toBe(true)
      }
    }
  })

  it('the "Telling…" rule’s new lines are PROPOSED and name the agent; the past tense differs from the present', () => {
    for (const key of ['RevokeNotToldPast', 'RevokeAlreadyEnded', 'RevokeAlreadyDisconnected'] as const) {
      expect(HCP_COPY[key].source).toBe('PROPOSED')
      expect(hcpPlaceholders(HCP_COPY[key].en)).toContain('name')
    }
    expect(hcpPlaceholders(HCP_COPY.RevokeNotToldPast.en)).toEqual(hcpPlaceholders(HCP_COPY.RevokeNotTold.en))
    for (const lang of ['en', 'fr', 'ptBr'] as const) {
      expect(HCP_COPY.RevokeNotToldPast[lang]).not.toBe(HCP_COPY.RevokeNotTold[lang])
      expect(HCP_COPY.RevokeAlreadyEnded[lang]).not.toBe(HCP_COPY.RevokeAlreadyDisconnected[lang])
    }
  })

  // control: the opening check bites on a line that does not open with "Revoked.".
  it('control: the opening check fails for a line that is not the notice’s', () => {
    expect(HCP_COPY.RevokeTitle.en.startsWith(`${HCP_COPY.RevokeNothingDisclosed.en} `)).toBe(false)
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

  it('the approve endings are PROPOSED; only "not approved" offers another attempt, never "approved but not recorded"', () => {
    for (const key of APPROVE_ENDINGS) expect(HCP_COPY[key].source).toBe('PROPOSED')
    for (const key of APPROVE_ENDINGS) {
      const { en, fr, ptBr } = HCP_COPY[key]
      for (const text of [en, fr, ptBr]) {
        if (key === 'ApproveNotApproved') expect(text).toMatch(RETRY)
        else expect(text).not.toMatch(RETRY)
      }
    }
    // Approved but not recorded names the agent, and says it will show as connected rather than that it failed.
    expect(hcpPlaceholders(HCP_COPY.ApproveNotRecorded.en)).toEqual(['name'])
    expect(HCP_COPY.ApproveNotRecorded.en).toMatch(/approved/i)
    expect(HCP_COPY.ApproveNotRecorded.en).toMatch(/connected/i)
    // Five cases, five strings.
    expect(new Set(APPROVE_ENDINGS.map((k) => HCP_COPY[k].en)).size).toBe(APPROVE_ENDINGS.length)
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
