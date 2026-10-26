/**
 * The tab bar's words: every label it names exists in English, French and Portuguese (pt-BR's Contacts tab fell back
 * to English), and every label is held to one line ("Portefeuille" broke as "Portefeuill / e" on a phone). jest can
 * see neither a fallback nor a wrap, so both are checked here at their source.
 */
import { readFileSync } from 'fs'
import path from 'path'

import en from '../../src/localization/en/en.json'
import fr from '../../src/localization/fr/fr.json'
import ptBr from '../../src/localization/pt-br/pt-br.json'

const source = readFileSync(path.join(__dirname, '../../src/navigators/TabStack.tsx'), 'utf8')
const LOCALES = { en, fr, 'pt-BR': ptBr } as Record<string, unknown>
const resolve = (locale: unknown, key: string): unknown =>
  key.split('.').reduce<unknown>((at, part) => (at as Record<string, unknown> | undefined)?.[part], locale)

describe('the tab bar', () => {
  const keys = [...new Set([...source.matchAll(/t\('((?:TabStack|Screens)\.[A-Za-z]+)'\)/g)].map((m) => m[1]))]

  test('names the labels it is there for (the scan finds them)', () => {
    expect(keys).toEqual(expect.arrayContaining(['TabStack.Contacts', 'TabStack.Wallet', 'Screens.Settings']))
  })

  test.each(Object.keys(LOCALES))('has every label in %s', (language) => {
    for (const key of keys) expect([key, typeof resolve(LOCALES[language], key)]).toEqual([key, 'string'])
  })

  test('holds every label to one line, shrinking a long word a little rather than breaking it', () => {
    const labels = source.split('...TabTheme.tabBarTextStyle,').length - 1
    // The spread may sit anywhere in the label's style object, as long as nothing nested precedes it.
    const oneLine =
      source.match(
        /numberOfLines=\{1\}\s*adjustsFontSizeToFit\s*minimumFontScale=\{0\.7\}\s*style=\{\{[^}]*?\.\.\.TabTheme\.tabBarTextStyle,/g
      ) ?? []
    expect(labels).toBeGreaterThanOrEqual(6)
    expect(oneLine).toHaveLength(labels)
  })

  // Android sizes a one-line label to fit without its own padding, so padding on the label clipped its last letter
  // with no ellipsis ("Contact" for "Contacts", font scale 1.15). The gap between labels is the tab container's.
  test('keeps the gap between labels on the container, never as padding inside a label', () => {
    const labelStyles = source.match(/style=\{\{[^}]*?\.\.\.TabTheme\.tabBarTextStyle,[^}]*\}\}/g) ?? []
    expect(labelStyles.length).toBeGreaterThanOrEqual(6)
    for (const style of labelStyles) expect(style).not.toMatch(/padding/)
    const containers = source.match(/\.\.\.TabTheme\.tabBarContainerStyle,\s*\.\.\.labelGap,/g) ?? []
    expect(containers).toHaveLength(labelStyles.length)
  })
})
