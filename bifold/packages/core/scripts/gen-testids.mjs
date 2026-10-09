#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Generates packages/core/testids.json: the manifest of every testID key the
 * core package hands to React Native, found by walking the TypeScript AST of
 * src/ (no type checker). The wallet's e2e drivers read the manifest instead
 * of retyping the strings, and `--check` fails CI when the committed file no
 * longer matches the tree. See docs/testids.md for the rules.
 *
 *   node scripts/gen-testids.mjs             write testids.json
 *   node scripts/gen-testids.mjs --check     exit 1 when the committed file is stale
 *   node scripts/gen-testids.mjs --json      print the manifest to stdout
 *   node scripts/gen-testids.mjs --out PATH  write somewhere else
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

export const HELPER_NAME = 'testIdWithKey'
export const PREFIX = 'com.ariesbifold:id/'
export const IDS_MAP_SUFFIX = 'Ids'
export const MANIFEST_SECTIONS = ['keys', 'stems', 'raw', 'derived']

const coreDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const DEFAULT_OUT = path.join(coreDir, 'testids.json')

// ---------------------------------------------------------------- extraction

const isStringLiteral = (node) => ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)

const unwrap = (node) => {
  let n = node
  while (
    ts.isParenthesizedExpression(n) ||
    ts.isAsExpression(n) ||
    ts.isSatisfiesExpression?.(n) ||
    ts.isTypeAssertionExpression(n) ||
    ts.isNonNullExpression(n)
  ) {
    n = n.expression
  }
  return n
}

/** The leftmost operand of a chain of `+` concatenations, or the node itself. */
const leftmostOperand = (node) => {
  let n = unwrap(node)
  while (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    n = unwrap(n.left)
  }
  return n
}

/**
 * Classifies the argument handed to testIdWithKey. A literal is a key, a
 * template or concatenation with a literal head is a stem, a conditional
 * contributes both branches, an element or property access on a same-file
 * lookup table contributes every string value of that table (rule 6), and
 * anything else is a derived expression the manifest records but cannot name.
 * `ctx` is { sourceFile, relPath, out, tables }.
 */
const classifyArgument = (node, ctx) => {
  const { sourceFile, relPath, out } = ctx
  const loc = relPath
  const n = unwrap(node)
  if (isStringLiteral(n)) {
    out.keys.push({ key: n.text, loc })
    return
  }
  if (ts.isTemplateExpression(n)) {
    const head = n.head.text
    if (head.length > 0) {
      out.stems.push({ stem: head, loc })
    } else {
      out.derived.push({ loc, expr: node.getText(sourceFile) })
    }
    return
  }
  if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = leftmostOperand(n)
    if (isStringLiteral(left) && left.text.length > 0) {
      out.stems.push({ stem: left.text, loc })
    } else {
      out.derived.push({ loc, expr: node.getText(sourceFile) })
    }
    return
  }
  if (ts.isConditionalExpression(n)) {
    classifyArgument(n.whenTrue, ctx)
    classifyArgument(n.whenFalse, ctx)
    return
  }
  // 6: inputTestId[usage] / ids.root where the table is an object literal declared in this file.
  // Every string value of the table is a key the call can produce; the call stays listed as derived.
  if ((ts.isElementAccessExpression(n) || ts.isPropertyAccessExpression(n)) && ts.isIdentifier(n.expression)) {
    const table = localObjectLiteral(ctx, n.expression.text)
    if (table) collectIdsMapValues(table, out, relPath)
  }
  out.derived.push({ loc, expr: node.getText(sourceFile) })
}

/** Every string value of an object literal, nested maps included; computed property names count. */
const collectIdsMapValues = (objectLiteral, out, relPath) => {
  for (const prop of objectLiteral.properties) {
    if (!ts.isPropertyAssignment(prop)) continue
    const value = unwrap(prop.initializer)
    if (isStringLiteral(value)) {
      out.keys.push({ key: value.text, loc: relPath })
    } else if (ts.isObjectLiteralExpression(value)) {
      collectIdsMapValues(value, out, relPath)
    }
  }
}

/**
 * The object literal a `const <name> = { ... }` declaration anywhere in the
 * file initialises, or undefined. Resolved once per file and cached in ctx.
 */
const localObjectLiteral = (ctx, name) => {
  if (!ctx.tables) {
    ctx.tables = new Map()
    const visit = (node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        const init = unwrap(node.initializer)
        if (ts.isObjectLiteralExpression(init) && !ctx.tables.has(node.name.text)) ctx.tables.set(node.name.text, init)
      }
      ts.forEachChild(node, visit)
    }
    visit(ctx.sourceFile)
  }
  return ctx.tables.get(name)
}

const hasExportModifier = (node) =>
  (ts.canHaveModifiers(node) ? (ts.getModifiers(node) ?? []) : []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)

