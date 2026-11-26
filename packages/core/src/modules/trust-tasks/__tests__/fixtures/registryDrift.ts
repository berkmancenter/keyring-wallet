/**
 * Comparing a vendored schema with the registry commit **its own provenance
 * names** — not with one global pin.
 *
 * Why per-fixture rather than per-repository: the shared pin in
 * `scripts/openvtc/PINS.json` feeds spec-watch and conformance for everyone,
 * and it sits at a commit that predates the `vta/pcs/*` specs entirely. Those
 * fixtures are therefore knowingly off-pin (see their README), while the
 * `acl/*` ones are at the pin. One global comparison could only be wrong about
 * one of them.
 *
 * Two faults in the first version of this check, both of which made it useless
 * and are the reason it is written out here:
 *
 * 1. it resolved `external/` relative to this package, so it looked inside the
 *    bifold checkout — `external/` lives in the *wallet* checkout. It therefore
 *    skipped everywhere, including on a machine with the registry present, and
 *    had never run once;
 * 2. where the directory was found it did `if (!existsSync(live)) continue`,
 *    so a registry lacking the mapped specs compared nothing and passed. A
 *    missing file is now a failure, because "upstream does not have this" is a
 *    result and silence is not.
 *
 * And a third, the first one again by another route: the fix for (1) counted
 * eight folders up from here, right while `packages/` sat inside the bifold
 * checkout. Since the fold put `packages/` at the repository's root, that count
 * landed one folder above the repository, so every drift test skipped on every
 * machine. The root is now found by what is in it, not by counting.
 *
 * @module trust-tasks/__tests__/fixtures/registryDrift
 */
import { execFileSync } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { dirname, join } from 'path'
import { isDeepStrictEqual } from 'util'

/** The file only this repository's root holds: the root is the nearest folder above that has it. */
const ROOT_MARK = join('scripts', 'openvtc', 'PINS.json')

/** The repository's root above `from`, found by the file only it holds, or undefined above any repository. */
export function repoRootAbove(from: string): string | undefined {
  for (let dir = from; ; dir = dirname(dir)) {
    if (existsSync(join(dir, ROOT_MARK))) return dir
    if (dirname(dir) === dir) return undefined
  }
}

/**
 * Where the drift tests read the registry clone, or undefined where they skip.
 *
 * `TRUST_TASKS_REGISTRY` overrides. Otherwise it is `external/dtgwg-trust-tasks-tf` in the repository's root
 * (`scripts/openvtc/setup-external.mjs` clones it there). Only a checkout with no `external/` at all answers undefined,
 * so only it skips: CI, which has no clone by design, and a fresh checkout. Where `external/` exists, or the variable is
 * set, the path is answered whether or not it is there: the drift test then runs, and `expectNoDrift` fails it, that
 * one test, saying what is missing. A setup gap never collapses the rest of the file, and never passes as a skip.
 */
export function registryPath(from: string = __dirname): string | undefined {
  const fromEnv = process.env.TRUST_TASKS_REGISTRY
  if (fromEnv) return fromEnv
  const root = repoRootAbove(from)
  if (!root) return undefined
  const external = join(root, 'external')
  return existsSync(external) ? join(external, 'dtgwg-trust-tasks-tf') : undefined
}

/** Fails the drift test that asked, when the clone it was pointed at is not there. */
function requireRegistry(registry: string): void {
  if (existsSync(registry)) return
  throw new Error(
    process.env.TRUST_TASKS_REGISTRY
      ? `TRUST_TASKS_REGISTRY is ${registry}, which does not exist: the drift test cannot compare anything`
      : `${registry} is missing, so the drift test cannot compare anything: ` +
        'run node scripts/openvtc/setup-external.mjs, or set TRUST_TASKS_REGISTRY'
  )
}

/** A file's bytes at a commit, or undefined when that commit does not have it. */
function fileAtCommit(registry: string, sha: string, path: string): string | undefined {
  try {
    return execFileSync('git', ['-C', registry, 'show', `${sha}:${path}`], {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    })
  } catch {
    return undefined
  }
}

/**
 * Assert every vendored file is byte-identical to the same file at the commit
 * the fixture directory's `PROVENANCE.sha` names — or, with `as: 'json'`, the
 * same JSON document: for a fixture directory left to the formatter rather
 * than listed in `.prettierignore` (step-up-schemas: a root config change would
 * read as a store build to the release tier).
 *
 * Reads the commit out of the clone's object store rather than the working
 * tree, so the comparison does not depend on what the clone happens to have
 * checked out — which is how a comparison against "the pin" silently became a
 * comparison against whatever someone last checked out.
 */
export function expectNoDrift(
  fixtureDir: string,
  map: Record<string, string>,
  { as = 'bytes' }: { as?: 'bytes' | 'json' } = {}
): void {
  // From the fixtures' own folder: the same repository root the call site's guard found.
  const registry = registryPath(fixtureDir)
  if (!registry) throw new Error('expectNoDrift called without a registry; guard with registryPath() first')
  requireRegistry(registry)
  const sha = readFileSync(join(fixtureDir, 'PROVENANCE.sha'), 'utf8').trim()
  expect(sha).toMatch(/^[0-9a-f]{40}$/)

  const missing: string[] = []
  const drifted: string[] = []
  for (const [vendored, path] of Object.entries(map)) {
    const live = fileAtCommit(registry, sha, path)
    if (live === undefined) {
      missing.push(`${path} (not at ${sha.slice(0, 8)})`)
      continue
    }
    const here = readFileSync(join(fixtureDir, vendored), 'utf8')
    const same = as === 'json' ? isDeepStrictEqual(JSON.parse(live), JSON.parse(here)) : live === here
    if (!same) drifted.push(vendored)
  }
  // Reported together, and as data rather than prose, so one run names every
  // file that moved instead of stopping at the first.
  expect({ missing, drifted }).toEqual({ missing: [], drifted: [] })
}
