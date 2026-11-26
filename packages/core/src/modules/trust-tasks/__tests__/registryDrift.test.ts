/**
 * Where the drift tests look for the registry clone (fixtures/registryDrift.ts). Since the fold, the old count of eight
 * folders up from the fixtures landed one folder above the repository, so the drift tests skipped on every machine,
 * the registry present or not, and nothing said so.
 */
import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { expectNoDrift, registryPath, repoRootAbove } from './fixtures/registryDrift'

const FIXTURES = join('packages', 'core', 'src', 'modules', 'trust-tasks', '__tests__', 'fixtures')

let base: string
const saved = process.env.TRUST_TASKS_REGISTRY

/** A repository as the fold laid it out, `packages/` at its root, with what `has` names in it. */
function repo(has: { external?: boolean; clone?: boolean } = {}) {
  const root = join(base, 'repo')
  mkdirSync(join(root, 'scripts', 'openvtc'), { recursive: true })
  writeFileSync(join(root, 'scripts', 'openvtc', 'PINS.json'), '{}')
  const fixtures = join(root, FIXTURES)
  mkdirSync(fixtures, { recursive: true })
  if (has.external || has.clone) mkdirSync(join(root, 'external'), { recursive: true })
  if (has.clone) mkdirSync(join(root, 'external', 'dtgwg-trust-tasks-tf'))
  return { root, fixtures }
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'registry-drift-'))
  delete process.env.TRUST_TASKS_REGISTRY
})
afterEach(() => {
  rmSync(base, { recursive: true, force: true })
  if (saved === undefined) delete process.env.TRUST_TASKS_REGISTRY
  else process.env.TRUST_TASKS_REGISTRY = saved
})

