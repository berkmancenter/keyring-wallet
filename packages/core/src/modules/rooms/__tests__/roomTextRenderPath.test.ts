/**
 * noInterpretingRenderers.test checks what the rooms module imports. This checks what it renders THROUGH: every
 * shared component under src/components that a rooms file imports (ThemedText, DayPill, buttons…) must not
 * interpret text either. If one ever grew markdown, autolinking or a web view, room text written by another member
 * would start to be interpreted on every rooms screen while the module's own guard stayed green.
 *
 * The line: shared components a rooms file imports directly, and what those import from src/components in turn.
 */
import fs from 'node:fs'
import path from 'node:path'

const SRC = path.resolve(__dirname, '../../..')
const ROOMS = path.resolve(__dirname, '..')
const COMPONENTS = path.join(SRC, 'components')
const FORBIDDEN = [
  /markdown/i,
  /render-html/i,
  /react-native-webview/,
  /react-native-hyperlink/,
  /react-native-parsed-text/,
  /react-native-autolink/,
  /\bLinking\b/,
  /dangerouslySetInnerHTML/,
]

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(full)
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : []
  })
}

/** The file a relative import names, if it exists. */
function resolveImport(from: string, spec: string): string | undefined {
  const base = path.resolve(path.dirname(from), spec)
  return [`${base}.tsx`, `${base}.ts`, path.join(base, 'index.tsx'), path.join(base, 'index.ts')].find((f) =>
    fs.existsSync(f)
  )
}

/** Shared components reached from `files`, following imports that stay inside src/components. */
function sharedComponents(files: string[]): string[] {
  const found = new Set<string>()
  const queue = [...files]
  while (queue.length) {
    const file = queue.pop() as string
    for (const [, spec] of fs.readFileSync(file, 'utf8').matchAll(/from '(\.[^']+)'/g)) {
      const target = resolveImport(file, spec)
      if (target && target.startsWith(COMPONENTS) && !found.has(target)) {
        found.add(target)
        queue.push(target)
      }
    }
  }
  return [...found]
}

describe('what room text is rendered through', () => {
  const shared = sharedComponents(sourceFiles(ROOMS))

  it('finds the shared components rooms renders with (a guard that checked nothing would pass)', () => {
    const names = shared.map((f) => path.relative(COMPONENTS, f))
    expect(names).toEqual(expect.arrayContaining(['texts/ThemedText.tsx', 'chat/DayPill.tsx']))
  })

  it.each(shared.map((f) => [path.relative(SRC, f), f]))('%s interprets no text', (_name, file) => {
    const source = fs.readFileSync(file, 'utf8')
    for (const pattern of FORBIDDEN) expect([file, pattern.test(source)]).toEqual([file, false])
  })
})
