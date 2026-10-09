#!/usr/bin/env node
/**
 * Checks that every testID the e2e drivers name exists in the app, so a
 * renamed or deleted id fails the PR that renamed it instead of the next gate.
 *
 * The drivers' side: every literal handed to the testID helper family
 * (byTestId, waitForTestId, tapTestId, tapTestIdReliable, tapTestIdByCoordinates,
 * scrollToTestId, existsTestId, existsRawId, findScrolling, waitStable and its
 * `absent` list, tapLifted, textOf) and every raw "com.ariesbifold:id/<key>"
 * string, across e2e/run-*.{js,mjs}, e2e/lib/*.{js,mjs} (unit tests excluded:
 * their fixture ids are not selectors) and e2e/openvtc/*.{js,mjs}. A template
 * literal with substitutions yields a stem: the text before its first `${`.
 * A key that is not a literal (a variable, a call) is dynamic and not checked.
 *
 * The app's side: e2e/lib/testids.json (bifold's packages/core manifest, see
 * sync-testids.sh) and e2e/lib/testids.app.json (the same extraction over the
 * wallet's app/src). A driver key is known when it is one of their keys or raw
 * ids, or begins with one of their stems; a driver stem is known when it is a
 * manifest stem, begins with one, or is the beginning of one or of a key.
 *
 * e2e/lib/testids.allow.json names the exceptions, each with its reason:
 * ids the generator cannot name (derived from a label at runtime), an older
 * build's handle a driver still falls back to, and the like.
 *
 * A key with whitespace is INVALID: testIdForAccessabilityLabel strips it, so
 * such a key only ever matches an id built straight from a label (the
 * allowlist says which those are).
 *
 *   node e2e/scripts/check-testids.mjs          exit 1 and list unknown keys per file:line
 *   node e2e/scripts/check-testids.mjs --json   the same, as one JSON object
 *
 * No packages needed: runs on a bare checkout, in CI's parse-check step.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const PREFIX = 'com.ariesbifold:id/'

/** Helper name -> index of the argument that carries the key. */
export const HELPERS = {
  byTestId: 1,
  waitForTestId: 1,
  tapTestId: 1,
  tapTestIdReliable: 1,
  tapTestIdByCoordinates: 1,
  scrollToTestId: 1,
  existsTestId: 1,
  existsRawId: 1,
  findScrolling: 1,
  waitStable: 1,
  tapLifted: 1,
  textOf: 1,
}

const e2eDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// ---------------------------------------------------------------- tokenizer

const PUNCT_BEFORE_REGEX = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^', '=>'])
const KEYWORDS_BEFORE_REGEX = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await'])

/**
 * Tokenizes JavaScript source into the tokens the extraction needs:
 *   { type: 'ident' | 'number' | 'punct' | 'string' | 'template' | 'regex', value, line }
 * A template token carries `parts`: [{ text, sub }] in order, `sub` true when
 * a `${...}` follows that text, and `inner`: the tokens of its substitutions,
 * kept on the template (not in the stream, so an argument stays one token) so
 * a raw prefix string inside `${...}` is still seen. Comments are dropped.
 */
