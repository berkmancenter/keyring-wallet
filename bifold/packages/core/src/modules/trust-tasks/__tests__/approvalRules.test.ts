/**
 * "Ask me before…" sets one kind of rule — consent from this phone, on a task
 * the phone never sends — and leaves every other rule as it found it. A rule
 * on a task the phone sends would hold the phone itself (measured on
 * device/set-wake, 2026-10-02), so the list of what the phone sends is held
 * against the code here.
 */
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

import {
  EMPTY_APPROVALS,
  NotOffered,
  OFFERED_TASKS,
  PHONE_SENDS,
  TEST_REQUEST_TASKS,
  approvalsView,
  modelFromExt,
  phoneSetName,
  withKeySwapped,
  withPhoneRule,
} from '../module/approvalRules'
import { synthesizeRego, validateApprovals } from '../module/approvalsPolicy'

const ME = 'did:key:z6MkThisPhone'
const OTHER = 'did:key:z6MkOtherPhone'
const CREATE = 'https://trusttasks.org/spec/vta/contexts/create/1.0'
const REVOKE = 'https://trusttasks.org/spec/keys/revoke/0.1'
const SET_WAKE = 'https://trusttasks.org/spec/device/set-wake/0.2'
const ACL_GRANT = 'https://trusttasks.org/spec/acl/grant/0.1'

const elsewhere = {
  rules: [
    { taskType: ACL_GRANT, requires: 'consent' as const, approverSet: 'ops', minApprovals: 2 },
    { taskType: SET_WAKE, requires: 'reauth' as const },
  ],
  sets: { ops: [OTHER, 'did:key:z6MkThird'] },
  version: 7,
}

describe('switching a rule on and off', () => {
  it('on: this phone as the one approver, one approval, its own approval counting', () => {
    const next = withPhoneRule(EMPTY_APPROVALS, CREATE, true, ME)
    expect(next).toEqual({
      rules: [
        {
          taskType: CREATE,
          requires: 'consent',
          approverSet: phoneSetName(ME),
          minApprovals: 1,
          excludeRequester: false,
        },
      ],
      sets: { [phoneSetName(ME)]: [ME] },
    })
    expect(() => validateApprovals(next.rules, next.sets)).not.toThrow()
  })

  it('keeps every rule and set from elsewhere, in order, on and off', () => {
    const on = withPhoneRule(elsewhere, CREATE, true, ME)
    expect(on.rules.slice(0, 2)).toEqual(elsewhere.rules)
    expect(on.sets.ops).toEqual(elsewhere.sets.ops)
    const off = withPhoneRule({ ...on, version: 8 }, CREATE, false, ME)
    expect(off).toEqual({ rules: elsewhere.rules, sets: elsewhere.sets })
  })

  it("the phone's set goes with its last rule, and stays while another names it", () => {
    const two = withPhoneRule(withPhoneRule(EMPTY_APPROVALS, CREATE, true, ME) as never, REVOKE, true, ME)
    expect(two.rules).toHaveLength(2)
    const one = withPhoneRule({ ...two, version: 1 }, CREATE, false, ME)
    expect(one.sets[phoneSetName(ME)]).toEqual([ME])
    const none = withPhoneRule({ ...one, version: 2 }, REVOKE, false, ME)
    expect(none.sets).toEqual({})
  })

  it("another phone's rule on the same task is not this phone's switch", () => {
    const theirs = withPhoneRule(EMPTY_APPROVALS, CREATE, true, OTHER)
    const view = approvalsView({ ...theirs, version: 1 }, ME)
    expect(view.offered.find((o) => o.taskType === CREATE)).toMatchObject({ on: false, elsewhere: true })
    expect(view.canTest).toBe(false)
  })

  it('never a task that is not offered, nor one the phone sends', () => {
    expect(() => withPhoneRule(EMPTY_APPROVALS, SET_WAKE, true, ME)).toThrow(NotOffered)
    expect(() => withPhoneRule(EMPTY_APPROVALS, 'https://trusttasks.org/spec/policy/upsert/0.2', true, ME)).toThrow(
      NotOffered
    )
  })

  it('what it writes is a model the SDK would accept, and generates', () => {
    const next = withPhoneRule(elsewhere, CREATE, true, ME)
    expect(() => validateApprovals(next.rules, next.sets)).not.toThrow()
    expect(synthesizeRego(next.rules)).toContain(`"approverSet": "${phoneSetName(ME)}"`)
  })
})

describe('what the screen shows', () => {
  it('a rule from elsewhere on a task the phone sends is flagged', () => {
    const view = approvalsView(elsewhere, ME)
    expect(view.elsewhere.map((e) => [e.rule.taskType, e.holdsThisPhone])).toEqual([
      [ACL_GRANT, true],
      [SET_WAKE, true],
    ])
    expect(view.offered.every((o) => !o.on && !o.elsewhere)).toBe(true)
  })

  it('the test request is on offer once the phone holds contexts/create', () => {
    const on = withPhoneRule(EMPTY_APPROVALS, CREATE, true, ME)
    expect(approvalsView({ ...on, version: 1 }, ME).canTest).toBe(true)
    expect(approvalsView(EMPTY_APPROVALS, ME).canTest).toBe(false)
  })
})

