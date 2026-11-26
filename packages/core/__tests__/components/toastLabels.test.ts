/**
 * Every key the toast components name resolves to real words in en, fr and pt-BR. The close button's label,
 * `Global.CloseNotification`, was missing from en and pt-BR and a placeholder in fr, so a screen reader read the key
 * itself (276.9).
 *
 * What it reads: `t('…')` calls with a single-quoted literal key on one line, in `components/toast`'s own files. A
 * key passed in by a caller, built from a variable or a template, or wrapped onto the next line isn't seen. The floor
 * test only guards against reading nothing, not against reading some.
 */
import { readdirSync, readFileSync } from 'fs'
import path from 'path'

import en from '../../src/localization/en/en.json'
import fr from '../../src/localization/fr/fr.json'
import ptBr from '../../src/localization/pt-br/pt-br.json'

const TOAST = path.resolve(__dirname, '../../src/components/toast')
const keys = readdirSync(TOAST)
  .filter((name) => name.endsWith('.tsx'))
  .flatMap((name) =>
    [...readFileSync(path.join(TOAST, name), 'utf8').matchAll(/\bt\('([\w.]+)'/g)].map(([, key]) => key)
  )

const at = (resources: unknown, key: string): unknown =>
  key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], resources)

test('finds the keys (a guard that read nothing would pass)', () => {
  expect(keys).toContain('Global.CloseNotification')
})

test.each([
  ['en', en],
  ['fr', fr],
  ['pt-BR', ptBr],
])('%s: each is real words, not missing and not a placeholder', (_lng, resources) => {
  for (const key of keys) {
    const words = at(resources, key)
    expect({ key, words: typeof words === 'string' && words.trim() !== '' }).toEqual({ key, words: true })
    expect({ key, placeholder: /\((FR|PT-BR)\)$/.test(String(words)) }).toEqual({ key, placeholder: false })
  }
})