export const tokenize = (src) => {
  const tokens = []
  let i = 0
  let line = 1
  const n = src.length
  const push = (type, value, extra) => tokens.push({ type, value, line, ...extra })
  const lastSignificant = () => tokens[tokens.length - 1]

  const regexAllowed = () => {
    const t = lastSignificant()
    if (!t) return true
    if (t.type === 'punct') return PUNCT_BEFORE_REGEX.has(t.value)
    if (t.type === 'ident') return KEYWORDS_BEFORE_REGEX.has(t.value)
    return false
  }

  // Reads a template literal starting at the backtick at `i`; returns the token and advances.
  const readTemplate = () => {
    const startLine = line
    const parts = []
    const inner = [] // tokens of the substitutions, kept on the template token
    let text = ''
    i++ // opening backtick
    while (i < n) {
      const c = src[i]
      if (c === '\\') {
        text += c + (src[i + 1] ?? '')
        if (src[i + 1] === '\n') line++
        i += 2
        continue
      }
      if (c === '`') {
        i++
        parts.push({ text, sub: false })
        return { type: 'template', value: text, line: startLine, parts, inner }
      }
      if (c === '$' && src[i + 1] === '{') {
        parts.push({ text, sub: true })
        text = ''
        i += 2
        // tokenize the substitution until its matching close brace
        let depth = 1
        const subStart = i
        while (i < n && depth > 0) {
          const d = src[i]
          if (d === '{') depth++
          else if (d === '}') depth--
          else if (d === '`') {
            readTemplate() // skip a nested template as a unit
            continue
          } else if (d === '"' || d === "'") {
            readString(d)
            continue
          } else if (d === '\n') line++
          if (depth > 0) i++
        }
        const subSrc = src.slice(subStart, i)
        i++ // closing brace
        for (const t of tokenize(subSrc)) inner.push({ ...t, line: startLine })
        continue
      }
      if (c === '\n') line++
      text += c
      i++
    }
    parts.push({ text, sub: false })
    return { type: 'template', value: text, line: startLine, parts, inner }
  }

  const readString = (quote) => {
    const startLine = line
    let text = ''
    i++
    while (i < n) {
      const c = src[i]
      if (c === '\\') {
        const e = src[i + 1] ?? ''
        text += e === 'n' ? '\n' : e === 't' ? '\t' : e
        i += 2
        continue
      }
      if (c === quote) {
        i++
        break
      }
      if (c === '\n') break // unterminated: stop at the line end
      text += c
      i++
    }
    return { type: 'string', value: text, line: startLine }
  }

  while (i < n) {
    const c = src[i]
    if (c === '\n') {
      line++
      i++
      continue
    }
    if (c === ' ' || c === '\t' || c === '\r') {
      i++
      continue
    }
    if (c === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') i++
      continue
    }
    if (c === '/' && src[i + 1] === '*') {
      i += 2
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') line++
        i++
      }
      i += 2
      continue
    }
    if (c === '"' || c === "'") {
      tokens.push(readString(c))
      continue
    }
    if (c === '`') {
      tokens.push(readTemplate())
      continue
    }
    if (c === '/' && regexAllowed()) {
      const startLine = line
      let j = i + 1
      let inClass = false
      while (j < n && src[j] !== '\n') {
        if (src[j] === '\\') j += 2
        else if (src[j] === '[') (inClass = true), j++
        else if (src[j] === ']') (inClass = false), j++
        else if (src[j] === '/' && !inClass) break
        else j++
      }
      j++ // closing slash
      while (j < n && /[a-z]/i.test(src[j])) j++
      tokens.push({ type: 'regex', value: src.slice(i, j), line: startLine })
      i = j
      continue
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i
      while (j < n && /[A-Za-z0-9_$]/.test(src[j])) j++
      push('ident', src.slice(i, j))
      i = j
      continue
    }
    if (/[0-9]/.test(c)) {
      let j = i
      while (j < n && /[0-9A-Za-z_.]/.test(src[j])) j++
      push('number', src.slice(i, j))
      i = j
      continue
    }
    if (c === '=' && src[i + 1] === '>') {
      push('punct', '=>')
      i += 2
      continue
    }
    push('punct', c)
    i++
  }
  return tokens
}

// --------------------------------------------------------------- extraction

/** Splits the tokens of a call's argument list (after `(`, up to the matching `)`) into arguments. */
const readArguments = (tokens, open) => {
  const args = [[]]
  let depth = 0
  let k = open + 1
  for (; k < tokens.length; k++) {
    const t = tokens[k]
    if (t.type === 'punct') {
      if (t.value === '(' || t.value === '[' || t.value === '{') depth++
      else if (t.value === ')' || t.value === ']' || t.value === '}') {
        if (depth === 0) break
        depth--
      } else if (t.value === ',' && depth === 0) {
        args.push([])
        continue
      }
    }
    args[args.length - 1].push(t)
  }
  return { args, close: k }
}

const stemOf = (template) => {
  const first = template.parts[0]
  if (!first.sub) return { kind: 'key', value: first.text } // no substitution: a plain key
  return first.text.length > 0 ? { kind: 'stem', value: first.text } : { kind: 'dynamic', value: '`${…}`' }
}

/** What one argument names: a key, a stem, several (a conditional of literals) or something dynamic. */
const classify = (arg) => {
  if (arg.length === 1) {
    const t = arg[0]
    if (t.type === 'string') return [{ kind: 'key', value: t.value }]
    if (t.type === 'template') return [stemOf(t)]
    return [{ kind: 'dynamic', value: t.value }]
  }
  // cond ? 'A' : 'B' with literal branches
  const q = arg.findIndex((t) => t.type === 'punct' && t.value === '?')
  if (q > 0) {
    const rest = arg.slice(q + 1)
    const colon = rest.findIndex((t) => t.type === 'punct' && t.value === ':')
    if (colon > 0) {
      const a = classify(rest.slice(0, colon))
      const b = classify(rest.slice(colon + 1))
      return [...a, ...b]
    }
  }
  return [{ kind: 'dynamic', value: arg.map((t) => t.value).join(' ') }]
}

