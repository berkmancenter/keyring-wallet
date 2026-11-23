// node --test scripts/tsc-ratchet.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'

import { compare, countDiagnostics, formatBaseline, judge, parseBaseline, parseLine, runTsc } from './tsc-ratchet.mjs'

const PKG = '/repo/packages/core'
const out = (...lines) => lines.join('\n')
const e1 = "src/a.ts(10,5): error TS2339: Property 'x' does not exist on type 'Y'."
const e1Moved = "src/a.ts(42,9): error TS2339: Property 'x' does not exist on type 'Y'."
const e2 = "src/b.ts(3,1): error TS2322: Type 'string' is not assignable to type 'number'."

test('a diagnostic parses into file, code, position and message', () => {
  assert.deepEqual(parseLine(e1, PKG), {
    file: 'src/a.ts',
    code: 'TS2339',
    at: '10,5',
    message: "Property 'x' does not exist on type 'Y'.",
  })
  assert.deepEqual(parseLine('error TS5058: The specified path does not exist.', PKG), {
    file: '<global>',
    code: 'TS5058',
    at: '',
    message: 'The specified path does not exist.',
  })
  assert.equal(parseLine("  Type 'A' is missing the following properties", PKG), undefined)
  assert.equal(parseLine('', PKG), undefined)
})

test('the same error moved to another line is the same signature: no churn', () => {
  const before = countDiagnostics(out(e1), PKG)
  const after = countDiagnostics(out(e1Moved), PKG)
  assert.deepEqual(compare(before, after), { rose: [], fell: [] })
})

test('the message is not in the signature: a printed type or a path that changes elsewhere does not churn', () => {
  const before = out(
    "src/s.test.ts(5,1): error TS2352: Conversion of type '{ Global: {...}; ... 75 more ...; Relationship: { ...; }; }' to type 'X' may be a mistake.",
    "src/j.test.ts(1,20): error TS7016: Could not find a declaration file for module 'jsonld'. '/Users/someone/bifold/node_modules/jsonld/lib/index.js' implicitly has an 'any' type."
  )
  const after = out(
    "src/s.test.ts(5,1): error TS2352: Conversion of type '{ Global: {...}; ... 76 more ...; Emoji: { ...; }; }' to type 'X' may be a mistake.",
    "src/j.test.ts(1,20): error TS7016: Could not find a declaration file for module 'jsonld'. '/home/runner/work/bifold/node_modules/jsonld/lib/index.js' implicitly has an 'any' type."
  )
  assert.deepEqual(compare(countDiagnostics(before, PKG), countDiagnostics(after, PKG)), { rose: [], fell: [] })
})

test("a 'Did you mean' suggestion does not change the signature (tsc caps suggestions per program)", () => {
  const pairs = [
    [
      "a.test.ts(1,1): error TS2552: Cannot find name 'getter'. Did you mean '_getter'?",
      "a.test.ts(1,1): error TS2304: Cannot find name 'getter'.",
    ],
    [
      "a.test.ts(1,1): error TS2551: Property 'nme' does not exist on type 'User'. Did you mean 'name'?",
      "a.test.ts(1,1): error TS2339: Property 'nme' does not exist on type 'User'.",
    ],
    [
      "a.test.ts(1,1): error TS2724: '\"m\"' has no exported member named 'Foo'. Did you mean 'Fooo'?",
      "a.test.ts(1,1): error TS2305: Module '\"m\"' has no exported member 'Foo'.",
    ],
    [
      "a.test.ts(1,1): error TS2561: Object literal may only specify known properties, but 'nme' does not exist in type 'User'. Did you mean to write 'name'?",
      "a.test.ts(1,1): error TS2353: Object literal may only specify known properties, and 'nme' does not exist in type 'User'.",
    ],
  ]
  for (const [suggesting, plain] of pairs)
    assert.deepEqual(countDiagnostics(suggesting, PKG), countDiagnostics(plain, PKG), suggesting)
})

