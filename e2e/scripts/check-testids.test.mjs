// node --test e2e/scripts/check-testids.test.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import { checkReferences, coverageGaps, extractReferences, isKnownKey, isKnownStem, knownIds, listDriverFiles, runCheck, tokenize } from './check-testids.mjs'

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

test('a substitution is lexed with the full rules: a quote inside a regex in `${...}` does not open a string', () => {
  const src = [
    'const cmd = `x \'${a.replace(/\'/g, "")}\'`;',
    "tapTestId(d, 'After');",
    'const url = `${s.replace(/["\']+/g, "")}/${b}`; // "quotes" inside a regex, then a comment',
    'const nested = `outer ${cond ? `in ${x.replace(/`/g, "")}` : "y"} ${`${z}`}`;',
    "existsTestId(d, 'Last');",
  ].join('\n')
  const tokens = tokenize(src)
  assert.deepEqual(coverageGaps(src, tokens), [])
  assert.deepEqual(
    refsOf(src).map((r) => [r.value, r.line]),
    [
      ['After', 2],
      ['Last', 5],
    ]
  )
  // the substitution's tokens stay on the template, not in the stream
  const first = tokens.find((t) => t.type === 'template')
  assert.deepEqual(
    first.inner.map((t) => t.type),
    ['ident', 'punct', 'ident', 'punct', 'regex', 'punct', 'string', 'punct']
  )
})

test('a helper call inside a template substitution is a reference', () => {
  const src = [
    'console.log(`got ${await textOf(d, "Known")}`);',
    'log(`${(await existsTestId(d, "Deep")) ? `yes ${await textOf(d, `Row_${k}`)}` : "no"} ${d.$("~com.ariesbifold:id/Raw")}`);',
  ].join('\n')
  assert.deepEqual(
    refsOf(src).map((r) => [r.kind, r.value, r.via, r.line]),
    [
      ['key', 'Known', 'textOf', 1],
      ['key', 'Deep', 'existsTestId', 2],
      ['stem', 'Row_', 'textOf', 2],
      ['key', 'Raw', 'raw', 2],
    ]
  )
})

