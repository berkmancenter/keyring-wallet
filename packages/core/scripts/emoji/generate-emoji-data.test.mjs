// Run with: node --test packages/core/scripts/emoji/generate-emoji-data.test.mjs
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

import {
  DEFAULT_OUT,
  SOURCES,
  SOURCES_DIR,
  buildData,
  formatData,
  generate,
  parseEmojiTest,
  readSources,
} from './generate-emoji-data.mjs'

const emojiTestText = fs.readFileSync(path.join(SOURCES_DIR, SOURCES.emojiTest.file), 'utf8')

/** Count fully-qualified lines straight from the vendored file, independently of the parser. */
const fullyQualifiedLines = emojiTestText
  .split('\n')
  .filter((l) => /^[0-9A-F]/.test(l) && /; fully-qualified\s/.test(l))

test('the data file holds every fully-qualified emoji in the pinned emoji-test.txt', () => {
  const data = JSON.parse(fs.readFileSync(DEFAULT_OUT, 'utf8'))
  const entries = data.groups.flatMap((g) => g.entries)
  const declared = Number(/^# fully-qualified : (\d+)$/m.exec(emojiTestText)[1])
  assert.equal(fullyQualifiedLines.length, declared)
  assert.equal(entries.length, declared)
  assert.equal(data.count, declared)
  assert.equal(new Set(entries.map((e) => e[0])).size, declared, 'no duplicate emoji')
})

test('every entry carries the emoji version from its E field', () => {
  const data = JSON.parse(fs.readFileSync(DEFAULT_OUT, 'utf8'))
  const versionOf = new Map(data.groups.flatMap((g) => g.entries).map((e) => [e[0], e[3]]))
  for (const line of fullyQualifiedLines) {
    const [, hex, version] = /^([0-9A-F ]+?)\s*;.*#\s*\S+\s+E(\d+\.\d+)/.exec(line)
    const emoji = hex
      .trim()
      .split(/\s+/)
      .map((cp) => String.fromCodePoint(parseInt(cp, 16)))
      .join('')
    assert.equal(versionOf.get(emoji), Number(version), `version of ${line}`)
  }
})

test('the committed data file is what the generator produces from the vendored sources', () => {
  assert.equal(fs.readFileSync(DEFAULT_OUT, 'utf8'), generate())
})

test('generation is deterministic', () => {
  assert.equal(generate(), generate())
})

test('the recorded source hashes match the vendored files', () => {
  const data = JSON.parse(fs.readFileSync(DEFAULT_OUT, 'utf8'))
  for (const { file } of Object.values(SOURCES)) {
    const hash = crypto
      .createHash('sha256')
      .update(fs.readFileSync(path.join(SOURCES_DIR, file)))
      .digest('hex')
    assert.equal(data.sources[file], hash, file)
  }
})

test('the Unicode and CLDR licences are vendored beside the sources', () => {
  for (const f of ['LICENSE-unicode.txt', 'LICENSE-cldr-json.txt']) {
    assert.match(fs.readFileSync(path.join(SOURCES_DIR, f), 'utf8'), /UNICODE LICENSE V3/)
  }
})

test('minimally-qualified and unqualified forms map to their fully-qualified emoji', () => {
  const { aliases } = parseEmojiTest(emojiTestText)
  assert.equal(aliases['❤'], '❤️') // ❤ → ❤️
  assert.equal(aliases['1⃣'], '1️⃣') // keycap 1
  assert.equal(aliases['\u{1F3F3}‍\u{1F308}'], '\u{1F3F3}️‍\u{1F308}') // rainbow flag
})

test('names and keywords come from CLDR, and skin-tone variants carry no keywords', () => {
  const data = buildData(readSources())
  const byEmoji = new Map(data.groups.flatMap((g) => g.entries).map((e) => [e[0], e]))
  const cat = byEmoji.get('\u{1F431}')
  assert.equal(cat[1], 'cat face')
  assert.ok(cat[2].includes('cat'))
  const tone = byEmoji.get('\u{1F44D}\u{1F3FD}')
  assert.equal(tone[1], 'thumbs up: medium skin tone')
  assert.equal(tone[2], 0)
  assert.equal(tone[4], 1)
})

test('formatData round-trips through JSON.parse', () => {
  const data = buildData(readSources())
  assert.deepEqual(JSON.parse(formatData(data)), data)
})

test('a parse whose count disagrees with the declared count fails loudly', () => {
  const sources = readSources()
  const broken = sources.emojiTestText.replace('# fully-qualified : ', '# fully-qualified : 1')
  assert.throws(() => buildData({ ...sources, emojiTestText: broken }), /declares/)
})
