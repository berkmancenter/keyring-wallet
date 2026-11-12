/**
 * What a demo audience reads on Ask me and Who approves says "practice" or names the demo state, never "test"
 * (Alberto, 2026-11-11: "remove the word test and just make sure it looks good"). The one exception is the name of
 * the context the practice request makes on the agent, "Keyring test request": it is the agent's own label, quoted so
 * a person can find it there, and VtaClient sends it as is.
 */
import { readFileSync } from 'fs'
import { join } from 'path'

import { K0_TEST_ROOT } from '../../sedi/guardian/stateRoots'

const WIRE_NAME = 'Keyring test request'
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

describe('demo words: no "test" in what a demo audience reads', () => {
  test.each(LANGS)(
    '%s: Ask me and Approver strings say no "test", apart from the agent\'s quoted context name',
    (lang) => {
      const found = Object.entries(strings(lang))
        .filter(([, value]) => TEST_WORD[lang].test(value.split(WIRE_NAME).join('')))
        .map(([key]) => key)
      expect(found).toEqual([])
    }
  )

  test('control: the scan reads the strings, so it sees the quoted context name it allows', () => {
    const quoting = Object.entries(strings('en/en')).filter(([, value]) => value.includes(WIRE_NAME))
    expect(quoting.map(([key]) => key)).toEqual(['AskMe.TestLetThroughKept'])
    expect(TEST_WORD['en/en'].test(quoting[0][1])).toBe(true)
  })

  test('the button reads "Try it: send yourself a request", and the K0 state is named "State of Utah"', () => {
    expect(strings('en/en')['AskMe.Test']).toBe('Try it: send yourself a request')
    expect(K0_TEST_ROOT.name).toBe('State of Utah')
    expect(/test/i.test(K0_TEST_ROOT.name)).toBe(false)
  })

  test('the K0 state keeps its Demo mark, and the holder card says the state it names did not issue it', () => {
    // A real state's name is shown only with the Demo pill and this line (Alberto, 2026-11-12).
    expect(K0_TEST_ROOT.demo).toBe(true)
    const all = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'localization', 'en/en.json'), 'utf8'))
    expect(all.StateCard.DemoNote).toBe(`Demo card, loaded on this phone; not issued by the ${K0_TEST_ROOT.name}`)
  })
})