test('a source the tokens do not cover is refused: an unclosed template, or tokens stopping before the end', () => {
  const open = ['const a = `never closed', 'tapTestId(d, "Unseen");', 'tapTestId(d, "AlsoUnseen");', '', ''].join('\n')
  assert.deepEqual(coverageGaps(open, tokenize(open)), ['template literal opened at line 1 is never closed'])
  assert.throws(() => extractReferences(open), /not fully tokenized: template literal opened at line 1/)
  const comment = ['tapTestId(d, "Seen");', '/* an unclosed block comment', 'tapTestId(d, "Unseen");', '', '', '', 'tapTestId(d, "AlsoUnseen");'].join('\n')
  assert.deepEqual(coverageGaps(comment, tokenize(comment)), ['tokens stop at line 1, the source goes on to line 7'])
  assert.throws(() => extractReferences(comment), /not fully tokenized/)
  // a short trailing comment, blank lines and an empty source are fine
  const fine = ['tapTestId(d, "Seen");', '// the end', '', ''].join('\n')
  assert.deepEqual(coverageGaps(fine, tokenize(fine)), [])
  assert.deepEqual(coverageGaps('', tokenize('')), [])
  assert.deepEqual(coverageGaps('\n\n', tokenize('\n\n')), [])
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

test('a page object: the key comes first in its own helpers, and an array literal names each key', () => {
  const refs = extractReferences(`
    const textOfId = async (key) => io.byTestId(d, key).getAttribute("text");
    await awaitStep(["VtaLinkDone", "VtaLinkError"], 240000, { each });
    await awaitStep("VtaLinkConfirm", 30000);
    await awaitStep([\`AgentDevice_\${key}\`, "AgentHome"], 5000);
    if (await onScreen("VtaLinkResumed")) say(await wordsOfId("VtaLinkError"), await textOfId("VtaLinkCode"));
    await awaitStep(wanted, 1000);
    await awaitStep([first, "AgentIntro"], 1000);
  `)
  assert.deepEqual(
    refs.map((r) => [r.kind, r.value, r.via]),
    [
      ['dynamic', 'key', 'byTestId'],
      ['key', 'VtaLinkDone', 'awaitStep'],
      ['key', 'VtaLinkError', 'awaitStep'],
      ['key', 'VtaLinkConfirm', 'awaitStep'],
      ['stem', 'AgentDevice_', 'awaitStep'],
      ['key', 'AgentHome', 'awaitStep'],
      ['key', 'VtaLinkResumed', 'onScreen'],
      ['key', 'VtaLinkError', 'wordsOfId'],
      ['key', 'VtaLinkCode', 'textOfId'],
      ['dynamic', 'wanted', 'awaitStep'],
      ['dynamic', '[ first , AgentIntro ]', 'awaitStep'],
    ]
  )
})

test('fixture tree: lists run-*, lib, lib/pages and openvtc drivers (unit tests excluded) and reports per file:line', () => {
  const files = listDriverFiles(fixtures).map((f) => path.relative(fixtures, f))
  assert.deepEqual(files, ['run-sample.js', 'run-sample.mjs', 'lib/helpers.js', 'lib/pages/sample.js', 'openvtc/walk.mjs'])
  const result = runCheck({ root: fixtures })
  assert.equal(result.ok, false)
  assert.deepEqual(
    result.files.map((f) => [f.file, f.unknown.map((r) => `${r.line}:${r.value}`), f.invalid.map((r) => `${r.line}:${r.value}`)]),
    [
      ['run-sample.js', ['9:Renamed', '12:Gone_'], ['10:Not Here']],
      ['lib/pages/sample.js', ['7:Lost'], []],
      ['openvtc/walk.mjs', ['2:TuiOnly'], []],
    ]
  )
  assert.deepEqual(result.stale, ['Unused'])
  assert.equal(result.totals.allowed, 2)
  assert.equal(result.known.keys, 5)
  assert.equal(result.known.stems, 1)
})

test('fixture tree passes once the allowlist covers what is left (an explicit allowlist replaces the file)', () => {
  const result = runCheck({
    root: fixtures,
    allow: { Old: 'x', Renamed: 'x', Gone_: 'x', 'Not Here': 'x', TuiOnly: 'x', Lost: 'x' },
  })
  assert.equal(result.ok, true)
  assert.deepEqual(result.files, [])
})

test('a driver the tokenizer cannot cover fails with its reason, and the other drivers are still checked', () => {
  // Built here, not committed: a driver with an unclosed template is not valid
  // JavaScript, and CI parse-checks every .js file under e2e.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'check-testids-'))
  try {
    fs.mkdirSync(path.join(root, 'lib'))
    fs.writeFileSync(path.join(root, 'lib', 'testids.json'), JSON.stringify({ keys: { Settings: [] }, stems: {}, raw: {} }))
    fs.writeFileSync(path.join(root, 'run-broken.js'), ['// the template on line 2 is never closed, so line 3 is never seen', 'const banner = `opened', 'await tapTestId(d, "Gone");', ''].join('\n'))
    fs.writeFileSync(path.join(root, 'run-fine.js'), 'await tapTestId(d, "Settings");\n')
    const result = runCheck({ root })
    assert.equal(result.ok, false)
    assert.deepEqual(
      result.files.map((f) => [f.file, f.error, f.unknown, f.invalid]),
      [['run-broken.js', 'not fully tokenized: template literal opened at line 2 is never closed', [], []]]
    )
    assert.equal(result.totals.unreadable, 1)
    assert.equal(result.totals.files, 2)
    assert.equal(result.totals.checked, 1) // run-fine.js
    assert.equal(result.totals.unknown, 0)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
