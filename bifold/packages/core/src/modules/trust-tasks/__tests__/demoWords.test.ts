/**
 * What a demo audience reads on Ask me and Who approves says "practice" or names the demo state, never "test"
 * (Alberto, 2026-11-11: "remove the word test and just make sure it looks good"). Two exceptions, each named here:
 * - the name of the context the practice request makes on the agent, "Keyring test request": it is the agent's own
 *   label, quoted so a person can find it there, and VtaClient sends it as is;
 * - the K0 preload's own label and words (TEST_KEYS): Alberto said "Yes" on 2026-11-13 to showing the Developer test
 *   card as "Example State" with a grey "Test" label, so it can never pass for K1, the state office's "State of Utah"
 *   demo card. Only those keys may say "test"; K1's words, and everything else, still may not.
 */
import { readFileSync } from 'fs'
import { join } from 'path'

import { K0_TEST_ROOT, K1_NAME, k1Root } from '../../sedi/guardian/stateRoots'

const WIRE_NAME = 'Keyring test request'
/** The K0 preload's label and words, the only keys that may say "test" (Alberto, 2026-11-13). */
const TEST_KEYS = [
  'Approver.TestPill',
  'Approver.GuardianTestCopy',
  'Approver.TestStateIs',
  'Approver.TestStateUnreachableHost',
  'Approver.TestStateRevoked',
]
const LANGS = ['en/en', 'fr/fr', 'pt-br/pt-br'] as const
const TEST_WORD: Record<(typeof LANGS)[number], RegExp> = {
  'en/en': /\btests?\b/i,
  'fr/fr': /\btests?\b/i,
  'pt-br/pt-br': /\btestes?\b/i,
}

const strings = (lang: string): Record<string, string> => {
  const all = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'localization', `${lang}.json`), 'utf8'))
  const flat: Record<string, string> = {}
  for (const section of ['AskMe', 'Approver'] as const)
    for (const [key, value] of Object.entries(all[section] as Record<string, unknown>))
      if (typeof value === 'string') flat[`${section}.${key}`] = value
  return flat
}

const stateCard = (lang: string): Record<string, string> =>
  JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'localization', `${lang}.json`), 'utf8')).StateCard

/** The keys among `flat` that say "test", outside the agent's quoted context name and the K0 preload's own keys. */
const sayingTest = (lang: (typeof LANGS)[number], flat: Record<string, string>): string[] =>
  Object.entries(flat)
    .filter(([key]) => !TEST_KEYS.includes(key))
    .filter(([, value]) => TEST_WORD[lang].test(value.split(WIRE_NAME).join('')))
    .map(([key]) => key)

describe('demo words: no "test" in what a demo audience reads', () => {
  test.each(LANGS)(
    '%s: Ask me and Approver strings say no "test", apart from the agent\'s quoted context name and the K0 test keys',
    (lang) => {
      expect(sayingTest(lang, strings(lang))).toEqual([])
    }
  )

  test('control: the scan reads the strings, so it sees the quoted context name it allows', () => {
    const quoting = Object.entries(strings('en/en')).filter(([, value]) => value.includes(WIRE_NAME))
    expect(quoting.map(([key]) => key)).toEqual(['AskMe.TestLetThroughKept'])
    expect(TEST_WORD['en/en'].test(quoting[0][1])).toBe(true)
  })

  test.each(LANGS)('%s control: the K0 test keys do say "test", and a planted "test" elsewhere is caught', (lang) => {
    const flat = strings(lang)
    // The allowance is real (each K0 key says it), and narrow: the same word in any other key, K1's included, is caught.
    for (const key of TEST_KEYS) expect(TEST_WORD[lang].test(flat[key])).toBe(true)
    const planted = { ...flat, 'Approver.DemoStateIs': `${flat['Approver.DemoStateIs']} ${flat['Approver.TestPill']}` }
    expect(sayingTest(lang, planted)).toEqual(['Approver.DemoStateIs'])
  })

  test('the button reads "Try it: send yourself a request"; the K0 preload is "Example State", marked test', () => {
    expect(strings('en/en')['AskMe.Test']).toBe('Try it: send yourself a request')
    expect(K0_TEST_ROOT.name).toBe('Example State')
    expect(K0_TEST_ROOT.test).toBe(true)
    // Not a real state's name: the Test label stands beside a made-up one.
    expect(/utah/i.test(K0_TEST_ROOT.name)).toBe(false)
  })

  test("K0's card says it was loaded here and issued by no one; never a state's name", () => {
    expect(stateCard('en/en').TestNote).toBe('Test card, loaded on this phone. Not issued by anyone.')
    expect(stateCard('en/en').Test).toBe('Test')
    expect(/utah/i.test(stateCard('en/en').TestNote)).toBe(false)
  })

  test.each(LANGS)(
    "%s: K1, a real state's name, keeps its Demo mark and its card says that state did not issue it",
    (lang) => {
      // A real state's name is shown only with the Demo pill and this line (Alberto, 2026-11-12), now on K1.
      expect(k1Root()?.name).toBe(K1_NAME)
      expect(k1Root()?.demo).toBe(true)
      expect(k1Root()?.test).toBeUndefined()
      const note = stateCard(lang).DemoNoteOffice
      expect(note).toBe(
        {
          'en/en': 'Demo card, issued by the State of Utah demo office. Not issued by the State of Utah.',
          'fr/fr':
            'Carte de démonstration, délivrée par le bureau de démonstration de l’État de l’Utah. Non délivrée par l’État de l’Utah.',
          'pt-br/pt-br':
            'Cartão de demonstração, emitido pelo escritório de demonstração do Estado de Utah. Não emitido pelo Estado de Utah.',
        }[lang]
      )
      expect(TEST_WORD[lang].test(note)).toBe(false)
    }
  )
})