test('real tsc: errors added in one file flip an untouched file from TS2552 to TS2304, and the gate holds', () => {
  // The false-positive control. tsc's suggestion budget (10 per program) is spent
  // in check order, so a.ts's 12 misspellings use it up before b.ts is checked.
  const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc')
  // realpath: tsc prints paths relative to its cwd, and macOS's tmpdir is behind a symlink.
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'tsc-ratchet-')))
  try {
    const misspell = (name, n) =>
      Array.from({ length: n }, (_, i) => `export const ${name}${i} = consol === undefined`).join('\n') + '\n'
    writeFileSync(
      path.join(dir, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { types: [], noEmit: true }, files: ['b.ts'] })
    )
    writeFileSync(path.join(dir, 'a.ts'), misspell('scratch', 12))
    writeFileSync(path.join(dir, 'b.ts'), misspell('untouched', 3))
    const before = runTsc(dir, { tscPath: tsc })
    writeFileSync(
      path.join(dir, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { types: [], noEmit: true }, files: ['a.ts', 'b.ts'] })
    )
    const after = runTsc(dir, { tscPath: tsc })
    const rawCodes = (o) =>
      o.output
        .split('\n')
        .filter((l) => l.startsWith('b.ts'))
        .map((l) => / (TS\d+):/.exec(l)[1])
    // Positive control: the raw codes in b.ts really do change.
    assert.deepEqual(rawCodes(before), ['TS2552', 'TS2552', 'TS2552'])
    assert.deepEqual(rawCodes(after), ['TS2304', 'TS2304', 'TS2304'])
    // The gate, on the untouched file: nothing rose and nothing fell.
    const only = (o, file) =>
      o.output
        .split('\n')
        .filter((l) => l.startsWith(file))
        .join('\n')
    assert.deepEqual(compare(countDiagnostics(only(before, 'b.ts'), dir), countDiagnostics(only(after, 'b.ts'), dir)), {
      rose: [],
      fell: [],
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("core's ratchet tsconfig excludes what core's tsconfig does, apart from the test files", () => {
  // "exclude" is replaced, not merged, so a new exclusion in tsconfig.json must be mirrored.
  const ts = createRequire(import.meta.url)('typescript')
  const core = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'packages', 'core')
  const exclude = (file) => ts.readConfigFile(path.join(core, file), ts.sys.readFile).config.exclude
  const testFiles = ['**/*.test.ts', '**/*.test.tsx']
  assert.deepEqual(
    exclude('tsconfig.ratchet.json'),
    exclude('tsconfig.json').filter((e) => !testFiles.includes(e)),
    'packages/core/tsconfig.json and tsconfig.ratchet.json exclude different paths. If you added an exclusion to ' +
      'tsconfig.json, add the same entry to tsconfig.ratchet.json. If it is a new test-file pattern the ratchet ' +
      'should still check, add it to testFiles in this test. Do not delete this test: without it the ratchet ' +
      'keeps checking the path and the next PR gets the errors.'
  )
})

test('fails on a NEW signature', () => {
  const r = judge({ status: 2, output: out(e1, e2) }, countDiagnostics(out(e1), PKG), PKG)
  assert.equal(r.ok, false)
  assert.match(r.lines.join('\n'), /NEW {2}0 -> 1 {2}src\/b\.ts {2}TS2322/)
  assert.match(r.lines.join('\n'), /a file above is one your change does not touch/)
  // The gate shows the diagnostic itself, so the author can find it.
  assert.match(r.lines.join('\n'), / {7}src\/b\.ts\(3,1\): Type 'string' is not assignable to type 'number'\./)
})

test('fails when a COUNT rises: a second error of a kind the file already has', () => {
  const baseline = countDiagnostics(out(e1), PKG)
  const r = judge({ status: 2, output: out(e1, e1Moved) }, baseline, PKG)
  assert.equal(r.ok, false)
  assert.match(r.lines.join('\n'), /NEW {2}1 -> 2 {2}src\/a\.ts {2}TS2339/)
  // A different error of the same code in the same file raises the count too.
  const other = "src/a.ts(7,3): error TS2339: Property 'z' does not exist on type 'W'."
  assert.equal(judge({ status: 2, output: out(e1, other) }, baseline, PKG).ok, false)
})

test('fails when tsc exits non-zero with NO output: a crash is not "zero new errors"', () => {
  for (const output of ['', 'Error: Cannot find module typescript\n    at …']) {
    const r = judge({ status: 1, output }, new Map(), PKG)
    assert.equal(r.ok, false, JSON.stringify(output))
    assert.match(r.lines[0], /exited 1 but reported no diagnostic/)
  }
  assert.equal(judge({ status: null, signal: 'SIGKILL', output: '' }, new Map(), PKG).ok, false)
  assert.equal(judge({ error: new Error('ENOENT'), output: '' }, new Map(), PKG).ok, false)
})

test('a tsc that cannot even start is a failure, by exit status (real spawn)', () => {
  const r = judge(runTsc(path.resolve('.'), { tscPath: '/usr/bin/false' }), new Map(), PKG)
  assert.equal(r.ok, false)
})

test('a missing tsconfig (TS5058) is a new signature, so it fails', () => {
  const r = judge({ status: 1, output: 'error TS5058: The specified path does not exist.' }, new Map(), PKG)
  assert.equal(r.ok, false)
})

test('fails when errors are fixed but the baseline is stale, naming the command that rewrites it', () => {
  const baseline = countDiagnostics(out(e1, e1Moved, e2), PKG)
  const r = judge({ status: 2, output: out(e1) }, baseline, PKG)
  assert.equal(r.ok, false)
  assert.match(r.lines.join('\n'), /FIXED 2 -> 1/)
  assert.match(r.lines.join('\n'), /FIXED 1 -> 0/)
  assert.match(r.lines.join('\n'), /the baseline is stale/)
  assert.match(r.lines.join('\n'), /never resolve it by hand/)
  // The message names the command that ran, project included, so following it
  // cannot record a baseline from a different project.
  const named = judge({ status: 2, output: out(e1) }, baseline, PKG, 'node x --project p.json --write')
  assert.match(named.lines.join('\n'), /Run node x --project p\.json --write and commit the baseline/)
  // All fixed: tsc exits 0, and the baseline still lists errors, so that is stale too.
  assert.equal(judge({ status: 0, output: '' }, baseline, PKG).ok, false)
  // With the baseline rewritten to match, it passes.
  assert.equal(judge({ status: 2, output: out(e1) }, countDiagnostics(out(e1), PKG), PKG).ok, true)
})

test('clean and baseline empty: passes quietly', () => {
  const r = judge({ status: 0, output: '' }, new Map(), PKG)
  assert.equal(r.ok, true)
  assert.equal(r.lines.length, 1)
})

test('the baseline round-trips, sorted, with its header and counts', () => {
  const counts = countDiagnostics(out(e2, e1, e1Moved), PKG)
  const text = formatBaseline(counts)
  assert.match(text, /^# tsc-ratchet baseline/)
  const body = text.split('\n').filter((l) => l && !l.startsWith('#'))
  assert.deepEqual(body, ['2\tsrc/a.ts\tTS2339', '1\tsrc/b.ts\tTS2322'])
  assert.deepEqual(parseBaseline(text), counts)
  assert.throws(() => parseBaseline('two\tsrc/a.ts\tTS1'), /unreadable baseline line/)
  assert.throws(() => parseBaseline('1\tsrc/a.ts\tTS1\tan old message column'), /unreadable baseline line/)
})
