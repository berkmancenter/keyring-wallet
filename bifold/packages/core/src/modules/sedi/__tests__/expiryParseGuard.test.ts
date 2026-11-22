/**
 * A derived tree-scan: in sedi/'s non-test sources, a date is parsed only inside readExpiry (chain.ts). A parse is
 * `Date.parse(` or `new Date(` with an argument; `new Date()` (now, no argument) is not a parse. Those two are the only
 * ways JS turns a string into a date, so a second expiry check written anywhere else in sedi/ shows up here. Blind
 * spot: a parser held in a variable (`const p = Date.parse`) is not seen; there is none today.
 *
 * Derived from both sides: the allowance is computed from readExpiry's own body (located by its declaration), and a
 * row asserts the scan sees readExpiry's own parses, so removing the allowance, or moving the helper, fails a row.
 */
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'

const ROOT = join(__dirname, '..')
const PARSE = /Date\.parse\(|new Date\((?!\))/g

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return name === '__tests__' ? [] : sources(p)
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : []
  })
}

/** Line range [start, end] of `export function readExpiry(` up to its closing `}` at column 0. */
export function helperRange(text: string): [number, number] | undefined {
  const lines = text.split('\n')
  const start = lines.findIndex((l) => l.startsWith('export function readExpiry('))
  if (start < 0) return undefined
  const end = lines.findIndex((l, i) => i > start && l === '}')
  return end < 0 ? undefined : [start + 1, end + 1]
}

export function parsesIn(files: { path: string; text: string }[]) {
  const found: { file: string; line: number; inHelper: boolean }[] = []
  for (const { path, text } of files) {
    const range = path.endsWith(join('guardian', 'chain.ts')) ? helperRange(text) : undefined
    text.split('\n').forEach((l, i) => {
      if (l.trimStart().startsWith('*') || l.trimStart().startsWith('//')) return
      const n = (l.match(PARSE) ?? []).length
      for (let k = 0; k < n; k++)
        found.push({
          file: relative(ROOT, path),
          line: i + 1,
          inHelper: !!range && i + 1 >= range[0] && i + 1 <= range[1],
        })
    })
  }
  return found
}

const tree = () => sources(ROOT).map((path) => ({ path, text: readFileSync(path, 'utf8') }))

describe('expiryParseGuard: dates are parsed only in readExpiry', () => {
  it('G1: no date parse in sedi/ outside readExpiry', () => {
    expect(parsesIn(tree()).filter((p) => !p.inHelper)).toEqual([])
  })
  it('G2: the scan sees readExpiry and its own parses (so G1 is not vacuous and the allowance is derived)', () => {
    const chain = tree().find((f) => f.path.endsWith(join('guardian', 'chain.ts')))!
    expect(helperRange(chain.text)).toBeDefined()
    expect(parsesIn(tree()).filter((p) => p.inHelper).length).toBeGreaterThan(0)
  })
  it('G3: control: a parse added outside the helper is caught (an isolated file, so G1 is the only tree row)', () => {
    const files = [{ path: join(ROOT, 'guardian', 'extra.ts'), text: 'const x = new Date(s)\n' }]
    expect(parsesIn(files).map((p) => [p.file, p.inHelper])).toEqual([[join('guardian', 'extra.ts'), false]])
  })
  it('G4: control: `new Date()` (now) and comment lines are not parses', () => {
    const files = [
      { path: join(ROOT, 'guardian', 'x.ts'), text: 'const now = new Date()\n// new Date(s)\n * Date.parse(s)\n' },
    ]
    expect(parsesIn(files)).toEqual([])
  })
})
