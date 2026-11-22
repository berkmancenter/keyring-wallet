#!/usr/bin/env node
/* eslint-disable no-console -- a command-line gate: its output is console output */
// tsc-ratchet.mjs — a type-check gate for a package that may carry known errors.
//
// A package's build type-checks its src, but its tsconfig excludes the test
// files, and jest strips types, so nothing type-checks the tests. This runs
// `tsc --noEmit` over a project that includes them (tsconfig.ratchet.json) and
// compares what it reports with a committed baseline.
//
//   node scripts/tsc-ratchet.mjs [--package packages/core] [--project tsconfig.ratchet.json] [--write]
//
// --project defaults to the package's tsconfig.ratchet.json when it has one, else
// its tsconfig.json, so a bare `--write` cannot record a baseline from the wrong
// project.
//
// A diagnostic's signature is its file and its TS code, and the baseline keeps a
// COUNT per signature, so a second error of a kind a file already has is still
// seen. Line and column are left out because unrelated edits move them, and so
// is the message, which moves too: it prints types inline ("... 75 more ...;
// Relationship" became "... 76 more ...; Emoji" when a locale section was added),
// it can hold an absolute path, and its "Did you mean" depends on the whole
// program (see SUGGESTING). When a count rises, the gate prints that file's
// current diagnostics of that code so the new one can be found.
//
// Fails (exit 1) when:
//   - a signature appears that the baseline does not have, or a count rises;
//   - a count falls or a signature goes away: the baseline is stale, and the
//     PR that fixed the errors must record it (`--write`), so every fix lowers
//     the floor rather than leaving room for the error to come back;
//   - tsc exits non-zero but reports no diagnostic (a crash, a missing tsc):
//     judged by tsc's exit status, so "no output" never reads as "no errors".
// Passes (exit 0) only when the counts equal the baseline.
//
// The baseline is one signature per line, sorted, so fixes in neighbouring files
// can conflict. On a conflict, rebase and regenerate with --write; never resolve
// it by hand.
//
// POLICY: src has no type errors (the build enforces it). Test files get no
// new ones: the baseline records the errors they had when the gate arrived and
// only shrinks. Adding an entry is an exception: it needs a named reason in the
// PR body and the review lane's explicit agreement. `--write` is for recording
// fixes; using it to absorb a new error without that is not allowed.
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// Where tsc looks up a similar name and finds one, it reports a different code
// ("Did you mean ...?") than when it finds none, and what it finds can depend on
// other files: the name lookups stop after the first 10 failed ones in the whole
// program (maximumSuggestionCount; in this tree those are spent on `JSX` lookups
// in dependencies' .d.ts files), and member, export and base-class lookups depend
// on declarations elsewhere. So each suggesting code counts as its plain one. The
// table is every such pair in the TypeScript 5.9 checker, found from its suggestion
// lookup sites; the JS-only pairs (2568, 2570) are not errors in a .ts file, and
// the parser, regex and lib-option suggestions look up fixed lists.
const SUGGESTING = {
  TS2552: 'TS2304', // Cannot find name
  TS2833: 'TS2503', // Cannot find namespace
  TS2551: 'TS2339', // Property does not exist on type
  TS2561: 'TS2353', // Object literal may only specify known properties
  TS2724: 'TS2305', // Module has no exported member
  TS4117: 'TS4113', // override modifier: not declared in the base class
  TS4123: 'TS4122', // JSDoc @override: not declared in the base class
}

/** One diagnostic line of `tsc --pretty false`, or undefined for anything else. */
export function parseLine(line, pkgDir) {
  const withFile = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/.exec(line)
  if (withFile) {
    const file = path.relative(pkgDir, path.resolve(pkgDir, withFile[1])).split(path.sep).join('/')
    const code = SUGGESTING[withFile[4]] ?? withFile[4]
    return { file, code, at: `${withFile[2]},${withFile[3]}`, message: withFile[5].trim() }
  }
  const global = /^error (TS\d+): (.*)$/.exec(line)
  if (global) return { file: '<global>', code: global[1], at: '', message: global[2].trim() }
  return undefined
}

const key = (d) => `${d.file}\t${d.code}`

/** Count diagnostics by signature. Continuation lines (indented) are not diagnostics. */
export function countDiagnostics(output, pkgDir) {
  const counts = new Map()
  for (const line of output.split(/\r?\n/)) {
    const d = parseLine(line, pkgDir)
    if (d) counts.set(key(d), (counts.get(key(d)) ?? 0) + 1)
  }
  return counts
}

/** The diagnostics themselves, by signature, for showing where a rise is. */
export function diagnosticsBySignature(output, pkgDir) {
  const found = new Map()
  for (const line of output.split(/\r?\n/)) {
    const d = parseLine(line, pkgDir)
    if (d) found.set(key(d), [...(found.get(key(d)) ?? []), `${d.file}(${d.at}): ${d.message}`])
  }
  return found
}

export function formatBaseline(counts) {
  const header = [
    '# tsc-ratchet baseline: <count> TAB <file> TAB <TS code>, sorted.',
    '# Policy: src has no type errors (the build enforces it); test files get no new ones, and',
    '# this list only shrinks. A new line is an exception: it needs a named reason in the PR',
    "# body and the review lane's explicit agreement. `--write` only to record fixes.",
    '# On a merge conflict here, rebase and regenerate (node scripts/tsc-ratchet.mjs --write); never',
    '# resolve it by hand.',
  ]
  const lines = [...counts.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, n]) => `${n}\t${k}`)
  return [...header, ...lines].join('\n') + '\n'
}

