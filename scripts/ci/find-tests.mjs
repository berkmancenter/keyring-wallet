#!/usr/bin/env node
// find-tests.mjs — the harness and script tests the quality workflow runs, found rather than named.
//
// Every *.test.mjs and *.test.sh under e2e/ and scripts/, so a new test file runs in CI without anyone adding it:
// e2e/scripts/check-testids.test.mjs and 20 others ran nowhere until 2026-10-22, because the workflow's loop named
// its files. Left out: node_modules, fixtures (the files a test reads, not tests), scripts/ota (its own step), and
// the tests that need a package this job does not install, listed in tests-need-install.json with the package and
// why. A listed file that no longer exists is an error, so the list cannot go stale unseen.
//
//   node scripts/ci/find-tests.mjs        → one path per line, sorted; exit 1 on a stale need-install entry

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

const ROOTS = ['e2e', 'scripts']
const SKIP_DIRS = new Set(['node_modules', 'fixtures', 'artifacts'])
// Run by their own step (quality.yml "OTA script tests").
const OWN_STEP = ['scripts/ota/']
const TEST_FILE = /\.test\.(mjs|sh)$/

const walk = (root, dir, out) => {
  const full = path.join(root, dir)
  if (!fs.existsSync(full)) return out
  for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(root, rel, out)
    } else if (TEST_FILE.test(entry.name)) out.push(rel)
  }
  return out
}

/** `{ tests, stale }`: the tests to run here, and need-install entries naming a file that is gone. */
export const findTests = (root = repoRoot, needInstall = loadNeedInstall(root)) => {
  const all = ROOTS.flatMap((r) => walk(root, r, [])).sort()
  const stale = Object.keys(needInstall).filter((f) => !fs.existsSync(path.join(root, f)))
  const tests = all.filter((f) => !(f in needInstall) && !OWN_STEP.some((p) => f.startsWith(p)))
  return { tests, stale }
}

export function loadNeedInstall(root = repoRoot) {
  const file = path.join(root, 'scripts', 'ci', 'tests-need-install.json')
  const list = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}
  for (const [f, why] of Object.entries(list)) if (!why || typeof why !== 'string') throw new Error(`tests-need-install.json: ${f} needs its reason`)
  return list
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { tests, stale } = findTests()
  for (const f of stale) console.error(`tests-need-install.json names ${f}, which no longer exists: drop the entry`)
  process.stdout.write(tests.join('\n') + '\n')
  process.exit(stale.length ? 1 : 0)
}