/** Keys listed in `absent: [ ... ]` inside a waitStable options object. */
const absentKeys = (optionTokens) => {
  const out = []
  for (let k = 0; k < optionTokens.length - 2; k++) {
    const t = optionTokens[k]
    if (t.type !== 'ident' || t.value !== 'absent') continue
    if (optionTokens[k + 1].value !== ':' || optionTokens[k + 2].value !== '[') continue
    for (let m = k + 3; m < optionTokens.length; m++) {
      const u = optionTokens[m]
      if (u.type === 'punct' && u.value === ']') break
      if (u.type === 'string') out.push({ kind: 'key', value: u.value, line: u.line })
      else if (u.type === 'template') out.push({ ...stemOf(u), line: u.line })
      else if (u.type === 'ident') out.push({ kind: 'dynamic', value: u.value, line: u.line })
    }
  }
  return out
}

const TERMINATOR = /["'`)\]\s,]/

/** Keys and stems spelled out as com.ariesbifold:id/<key> inside a string or template. */
const rawPrefixed = (token) => {
  const out = []
  const parts = token.type === 'template' ? token.parts : [{ text: token.value, sub: false }]
  for (const part of parts) {
    let from = 0
    for (;;) {
      const at = part.text.indexOf(PREFIX, from)
      if (at < 0) break
      const start = at + PREFIX.length
      let end = start
      while (end < part.text.length && !TERMINATOR.test(part.text[end])) end++
      const text = part.text.slice(start, end)
      from = end
      if (end === part.text.length && part.sub) {
        out.push(text.length > 0 ? { kind: 'stem', value: text, line: token.line } : { kind: 'dynamic', value: '`${…}`', line: token.line })
      } else if (/[_-]$/.test(text)) {
        out.push({ kind: 'stem', value: text, line: token.line }) // starts-with(@resource-id, "…/Stem_")
      } else if (text.length > 0) {
        out.push({ kind: 'key', value: text, line: token.line })
      }
    }
  }
  return out
}

/**
 * Every testID reference in one driver file.
 * @returns {{ kind: 'key' | 'stem' | 'dynamic', value: string, line: number, via: string }[]}
 */
export const extractReferences = (src) => {
  const tokens = tokenize(src)
  const refs = []
  for (let k = 0; k < tokens.length - 1; k++) {
    const t = tokens[k]
    if (t.type === 'ident' && Object.hasOwn(HELPERS, t.value) && tokens[k + 1].type === 'punct' && tokens[k + 1].value === '(') {
      // not a definition: `function tapTestId(` / `const tapTestId = (`
      const prev = tokens[k - 1]
      if (prev && prev.type === 'ident' && (prev.value === 'function' || prev.value === 'async')) continue
      const { args } = readArguments(tokens, k + 1)
      const arg = args[HELPERS[t.value]]
      if (arg && arg.length > 0) for (const r of classify(arg)) refs.push({ ...r, line: arg[0].line, via: t.value })
      if (t.value === 'waitStable' && args[2]) for (const r of absentKeys(args[2])) refs.push({ ...r, via: 'waitStable.absent' })
    }
    if (t.type === 'string' || t.type === 'template') {
      for (const r of rawInside(t)) refs.push({ ...r, via: 'raw' })
    }
  }
  return refs
}

/** Raw prefix strings in a token and, for a template, in its substitutions. */
const rawInside = (token) => {
  const out = rawPrefixed(token)
  for (const t of token.inner ?? []) if (t.type === 'string' || t.type === 'template') out.push(...rawInside(t))
  return out
}

// --------------------------------------------------------------- comparison

const loadJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))

/** The app's side: keys, raw ids and stems from the manifests handed in. */
export const knownIds = (manifests) => {
  const keys = new Set()
  const stems = new Set()
  for (const m of manifests) {
    for (const k of Object.keys(m.keys ?? {})) keys.add(k)
    for (const k of Object.keys(m.raw ?? {})) keys.add(k)
    for (const s of Object.keys(m.stems ?? {})) stems.add(s)
  }
  return { keys, stems }
}

export const isKnownKey = (key, { keys, stems }) => {
  if (keys.has(key)) return true
  for (const s of stems) if (key.length > s.length && key.startsWith(s)) return true
  return false
}

export const isKnownStem = (stem, { keys, stems }) => {
  if (stems.has(stem)) return true
  for (const s of stems) if (s.startsWith(stem) || stem.startsWith(s)) return true
  for (const k of keys) if (k.startsWith(stem)) return true
  return false
}

