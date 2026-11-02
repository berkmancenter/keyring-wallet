// node --test scripts/ci/select-tests.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buildSet, findGuards, parsePart, plan, setupClosure, sourceMapped } from './select-tests.mjs'

// The shape of this repo's graph: core loads oca and trust-tasks from src (mapped), the adapter from its build, and
// the adapter loads trust-tasks; remote-logs loads core; witness-server is outside core's graph.
const WS = [
  {
    name: '@bifold/core',
    dir: 'packages/core',
    deps: ['@bifold/oca', '@bifold/trust-tasks', '@bifold/credo-tsp-adapter'],
    hasTest: true,
  },
  { name: '@bifold/oca', dir: 'packages/oca', deps: [], hasTest: true },
  { name: '@bifold/trust-tasks', dir: 'packages/trust-tasks', deps: [], hasTest: true },
  {
    name: '@bifold/credo-tsp-adapter',
    dir: 'packages/credo-tsp-adapter',
    deps: ['@bifold/trust-tasks'],
    hasTest: true,
  },
  { name: '@bifold/remote-logs', dir: 'packages/remote-logs', deps: ['@bifold/core'], hasTest: true },
  { name: '@bifold/witness-server', dir: 'packages/witness-server', deps: [], hasTest: true },
]
const MAPPED = new Set(['@bifold/oca', '@bifold/trust-tasks'])
const M = (...paths) => paths.map((p) => ({ status: 'M', path: p }))
const run = (changes) => plan(changes, WS, MAPPED)

test('a rooms-only change runs core as a related subset, nothing else', () => {
  const r = run(
    M('packages/core/src/modules/rooms/useRoomPosts.ts', 'packages/core/src/modules/rooms/__tests__/x.test.ts')
  )
  assert.equal(r.everything, false)
  assert.deepEqual(r.modes, { '@bifold/core': 'related' })
  assert.deepEqual(r.related, [
    'packages/core/src/modules/rooms/__tests__/x.test.ts',
    'packages/core/src/modules/rooms/useRoomPosts.ts',
  ])
})

test('the install, root setup, the workflow and this selector run everything', () => {
  for (const p of [
    'yarn.lock',
    'package.json',
    '.yarn/patches/x.patch',
    '.github/workflows/quality.yaml',
    'scripts/ci/select-tests.mjs',
    'tsconfig.json',
    '.github/actions/setup-node/action.yaml',
  ])
    assert.equal(run(M(p)).everything, true, p)
})

test('a path no rule knows runs everything: an unknown shape is never a skip', () => {
  const r = run(M('scripts/refresh-ledgers.ts'))
  assert.equal(r.everything, true)
  assert.match(r.reasons.join('\n'), /no rule knows/)
  assert.equal(run(M('packages/not-a-workspace/src/a.ts')).everything, true)
})

test('docs, markdown and lint-only files run nothing', () => {
  const r = run(
    M(
      'docs/a.txt',
      'packages/core/README.md',
      '.github/workflows/publish.yaml',
      'eslint.config.mjs',
      'packages/core/tsc-baseline.txt'
    )
  )
  assert.equal(r.everything, false)
  assert.deepEqual(r.modes, {})
})

test("core's own test setup, a manual mock or a deleted file runs core whole", () => {
  for (const p of [
    'packages/core/jest.config.js',
    'packages/core/jestSetup.js',
    'packages/core/__mocks__/x.js',
    'packages/core/src/__mocks__/y.ts',
    'packages/core/package.json',
    'packages/core/babel.config.js',
  ])
    assert.deepEqual(run(M(p)).modes, { '@bifold/core': 'all' }, p)
  const deleted = run([{ status: 'D', path: 'packages/core/src/a.ts' }, ...M('packages/core/src/b.ts')])
  assert.deepEqual(deleted.modes, { '@bifold/core': 'all' })
  assert.deepEqual(deleted.related, [])
})

test('a change in core never runs the packages that load its build', () => {
  assert.equal(run(M('packages/core/src/a.ts')).modes['@bifold/remote-logs'], undefined)
  assert.equal(run(M('packages/core/jest.config.js')).modes['@bifold/remote-logs'], undefined)
})

test('a changed snapshot runs its test', () => {
  const r = run(M('packages/core/__tests__/screens/__snapshots__/Home.test.tsx.snap'))
  assert.deepEqual(r.related, ['packages/core/__tests__/screens/Home.test.tsx'])
})

test("a mapped package's src runs core whole: its files are outside core's jest roots", () => {
  const r = run(M('packages/oca/src/index.ts'))
  assert.deepEqual(r.modes, { '@bifold/oca': 'all', '@bifold/core': 'all' })
})

