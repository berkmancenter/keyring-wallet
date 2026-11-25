/**
 * Every screen shows and counts the agent's requests through `shownApprovals` (or `waitingRequests`, which uses it),
 * so a request from someone else's agent never shows while the trusted-approvers switch is off. A screen that read
 * `state.approvals` directly would show one: the rows for each screen prove that screen today, this one fails the
 * moment any screen, now or added later, writes the direct read.
 */
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

const ROOT = join(__dirname, '..')
const DIRS = ['screens', 'components']
const THROUGH = /(shownApprovals|waitingRequests)\(\s*$/

const reads = DIRS.flatMap((dir) =>
  readdirSync(join(ROOT, dir))
    .filter((file) => file.endsWith('.tsx') || file.endsWith('.ts'))
    .flatMap((file) => {
      const text = readFileSync(join(ROOT, dir, file), 'utf8')
      return [...text.matchAll(/\b[\w.]+\.approvals\b/g)].map((m) => ({
        at: `${dir}/${file}:${text.slice(0, m.index).split('\n').length}`,
        through: THROUGH.test(text.slice(0, m.index)),
      }))
    })
)

// A destructured read (`const { approvals } = vta`, or `({ approvals }) =>`) contains no `.approvals`, so the scan
// above cannot see it, and a count cannot see one read swapped for another: refuse it outright.
const destructured = DIRS.flatMap((dir) =>
  readdirSync(join(ROOT, dir))
    .filter((file) => file.endsWith('.tsx') || file.endsWith('.ts'))
    .flatMap((file) => {
      const text = readFileSync(join(ROOT, dir, file), 'utf8')
      return [...text.matchAll(/\{[^{}]*\bapprovals\b[^{}]*\}\s*(=[^=>]|\)\s*=>|:)/g)]
        .filter((m) => !/\bapprovals\s*:/.test(m[0]))
        .map((m) => `${dir}/${file}:${text.slice(0, m.index).split('\n').length}`)
    })
)

describe('the requests a screen shows', () => {
  it('are read only through shownApprovals or waitingRequests, in every screen and component', () => {
    // Too few found means the scan stopped looking, not that the rule holds.
    expect(reads.length).toBeGreaterThanOrEqual(5)
    expect(reads.filter((read) => !read.through).map((read) => read.at)).toEqual([])
  })

  it('are never destructured out of the agent state, where the scan above cannot see them', () => {
    // Named, with its reason: requestsView takes an already-shown list from its one caller, which the next row checks.
    const ALLOWED = ['screens/requestsView.ts']
    expect(destructured.filter((at) => !ALLOWED.includes(at.replace(/:\d+$/, '')))).toEqual([])
  })

  it("requestsView's list is the shown one: its only caller passes shownApprovals (else the allowance above is wrong)", () => {
    const callers = DIRS.flatMap((dir) =>
      readdirSync(join(ROOT, dir))
        .filter((file) => file.endsWith('.tsx') || file.endsWith('.ts'))
        .filter((file) => file !== 'requestsView.ts')
        .map((file) => readFileSync(join(ROOT, dir, file), 'utf8'))
        .filter((text) => /\brequestsView\(/.test(text))
    )
    expect(callers).toHaveLength(1)
    expect(callers[0]).toMatch(/requestsView\(\{[\s\S]*?approvals: shownApprovals\(/)
  })
})
