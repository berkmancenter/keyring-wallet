/**
 * Every accessibility label core names by key has English words, so a screen reader never reads the key itself.
 * Four didn't (a proof request's predicate field and credential choice, the PIN-changed screen's button, the PIN
 * screen's app-information trigger), nor did the toast's close button.
 *
 * What it reads: `accessibilityLabel={t('…')}` and `accessibilityLabel: t('…')` in core's source (not its tests), with
 * the key a single-quoted literal; the call may wrap onto the next line. A key passed in by a caller, built from a
 * variable or a template, or named some other way isn't seen. The floor test only guards against reading nothing.
 * English only: a key missing in fr or pt-BR falls back to English, so it is read as words, not as a key.
 */
import { readdirSync, readFileSync } from 'fs'
import path from 'path'

import en from '../../src/localization/en/en.json'

const SRC = path.resolve(__dirname, '../../src')

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sources(full)
    return /\.tsx?$/.test(entry.name) ? [full] : []
  })
}

const named = sources(SRC).flatMap((file) =>
  [...readFileSync(file, 'utf8').matchAll(/accessibilityLabel(?:=\{|:\s*)t\(\s*'([\w.]+)'/g)].map(([, key]) => ({
    file: path.relative(SRC, file),
    key,
  }))
)

const at = (key: string): unknown =>
  key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], en)

test('finds the labels (a guard that read nothing would pass)', () => {
  const keys = named.map(({ key }) => key)
  expect(keys).toEqual(
    expect.arrayContaining([
      'PINEnter.DeveloperMenuTrigger',
      'ProofRequest.PredicateInput',
      'ProofRequest.SelectCredential',
      'PINChangeSuccess.PrimaryButton',
    ])
  )
})

test('each has English words', () => {
  const missing = named.filter(({ key }) => typeof at(key) !== 'string' || !String(at(key)).trim())
  expect(missing).toEqual([])
})
