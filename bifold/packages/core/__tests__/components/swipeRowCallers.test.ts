/**
 * Every SwipeRow caller spreads the touch props on its row. SwipeRow hands the row's own touchable the long press and
 * the screen reader's action through its render prop; a caller that forgets `{...touch}` loses both with no type
 * error and, unless it tests a long press, no failing test. A screen reader then can't reach Delete or Hide at all.
 * So this reads each file that renders a SwipeRow, finds each row's render prop argument, and asks for it spread
 * within that row's own children.
 *
 * It proves the spread is there, not that it lands on the row's touchable: a spread onto an inner View would pass
 * here and still lose the gesture. Each caller's own long-press and screen-reader tests are what cover that.
 */
import fs from 'node:fs'
import path from 'node:path'

const SRC = path.resolve(__dirname, '../../src')

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sources(full)
    return /\.tsx$/.test(entry.name) ? [full] : []
  })
}

const callers = sources(SRC).filter(
  (file) => !file.endsWith(`${path.sep}SwipeRow.tsx`) && /<SwipeRow\b/.test(fs.readFileSync(file, 'utf8'))
)

test('finds the callers (a guard that read nothing would pass)', () => {
  // The floor: a named caller, so an empty match (or a broken file walk) fails instead of passing with nothing read.
  // If ContactListItem stops using SwipeRow, name another caller here; don't remove the check.
  expect(callers.map((file) => path.basename(file))).toContain('ContactListItem.tsx')
})

test.each(callers.map((file) => [path.relative(SRC, file), file]))(
  '%s spreads the touch props on its row',
  (_name, file) => {
    const text = fs.readFileSync(file, 'utf8')
    const rows = [...text.matchAll(/<SwipeRow\b[\s\S]*?>\s*\{\s*\(\s*(\w+)\s*\)\s*=>([\s\S]*?)<\/SwipeRow>/g)]
    // Each SwipeRow in the file takes its children as `(name) => …`, and spreads `name` within its own children: two
    // rows that both call it `touch` must each spread it, so one row's spread can't stand in for the other's.
    expect(rows).toHaveLength((text.match(/<SwipeRow\b/g) ?? []).length)
    for (const [, name, children] of rows) expect(children).toMatch(new RegExp(`\\{\\.\\.\\.${name}\\}`))
  }
)
