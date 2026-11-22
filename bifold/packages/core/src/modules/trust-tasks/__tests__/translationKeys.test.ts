/**
 * No raw key on screen. A key the locale does not have renders as itself —
 * "Vetting.YourVetter" was shown to a maintainer on 219, because the words
 * lived under another namespace. Every literal key a module's source asks
 * for must exist in each locale (a plural counts through its _one/_other
 * forms). Keys built at run time (`Vetting.Status.${…}`) are not checked here.
 *
 * Every module is read, so a new one is covered without being listed: a scan
 * of trust-tasks' screens alone passed while 99 poll strings had no French or
 * Portuguese. vrc and openid are left out because the app's own locale
 * supplies many of their words, which this package's files can't see.
 */
import fs from 'fs'
import path from 'path'

import en from '../../../localization/en/en.json'
import fr from '../../../localization/fr/fr.json'
import ptBr from '../../../localization/pt-br/pt-br.json'

const MODULES = path.join(__dirname, '..', '..')
const WORDS_FROM_THE_APP = new Set(['vrc', 'openid'])
// 'Namespace.Key' as a string literal: a capitalised namespace, then a key.
const KEY = /['"]([A-Z][A-Za-z0-9]*(?:\.[A-Z][A-Za-z0-9_]*)+)['"]/g

const sources = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sources(full)
    return /\.tsx?$/.test(entry.name) ? [full] : []
  })

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
  for (const dir of fs.readdirSync(MODULES, { withFileTypes: true })) {
    if (!dir.isDirectory() || WORDS_FROM_THE_APP.has(dir.name)) continue
    for (const file of sources(path.join(MODULES, dir.name))) {
      const source = fs.readFileSync(file, 'utf8')
      for (const m of source.matchAll(KEY)) if (!found.has(m[1])) found.set(m[1], path.relative(MODULES, file))
    }
  }
  return found
})()

describe('every key the modules show exists', () => {
  it('finds the keys it checks', () => {
    expect(keysUsed.size).toBeGreaterThan(1000)
    expect(keysUsed.has('Vetting.YourVetter')).toBe(true)
    expect([...keysUsed.keys()].some((key) => key.startsWith('Rooms.'))).toBe(true)
    expect(keysUsed.has('Polls.SameOperator')).toBe(true)
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