/**
 * Extracts every testID the given source contributes. Every entry's `loc` is
 * the file path (`relPath`), never a line: the manifest must only change when
 * an id is added, removed, renamed or moved to another file, not when a line
 * shifts, or every UI change would conflict on it.
 * @param {string} text   file contents
 * @param {string} relPath path to report, relative to packages/core (e.g. src/screens/Home.tsx)
 * @returns {{keys: {key: string, loc: string}[], stems: {stem: string, loc: string}[],
 *            raw: {key: string, loc: string}[], derived: {loc: string, expr: string}[]}}
 */
export const extractFromSource = (text, relPath) => {
  const kind = relPath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const sourceFile = ts.createSourceFile(relPath, text, ts.ScriptTarget.Latest, true, kind)
  const out = { keys: [], stems: [], raw: [], derived: [] }
  const ctx = { sourceFile, relPath, out }

  const visit = (node) => {
    // 1, 2, 4, 6: testIdWithKey(...) anywhere, including tabBarTestID: testIdWithKey('X')
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === HELPER_NAME &&
      node.arguments.length > 0
    ) {
      classifyArgument(node.arguments[0], ctx)
    }

    // 3: export const <Name>Ids = { k: 'Literal', ... } as const
    if (ts.isVariableStatement(node) && hasExportModifier(node)) {
      for (const decl of node.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !decl.name.text.endsWith(IDS_MAP_SUFFIX) || !decl.initializer) continue
        const init = unwrap(decl.initializer)
        if (ts.isObjectLiteralExpression(init)) collectIdsMapValues(init, out, relPath)
      }
    }

    // 5: testID="Literal" / testID={'Literal'} without the helper (no prefix is applied)
    if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && node.name.text === 'testID' && node.initializer) {
      const init = node.initializer
      if (isStringLiteral(init)) {
        out.raw.push({ key: init.text, loc: relPath })
      } else if (ts.isJsxExpression(init) && init.expression) {
        const inner = unwrap(init.expression)
        if (isStringLiteral(inner)) out.raw.push({ key: inner.text, loc: relPath })
      }
    }

    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return out
}

// ------------------------------------------------------------------- sources

const SOURCE_EXT = /\.(ts|tsx)$/
const TEST_FILE = /\.test\./

export const listSourceFiles = (srcDir) => {
  const files = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === '__tests__' || entry.name === 'node_modules') continue
        walk(full)
      } else if (SOURCE_EXT.test(entry.name) && !TEST_FILE.test(entry.name) && !entry.name.endsWith('.d.ts')) {
        files.push(full)
      }
    }
  }
  walk(srcDir)
  return files
}

// ------------------------------------------------------------------ manifest

const compareString = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

const groupSorted = (entries, field) => {
  const map = new Map()
  for (const e of entries) {
    if (!map.has(e[field])) map.set(e[field], new Set())
    map.get(e[field]).add(e.loc)
  }
  const result = {}
  for (const k of [...map.keys()].sort(compareString)) result[k] = [...map.get(k)].sort(compareString)
  return result
}

/**
 * Builds the manifest object from per-file extraction results.
 * @param {ReturnType<typeof extractFromSource>[]} perFile
 * @param {{generatedFrom: string, prefix?: string}} meta
 */
export const buildManifest = (perFile, { generatedFrom, prefix = PREFIX }) => {
  const all = { keys: [], stems: [], raw: [], derived: [] }
  for (const r of perFile) for (const s of MANIFEST_SECTIONS) all[s].push(...r[s])
  const seen = new Set()
  const derived = all.derived
    .sort((a, b) => compareString(a.loc, b.loc) || compareString(a.expr, b.expr))
    .filter(({ loc, expr }) => !seen.has(`${loc} ${expr}`) && seen.add(`${loc} ${expr}`))
    .map(({ loc, expr }) => ({ [loc]: expr }))
  return {
    generatedFrom,
    prefix,
    keys: groupSorted(all.keys, 'key'),
    stems: groupSorted(all.stems, 'stem'),
    raw: groupSorted(all.raw, 'key'),
    derived,
  }
}

export const generateManifest = ({ root = coreDir, generatedFrom = gitHead(root) } = {}) => {
  const srcDir = path.join(root, 'src')
  const perFile = listSourceFiles(srcDir).map((file) =>
    extractFromSource(fs.readFileSync(file, 'utf8'), path.relative(root, file).split(path.sep).join('/'))
  )
  return buildManifest(perFile, { generatedFrom })
}

const gitHead = (cwd) => {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return 'unknown'
  }
}

// --------------------------------------------------------------- formatting

const PRINT_WIDTH = 120

/**
 * Serialises like prettier would print the JSON (objects expanded, arrays on
 * one line when they fit in the print width), so the committed file passes
 * the repo's formatter check without a prettier dependency here.
 */
export const formatManifest = (value) => render(value, 0, false) + '\n'

