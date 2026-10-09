// Run with: node --test packages/core/scripts/gen-testids.test.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  buildManifest,
  diffManifests,
  extractFromSource,
  formatManifest,
  listSourceFiles,
  PREFIX,
} from './gen-testids.mjs'

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '__fixtures__')
const extractFixture = (name) =>
  extractFromSource(fs.readFileSync(path.join(fixturesDir, name), 'utf8'), `scripts/__fixtures__/${name}`)

const keysOf = (r) => r.keys.map((k) => k.key).sort()

test('rule 1 and 4: literal arguments, in JSX and in tabBarTestID, are keys', () => {
  const r = extractFixture('helper-literals.tsx')
  assert.deepEqual(keysOf(r), [
    'FixtureDone',
    'FixtureParens',
    'FixturePending',
    'FixtureRoot',
    'FixtureTitle',
    'TabHome',
  ])
  assert.deepEqual(r.stems, [])
  assert.deepEqual(r.raw, [])
  assert.deepEqual(r.derived, [])
  const root = r.keys.find((k) => k.key === 'FixtureRoot')
  assert.equal(root.loc, 'scripts/__fixtures__/helper-literals.tsx:11')
})

test('rule 2: a literal head before ${ or + is a stem; an empty head is derived', () => {
  const r = extractFixture('helper-dynamic.tsx')
  assert.deepEqual(r.stems.map((s) => s.stem).sort(), ['FixtureRowA_', 'FixtureRowName_', 'FixtureRow_'])
  assert.deepEqual(keysOf(r), ['FixtureRowOther'])
  assert.deepEqual(r.derived, [{ loc: 'scripts/__fixtures__/helper-dynamic.tsx:11', expr: '`${row.id}Trailing`' }])
})

test('rule 3: every string value of an exported *Ids map is a key, nested maps included', () => {
  const r = extractFixture('ids-map.ts')
  assert.deepEqual(keysOf(r), [
    'FixtureOtherOnly',
    'FixtureScreenRoot',
    'FixtureScreenStepFirst',
    'FixtureScreenStepSecond',
  ])
  assert.equal(r.keys.find((k) => k.key === 'FixtureScreenRoot').loc, 'scripts/__fixtures__/ids-map.ts:3')
})

test('rule 5: a testID prop without the helper is raw, a passed-through prop is not recorded', () => {
  const r = extractFixture('raw-testid.tsx')
  assert.deepEqual(r.raw.map((k) => k.key).sort(), ['FixtureRawRoot', 'FixtureRawText'])
  assert.deepEqual(r.keys, [])
  assert.deepEqual(r.derived, [])
})

test('derived: calls and variables are recorded with their expression text', () => {
  const r = extractFixture('derived.tsx')
  assert.deepEqual(r.keys, [])
  assert.deepEqual(
    r.derived.map((d) => d.expr),
    ["t('Fixture.Root')", 'label']
  )
})

test('buildManifest sorts keys and call sites and merges duplicates', () => {
  const a = extractFromSource(`testIdWithKey('Zed'); testIdWithKey('Alpha')`, 'src/b.ts')
  const b = extractFromSource(`\n\ntestIdWithKey('Alpha'); testIdWithKey(\`Alpha_\${x}\`)`, 'src/a.ts')
  const m = buildManifest([a, b], { generatedFrom: 'abc' })
  assert.equal(m.generatedFrom, 'abc')
  assert.equal(m.prefix, PREFIX)
  assert.deepEqual(Object.keys(m.keys), ['Alpha', 'Zed'])
  assert.deepEqual(m.keys.Alpha, ['src/a.ts:3', 'src/b.ts:1'])
  assert.deepEqual(m.stems, { Alpha_: ['src/a.ts:3'] })
  assert.deepEqual(m.raw, {})
  assert.deepEqual(m.derived, [])
  assert.equal(formatManifest(m), formatManifest(buildManifest([b, a], { generatedFrom: 'abc' })))
})

test('formatManifest writes valid JSON, one-line arrays that fit and expanded ones that do not', () => {
  const long = Array.from({ length: 12 }, (_, i) => `src/modules/some/long/path/Component${i}.tsx:${100 + i}`)
  const m = {
    generatedFrom: 'x',
    prefix: PREFIX,
    keys: { A: ['src/a.ts:1'], B: long },
    stems: {},
    raw: {},
    derived: [{ 'src/a.ts:2': 'label' }],
  }
  const text = formatManifest(m)
  assert.deepEqual(JSON.parse(text), m)
  assert.ok(text.includes('\n  "keys": {\n    "A": ["src/a.ts:1"],\n    "B": [\n      "src/'))
  assert.ok(text.endsWith('"derived": [\n    {\n      "src/a.ts:2": "label"\n    }\n  ]\n}\n'))
})

test('diffManifests names added, removed and moved entries and ignores generatedFrom', () => {
  const current = {
    generatedFrom: 'old',
    prefix: PREFIX,
    keys: { A: ['src/a.ts:1'], B: ['src/b.ts:1'] },
    stems: { S_: ['src/s.ts:1'] },
    raw: {},
    derived: [{ 'src/d.ts:1': 'x' }],
  }
  const same = { ...current, generatedFrom: 'new' }
  assert.deepEqual(diffManifests(current, same), {})
  const next = {
    generatedFrom: 'new',
    prefix: PREFIX,
    keys: { A: ['src/a.ts:9'], C: ['src/c.ts:1'] },
    stems: {},
    raw: { R: ['src/r.tsx:1'] },
    derived: [],
  }
  assert.deepEqual(diffManifests(current, next), {
    keys: { added: ['C'], removed: ['B'], moved: ['A'] },
    stems: { added: [], removed: ['S_'], moved: [] },
    raw: { added: ['R'], removed: [], moved: [] },
    derived: { added: [], removed: ['src/d.ts:1 x'], moved: [] },
  })
})

test('listSourceFiles skips __tests__, *.test.* and .d.ts files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-testids-'))
  try {
    fs.mkdirSync(path.join(dir, '__tests__'))
    fs.mkdirSync(path.join(dir, 'screens'))
    for (const f of ['a.ts', 'b.tsx', 'b.test.tsx', 'types.d.ts', '__tests__/c.tsx', 'screens/d.tsx', 'screens/e.js']) {
      fs.writeFileSync(path.join(dir, f), '')
    }
    assert.deepEqual(
      listSourceFiles(dir).map((f) => path.relative(dir, f)),
      ['a.ts', 'b.tsx', path.join('screens', 'd.tsx')]
    )
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
