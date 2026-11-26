// Tests for tokens.ts. Run: node --experimental-strip-types --test scripts/plans/mockup-kit/*.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { checkAnchor, fingerprint, type Token, TOKENS } from './tokens.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

test('every token still matches the theme source it was read from', () => {
  const problems: string[] = []
  for (const [name, token] of Object.entries(TOKENS) as [string, Token][]) {
    for (const a of token.anchors) {
      const file = path.join(root, a.file)
      if (!fs.existsSync(file)) {
        problems.push(`${name}: ${a.file} is missing`)
        continue
      }
      const why = checkAnchor(token, a, fs.readFileSync(file, 'utf8'))
      if (why) problems.push(`${name}: ${why}`)
    }
  }
  assert.deepEqual(problems, [], 'the theme changed: update tokens.ts, then regenerate the mockups (docs/plans/CLAUDE.md)')
})

test('checkAnchor: a changed value, a vanished alias and a missing block are each reported', () => {
  const src = "export const Buttons = {\n  primary: {\n    borderRadius: 10,\n    backgroundColor: ColorPalette.brand.primary,\n  },\n  other: {\n    borderRadius: 3,\n  },\n}\n"
  const radius: Token = { value: 10, anchors: [] }
  const at = (p: RegExp, pathParts = ['export const Buttons', '  primary: {']) => ({ file: 'x.ts', path: pathParts, pattern: p })
  assert.equal(checkAnchor(radius, at(/borderRadius: (\d+)/), src), null)
  assert.match(checkAnchor({ value: 12, anchors: [] }, at(/borderRadius: (\d+)/), src) ?? '', /has 10, the token has 12/)
  // The block ends at its closing brace, so `other`'s radius is not read as `primary`'s.
  assert.match(checkAnchor(radius, at(/borderRadius: 3/), src) ?? '', /no longer matches/)
  assert.equal(checkAnchor(radius, at(/backgroundColor: ColorPalette\.brand\.primary,/), src), null)
  assert.match(checkAnchor(radius, at(/x/, ['export const Inputs']), src) ?? '', /block "export const Inputs" not found/)
  assert.equal(checkAnchor({ value: '#622c62', anchors: [] }, at(/'(#\w+)'/, []), "const A = '#622C62'"), null) // hex case-insensitive
})

test('fingerprint changes with any value and is stable otherwise', () => {
  const a = fingerprint()
  assert.equal(a, fingerprint())
  assert.match(a, /^[0-9a-f]{12}$/)
  const changed = { ...TOKENS, 'color.primary': { ...TOKENS['color.primary'], value: '#000000' } }
  assert.notEqual(fingerprint(changed), a)
})