const render = (value, depth, trailingComma) => {
  const indent = '  '.repeat(depth)
  const inner = '  '.repeat(depth + 1)
  const comma = trailingComma ? ',' : ''
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    const flat = `[${value.map((v) => JSON.stringify(v)).join(', ')}]`
    const allScalar = value.every((v) => typeof v !== 'object' || v === null)
    if (allScalar && indent.length + flat.length + comma.length <= PRINT_WIDTH) return flat
    const items = value.map((v, i) => inner + render(v, depth + 1, i < value.length - 1))
    return `[\n${items.join(',\n')}\n${indent}]`
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value)
    if (entries.length === 0) return '{}'
    const items = entries.map(
      ([k, v], i) => `${inner}${JSON.stringify(k)}: ${renderValue(k, v, depth + 1, i < entries.length - 1)}`
    )
    return `{\n${items.join(',\n')}\n${indent}}`
  }
  return JSON.stringify(value)
}

// An array's one-line fit is measured from the start of its line, key included.
const renderValue = (key, value, depth, trailingComma) => {
  if (!Array.isArray(value) || value.length === 0) return render(value, depth, trailingComma)
  const indent = '  '.repeat(depth)
  const prefixLen = indent.length + JSON.stringify(key).length + 2
  const flat = `[${value.map((v) => JSON.stringify(v)).join(', ')}]`
  const allScalar = value.every((v) => typeof v !== 'object' || v === null)
  if (allScalar && prefixLen + flat.length + (trailingComma ? 1 : 0) <= PRINT_WIDTH) return flat
  const inner = '  '.repeat(depth + 1)
  const items = value.map((v, i) => inner + render(v, depth + 1, i < value.length - 1))
  return `[\n${items.join(',\n')}\n${indent}]`
}

// -------------------------------------------------------------------- check

const derivedId = (entry) => {
  const [loc] = Object.keys(entry)
  return `${loc} ${entry[loc]}`
}

/** Names what `next` adds to, removes from and moves between files in `current`, section by section; generatedFrom is ignored. */
export const diffManifests = (current, next) => {
  const diff = {}
  for (const section of MANIFEST_SECTIONS) {
    const a = section === 'derived' ? (current[section] ?? []).map(derivedId) : Object.keys(current[section] ?? {})
    const b = section === 'derived' ? (next[section] ?? []).map(derivedId) : Object.keys(next[section] ?? {})
    const setA = new Set(a)
    const setB = new Set(b)
    const added = b.filter((k) => !setA.has(k))
    const removed = a.filter((k) => !setB.has(k))
    // Same name but produced by a different set of files (an id moved to another screen): still a stale file.
    const moved =
      section === 'derived'
        ? []
        : b.filter((k) => setA.has(k) && JSON.stringify(current[section][k]) !== JSON.stringify(next[section][k]))
    if (added.length || removed.length || moved.length) diff[section] = { added, removed, moved }
  }
  if ((current.prefix ?? PREFIX) !== (next.prefix ?? PREFIX)) diff.prefix = { from: current.prefix, to: next.prefix }
  return diff
}

// ---------------------------------------------------------------------- CLI

const parseArgs = (argv) => {
  const opts = { out: DEFAULT_OUT, check: false, json: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--check') opts.check = true
    else if (a === '--json') opts.json = true
    else if (a === '--out') opts.out = path.resolve(argv[++i] ?? '')
    else if (a.startsWith('--out=')) opts.out = path.resolve(a.slice('--out='.length))
    else {
      console.error(`unknown option: ${a}`)
      process.exit(2)
    }
  }
  return opts
}

const main = () => {
  const opts = parseArgs(process.argv.slice(2))
  const manifest = generateManifest()
  const summary = `${Object.keys(manifest.keys).length} keys, ${Object.keys(manifest.stems).length} stems, ${
    Object.keys(manifest.raw).length
  } raw, ${manifest.derived.length} derived`

  if (opts.json) {
    process.stdout.write(formatManifest(manifest))
    return
  }

  if (opts.check) {
    const rel = path.relative(process.cwd(), opts.out)
    if (!fs.existsSync(opts.out)) {
      console.error(`${rel} is missing; run \`yarn testids\` in packages/core and commit the result`)
      process.exit(1)
    }
    let current
    try {
      current = JSON.parse(fs.readFileSync(opts.out, 'utf8'))
    } catch (e) {
      console.error(`${rel} is not valid JSON (${e.message}); run \`yarn testids\` in packages/core`)
      process.exit(1)
    }
    const diff = diffManifests(current, manifest)
    if (Object.keys(diff).length === 0) {
      console.log(`${rel} is current (${summary})`)
      return
    }
    console.error(`${rel} is stale; run \`yarn testids\` in packages/core and commit the result`)
    for (const [section, d] of Object.entries(diff)) {
      if (section === 'prefix') {
        console.error(`  prefix: ${d.from} -> ${d.to}`)
        continue
      }
      for (const k of d.added) console.error(`  + ${section}: ${k}`)
      for (const k of d.removed) console.error(`  - ${section}: ${k}`)
      for (const k of d.moved) console.error(`  ~ ${section}: ${k} (files changed)`)
    }
    process.exit(1)
  }

  fs.mkdirSync(path.dirname(opts.out), { recursive: true })
  fs.writeFileSync(opts.out, formatManifest(manifest))
  console.log(`wrote ${path.relative(process.cwd(), opts.out)} (${summary})`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main()
}
