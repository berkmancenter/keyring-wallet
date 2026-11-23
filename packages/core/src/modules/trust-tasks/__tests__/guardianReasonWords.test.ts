/**
 * Every reason a Guardian card or its authorization can be refused with has plain words on Who approves (Alberto's
 * hand run on 278.18, 2026-11-13: "Details: noWard" reached the screen). The reason codes are read from the files that
 * raise them, so a new code fails here until it is worded; and each group's words exist in en, fr and pt-BR.
 */
import fs from 'fs'
import path from 'path'

import {
  GUARDIAN_REASON_GROUPS,
  guardianReasonGroup,
  guardianReasonKeys,
  type GuardianReasonGroup,
} from '../screens/approver/guardianReasonWords'

const SRC = path.resolve(__dirname, '../..')
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8')

/** The string literals in `export type RefusalReason = | 'a' | 'b' ...` of the SEDI chain check. */
const chainReasons = (): string[] => {
  const text = read('sedi/guardian/chain.ts')
  const block = /export type RefusalReason =([^]*?)\n\n/.exec(text)?.[1] ?? ''
  return [...block.matchAll(/'([A-Za-z0-9]+)'/g)].map((m) => m[1])
}

/**
 * The reason codes a file raises itself: refuse('x', ...), and every quoted code in what a `reason:` is set to, in any
 * shape (a literal, or a ternary such as guardianEvidence's `fromRoot ? 'revokedInStateRecord' : ...`), so a code
 * assigned a new way is still seen (ac, #1063).
 */
const raisedIn = (rel: string): string[] => {
  const text = read(rel)
  return [
    ...[...text.matchAll(/refuse\('([A-Za-z0-9]+)'/g)].map((m) => m[1]),
    ...[...text.matchAll(/reason: ([^,\n]+)/g)].flatMap((m) =>
      [...m[1].matchAll(/'([A-Za-z0-9]+)'/g)].map((q) => q[1])
    ),
  ]
}

const locale = (loc: string) =>
  JSON.parse(read(`../localization/${loc}/${loc}.json`)) as {
    Approver: { Reason: Record<string, string>; ReasonDo: Record<string, string> }
  }

const GROUPS: GuardianReasonGroup[] = [
  ...new Set<GuardianReasonGroup>([...Object.values(GUARDIAN_REASON_GROUPS), 'other']),
]

describe('guardianReasonWords: every refusal has words', () => {
  test('the scans find the codes they should (control: the noWard and kelNotReplaying the screen once showed)', () => {
    expect(chainReasons()).toEqual(expect.arrayContaining(['kelNotReplaying', 'wardMismatch', 'chainMissing']))
    expect(chainReasons().length).toBeGreaterThanOrEqual(22)
    expect(raisedIn('trust-tasks/guardianEvidence.ts')).toEqual(
      expect.arrayContaining(['noWard', 'tooLarge', 'untrustedRoot', 'checkFailed', 'stateHostRefused'])
    )
    expect(raisedIn('trust-tasks/socialAuthorization.ts')).toEqual(
      expect.arrayContaining(['notThisAuthorization', 'notTheHolder', 'notThisCard'])
    )
    // a code set through a ternary, found with no special case
    expect(raisedIn('trust-tasks/guardianEvidence.ts')).toEqual(
      expect.arrayContaining(['revokedInStateRecord', 'revokedInIssuerRecord'])
    )
    // the chain check's own decide() raises these itself (sedi/guardian/index.ts)
    expect(raisedIn('sedi/guardian/index.ts')).toEqual(
      expect.arrayContaining(['unsupportedCesr', 'malformedCesr', 'kelNotReplaying', 'switchedOff'])
    )
  })

  test.each([
    ['sedi/guardian/chain.ts', chainReasons],
    ['trust-tasks/guardianEvidence.ts', () => raisedIn('trust-tasks/guardianEvidence.ts')],
    ['trust-tasks/socialAuthorization.ts', () => raisedIn('trust-tasks/socialAuthorization.ts')],
    ['sedi/guardian/index.ts', () => raisedIn('sedi/guardian/index.ts')],
  ])('each code %s raises is listed, so none falls to the general words', (_file, codes) => {
    const unlisted = (codes as () => string[])().filter((code) => !(code in GUARDIAN_REASON_GROUPS))
    expect(unlisted).toEqual([])
  })

  test("a code not listed reads as 'other', even one named like an Object property (control: noWard is its own)", () => {
    expect(guardianReasonGroup('someNewReason')).toBe('other')
    expect(guardianReasonGroup('toString')).toBe('other')
    expect(guardianReasonGroup('noWard')).toBe('noWard')
    expect(guardianReasonKeys('noWard')).toEqual({ what: 'Approver.Reason.noWard', todo: 'Approver.ReasonDo.noWard' })
  })

  test.each(['en', 'fr', 'pt-br'])('%s has both lines for every group, and no code in the words', (loc) => {
    const { Reason, ReasonDo } = locale(loc).Approver
    for (const group of GROUPS) {
      expect([group, typeof Reason[group], typeof ReasonDo[group]]).toEqual([group, 'string', 'string'])
    }
    expect(Object.keys(Reason).sort()).toEqual([...GROUPS].sort())
    expect(Object.keys(ReasonDo).sort()).toEqual([...GROUPS].sort())
    // camelCase codes only: 'expired' and 'revoked' are also plain words
    const codes = Object.keys(GUARDIAN_REASON_GROUPS).filter((code) => /[A-Z]/.test(code))
    expect(codes).toEqual(expect.arrayContaining(['noWard', 'kelNotReplaying']))
    for (const words of [...Object.values(Reason), ...Object.values(ReasonDo)])
      expect(codes.filter((code) => words.includes(code))).toEqual([])
  })

  test("the noWard words say where to fix it (en), as Alberto asked: the Ward demo switch, or the office and this phone's ward code", () => {
    expect(locale('en').Approver.ReasonDo.noWard).toBe(
      "For the test card, turn on Settings › Developer › Demos › Ward demo. For a card from a state office, check the office used this phone's ward code."
    )
  })

  test('no refusal words name the old "Set up as the person" step, in any language (11-14: the switch is "Ward demo")', () => {
    for (const lng of ['en', 'fr', 'pt-br'] as const) {
      const words = JSON.stringify([locale(lng).Approver.Reason, locale(lng).Approver.ReasonDo])
      expect(words).not.toMatch(/Set up as the person|Préparer comme la personne|Preparar como a pessoa/)
    }
  })
})