describe('reading the row', () => {
  it('reads rules and sets, and keeps only the members a rule has', () => {
    const model = modelFromExt(
      {
        'openvtc.approvals': [{ taskType: CREATE, requires: 'consent', approverSet: 's', contexts: [] }],
        'openvtc.approver-sets': { s: [ME] },
      },
      3
    )
    expect(model).toEqual({
      rules: [{ taskType: CREATE, requires: 'consent', approverSet: 's' }],
      sets: { s: [ME] },
      version: 3,
      unreadable: false,
    })
  })

  it('no row, or a row with no ext, is no rules', () => {
    expect(modelFromExt(undefined, 0)).toEqual({ rules: [], sets: {}, version: 0, unreadable: false })
  })

  it('anything it cannot read whole makes the row read-only, never dropped on write', () => {
    for (const ext of [
      { 'openvtc.approvals': [{ taskType: CREATE, requires: 'consent', approverSet: 's', later: true }] },
      { 'openvtc.approvals': [{ taskType: CREATE, requires: 'maybe' }] },
      { 'openvtc.approvals': {} },
      { 'openvtc.approvals': [], 'openvtc.approver-sets': { s: [1] } },
    ]) {
      expect(modelFromExt(ext, 1).unreadable).toBe(true)
    }
  })
})

describe('the phone never sends an offered task', () => {
  const moduleDir = join(__dirname, '..', 'module')
  const source = readdirSync(moduleDir)
    .filter((f) => f.endsWith('.ts') && f !== 'approvalRules.ts')
    .map((f) => readFileSync(join(moduleDir, f), 'utf8'))
    .join('\n')

  it('no offered task is on the list of what the phone sends', () => {
    for (const { taskType } of OFFERED_TASKS) expect(PHONE_SENDS).not.toContain(taskType)
  })

  it('an offered task is named in the code only for the test request', () => {
    for (const { taskType } of OFFERED_TASKS) {
      if ((TEST_REQUEST_TASKS as readonly string[]).includes(taskType)) continue
      expect(source).not.toContain(taskType)
    }
  })

  it('contexts/create and contexts/delete are sent only by the test request', () => {
    const callers = (name: string) =>
      readdirSync(moduleDir)
        .filter((f) => f.endsWith('.ts'))
        .filter((f) => readFileSync(join(moduleDir, f), 'utf8').includes(name))
    expect(callers('VTA_TASK.contextsCreate')).toEqual(['VtaClient.ts'])
    expect(callers('VTA_TASK.contextsDelete')).toEqual(['VtaClient.ts'])
    const client = readFileSync(join(moduleDir, 'VtaClient.ts'), 'utf8')
    const uses = client.split('\n').filter((l) => /VTA_TASK\.contexts(Create|Delete)\b/.test(l))
    // createContext (no caller in the app) and the two sends of sendTestRequest.
    expect(uses).toHaveLength(3)
  })

  it('the app has no caller of createContext', () => {
    const src = join(__dirname, '..', '..', '..')
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory()
          ? e.name === '__tests__' || e.name === 'node_modules'
            ? []
            : walk(join(dir, e.name))
          : /\.tsx?$/.test(e.name)
            ? [join(dir, e.name)]
            : []
      )
    // React's createContext is imported and called bare; a VTA client's is a method.
    expect(walk(src).filter((f) => /\.createContext\(/.test(readFileSync(f, 'utf8')))).toEqual([])
  })
})

/**
 * After this phone's key is swapped (acl/swap-key), the rules still named the
 * retired key: the agent kept asking a key that can no longer answer, and the
 * phone stopped being asked at all.
 */
describe('approval rules follow this phone through a key swap', () => {
  const NEW = 'did:peer:2.swappedIn'

  it("renames the phone's own set, swaps its member, and repoints the rules that use it", () => {
    const before = { ...EMPTY_APPROVALS, ...withPhoneRule(EMPTY_APPROVALS, CREATE, true, ME) }
    const after = withKeySwapped(before, ME, NEW)
    expect(after.changed).toBe(true)
    expect(after.sets).toEqual({ [phoneSetName(NEW)]: [NEW] })
    expect(after.rules).toEqual([expect.objectContaining({ taskType: CREATE, approverSet: phoneSetName(NEW) })])
    // The screen recognises the rule as this phone's again, under its new key.
    const view = approvalsView({ ...after, version: 1 }, NEW)
    expect(view.offered.find((o) => o.taskType === CREATE)?.on).toBe(true)
    expect(view.elsewhere).toEqual([])
    expect(() => validateApprovals(after.rules, after.sets)).not.toThrow()
  })

  it('swaps the old key in a set made elsewhere, and leaves every other member, set and rule as it was', () => {
    const model = {
      rules: [{ taskType: REVOKE, requires: 'consent' as const, approverSet: 'ops', minApprovals: 1 }],
      sets: { ops: [OTHER, ME], audit: [OTHER] },
    }
    const after = withKeySwapped(model, ME, NEW)
    expect(after.changed).toBe(true)
    expect(after.sets).toEqual({ ops: [OTHER, NEW], audit: [OTHER] })
    expect(after.rules).toEqual(model.rules)
  })

  it('nothing to change when the old key appears nowhere', () => {
    const model = { rules: [], sets: { ops: [OTHER] } }
    expect(withKeySwapped(model, ME, NEW)).toEqual({ ...model, changed: false })
  })

  it('a set renamed onto one that already exists merges into it, each member once', () => {
    const model = { rules: [], sets: { [phoneSetName(ME)]: [ME], [phoneSetName(NEW)]: [NEW] } }
    expect(withKeySwapped(model, ME, NEW).sets).toEqual({ [phoneSetName(NEW)]: [NEW] })
  })
})
