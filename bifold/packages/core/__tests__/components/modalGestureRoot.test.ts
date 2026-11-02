/**
 * A react-native-gesture-handler touchable inside an RN Modal needs a GestureHandlerRootView inside that Modal. On
 * Android a Modal is its own native window, outside every gesture root above it, so gesture-handler never sees the
 * touch: the sheet shows and takes no taps, only system Back. That was the disappearing-messages sheet and the
 * long-press actions on Android from 272. iOS works either way, and jest can't tell the difference at all.
 *
 * So this reads each file in src that renders a <Modal> or <SafeAreaModal>, and asks for a GestureHandlerRootView
 * within a Modal when either:
 * - the file imports from gesture-handler itself (its touchables may be built outside the Modal's JSX, as
 *   MessageActions' entries are), or
 * - the Modal renders a component from a file that imports gesture-handler and has no Modal of its own, as
 *   MessageActions renders ReactionBar. A component that brings its own Modal (DisappearingMessagesSheet) answers
 *   for that Modal itself.
 *
 * Each Modal is checked on its own, so one Modal's root can't stand in for a sibling's. A Modal is matched from its
 * open tag to the first close after it, so a nested pair would be scoped wrongly; every file's matched Modals are
 * therefore counted against the Modals it opens with children, and a nested or unclosed one fails as a mismatch
 * rather than reading as a pass.
 *
 * It proves the root is there, not that a tap lands: that's a device check on Android. It doesn't see a Modal
 * wrapper other than SafeAreaModal, or gesture-handler reached through more than one import.
 */
import fs from 'node:fs'
import path from 'node:path'

const SRC = path.resolve(__dirname, '../../src')
const RNGH = /from 'react-native-gesture-handler'/
const MODAL = /<(Modal|SafeAreaModal)\b[\s\S]*?<\/\1>/g

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sources(full)
    return /\.tsx?$/.test(entry.name) ? [full] : []
  })
}

const read = (file: string) => fs.readFileSync(file, 'utf8')

function resolve(from: string, spec: string): string | undefined {
  const base = path.resolve(path.dirname(from), spec)
  return [`${base}.tsx`, `${base}.ts`, path.join(base, 'index.tsx'), path.join(base, 'index.ts')].find((file) =>
    fs.existsSync(file)
  )
}

/** The names a file imports from sibling modules that use gesture-handler and have no Modal of their own. */
function gestureComponents(file: string): string[] {
  return [...read(file).matchAll(/import\s+(?!type\b)([^;]+?)\s+from\s+'(\.{1,2}\/[^']+)'/g)].flatMap(
    ([, clause, spec]) => {
      const target = resolve(file, spec)
      if (!target || !RNGH.test(read(target)) || new RegExp(MODAL.source).test(read(target))) return []
      return clause
        .split(/[{},]/)
        .map(
          (name) =>
            name
              .trim()
              .split(/\s+as\s+/)
              .pop() ?? ''
        )
        .filter((name) => /^[A-Z]\w*$/.test(name))
    }
  )
}

/** Each Modal in `text`: why it needs a gesture root (none when it doesn't), and whether it has one. */
function modalsIn(text: string, imported: string[]): { reasons: string[]; root: boolean }[] {
  return [...text.matchAll(MODAL)].map(([modal]) => ({
    reasons: [
      ...(RNGH.test(text) ? ['imports gesture-handler'] : []),
      ...imported.filter((name) => new RegExp(`<${name}\\b`).test(modal)),
    ],
    root: /<GestureHandlerRootView\b/.test(modal),
  }))
}

/** How many Modals `text` opens with children. A self-closing `<Modal />` has nothing to scope, so isn't counted. */
function modalOpens(text: string): number {
  return [...text.matchAll(/<(Modal|SafeAreaModal)\b/g)].filter(({ index = 0 }) => {
    // The open tag ends at the first `>` outside its props' braces (an arrow function's `=>` is inside them).
    let depth = 0
    for (let i = index; i < text.length; i++) {
      if (text[i] === '{') depth++
      else if (text[i] === '}') depth--
      else if (text[i] === '>' && depth === 0) return text[i - 1] !== '/'
    }
    return false
  }).length
}

const allModalFiles = sources(SRC)
  .filter((file) => file.endsWith('.tsx') && !file.endsWith(`${path.sep}SafeAreaModal.tsx`))
  .filter((file) => /<(Modal|SafeAreaModal)\b/.test(read(file)))

/** For each file rendering a Modal that needs a gesture root: its Modals, each with why and whether it has one. */
const modalFiles = allModalFiles
  .map((file) => ({ file, modals: modalsIn(read(file), gestureComponents(file)) }))
  .filter(({ modals }) => modals.some(({ reasons }) => reasons.length > 0))

test('finds the Modals that need a gesture root (a guard that read nothing would pass)', () => {
  // The floor: named files, so a broken file walk or Modal match fails instead of passing with nothing read. If one
  // of these stops using gesture-handler in a Modal, name another here; don't remove the check.
  const byName = Object.fromEntries(modalFiles.map(({ file, modals }) => [path.basename(file), modals]))
  expect(Object.keys(byName)).toEqual(
    expect.arrayContaining(['DisappearingMessagesSheet.tsx', 'MessageActions.tsx', 'RCardPhotoCropModal.tsx'])
  )
  // The component rule is seen too, not just the file's own import: MessageActions renders ReactionBar.
  expect(byName['MessageActions.tsx'].flatMap(({ reasons }) => reasons)).toContain('ReactionBar')
})

test.each(modalFiles.map(({ file, modals }) => [path.relative(SRC, file), modals]))(
  '%s has a GestureHandlerRootView inside each Modal that needs one',
  (_name, modals) => {
    for (const { reasons, root } of modals)
      if (reasons.length) expect({ reasons, root }).toEqual({ reasons, root: true })
  }
)

test('every Modal in src is matched whole: none nested, none left open', () => {
  const mismatched = allModalFiles
    .map((file) => ({
      file: path.relative(SRC, file),
      opens: modalOpens(read(file)),
      matched: modalsIn(read(file), []).length,
    }))
    .filter(({ opens, matched }) => opens !== matched)
  expect(allModalFiles.map((file) => path.basename(file))).toEqual(expect.arrayContaining(['MessageActions.tsx']))
  expect(mismatched).toEqual([])
})

describe('the rule itself, on fixtures', () => {
  const gesture = "import { TouchableOpacity } from 'react-native-gesture-handler'\n"

  it('checks two Modals in one file apart: a root in one does not stand in for the other', () => {
    const text = `${gesture}<Modal><GestureHandlerRootView><A /></GestureHandlerRootView></Modal>\n<Modal><B /></Modal>`
    expect(modalsIn(text, []).map(({ root }) => root)).toEqual([true, false])
    expect(modalsIn(text, []).every(({ reasons }) => reasons.length > 0)).toBe(true)
  })

  it('reads a nested pair as a count mismatch, not a pass', () => {
    const text = `${gesture}<Modal><Modal><GestureHandlerRootView /></Modal></Modal>`
    expect({ opens: modalOpens(text), matched: modalsIn(text, []).length }).toEqual({ opens: 2, matched: 1 })
  })

  it('does not count a self-closing Modal, or an arrow in an open tag', () => {
    expect(modalOpens('<Modal visible />')).toBe(0)
    expect(modalOpens('<Modal onRequestClose={() => close()}><A /></Modal>')).toBe(1)
  })
})
