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

/**
 * The upstream clones a vendored fixture can come from, by their folder in `external/`
 * (`scripts/openvtc/setup-external.mjs` clones them there, at `scripts/openvtc/PINS.json`'s pins). Each fixture's README
 * names its source; the Trust Tasks registry is the default.
 */
export type DriftSource = 'dtgwg-trust-tasks-tf' | 'verifiable-trust-infrastructure'
const REGISTRY: DriftSource = 'dtgwg-trust-tasks-tf'

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
export function registryPath(from: string = __dirname, source: DriftSource = REGISTRY): string | undefined {
  const fromEnv = source === REGISTRY ? process.env.TRUST_TASKS_REGISTRY : undefined
  if (fromEnv) return fromEnv
  const root = repoRootAbove(from)
  if (!root) return undefined
  const external = join(root, 'external')
  return existsSync(external) ? join(external, source) : undefined
}

/** Fails the drift test that asked, when the clone it was pointed at is not there. */
function requireRegistry(registry: string, source: DriftSource): void {
  if (existsSync(registry)) return
  throw new Error(
    source === REGISTRY && process.env.TRUST_TASKS_REGISTRY
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
 * A vendored file's source path, or its path and the commit it was copied at: for a fixture copied in more than one
 * go, whose `PROVENANCE.sha` names one commit per line (polls-schemas).
 */
export type DriftEntry = string | { path: string; commit: string }

const SHA = /^[0-9a-f]{40}$/

/**
 * Assert every vendored file is byte-identical to the same file at the commit
 * the fixture directory's `PROVENANCE.sha` names — or, with `as: 'json'`, the
 * same JSON document: for a fixture directory left to the formatter rather
 * than listed in `.prettierignore` (step-up-schemas: a root config change would
 * read as a store build to the release tier).
 *
 * `PROVENANCE.sha` holds one full commit per line. An entry given as a path alone is read at the only commit, and a
 * file naming more than one makes such an entry fail; an entry that names its commit is read there, and that commit
 * must be one the file lists, so the provenance file stays the record of where each copy came from. `source` is the
 * upstream clone the fixture's README names (the Trust Tasks registry unless it says otherwise).
 *
 * Reads the commit out of the clone's object store rather than the working
 * tree, so the comparison does not depend on what the clone happens to have
 * checked out — which is how a comparison against "the pin" silently became a
 * comparison against whatever someone last checked out.
 */
export function expectNoDrift(
  fixtureDir: string,
  map: Record<string, DriftEntry>,
  { as = 'bytes', source = REGISTRY }: { as?: 'bytes' | 'json'; source?: DriftSource } = {}
): void {
  // From the fixtures' own folder: the same repository root the call site's guard found.
  const registry = registryPath(fixtureDir, source)
  if (!registry) throw new Error('expectNoDrift called without a registry; guard with registryPath() first')
  requireRegistry(registry, source)
  const commits = readFileSync(join(fixtureDir, 'PROVENANCE.sha'), 'utf8').trim().split(/\s+/)
  expect(commits.filter((c) => !SHA.test(c))).toEqual([])

  const missing: string[] = []
  const drifted: string[] = []
  const unlisted: string[] = []
  for (const [vendored, entry] of Object.entries(map)) {
    const { path, commit } =
      typeof entry === 'string' ? { path: entry, commit: commits.length === 1 ? commits[0] : undefined } : entry
    if (commit === undefined || !commits.includes(commit)) {
      unlisted.push(`${vendored} (${commit ? `${commit.slice(0, 8)} is not in PROVENANCE.sha` : 'which commit?'})`)
      continue
    }
    const live = fileAtCommit(registry, commit, path)
    if (live === undefined) {
      missing.push(`${path} (not at ${commit.slice(0, 8)})`)
      continue
    }
    const here = readFileSync(join(fixtureDir, vendored), 'utf8')
    const same = as === 'json' ? isDeepStrictEqual(JSON.parse(live), JSON.parse(here)) : live === here
    if (!same) drifted.push(vendored)
  }
  // Reported together, and as data rather than prose, so one run names every
  // file that moved instead of stopping at the first.
  expect({ unlisted, missing, drifted }).toEqual({ unlisted: [], missing: [], drifted: [] })
}
