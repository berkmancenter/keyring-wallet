/**
 * The boundary that makes `src/hardware-signing/` extractable.
 *
 * The point of the directory is that a caller — the approval demo today, a
 * relying-party service or a published `@bifold/hardware-signing` package
 * later — can sign and verify without installing an agent framework. That
 * property is invisible at runtime and easy to lose to one convenient import,
 * so it is asserted here instead of documented and hoped for.
 */

import fs from 'fs'
import path from 'path'

const DIRECTORY = path.join(__dirname, '..', '..', 'src', 'hardware-signing')

/**
 * The only packages the directory may depend on: the native module it is a
 * client of, plus what it needs to know which platform it is on and to hand
 * bytes to the bridge.
 */
const ALLOWED_PACKAGES = ['@bifold/react-native-attestation', 'react-native', 'buffer']

const IMPORT_PATTERN = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+['"]([^'"]+)['"]/g

const sourceFiles = fs
  .readdirSync(DIRECTORY)
  .filter((name) => name.endsWith('.ts'))
  .map((name) => path.join(DIRECTORY, name))

function importsOf(file: string): string[] {
  const contents = fs.readFileSync(file, 'utf8')
  const specifiers: string[] = []
  let match: RegExpExecArray | null
  IMPORT_PATTERN.lastIndex = 0
  while ((match = IMPORT_PATTERN.exec(contents)) !== null) {
    specifiers.push(match[1])
  }
  return specifiers
}

describe('hardware-signing is Credo-free', () => {
  it('finds the source files it is meant to be guarding', () => {
    expect(sourceFiles.length).toBeGreaterThanOrEqual(6)
    expect(sourceFiles.map((f) => path.basename(f))).toEqual(
      expect.arrayContaining(['index.ts', 'types.ts', 'key.ts', 'sign.ts', 'evidence.ts', 'verify.ts', 'service.ts'])
    )
  })

  it.each(sourceFiles.map((file) => [path.basename(file), file]))(
    '%s imports no @credo-ts or DI container package',
    (_name, file) => {
      for (const specifier of importsOf(file)) {
        expect(specifier).not.toMatch(/^@credo-ts\//)
        expect(specifier).not.toMatch(/^tsyringe$/)
      }
    }
  )

  it.each(sourceFiles.map((file) => [path.basename(file), file]))(
    '%s reaches outside the directory only for allowed packages',
    (_name, file) => {
      for (const specifier of importsOf(file)) {
        if (specifier.startsWith('.')) {
          // A relative import must resolve inside the directory, or the
          // directory is not movable on its own.
          const resolved = path.resolve(path.dirname(file), specifier)
          expect(resolved.startsWith(DIRECTORY + path.sep)).toBe(true)
          continue
        }
        expect(ALLOWED_PACKAGES).toContain(specifier)
      }
    }
  )

  it('does not mention @credo-ts anywhere in its source, including in types', () => {
    for (const file of sourceFiles) {
      const contents = fs.readFileSync(file, 'utf8')
      // The word appears in prose in index.ts/evidence.ts headers explaining the
      // rule; what must never appear is an import or a type reference.
      expect(contents).not.toMatch(/from\s+['"]@credo-ts/)
      expect(contents).not.toMatch(/require\(\s*['"]@credo-ts/)
      expect(contents).not.toMatch(/import\(\s*['"]@credo-ts/)
    }
  })
})
