// node --test e2e/scripts/check-testids.test.mjs
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import { checkReferences, extractReferences, isKnownKey, isKnownStem, knownIds, listDriverFiles, runCheck, tokenize } from './check-testids.mjs'

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'check-testids')

const refsOf = (src) => extractReferences(src).map(({ kind, value, line, via }) => ({ kind, value, line, via }))

test('tokenizer: quotes, escapes, comments, regexes and templates with substitutions', () => {
  const src = [
    `const a = 'it\\'s'; // tapTestId(d, "InComment")`,
    `/* existsTestId(d, 'InBlock') */ const b = "say \\"hi\\"";`,
    `const re = /["']Quoted/g; const t = \`Row_\${id}_\${n}\`;`,
    `const n = 10 / 2 / 5;`,
  ].join('\n')
  const tokens = tokenize(src)
  const strings = tokens.filter((t) => t.type === 'string').map((t) => t.value)
  assert.deepEqual(strings, ["it's", 'say "hi"'])
  assert.equal(tokens.filter((t) => t.type === 'regex').length, 1)
  const tpl = tokens.find((t) => t.type === 'template')
  assert.deepEqual(
    tpl.parts.map((p) => [p.text, p.sub]),
    [
      ['Row_', true],
      ['_', true],
      ['', false],
    ]
  )
  assert.equal(tpl.line, 3)
  // a division is not a regex: both numbers survive
  assert.deepEqual(tokens.filter((t) => t.type === 'number').map((t) => t.value), ['10', '2', '5'])
})

test('extracts literal keys from every helper, in either quote style, with the line', () => {
  const src = [
    `await tapTestId(d, "Settings", 15000);`,
    `if (await existsTestId(driver, 'HardwareAttestation', 5000)) {}`,
    `const el = byTestId(d, 'MyAgent');`,
    `await waitForTestId(d, "PastedUrl");`,
    `await scrollToTestId(d, 'ScanPastedUrl', 8, { direction: "up" });`,
    `await tapTestIdReliable(d, "Continue", () => existsTestId(d, "Next", 1500));`,
    `await tapTestIdByCoordinates(d, 'GiveFeedback');`,
    `await findScrolling(d, 'AgentDevice_abc');`,
    `await tapLifted(d, 'DetailsToggle', { verify });`,
    `const t = await textOf(d, "VettingTicketCode");`,
    `await existsRawId(d, "SecureExchangeBadge");`,
  ].join('\n')
  const refs = refsOf(src)
  assert.deepEqual(
    refs.map((r) => [r.value, r.via, r.line]),
    [
      ['Settings', 'tapTestId', 1],
      ['HardwareAttestation', 'existsTestId', 2],
      ['MyAgent', 'byTestId', 3],
      ['PastedUrl', 'waitForTestId', 4],
      ['ScanPastedUrl', 'scrollToTestId', 5],
      ['Continue', 'tapTestIdReliable', 6],
      ['Next', 'existsTestId', 6],
      ['GiveFeedback', 'tapTestIdByCoordinates', 7],
      ['AgentDevice_abc', 'findScrolling', 8],
      ['DetailsToggle', 'tapLifted', 9],
      ['VettingTicketCode', 'textOf', 10],
      ['SecureExchangeBadge', 'existsRawId', 11],
    ]
  )
  assert.ok(refs.every((r) => r.kind === 'key'))
})

test('waitStable: the target and its absent list', () => {
  const src = `await waitStable(d, "CredentialCard", { absent: ["NoCredentials", 'AddFirstCredential', \`Row_\${k}\`], holdMs: 500 });`
  assert.deepEqual(
    refsOf(src).map((r) => [r.kind, r.value, r.via]),
    [
      ['key', 'CredentialCard', 'waitStable'],
      ['key', 'NoCredentials', 'waitStable.absent'],
      ['key', 'AddFirstCredential', 'waitStable.absent'],
      ['stem', 'Row_', 'waitStable.absent'],
    ]
  )
})

test('template literals yield a stem; a variable or a bare substitution is dynamic', () => {
  const src = [
    'await tapTestId(d, `AgentSegment_${key}`, 10000);',
    'await existsTestId(d, `${id}`);',
    'await existsTestId(d, id, 1500);',
    'await tapTestId(d, `Plain`);',
    'await existsTestId(d, cond ? "A" : `B_${x}`);',
  ].join('\n')
  assert.deepEqual(
    refsOf(src).map((r) => [r.kind, r.value]),
    [
      ['stem', 'AgentSegment_'],
      ['dynamic', '`${…}`'],
      ['dynamic', 'id'],
      ['key', 'Plain'],
      ['key', 'A'],
      ['stem', 'B_'],
    ]
  )
})