export function parseBaseline(text) {
  const counts = new Map()
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.startsWith('#')) continue
    const [n, ...rest] = line.split('\t')
    const count = Number(n)
    if (!Number.isInteger(count) || count < 1 || rest.length !== 2)
      throw new Error(`tsc-ratchet: unreadable baseline line: ${line}`)
    counts.set(rest.join('\t'), count)
  }
  return counts
}

/** What rose (fails the gate) and what fell (asks for a baseline update). */
export function compare(baseline, current) {
  const rose = []
  const fell = []
  for (const [k, n] of current) {
    const was = baseline.get(k) ?? 0
    if (n > was) rose.push({ signature: k, was, now: n })
  }
  for (const [k, was] of baseline) {
    const n = current.get(k) ?? 0
    if (n < was) fell.push({ signature: k, was, now: n })
  }
  return { rose, fell }
}

/** Run tsc for the package. Judged by exit status first: a failed run with no diagnostic is a failure. */
export function runTsc(pkgDir, { project = 'tsconfig.json', tscPath = process.env.TSC_RATCHET_TSC } = {}) {
  const tsc = tscPath ?? createRequire(path.join(pkgDir, 'package.json')).resolve('typescript/bin/tsc')
  const args = tscPath ? [] : [tsc]
  const command = tscPath ? tsc : process.execPath
  const result = spawnSync(command, [...args, '--noEmit', '--pretty', 'false', '-p', path.join(pkgDir, project)], {
    cwd: pkgDir,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  return {
    status: result.status,
    signal: result.signal,
    error: result.error,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  }
}

export function judge(
  { status, signal, error, output },
  baseline,
  pkgDir,
  writeCommand = 'node scripts/tsc-ratchet.mjs --write'
) {
  if (error) return { ok: false, lines: [`tsc-ratchet: tsc could not be started: ${error.message}`] }
  if (signal) return { ok: false, lines: [`tsc-ratchet: tsc was killed by ${signal}`] }
  const current = countDiagnostics(output, pkgDir)
  const total = [...current.values()].reduce((a, b) => a + b, 0)
  if (status !== 0 && total === 0) {
    return {
      ok: false,
      lines: [
        `tsc-ratchet: tsc exited ${status} but reported no diagnostic — not a pass. Output tail:`,
        ...output.trim().split('\n').slice(-20),
      ],
    }
  }
  if (status === 0 && total > 0)
    return { ok: false, lines: ['tsc-ratchet: tsc exited 0 with diagnostics; refusing to guess'] }
  const { rose, fell } = compare(baseline, current)
  const lines = [
    `tsc-ratchet: ${total} diagnostic(s) now; baseline ${[...baseline.values()].reduce((a, b) => a + b, 0)}`,
  ]
  const found = rose.length ? diagnosticsBySignature(output, pkgDir) : new Map()
  for (const r of rose) {
    lines.push(`NEW  ${r.was} -> ${r.now}  ${r.signature.replace(/\t/g, '  ')}`)
    for (const d of found.get(r.signature) ?? []) lines.push(`       ${d}`)
  }
  for (const f of fell) lines.push(`FIXED ${f.was} -> ${f.now}  ${f.signature.replace(/\t/g, '  ')}`)
  if (rose.length) {
    lines.push(
      "tsc-ratchet: new type errors. Fix them. A baseline exception needs a named reason in the PR body and the review lane's agreement.",
      'tsc-ratchet: if a file above is one your change does not touch, the error did not come from you: tsc moved an' +
        " existing error's signature (for example a code that changes with a suggestion and is missing from" +
        ' SUGGESTING), which is a bug in this gate. Tell the review lane rather than re-running.'
    )
    return { ok: false, lines, current }
  }
  if (fell.length) {
    lines.push(
      `tsc-ratchet: the baseline is stale: errors were fixed. Run ${writeCommand} and commit the baseline in this PR.`,
      'tsc-ratchet: on a conflict in the baseline, rebase and run that command again; never resolve it by hand.'
    )
    return { ok: false, lines, current }
  }
  return { ok: true, lines, current }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (name) => {
    const i = process.argv.indexOf(name)
    return i > 0 ? process.argv[i + 1] : undefined
  }
  const pkgDir = path.resolve(repoRoot, arg('--package') ?? 'packages/core')
  const baselinePath = path.join(pkgDir, 'tsc-baseline.txt')
  const writing = process.argv.includes('--write')
  // --write replaces the baseline, so it does not need (or trust) the old one.
  const baseline = !writing && existsSync(baselinePath) ? parseBaseline(readFileSync(baselinePath, 'utf8')) : new Map()
  const project =
    arg('--project') ??
    (existsSync(path.join(pkgDir, 'tsconfig.ratchet.json')) ? 'tsconfig.ratchet.json' : 'tsconfig.json')
  const writeCommand = `node scripts/tsc-ratchet.mjs --package ${path.relative(repoRoot, pkgDir)} --project ${project} --write`
  const result = judge(runTsc(pkgDir, { project }), baseline, pkgDir, writeCommand)
  for (const line of result.lines) console.log(line)
  if (writing) {
    if (!result.current) {
      console.log('tsc-ratchet: not writing a baseline from a failed tsc run')
      process.exit(1)
    }
    writeFileSync(baselinePath, formatBaseline(result.current))
    console.log(`tsc-ratchet: wrote ${path.relative(repoRoot, baselinePath)}`)
    process.exit(0)
  }
  process.exit(result.ok ? 0 : 1)
}
