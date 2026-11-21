#!/usr/bin/env node
/* eslint-disable no-console -- a command-line gate: its output is console output */
// select-tests.mjs — which jest suites a pull request's Testing job runs.
//
// The whole suite of every package, with coverage, takes 20 to 30 minutes. A PR
// runs only what its change can reach. The whole suite runs on every push to main,
// nightly, and on dispatch (.github/workflows/full-tests.yaml).
//
//   node scripts/ci/select-tests.mjs plan --base origin/main --out plan.json
//   node scripts/ci/select-tests.mjs run --plan plan.json [--part 2/4] [--max-workers 4]
//
// plan: reads the PR's diff against its merge base and decides each workspace's
// mode: "all" (its whole suite) or, for @bifold/core only, "related" (jest's
// --findRelatedTests on the changed files, plus every guard, see below). It prints
// each rule it applied. Under GitHub Actions it writes the step outputs `work`
// (false when no suite is selected) and `build` (the workspaces whose build output
// the selected tests load).
//
// run: lists the selected test files with jest, says "related subset: N of M test
// files" or "full suite" in the log, the step summary, a notice and the step output
// `scope`, then runs them. Each workspace runs even when an earlier one failed,
// and the step fails if any did. With --part i/n it runs only its share: core's
// selected (or whole) suites through jest's --shard, and another package's whole
// suite only in the last part. Every part lists the whole selection and reports
// the same scope.
//
// Rules, in order. Each path is judged on its own; the run is the union.
//   1. Everything (every workspace's whole suite): the install and the jest/babel
//      setup at the root (package.json, yarn.lock, .yarn/, tsconfig, babel), this
//      script and the workflow that runs it, and any path no rule below knows. An
//      unknown shape is never a skip.
//   2. Nothing: docs, markdown, and repo files no jest run reads (lint, prettier,
//      hooks, the tsc ratchet, other workflows).
//   3. In @bifold/core: its own setup (jest.config, babel.config, jestSetup*,
//      tsconfig*, package.json, any __mocks__/, since manual mocks apply without
//      an import), a file the setup loads before every test (CORE_SETUP_FILES),
//      or a deleted file runs its whole suite. A changed snapshot runs
//      its test. Any other file goes to --findRelatedTests.
//   4. In another workspace: its whole suite, and the whole suite of every
//      workspace that depends on it, transitively: @bifold/* resolves to each
//      package's build output, which jest can't relate to a change. When core
//      loads the package, core runs whole too. That holds for a package core's
//      jest maps to its src (moduleNameMapper '^@bifold/x$' to '../x/src/') as
//      well: those files are outside core's jest roots, so --findRelatedTests
//      can't see them. Only a mapped package's files outside src/ (its own
//      tests, docs, config), and only when no package core loads from a build
//      depends on it, leave core alone.
//   Workspaces that depend on core (remote-logs, the sample app) do not run for
//   a change in core: they load core's build, which the PR doesn't build. The full
//   suite on main runs them.
//
// GUARDS. Tests that read source from disk (readFileSync, readdirSync, a glob,
// exec/spawn) check files they never import, so jest can't relate them to a
// change. Every core test that does, or that imports a helper under __tests__/
// that does, runs on every PR. They are found on each run, not listed, so a new
// guard joins without anyone remembering. NAMED_GUARDS run too.
import { spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

// The one workspace that runs a related subset. The others are small, and their
// tests load their dependencies' build output, which jest can't relate.
export const RELATED = '@bifold/core'

const EVERYTHING = [
  /^package\.json$/,
  /^yarn\.lock$/,
  /^\.yarnrc\.yml$/,
  /^\.yarn\//,
  /^\.nvmrc$/,
  /^\.node-version$/,
  /^babel\.config\./,
  /^jest\.config\./,
  /^tsconfig[^/]*\.json$/,
  /^\.github\/workflows\/quality\.yaml$/,
  /^\.github\/actions\//,
  /^scripts\/ci\//,
]

const NO_JEST = [
  /\.md$/,
  /^docs\//,
  /^\.github\//,
  /^\.changeset\//,
  /^LICENSE/,
  /^\.gitignore$/,
  /^\.prettierrc/,
  /^\.prettierignore$/,
  /^eslint\.config\./,
  /^eslint-rules\//,
  /^\.editorconfig$/,
  /^\.husky\//,
  /^\.githooks\//,
  /^commitlint\./,
  /^scripts\/tsc-ratchet/,
  /^packages\/[^/]+\/tsc-baseline\.txt$/,
]

const CORE_SETUP = [
  /^jest\.config\./,
  /^babel\.config\./,
  /^jestSetup/,
  /^tsconfig[^/]*\.json$/,
  /^package\.json$/,
  /(^|\/)__mocks__\//,
]

// Import the package barrels; jest relates them already, but they guard what the app can import.
export const NAMED_GUARDS = [
  'src/modules/rooms/__tests__/rootExports.test.ts',
  'src/modules/rooms/__tests__/roomsPublicApi.test.ts',
]

// Core's jest setup files and how far to follow what they load (see setupClosure). jestSetup.js imports at the top:
// all of it. jestSetupAfterEnv.js requires src/hooks/notifications inside a beforeEach try/catch, so its clear
// function runs before every test but a failure to load what notifications imports is swallowed; following those
// imports would put 392 of core's 834 source files here, for a reach of load-time side effects only. Those are left
// to the full suite on main.
export const CORE_SETUP_FILES = [
  { file: 'packages/core/jestSetup.js', depth: Infinity },
  { file: 'packages/core/jestSetupAfterEnv.js', depth: 1 },
]

// createProgram: a TypeScript program over src reads every source file (dateRerenderGuard, versionLadderGuard), through
// ts.sys rather than fs, so neither name above appears.
export const DISK_READ =
  /\b(readFileSync|readdirSync|existsSync|globSync|execSync|execFileSync|spawnSync|createProgram)\b|['"](fast-)?glob['"]/

/** Core's jest maps these @bifold packages to their src, so jest relates a change in them to core's tests. */
export function sourceMapped(jestConfigText) {
  const mapped = new Set()
  for (const m of jestConfigText.matchAll(/'\^(@bifold\/[\w-]+)\$'\s*:\s*'<rootDir>\/\.\.\/([\w-]+)\/src\//g))
    mapped.add(m[1])
  return mapped
}

const matches = (rules, p) => rules.some((re) => re.test(p))

/** The workspaces `name` loads, transitively. */
function closure(name, workspaces) {
  const byName = new Map(workspaces.map((w) => [w.name, w]))
  const out = new Set()
  const visit = (n) => {
    for (const d of byName.get(n)?.deps ?? []) {
      if (out.has(d) || !byName.has(d)) continue
      out.add(d)
      visit(d)
    }
  }
  visit(name)
  return out
}

/**
 * @param changes  [{ status: 'A'|'M'|'D'|..., path }] relative to the repo root
 * @param workspaces [{ name, dir, deps: [names], hasTest }]
 * @param mapped   names core's jest maps to their src
 * @param setup    paths core's jest setup loads before every test (setupClosure)
 * @returns { everything, modes: { name: 'all'|'related' }, related: [paths], reasons: [string] }
 */
export function plan(changes, workspaces, mapped = new Set(), setup = new Set()) {
  const reasons = []
  const modes = {}
  const related = new Set()
  let everything = false
  const byDir = new Map(workspaces.map((w) => [w.dir, w]))
  const dependents = (name) => workspaces.filter((w) => w.deps.includes(name))
  const coreLoads = closure(RELATED, workspaces)

  const runAll = (name, why) => {
    if (modes[name] === 'all') return
    modes[name] = 'all'
    reasons.push(`${name}: whole suite (${why})`)
    // Core's dependents load its build, which a PR doesn't build; the full suite on main runs them. Core itself is
    // decided by the caller.
    if (name === RELATED) return
    for (const d of dependents(name)) if (d.name !== RELATED) runAll(d.name, `depends on ${name}`)
  }

  for (const { status, path: p } of changes) {
    if (matches(EVERYTHING, p)) {
      everything = true
      reasons.push(`everything: ${p} (install, setup or this selector)`)
      continue
    }
    if (matches(NO_JEST, p)) {
      reasons.push(`nothing: ${p} (no jest run reads it)`)
      continue
    }
    const m = p.match(/^((?:packages|samples)\/[^/]+)\/(.+)$/)
    const ws = m && byDir.get(m[1])
    if (!ws) {
      everything = true
      reasons.push(`everything: ${p} (no rule knows this path)`)
      continue
    }
    const rel = m[2]
    if (ws.name === RELATED) {
      if (matches(CORE_SETUP, rel)) runAll(RELATED, `${p} is test setup`)
      else if (setup.has(p)) runAll(RELATED, `${p} is loaded by jest's setup, before every test`)
      else if (status.startsWith('D')) runAll(RELATED, `${p} was deleted; nothing can be related to it`)
      else if (/(^|\/)__snapshots__\/[^/]+\.snap$/.test(rel)) {
        const test = p.replace(/__snapshots__\/([^/]+)\.snap$/, '$1')
        related.add(test)
        reasons.push(`${RELATED}: ${p} → its test ${test}`)
      } else {
        related.add(p)
        reasons.push(`${RELATED}: related to ${p}`)
      }
      continue
    }
    runAll(ws.name, `${p} changed`)
    if (!coreLoads.has(ws.name)) continue
    // Core's tests load this package. From its build, unless core's jest maps it to its src; either way the files are
    // outside core's jest roots, so --findRelatedTests can't relate them and core runs whole. A mapped package's
    // files outside src/ (its own tests, docs, config) are not loaded.
    const viaBuild = [...coreLoads].some(
      (u) => !mapped.has(u) && (u === ws.name || closure(u, workspaces).has(ws.name))
    )
    if (viaBuild) runAll(RELATED, `loads ${ws.name}'s build output, and ${p} changed`)
    else if (rel.startsWith('src/')) runAll(RELATED, `its jest loads ${ws.name}'s src, and ${p} changed`)
    else reasons.push(`${RELATED}: not affected by ${p} (its jest loads only ${ws.name}'s src)`)
  }

  if (everything) return { everything, modes: {}, related: [], reasons }
  if (related.size > 0 && modes[RELATED] !== 'all') modes[RELATED] = 'related'
  return { everything, modes, related: modes[RELATED] === 'related' ? [...related].sort() : [], reasons }
}

/** Every @bifold workspace the given ones load, transitively; and, unless it's core, each one itself. */
export function buildSet(names, workspaces) {
  const out = new Set()
  for (const n of names) {
    if (n !== RELATED) out.add(n)
    for (const d of closure(n, workspaces)) out.add(d)
  }
  return [...out].sort()
}

/**
 * Tests that read files from disk, directly or through a helper under __tests__/ that isn't itself a test.
 * @param tests   absolute paths of the package's test files (jest --listTests)
 * @param helpers absolute paths of the other files under __tests__/
 */
export function findGuards(tests, helpers, read) {
  const readers = new Set(helpers.filter((h) => DISK_READ.test(read(h))))
  const strip = (f) => f.replace(/\.(tsx?|jsx?|mjs|cjs)$/, '').replace(/\/index$/, '')
  const readerStems = new Set([...readers].map(strip))
  return tests.filter((t) => {
    const text = read(t)
    if (DISK_READ.test(text)) return true
    for (const m of text.matchAll(/(?:from\s+|require\(\s*|import\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g)) {
      if (readerStems.has(strip(path.resolve(path.dirname(t), m[1])))) return true
    }
    return false
  })
}

const SOURCE_EXT = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']

/**
 * Every local file jest's setup files load, transitively: a change in one reaches every test, and jest's
 * --findRelatedTests does not follow setup files. Relative specifiers only (import, require, jest.requireActual;
 * not jest.mock, whose factory replaces the module); a package import is not followed.
 * @param entries absolute paths of the setup files
 * @param depth   how many imports deep to follow
 * @returns absolute paths, the entries included
 */
export function setupClosure(entries, read, exists, depth = Infinity) {
  const seen = new Set()
  const resolve = (from, spec) => {
    const base = path.resolve(path.dirname(from), spec)
    const candidates = [
      base,
      ...SOURCE_EXT.map((e) => base + e),
      ...SOURCE_EXT.map((e) => path.join(base, 'index' + e)),
    ]
    return candidates.find((c) => SOURCE_EXT.includes(path.extname(c)) && exists(c))
  }
  const visit = (file, left) => {
    if (seen.has(file)) return
    seen.add(file)
    if (left === 0) return
    const text = read(file)
    for (const m of text.matchAll(
      /(?:from\s+|import\s+|require\(\s*|import\(\s*|jest\.requireActual\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g
    )) {
      const next = resolve(file, m[1])
      if (next && !next.includes(`${path.sep}node_modules${path.sep}`)) visit(next, left - 1)
    }
  }
  for (const e of entries.filter(exists)) visit(e, depth)
  return seen
}

export function readWorkspaces(root = repoRoot) {
  const out = []
  for (const parent of ['packages', 'samples']) {
    const abs = path.join(root, parent)
    if (!existsSync(abs)) continue
    for (const dir of readdirSync(abs)) {
      const file = path.join(abs, dir, 'package.json')
      if (!existsSync(file)) continue
      const pkg = JSON.parse(readFileSync(file, 'utf8'))
      const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies })
      out.push({ name: pkg.name, dir: `${parent}/${dir}`, deps, hasTest: !!pkg.scripts?.test })
    }
  }
  const names = new Set(out.map((w) => w.name))
  for (const w of out) w.deps = w.deps.filter((d) => names.has(d) && d !== w.name)
  return out
}

const git = (...args) => {
  const r = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr.trim()}`)
  return r.stdout
}

const output = (pairs) => {
  if (!process.env.GITHUB_OUTPUT) return
  for (const [k, v] of Object.entries(pairs)) {
    const s = String(v)
    appendFileSync(process.env.GITHUB_OUTPUT, s.includes('\n') ? `${k}<<EOF\n${s}\nEOF\n` : `${k}=${s}\n`)
  }
}
const summary = (text) => process.env.GITHUB_STEP_SUMMARY && appendFileSync(process.env.GITHUB_STEP_SUMMARY, text)

function planCommand(args) {
  const base = args.base
  if (!base) throw new Error('plan needs --base <ref>')
  git('merge-base', base, 'HEAD') // throws on a checkout too shallow to diff
  const changes = git('diff', '--name-status', '--no-renames', `${base}...HEAD`)
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [status, p] = line.split('\t')
      return { status, path: p }
    })
  const listed = Number(process.env.PR_CHANGED_FILES || 0)
  if (changes.length === 0 && listed > 0)
    throw new Error(
      `the diff against ${base} is empty, but GitHub lists ${listed} changed files; refusing to select nothing`
    )

  const workspaces = readWorkspaces()
  const mapped = sourceMapped(readFileSync(path.join(repoRoot, 'packages/core/jest.config.js'), 'utf8'))
  const exists = (f) => existsSync(f) && statSync(f).isFile()
  const setup = new Set()
  for (const { file, depth } of CORE_SETUP_FILES)
    for (const f of setupClosure([path.join(repoRoot, file)], (x) => readFileSync(x, 'utf8'), exists, depth))
      setup.add(path.relative(repoRoot, f))
  if (setup.size === 0) throw new Error(`none of ${CORE_SETUP_FILES.map((s) => s.file).join(', ')} exists`)
  const result = plan(changes, workspaces, mapped, setup)

  const testing = result.everything
    ? workspaces.filter((w) => w.hasTest).map((w) => w.name)
    : Object.keys(result.modes).filter((n) => workspaces.find((w) => w.name === n)?.hasTest)
  const build = result.everything ? workspaces.map((w) => w.name).sort() : buildSet(testing, workspaces)
  const out = { ...result, workspaces, testing, build }
  console.log(`Changed against ${base}: ${changes.length} file(s)`)
  for (const r of result.reasons) console.log(`  ${r}`)
  console.log(
    result.everything
      ? 'Selected: every workspace, whole suite'
      : testing.length === 0
        ? 'Selected: no jest suite'
        : `Selected: ${testing.map((n) => `${n} (${result.modes[n]})`).join(', ')}`
  )
  console.log(`Build: ${build.length ? build.join(' ') : 'nothing'}`)
  if (args.out) writeFileSync(args.out, JSON.stringify(out, null, 2))
  output({
    work: testing.length > 0,
    ...(testing.length === 0 ? { scope: 'no jest suite' } : {}),
    build: result.everything ? 'all' : build.join(' '),
  })
}

function yarnIn(dir, args, capture) {
  const r = spawnSync('yarn', args, {
    cwd: path.join(repoRoot, dir),
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    maxBuffer: 64 * 1024 * 1024,
  })
  return r
}

function listTests(dir, extra = []) {
  const r = yarnIn(dir, ['run', 'test', '--listTests', ...extra], true)
  if (r.status !== 0) throw new Error(`jest --listTests in ${dir} failed (exit ${r.status})`)
  return r.stdout.split('\n').filter((l) => l.startsWith('/'))
}

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

/** "2/4" → { part: 2, parts: 4 }; absent → one part. */
export function parsePart(text) {
  if (text === undefined) return { part: 1, parts: 1 }
  const m = /^(\d+)\/(\d+)$/.exec(text)
  const part = m && Number(m[1])
  const parts = m && Number(m[2])
  if (!m || part < 1 || part > parts) throw new Error(`--part must look like 2/4, got ${text}`)
  return { part, parts }
}

function runCommand(args) {
  const p = JSON.parse(readFileSync(args.plan, 'utf8'))
  const { part, parts } = parsePart(args.part)
  // Core's suites are split across the parts by jest's --shard; another package's whole suite runs in the last part.
  const shard = parts > 1 ? [`--shard=${part}/${parts}`, '--passWithNoTests'] : []
  const workers = args['max-workers'] ? [`--maxWorkers=${args['max-workers']}`] : []
  const lines = []
  const failed = []
  const scopes = []
  const modes = p.everything ? Object.fromEntries(p.testing.map((n) => [n, 'all'])) : p.modes
  for (const name of p.testing) {
    const ws = p.workspaces.find((w) => w.name === name)
    if (modes[name] === 'all') {
      scopes.push(`${name} full`)
      lines.push(`- ${name}: **full suite**`)
      if (name !== RELATED && part !== parts) {
        console.log(`
=== ${name}: full suite, in part ${parts}/${parts} ===`)
        continue
      }
      console.log(`
=== ${name}: full suite${name === RELATED && parts > 1 ? `, part ${part}/${parts}` : ''} ===`)
      const split = name === RELATED ? shard : []
      if (yarnIn(ws.dir, ['run', 'test', '--ci', ...workers, ...split]).status !== 0) failed.push(name)
      continue
    }
    const pkgRoot = path.join(repoRoot, ws.dir)
    const every = listTests(ws.dir)
    const changed = p.related.map((f) => path.join(repoRoot, f))
    // jest relates only files inside its roots; one outside would silently select nothing.
    const outside = changed.filter((f) => !f.startsWith(pkgRoot + path.sep))
    if (outside.length) throw new Error(`related file(s) outside ${ws.dir}: ${outside.join(', ')}`)
    const rel = listTests(ws.dir, ['--findRelatedTests', ...changed])
    const testSet = new Set(every)
    const helpers = walk(pkgRoot).filter(
      (f) => /\/__tests__\//.test(f) && /\.(tsx?|jsx?|mjs|cjs)$/.test(f) && !testSet.has(f)
    )
    const guards = findGuards(every, helpers, (f) => readFileSync(f, 'utf8'))
    const named = NAMED_GUARDS.map((g) => path.join(pkgRoot, g))
    const missing = named.filter((g) => !testSet.has(g))
    if (missing.length) throw new Error(`named guard(s) not among ${name}'s tests: ${missing.join(', ')}`)
    if (guards.length === 0) throw new Error(`no guard found among ${every.length} tests in ${name}; refusing to run`)
    const run = [...new Set([...rel, ...guards, ...named])].sort()
    const head = `${name}: related subset: ${run.length} of ${every.length} test files (${rel.length} related to ${changed.length} changed file(s), ${guards.length + named.length} guards)${parts > 1 ? `; this is part ${part}/${parts} of them` : ''}`
    scopes.push(`${name} subset ${run.length} of ${every.length}`)
    lines.push(`- ${head}`)
    console.log(`\n=== ${head} ===`)
    for (const f of run) console.log(`  ${path.relative(pkgRoot, f)}${rel.includes(f) ? '' : '  (guard)'}`)
    lines.push(
      '',
      '<details><summary>Files</summary>',
      '',
      ...run.map((f) => `- \`${path.relative(pkgRoot, f)}\`${rel.includes(f) ? '' : ' (guard)'}`),
      '',
      '</details>'
    )
    if (yarnIn(ws.dir, ['run', 'test', '--ci', ...workers, ...shard, '--runTestsByPath', ...run]).status !== 0)
      failed.push(name)
  }
  // The same in every part: it names the whole selection, not this part's share of it.
  const scope = p.everything ? 'full suite' : scopes.length === 0 ? 'no jest suite' : scopes.join('; ')
  console.log(`\n::notice title=Testing scope::${scope}`)
  summary(
    `### Testing scope: ${scope}${parts > 1 ? ` (part ${part}/${parts})` : ''}\n\n${lines.join('\n')}\n\n**Why**\n\n${p.reasons.map((r) => `- ${r}`).join('\n')}\n`
  )
  output({ scope })
  if (failed.length) {
    console.error(`Failed: ${failed.join(', ')}`)
    process.exit(1)
  }
}

function parseArgs(argv) {
  const args = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) args[a.slice(2)] = argv[++i]
    else args._.push(a)
  }
  return args
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2))
  try {
    if (args._[0] === 'plan') planCommand(args)
    else if (args._[0] === 'run') runCommand(args)
    else
      throw new Error(
        'usage: select-tests.mjs plan --base <ref> [--out plan.json] | run --plan plan.json [--part 2/4] [--max-workers 4]'
      )
  } catch (e) {
    console.error(`::error::select-tests: ${e.message}`)
    process.exit(1)
  }
}
