/**
 * No raw key on screen. A key the locale does not have renders as itself —
 * "Vetting.YourVetter" was shown to a maintainer on 219, because the words
 * lived under another namespace. Every literal key the trust-tasks screens
 * ask for must exist in each locale (a plural counts through its _one/_other
 * forms). Keys built at run time (`Vetting.Status.${…}`) are not checked here.
 */
import fs from 'fs'
import path from 'path'

import en from '../../../localization/en/en.json'
import fr from '../../../localization/fr/fr.json'
import ptBr from '../../../localization/pt-br/pt-br.json'

const SCREENS = path.join(__dirname, '..', 'screens')
// 'Namespace.Key' as a string literal: a capitalised namespace, then a key.
const KEY = /['"]([A-Z][A-Za-z0-9]*(?:\.[A-Z][A-Za-z0-9_]*)+)['"]/g

type Tree = Record<string, unknown>
const has = (tree: Tree, key: string) => {
  const parts = key.split('.')
  const leaf = parts.pop() as string
  let node: unknown = tree
  for (const p of parts) node = (node as Tree | undefined)?.[p]
  const at = node as Tree | undefined
  return Boolean(at && (typeof at[leaf] === 'string' || typeof at[`${leaf}_one`] === 'string'))
}

const keysUsed = (() => {
  const found = new Map<string, string>()
  for (const file of fs.readdirSync(SCREENS)) {
    if (!/\.tsx?$/.test(file)) continue
    const source = fs.readFileSync(path.join(SCREENS, file), 'utf8')
    for (const m of source.matchAll(KEY)) if (!found.has(m[1])) found.set(m[1], file)
  }
  return found
})()

describe('every key the trust-tasks screens show exists', () => {
  it('finds the keys it checks', () => {
    expect(keysUsed.size).toBeGreaterThan(50)
    expect(keysUsed.has('Vetting.YourVetter')).toBe(true)
  })

  for (const [name, locale] of [
    ['en', en],
    ['fr', fr],
    ['pt-br', ptBr],
  ] as const) {
    it(`in ${name}`, () => {
      const missing = [...keysUsed]
        .filter(([key]) => !has(locale as Tree, key))
        .map(([key, file]) => `${key} (${file})`)
      expect(missing).toEqual([])
    })
  }
})
