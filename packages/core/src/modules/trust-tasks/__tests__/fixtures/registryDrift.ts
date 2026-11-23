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
 * @module trust-tasks/__tests__/fixtures/registryDrift
 */
import { execFileSync } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { isDeepStrictEqual } from 'util'

/**
 * The registry clone, or undefined when this machine has none.
 *
 * `TRUST_TASKS_REGISTRY` overrides; otherwise it is `external/` beside the
 * wallet checkout that carries this submodule. A standalone bifold clone has
 * no such sibling, and CI has no clone at all — both of which are legitimately
 * "absent", and the only case that skips.
 */
export function registryPath(): string | undefined {
  const fromEnv = process.env.TRUST_TASKS_REGISTRY
  if (fromEnv) return existsSync(fromEnv) ? fromEnv : undefined
  // __dirname is <bifold>/packages/core/src/modules/trust-tasks/__tests__/fixtures
  const walletRoot = join(__dirname, '..', '..', '..', '..', '..', '..', '..', '..')
  const guess = join(walletRoot, 'external', 'dtgwg-trust-tasks-tf')
  return existsSync(guess) ? guess : undefined
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
  const registry = registryPath()
  if (!registry) throw new Error('expectNoDrift called without a registry; guard with registryPath() first')
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
