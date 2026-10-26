import fs from 'node:fs'
import path from 'node:path'

// Room text reaches the screens as InertText and must be shown as plain text: nothing in the rooms
// module may import a renderer that interprets markup, a link parser, a web view, or Linking (which
// would follow a link). Screens that show room text add their files to ROOM_TEXT_SCREENS below.
const ROOT = path.resolve(__dirname, '..')
const ROOM_TEXT_SCREENS: string[] = []
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

describe('room text is never interpreted', () => {
  const files = [...sourceFiles(ROOT), ...ROOM_TEXT_SCREENS]

  it('finds the module’s sources (a guard that checked nothing would pass)', () => {
    expect(files.length).toBeGreaterThanOrEqual(6)
  })

  it.each(files.map((f) => [path.relative(ROOT, f), f]))('%s imports no interpreting renderer', (_name, file) => {
    const imports = fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .filter(
        (line) => /^\s*import\b|require\(|from\s+['"]/.test(line) || /\bLinking\b|dangerouslySetInnerHTML/.test(line)
      )
    for (const pattern of FORBIDDEN) expect(imports.filter((line) => pattern.test(line))).toEqual([])
  })
})