test('raw com.ariesbifold:id/ strings: keys, stems before a substitution or a trailing _, and inside a substitution', () => {
  const src = [
    `d.$('android=new UiSelector().resourceId("com.ariesbifold:id/AgentAddedCard")');`,
    'd.$(`android=new UiSelector().resourceId("com.ariesbifold:id/${id}")`);',
    'd.$$(`//*[starts-with(@resource-id,"com.ariesbifold:id/AgentSwitcherRow_")]`);',
    'd.$(`//*[@name="com.ariesbifold:id/AskMeSwitch_${ctx}"]`);',
    'const x = `${d.$("~com.ariesbifold:id/Inner")}`;',
    `s.replace("com.ariesbifold:id/", "");`,
  ].join('\n')
  assert.deepEqual(
    refsOf(src).map((r) => [r.kind, r.value, r.line]),
    [
      ['key', 'AgentAddedCard', 1],
      ['dynamic', '`${…}`', 2],
      ['stem', 'AgentSwitcherRow_', 3],
      ['stem', 'AskMeSwitch_', 4],
      ['key', 'Inner', 5],
    ]
  )
})

test('a helper definition is not a reference', () => {
  const src = ['export async function tapTestId(driver, key, timeout = 30000) {', '  const el = await waitForTestId(driver, key, timeout);', '}'].join('\n')
  assert.deepEqual(
    refsOf(src).map((r) => r.kind),
    ['dynamic']
  )
})

test('known ids: keys, raw ids and stems from several manifests', () => {
  const known = knownIds([
    { keys: { Settings: [] }, stems: { AgentDevice_: [] }, raw: { WitnessedBadge: [] } },
    { keys: { ToggleDeveloper: [] } },
  ])
  assert.equal(isKnownKey('Settings', known), true)
  assert.equal(isKnownKey('ToggleDeveloper', known), true)
  assert.equal(isKnownKey('WitnessedBadge', known), true)
  assert.equal(isKnownKey('AgentDevice_abc', known), true)
  assert.equal(isKnownKey('AgentDevice_', known), false)
  assert.equal(isKnownKey('Nope', known), false)
  assert.equal(isKnownStem('AgentDevice_', known), true)
  assert.equal(isKnownStem('AgentDev', known), true) // the start of a stem
  assert.equal(isKnownStem('AgentDevice_x', known), true) // begins with a stem
  assert.equal(isKnownStem('Sett', known), true) // the start of a key
  assert.equal(isKnownStem('Zzz_', known), false)
})

test('a key with whitespace is invalid unless allowlisted; unknown keys are listed; the allowlist is honoured', () => {
  const known = knownIds([{ keys: { Settings: [] }, stems: {}, raw: {} }])
  const refs = extractReferences(`tapTestId(d, "Try Again"); tapTestId(d, "Gone"); tapTestId(d, "Settings"); tapTestId(d, "Old"); tapTestId(d, x);`)
  const r = checkReferences(refs, known, { Old: 'older-build fallback' })
  assert.deepEqual(r.invalid.map((x) => x.value), ['Try Again'])
  assert.deepEqual(r.unknown.map((x) => x.value), ['Gone'])
  assert.equal(r.allowed, 1)
  assert.equal(r.dynamic, 1)
  assert.equal(r.checked, 4)
  const r2 = checkReferences(refs, known, { Old: 'older-build fallback', 'Try Again': 'derived from a label, the space is kept' })
  assert.deepEqual(r2.invalid, [])
})

test('fixture tree: lists run-*, lib and openvtc drivers (unit tests excluded) and reports per file:line', () => {
  const files = listDriverFiles(fixtures).map((f) => path.relative(fixtures, f))
  assert.deepEqual(files, ['run-sample.js', 'run-sample.mjs', 'lib/helpers.js', 'openvtc/walk.mjs'])
  const result = runCheck({ root: fixtures })
  assert.equal(result.ok, false)
  assert.deepEqual(
    result.files.map((f) => [f.file, f.unknown.map((r) => `${r.line}:${r.value}`), f.invalid.map((r) => `${r.line}:${r.value}`)]),
    [
      ['run-sample.js', ['9:Renamed', '12:Gone_'], ['10:Not Here']],
      ['openvtc/walk.mjs', ['2:TuiOnly'], []],
    ]
  )
  assert.deepEqual(result.stale, ['Unused'])
  assert.equal(result.totals.allowed, 1)
  assert.equal(result.known.keys, 5)
  assert.equal(result.known.stems, 1)
})

test('fixture tree passes once the allowlist covers what is left (an explicit allowlist replaces the file)', () => {
  const result = runCheck({
    root: fixtures,
    allow: { Old: 'x', Renamed: 'x', Gone_: 'x', 'Not Here': 'x', TuiOnly: 'x' },
  })
  assert.equal(result.ok, true)
  assert.deepEqual(result.files, [])
})
