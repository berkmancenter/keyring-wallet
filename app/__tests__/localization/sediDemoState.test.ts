/**
 * The Developer › Demos set-up lines for the SEDI demo name the K0 test state as its card does: "Example State", the
 * name bifold gives K0_TEST_ROOT in every language. They said "State of Utah", which is K1's name (bifold #1062 drew
 * the K0 Example State / K1 State of Utah line), so a tester could not tell the two apart. Pinned by literals: a drift
 * back to Utah, or a line naming both, fails here; nothing else reads these words (the screens match on the keys).
 */
import en from '../../src/localization/en'
import fr from '../../src/localization/fr'
import ptBr from '../../src/localization/pt-br'

const LINES = ['SetUpSediDemoGuardianHint', 'SetUpSediDemoPersonHint', 'SediDemoGuardianDone'] as const
const LOCALES = { en, fr, 'pt-BR': ptBr } as unknown as Record<string, { Developer: Record<string, string> }>

describe.each(Object.keys(LOCALES))('the SEDI demo set-up lines, in %s', (lng) => {
  test.each(LINES)('%s names Example State and never State of Utah', (key) => {
    const line = LOCALES[lng].Developer[key]
    expect(typeof line).toBe('string')
    expect(line).toContain('Example State')
    expect(line).not.toMatch(/Utah/i)
  })
})
