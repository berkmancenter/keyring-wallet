#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Generates packages/core/src/modules/chat/emoji/emoji-data.json: every
 * fully-qualified emoji in the pinned Unicode emoji version, with its group,
 * its English name and search keywords from CLDR, and the emoji version it
 * first appeared in. The chat's emoji picker and reaction validation read it
 * (docs: the rich-messaging plan, §5 "Emoji picker" and "Emoji validation").
 *
 * Inputs are vendored under scripts/emoji/sources/ with their licences, so
 * the build needs no network and the output is reproducible. They stay out
 * of the app bundle; only the generated JSON ships.
 *
 *   node scripts/emoji/generate-emoji-data.mjs           write emoji-data.json
 *   node scripts/emoji/generate-emoji-data.mjs --check   exit 1 when the committed file is stale
 *
 * To move to a new Unicode or CLDR release, replace the files in sources/,
 * update SOURCES below (URL and version), and re-run.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const coreDir = path.resolve(here, '..', '..')
export const SOURCES_DIR = path.join(here, 'sources')
export const DEFAULT_OUT = path.join(coreDir, 'src', 'modules', 'chat', 'emoji', 'emoji-data.json')

export const UNICODE_EMOJI_VERSION = '18.0'
export const CLDR_VERSION = '49.0.0'
export const SOURCES = {
  emojiTest: {
    file: 'emoji-test.txt',
    url: 'https://www.unicode.org/Public/18.0.0/emoji/emoji-test.txt',
  },
  annotations: {
    file: 'cldr-annotations-en.json',
    url: 'https://raw.githubusercontent.com/unicode-org/cldr-json/49.0.0/cldr-json/cldr-annotations-full/annotations/en/annotations.json',
  },
  annotationsDerived: {
    file: 'cldr-annotations-derived-en.json',
    url: 'https://raw.githubusercontent.com/unicode-org/cldr-json/49.0.0/cldr-json/cldr-annotations-derived-full/annotationsDerived/en/annotations.json',
  },
}

/** Fitzpatrick skin-tone modifiers U+1F3FB..U+1F3FF. */
const SKIN_TONE = /[\u{1F3FB}-\u{1F3FF}]/u
const VS16 = /️/g

const LINE =
  /^([0-9A-F ]+?)\s*;\s*(component|fully-qualified|minimally-qualified|unqualified)\s*#\s*\S+\s+E(\d+\.\d+)\s+(.+)$/

const fromCodePoints = (hex) =>
  hex
    .trim()
    .split(/\s+/)
    .map((cp) => String.fromCodePoint(parseInt(cp, 16)))
    .join('')

/**
 * Parse emoji-test.txt into groups of fully-qualified entries, plus every
 * minimally-qualified or unqualified form with the fully-qualified emoji it
 * stands for. A non-fully-qualified form differs from its fully-qualified one
 * only by missing U+FE0F, so they are matched with FE0F removed.
 */
export function parseEmojiTest(text) {
  const groups = []
  const others = []
  let group
  let declaredCount
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd()
    const g = /^# group: (.+)$/.exec(line)
    if (g) {
      group = { name: g[1], entries: [] }
      groups.push(group)
      continue
    }
    const c = /^# fully-qualified : (\d+)$/.exec(line)
    if (c) {
      declaredCount = Number(c[1])
      continue
    }
    const m = LINE.exec(line)
    if (!m) continue
    const [, codePoints, status, version, name] = m
    const emoji = fromCodePoints(codePoints)
    if (status === 'fully-qualified') group.entries.push({ emoji, version: Number(version), name })
    else if (status !== 'component') others.push(emoji)
  }

  const byBare = new Map()
  for (const g of groups) for (const e of g.entries) byBare.set(e.emoji.replace(VS16, ''), e.emoji)
  const aliases = {}
  for (const other of others) {
    const fq = byBare.get(other.replace(VS16, ''))
    if (!fq) throw new Error(`no fully-qualified form for ${JSON.stringify(other)}`)
    aliases[other] = fq
  }
  return { groups: groups.filter((g) => g.entries.length > 0), aliases, declaredCount }
}

/** CLDR keys its annotations without U+FE0F; look an emoji up either way. */
export function cldrLookup(annotations, emoji) {
  return annotations[emoji] ?? annotations[emoji.replace(VS16, '')]
}