describe('the registry clone the drift tests read', () => {
  test('is external/dtgwg-trust-tasks-tf in the repository root above the fixtures, however deep they sit', () => {
    const { root, fixtures } = repo({ clone: true })
    expect(repoRootAbove(fixtures)).toBe(root)
    expect(registryPath(fixtures)).toBe(join(root, 'external', 'dtgwg-trust-tasks-tf'))
  })

  test('is absent, and the drift tests skip, only where the checkout has no external/ at all (CI, a fresh clone)', () => {
    const { fixtures } = repo()
    expect(registryPath(fixtures)).toBeUndefined()
  })

  test('a checkout whose external/ is empty runs the drift test, and that test alone fails, saying what is missing', () => {
    const { root, fixtures } = repo({ external: true })
    // The path is answered, so a call site's `registryPath() ? it : it.skip` runs the test rather than skipping it,
    // and nothing is thrown while the file is read: the file's other tests are untouched.
    expect(registryPath(fixtures)).toBe(join(root, 'external', 'dtgwg-trust-tasks-tf'))
    expect(() => expectNoDrift(fixtures, {})).toThrow(/is missing.*setup-external/)
  })

  test('TRUST_TASKS_REGISTRY names it; one that names nothing runs the drift test and fails it, never skips', () => {
    const { fixtures } = repo()
    const elsewhere = join(base, 'elsewhere')
    mkdirSync(elsewhere)
    process.env.TRUST_TASKS_REGISTRY = elsewhere
    expect(registryPath(fixtures)).toBe(elsewhere)
    process.env.TRUST_TASKS_REGISTRY = join(base, 'nothing-here')
    expect(registryPath(fixtures)).toBe(join(base, 'nothing-here'))
    expect(() => expectNoDrift(fixtures, {})).toThrow(/TRUST_TASKS_REGISTRY .* does not exist/)
  })

  test('another source is its own folder in external/, and TRUST_TASKS_REGISTRY names only the registry', () => {
    const { root, fixtures } = repo({ clone: true })
    process.env.TRUST_TASKS_REGISTRY = join(base, 'elsewhere')
    expect(registryPath(fixtures, 'verifiable-trust-infrastructure')).toBe(
      join(root, 'external', 'verifiable-trust-infrastructure')
    )
  })

  test('with TRUST_TASKS_REGISTRY set and no external/, another source fails its drift test rather than skipping', () => {
    // The variable names only the registry; a source it does not cover must not quietly drop out where it is set.
    const { root, fixtures } = repo()
    process.env.TRUST_TASKS_REGISTRY = join(base, 'elsewhere')
    expect(registryPath(fixtures, 'verifiable-trust-infrastructure')).toBe(
      join(root, 'external', 'verifiable-trust-infrastructure')
    )
    expect(() => expectNoDrift(fixtures, {}, { source: 'verifiable-trust-infrastructure' })).toThrow(
      /is missing.*registry only, not verifiable-trust-infrastructure/
    )
  })

  test('a file copied at one of several commits names it, and one PROVENANCE.sha does not list is refused', () => {
    const { root, fixtures } = repo({ clone: true })
    const clone = join(root, 'external', 'dtgwg-trust-tasks-tf')
    const git = (...args: string[]) => execFileSync('git', ['-C', clone, ...args], { encoding: 'utf8' }).trim()
    git('init', '-q')
    const commitWith = (text: string) => {
      writeFileSync(join(clone, 'a.json'), text)
      git('add', 'a.json')
      git('-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', text)
      return git('rev-parse', 'HEAD')
    }
    const first = commitWith('{"v":1}\n')
    const later = commitWith('{"v":2}\n')
    writeFileSync(join(fixtures, 'PROVENANCE.sha'), `${first}\n${later}\n`)
    writeFileSync(join(fixtures, 'old.json'), '{"v":1}\n')
    writeFileSync(join(fixtures, 'new.json'), '{"v":2}\n')
    // Each at the commit it names.
    expectNoDrift(fixtures, {
      'old.json': { path: 'a.json', commit: first },
      'new.json': { path: 'a.json', commit: later },
    })
    // Read at the wrong one of the two, it has drifted.
    expect(() => expectNoDrift(fixtures, { 'old.json': { path: 'a.json', commit: later } })).toThrow(/old\.json/)
    // A path alone, with two commits listed: which one is not guessed.
    expect(() => expectNoDrift(fixtures, { 'old.json': 'a.json' })).toThrow(/which commit/)
    // A commit the provenance file does not list.
    const other = 'f'.repeat(40)
    expect(() => expectNoDrift(fixtures, { 'old.json': { path: 'a.json', commit: other } })).toThrow(
      /not in PROVENANCE/
    )
  })

  test('a vendored file the map does not name fails the drift test, and names it; mapped, it passes', () => {
    const { root, fixtures } = repo({ clone: true })
    const clone = join(root, 'external', 'dtgwg-trust-tasks-tf')
    const git = (...args: string[]) => execFileSync('git', ['-C', clone, ...args], { encoding: 'utf8' }).trim()
    git('init', '-q')
    mkdirSync(join(clone, 'specs'))
    writeFileSync(join(clone, 'specs', 'a.json'), '{"a":1}\n')
    writeFileSync(join(clone, 'specs', 'b.json'), '{"b":1}\n')
    git('add', '.')
    git('-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'both')
    writeFileSync(join(fixtures, 'PROVENANCE.sha'), `${git('rev-parse', 'HEAD')}\n`)
    mkdirSync(join(fixtures, 'nested'))
    writeFileSync(join(fixtures, 'a.json'), '{"a":1}\n')
    writeFileSync(join(fixtures, 'nested', 'b.json'), '{"b":1}\n')
    expect(() => expectNoDrift(fixtures, { 'a.json': 'specs/a.json' })).toThrow(/nested\/b\.json/)
    expect(() => expectNoDrift(fixtures, { 'a.json': 'specs/a.json', 'nested/b.json': 'specs/b.json' })).not.toThrow()
  })

  test('above any repository there is no root, and nothing to read', () => {
    const lone = join(base, 'lone', 'a', 'b')
    mkdirSync(lone, { recursive: true })
    expect(repoRootAbove(lone)).toBeUndefined()
    expect(registryPath(lone)).toBeUndefined()
  })

  test("this package's own fixtures resolve to this repository's root, never a folder above it", () => {
    const root = repoRootAbove(join(__dirname, 'fixtures'))
    expect(root).toBeDefined()
    expect(join(__dirname, 'fixtures').startsWith(join(root as string, FIXTURES))).toBe(true)
  })
})