test("a mapped package's own tests leave core alone", () => {
  const r = run(M('packages/oca/__tests__/a.test.ts'))
  assert.deepEqual(r.modes, { '@bifold/oca': 'all' })
  assert.match(r.reasons.join('\n'), /not affected/)
})

test('a mapped package that a build core loads depends on runs core whole, even outside src', () => {
  const r = run(M('packages/trust-tasks/__tests__/a.test.ts'))
  assert.equal(r.modes['@bifold/core'], 'all')
  assert.equal(r.modes['@bifold/credo-tsp-adapter'], 'all')
})

test('a package outside core runs itself and its dependents only', () => {
  assert.deepEqual(run(M('packages/witness-server/src/a.ts')).modes, { '@bifold/witness-server': 'all' })
})

test('core loads, and so builds, its dependencies but not itself; another package builds itself too', () => {
  assert.deepEqual(buildSet(['@bifold/core'], WS), ['@bifold/credo-tsp-adapter', '@bifold/oca', '@bifold/trust-tasks'])
  assert.deepEqual(buildSet(['@bifold/remote-logs'], WS), [
    '@bifold/core',
    '@bifold/credo-tsp-adapter',
    '@bifold/oca',
    '@bifold/remote-logs',
    '@bifold/trust-tasks',
  ])
})

test("sourceMapped reads core's moduleNameMapper", () => {
  const text = `
    '^@bifold/oca$': '<rootDir>/../oca/src/index.ts',
    '^@bifold/trust-tasks$': '<rootDir>/../trust-tasks/src/index.ts',
    '^uuid$': require.resolve('uuid'),`
  assert.deepEqual([...sourceMapped(text)], ['@bifold/oca', '@bifold/trust-tasks'])
})

test('guards: a test that reads from disk, or imports a helper that does; not one that only imports code', () => {
  const files = {
    '/p/src/__tests__/plainWords.test.ts': "import { readFileSync } from 'fs'",
    '/p/src/__tests__/drift.test.ts': "import { drift } from './fixtures/registryDrift'",
    '/p/src/__tests__/fixtures/registryDrift.ts': "const t = fs.readdirSync('src')",
    '/p/src/__tests__/plain.test.ts': "import { a } from '../a'",
    '/p/src/__tests__/globby.test.ts': "const g = require('fast-glob')",
    '/p/src/__tests__/checker.test.ts': 'const program = ts.createProgram(roots, options, host)',
  }
  const tests = Object.keys(files).filter((f) => f.endsWith('.test.ts'))
  const guards = findGuards(tests, ['/p/src/__tests__/fixtures/registryDrift.ts'], (f) => files[f])
  assert.deepEqual(guards.sort(), [
    '/p/src/__tests__/checker.test.ts',
    '/p/src/__tests__/drift.test.ts',
    '/p/src/__tests__/globby.test.ts',
    '/p/src/__tests__/plainWords.test.ts',
  ])
})

test('a file the jest setup loads before every test runs core whole', () => {
  const setup = new Set(['packages/core/src/services/bifoldLogger.ts'])
  const r = plan(M('packages/core/src/services/bifoldLogger.ts'), WS, MAPPED, setup)
  assert.deepEqual(r.modes, { '@bifold/core': 'all' })
  assert.match(r.reasons.join('\n'), /loaded by jest's setup/)
})

test('setupClosure follows relative imports to the given depth, not jest.mock targets or packages', () => {
  const files = {
    '/p/jestSetup.js': "import { a } from './src/a'\njest.mock('./src/mocked', () => ({}))\nimport x from 'react'",
    '/p/src/a.ts': "export * from './b'",
    '/p/src/b/index.ts': "const c = require('../c')",
    '/p/src/c.tsx': '',
    '/p/src/mocked.ts': "import './d'",
    '/p/src/d.ts': '',
  }
  const read = (f) => files[f]
  const exists = (f) => f in files
  assert.deepEqual([...setupClosure(['/p/jestSetup.js'], read, exists)].sort(), [
    '/p/jestSetup.js',
    '/p/src/a.ts',
    '/p/src/b/index.ts',
    '/p/src/c.tsx',
  ])
  assert.deepEqual([...setupClosure(['/p/jestSetup.js'], read, exists, 1)].sort(), ['/p/jestSetup.js', '/p/src/a.ts'])
})

test('--part reads "i/n" and refuses anything else', () => {
  assert.deepEqual(parsePart(undefined), { part: 1, parts: 1 })
  assert.deepEqual(parsePart('2/4'), { part: 2, parts: 4 })
  for (const bad of ['0/4', '5/4', '2', 'a/b', '2/4/1']) assert.throws(() => parsePart(bad), /--part/, bad)
})