/**
 * Build the data file. Each entry is a compact tuple:
 *   [emoji, name, keywords, version]          a base emoji
 *   [emoji, name, 0, version, 1]              a skin-tone variant (validated, not shown in the grid or searched)
 */
export function buildData({ emojiTestText, annotations, annotationsDerived, sha256 }) {
  const { groups, aliases, declaredCount } = parseEmojiTest(emojiTestText)
  const all = { ...annotationsDerived, ...annotations }
  let count = 0
  const outGroups = groups.map((g) => ({
    name: g.name,
    entries: g.entries.map((e) => {
      count += 1
      const cldr = cldrLookup(all, e.emoji)
      const name = cldr?.tts?.[0] ?? e.name
      if (SKIN_TONE.test(e.emoji)) return [e.emoji, name, 0, e.version, 1]
      const keywords = [...new Set((cldr?.default ?? []).map((k) => k.toLowerCase()))].filter((k) => k !== name)
      return [e.emoji, name, keywords, e.version]
    }),
  }))
  if (declaredCount !== undefined && count !== declaredCount) {
    throw new Error(`emoji-test.txt declares ${declaredCount} fully-qualified entries but ${count} were parsed`)
  }
  return {
    unicode: UNICODE_EMOJI_VERSION,
    cldr: CLDR_VERSION,
    sources: sha256,
    count,
    groups: outGroups,
    aliases,
  }
}

/**
 * Serialise with one entry per line, so a Unicode update reviews as a
 * readable diff instead of one changed line.
 */
export function formatData(data) {
  const lines = ['{']
  lines.push(`  "unicode": ${JSON.stringify(data.unicode)},`)
  lines.push(`  "cldr": ${JSON.stringify(data.cldr)},`)
  lines.push(`  "sources": ${JSON.stringify(data.sources)},`)
  lines.push(`  "count": ${data.count},`)
  lines.push('  "groups": [')
  data.groups.forEach((g, gi) => {
    lines.push(`    { "name": ${JSON.stringify(g.name)}, "entries": [`)
    g.entries.forEach((e, ei) => lines.push(`      ${JSON.stringify(e)}${ei < g.entries.length - 1 ? ',' : ''}`))
    lines.push(`    ] }${gi < data.groups.length - 1 ? ',' : ''}`)
  })
  lines.push('  ],')
  const aliasEntries = Object.entries(data.aliases)
  lines.push('  "aliases": {')
  aliasEntries.forEach(([k, v], i) =>
    lines.push(`    ${JSON.stringify(k)}: ${JSON.stringify(v)}${i < aliasEntries.length - 1 ? ',' : ''}`)
  )
  lines.push('  }')
  lines.push('}')
  return lines.join('\n') + '\n'
}

export function readSources(dir = SOURCES_DIR) {
  const read = (key) => fs.readFileSync(path.join(dir, SOURCES[key].file))
  const emojiTest = read('emojiTest')
  const annotations = read('annotations')
  const annotationsDerived = read('annotationsDerived')
  const hash = (buf) => crypto.createHash('sha256').update(buf).digest('hex')
  return {
    emojiTestText: emojiTest.toString('utf8'),
    annotations: JSON.parse(annotations.toString('utf8')).annotations.annotations,
    annotationsDerived: JSON.parse(annotationsDerived.toString('utf8')).annotationsDerived.annotations,
    sha256: {
      [SOURCES.emojiTest.file]: hash(emojiTest),
      [SOURCES.annotations.file]: hash(annotations),
      [SOURCES.annotationsDerived.file]: hash(annotationsDerived),
    },
  }
}

export function generate() {
  return formatData(buildData(readSources()))
}

function main(argv) {
  const out = generate()
  if (argv.includes('--check')) {
    const committed = fs.existsSync(DEFAULT_OUT) ? fs.readFileSync(DEFAULT_OUT, 'utf8') : ''
    if (committed !== out) {
      console.error(
        `${path.relative(process.cwd(), DEFAULT_OUT)} is stale: run node scripts/emoji/generate-emoji-data.mjs`
      )
      process.exit(1)
    }
    console.log('emoji-data.json is up to date')
    return
  }
  fs.mkdirSync(path.dirname(DEFAULT_OUT), { recursive: true })
  fs.writeFileSync(DEFAULT_OUT, out)
  console.log(`wrote ${path.relative(process.cwd(), DEFAULT_OUT)} (${Buffer.byteLength(out)} bytes)`)
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2))
