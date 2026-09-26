/**
 * The paste screen speaks of links, in every language, with no placeholder
 * left untranslated. It titled a pasted non-link "URL not recognized" (225
 * gate, 226 item 11), and pt-br still showed "URL not recognized (PT-BR)".
 */
import en from '../../../localization/en/en.json'
import fr from '../../../localization/fr/fr.json'
import ptBr from '../../../localization/pt-br/pt-br.json'

const LOCALES: Record<string, Record<string, unknown>> = { en, fr, 'pt-br': ptBr }

describe('the paste screen in words', () => {
  for (const [loc, strings] of Object.entries(LOCALES)) {
    const paste = strings.PasteUrl as Record<string, string>
    test(`${loc}: no "URL", and nothing left as a placeholder`, () => {
      for (const [key, text] of Object.entries(paste)) {
        expect([key, text]).toEqual([key, expect.not.stringMatching(/\bURL\b/)])
        expect([key, text]).toEqual([key, expect.not.stringMatching(/\((FR|PT-BR)\)/)])
      }
    })
  }
})
