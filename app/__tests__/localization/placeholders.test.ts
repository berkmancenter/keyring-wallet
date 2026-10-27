/**
 * The wallet's French and Portuguese override bifold's (localization/index.ts merges them over translationResources).
 * Many wallet entries are still placeholders, English with " (FR)" or " (PT-BR)" after it, and a placeholder over a
 * key bifold already translates hid bifold's real words behind it. None may: where bifold translates a key for a
 * language, and its English is the wallet's English (so its words are a translation of the same thing), the wallet has
 * no placeholder for it. A wallet value in real words is left alone, even over bifold's: it may be Keyring's wording.
 */
import fs from 'fs'
import path from 'path'

import en from '../../src/localization/en'
import fr from '../../src/localization/fr'
import ptBr from '../../src/localization/pt-br'

type Tree = { [key: string]: string | Tree }

const BIFOLD = path.join(__dirname, '../../../bifold/packages/core/src/localization')
const bifold = (code: string): Tree => JSON.parse(fs.readFileSync(path.join(BIFOLD, code, `${code}.json`), 'utf8'))

function leaves(tree: Tree, prefix = ''): [string, string][] {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === 'string' ? [[`${prefix}${key}`, value]] : leaves(value, `${prefix}${key}.`)
  )
}
const at = (tree: Tree, key: string): unknown =>
  key.split('.').reduce<unknown>((node, part) => (node as Tree | undefined)?.[part], tree)

/** Wallet placeholders that hide a translation bifold already has, of the same English. */
export function hiddenTranslations(
  wallet: Tree,
  walletEn: Tree,
  bifoldLanguage: Tree,
  bifoldEn: Tree,
  tag: string
): string[] {
  const placeholder = (value: unknown) => typeof value === 'string' && value.endsWith(` (${tag})`)
  return leaves(wallet)
    .filter(([, value]) => placeholder(value))
    .map(([key]) => key)
    .filter((key) => {
      const translated = at(bifoldLanguage, key)
      return (
        typeof translated === 'string' &&
        translated.trim() !== '' &&
        !placeholder(translated) &&
        at(bifoldEn, key) === at(walletEn, key)
      )
    })
}

describe('wallet placeholders never hide bifold translations', () => {
  const bifoldEn = bifold('en')

  test.each([
    ['fr', fr, 'FR'],
    ['pt-br', ptBr, 'PT-BR'],
  ])('%s', (code, wallet, tag) => {
    expect(hiddenTranslations(wallet as Tree, en as Tree, bifold(code), bifoldEn, tag)).toEqual([])
  })

  // The check is only as good as its predicate: a planted placeholder over a translated key is found, one over a key
  // whose English the wallet changed is not, and a wallet value in real words is never touched.
  test('finds a hidden translation, and only that', () => {
    const walletEn = { A: { Same: 'Skip', Changed: 'Menu', Real: 'Done' } }
    const bifoldEn2 = { A: { Same: 'Skip', Changed: 'Profile', Real: 'Done' } }
    const bifoldPt = { A: { Same: 'Pular', Changed: 'Perfil', Real: 'Terminar' } }
    const wallet = { A: { Same: 'Skip (PT-BR)', Changed: 'Menu (PT-BR)', Real: 'Pronto' } }
    expect(hiddenTranslations(wallet, walletEn, bifoldPt, bifoldEn2, 'PT-BR')).toEqual(['A.Same'])
  })
})

/** Every source file the app is built from: the wallet's app and bifold's packages, without dependencies, native
 * projects, caches, tests or the locale files themselves. */
const SKIP = ['node_modules', 'localization', '__tests__', '__mocks__', 'lib', 'build', 'ios', 'android', 'coverage']

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return entry.name.startsWith('.') || SKIP.includes(entry.name) ? [] : sources(full)
    return /\.(tsx?|jsx?)$/.test(entry.name) ? [full] : []
  })
}

describe('a string the app shows is never a placeholder', () => {
  const ROOTS = [path.join(__dirname, '../..'), path.join(__dirname, '../../../bifold/packages')]
  const corpus = ROOTS.flatMap(sources)
    .map((file) => fs.readFileSync(file, 'utf8'))
    .join('\n')
  // Named literally ('Settings.Help'), or by its section in a template (`Developer.${name}`).
  const shown = (key: string) =>
    corpus.includes(`'${key}'`) ||
    corpus.includes(`"${key}"`) ||
    corpus.includes(`\`${key}`) ||
    corpus.includes(`${key.split('.').slice(0, -1).join('.')}.\${`)

  test.each([
    ['fr', fr, 'FR'],
    ['pt-br', ptBr, 'PT-BR'],
  ])('%s', (_code, wallet, tag) => {
    const placeholders = leaves(wallet as Tree).filter(([, value]) => value.endsWith(` (${tag})`))
    expect(placeholders.filter(([key]) => shown(key)).map(([key]) => key)).toEqual([])
  })

  // The scan is only as good as what it finds: keys the app is known to name are found.
  test('finds the keys the app names', () => {
    expect(['Screens.Settings', 'Settings.Help', 'RemoteLogging.Banner'].every(shown)).toBe(true)
    expect(shown('Unified.NoSuchKey')).toBe(false)
  })
})
