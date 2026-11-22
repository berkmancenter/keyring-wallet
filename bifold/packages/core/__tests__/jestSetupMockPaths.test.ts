/**
 * Every local path jestSetup.js mocks must name a real file, case-exact.
 *
 * macOS folds case and Linux does not, so a mock path that differs from the
 * file only in case applies on a developer's machine and does nothing in CI:
 * jest registers the mock against a module id that nothing ever requires, and
 * raises no error either way. src/modules/openid/refresh/refreshOrchestrator
 * was mocked as RefreshOrchestrator for exactly that reason, so every suite
 * that builds the container ran the real orchestrator, with its timers and
 * logs, in CI only.
 *
 * fs.existsSync cannot see this on macOS. Each segment is matched against its
 * directory's entries instead.
 */
import fs from 'fs'
import path from 'path'

const packageRoot = path.resolve(__dirname, '..')
const setup = fs.readFileSync(path.join(packageRoot, 'jestSetup.js'), 'utf8')

// A module path carries no extension, and may be a directory with an index.
const suffixes = ['', '.ts', '.tsx', '.js', '.jsx', '.json', '/index.ts', '/index.tsx', '/index.js']

/** The paths into this package that jestSetup.js mocks or requires. */
function localMockPaths(source: string): string[] {
  const found = new Set<string>()
  for (const match of source.matchAll(/(?:jest\.mock|require)\(\s*'(\.[^']+)'/g)) found.add(match[1])
  for (const match of source.matchAll(/path\.resolve\(\s*__dirname\s*,\s*'([^']+)'\s*\)/g)) found.add(match[1])
  return [...found]
}

/** Whether this file exists spelled exactly this way, every segment included. */
function isFileCaseExact(absolute: string): boolean {
  const relative = path.relative(packageRoot, absolute)
  if (relative.startsWith('..') || path.isAbsolute(relative)) return false
  let walked = packageRoot
  for (const segment of relative.split(path.sep)) {
    let entries: string[]
    try {
      entries = fs.readdirSync(walked)
    } catch {
      return false
    }
    if (!entries.includes(segment)) return false
    walked = path.join(walked, segment)
  }
  return fs.statSync(walked).isFile()
}

const resolvesCaseExact = (modulePath: string): boolean =>
  suffixes.some((suffix) => isFileCaseExact(path.resolve(packageRoot, modulePath + suffix)))

describe('jestSetup.js mock paths', () => {
  const paths = localMockPaths(setup)

  // Without this, a regex that stopped matching would leave every assertion below vacuous.
  it('finds the local paths jestSetup.js names', () => {
    expect(paths.length).toBeGreaterThanOrEqual(3)
    expect(paths).toContain('src/modules/openid/refresh/refreshOrchestrator')
  })

  it.each(paths)('%s names a real file, case-exact', (modulePath) => {
    expect(resolvesCaseExact(modulePath)).toBe(true)
  })

  // The check must be able to fail on a case-insensitive filesystem, or it proves nothing there.
  it('refuses a path that differs only in case', () => {
    expect(resolvesCaseExact('src/modules/openid/refresh/RefreshOrchestrator')).toBe(false)
    expect(resolvesCaseExact('src/modules/openid/refresh/refreshOrchestrator')).toBe(true)
  })
})
