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

/** For each file rendering a Modal: why each of its Modals needs a gesture root, if it does. */
const modalFiles = sources(SRC)
  .filter((file) => file.endsWith('.tsx') && !file.endsWith(`${path.sep}SafeAreaModal.tsx`))
  .map((file) => {
    const text = read(file)
    const imported = gestureComponents(file)
    const modals = [...text.matchAll(MODAL)].map(([modal]) => {
      const reasons = [
        ...(RNGH.test(text) ? ['imports gesture-handler'] : []),
        ...imported.filter((name) => new RegExp(`<${name}\\b`).test(modal)),
      ]
      return { modal, reasons }
    })
    return { file, modals }
  })
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
    for (const { modal, reasons } of modals) {
      if (reasons.length)
        expect({ reasons, root: /<GestureHandlerRootView\b/.test(modal) }).toEqual({ reasons, root: true })
    }
  }
)
