/**
 * Where the drift tests look for the registry clone (fixtures/registryDrift.ts). Since the fold, the old count of eight
 * folders up from the fixtures landed one folder above the repository, so the drift tests skipped on every machine,
 * the registry present or not, and nothing said so.
 */
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