export const hasWhitespace = (s) => /\s/.test(s)

/**
 * Checks one file's references against the known ids and the allowlist.
 * @returns {{ unknown: object[], invalid: object[], dynamic: number, checked: number, allowed: number }}
 */
export const checkReferences = (refs, known, allow) => {
  const unknown = []
  const invalid = []
  let dynamic = 0
  let allowed = 0
  let checked = 0
  for (const r of refs) {
    if (r.kind === 'dynamic') {
      dynamic++
      continue
    }
    checked++
    if (r.value in allow) {
      allowed++
      continue
    }
    if (hasWhitespace(r.value)) {
      invalid.push(r)
      continue
    }
    const ok = r.kind === 'stem' ? isKnownStem(r.value, known) : isKnownKey(r.value, known)
    if (!ok) unknown.push(r)
  }
  return { unknown, invalid, dynamic, checked, allowed }
}

// ------------------------------------------------------------------- driver

const DRIVER_FILE = /\.(js|mjs)$/
const UNIT_TEST = /\.test\.m?js$/

export const listDriverFiles = (root = e2eDir) => {
  const files = []
  for (const name of fs.readdirSync(root).sort()) {
    if (name.startsWith('run-') && DRIVER_FILE.test(name)) files.push(path.join(root, name))
  }
  for (const dir of ['lib', 'openvtc']) {
    const full = path.join(root, dir)
    if (!fs.existsSync(full)) continue
    for (const name of fs.readdirSync(full).sort()) {
      if (DRIVER_FILE.test(name) && !UNIT_TEST.test(name)) files.push(path.join(full, name))
    }
  }
  return files
}

export const runCheck = ({ root = e2eDir, manifests, allow } = {}) => {
  const libDir = path.join(root, 'lib')
  const loaded =
    manifests ??
    ['testids.json', 'testids.app.json'].filter((f) => fs.existsSync(path.join(libDir, f))).map((f) => loadJson(path.join(libDir, f)))
  if (loaded.length === 0) throw new Error(`no manifest in ${libDir}: run e2e/scripts/sync-testids.sh <bifold checkout>`)
  const allowed = allow ?? (fs.existsSync(path.join(libDir, 'testids.allow.json')) ? loadJson(path.join(libDir, 'testids.allow.json')) : {})
  const known = knownIds(loaded)
  const files = []
  const totals = { files: 0, checked: 0, dynamic: 0, allowed: 0, unknown: 0, invalid: 0 }
  for (const file of listDriverFiles(root)) {
    const rel = path.relative(root, file).split(path.sep).join('/')
    const result = checkReferences(extractReferences(fs.readFileSync(file, 'utf8')), known, allowed)
    totals.files++
    totals.checked += result.checked
    totals.dynamic += result.dynamic
    totals.allowed += result.allowed
    totals.unknown += result.unknown.length
    totals.invalid += result.invalid.length
    if (result.unknown.length || result.invalid.length) files.push({ file: rel, unknown: result.unknown, invalid: result.invalid })
  }
  // An allowlist entry nothing uses any more is noise: say so, without failing.
  const used = new Set()
  for (const file of listDriverFiles(root)) for (const r of extractReferences(fs.readFileSync(file, 'utf8'))) used.add(r.value)
  const stale = Object.keys(allowed).filter((k) => !used.has(k))
  return { ok: totals.unknown === 0 && totals.invalid === 0, totals, files, stale, known: { keys: known.keys.size, stems: known.stems.size } }
}

const main = () => {
  const json = process.argv.includes('--json')
  const result = runCheck()
  if (json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n')
    process.exit(result.ok ? 0 : 1)
  }
  const { totals, known } = result
  for (const f of result.files) {
    for (const r of f.invalid) console.error(`${f.file}:${r.line}: INVALID key "${r.value}" (whitespace) via ${r.via}`)
    for (const r of f.unknown) console.error(`${f.file}:${r.line}: unknown ${r.kind} "${r.value}" via ${r.via}`)
  }
  for (const k of result.stale) console.error(`note: allowlist entry "${k}" is used by no driver`)
  const summary = `${totals.checked} references in ${totals.files} files against ${known.keys} ids and ${known.stems} stems (${totals.allowed} allowlisted, ${totals.dynamic} dynamic)`
  if (result.ok) {
    console.log(`testids: all known; ${summary}`)
    return
  }
  console.error(`testids: ${totals.unknown} unknown, ${totals.invalid} invalid; ${summary}`)
  process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main()
}
