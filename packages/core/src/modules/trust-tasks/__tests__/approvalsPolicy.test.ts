/**
 * The VTA re-derives the approvals policy's Rego from its rules and refuses a
 * write that differs byte for byte, so Keyring's port must produce exactly what
 * the SDK's `synthesize_rego` does. The fixtures are the SDK's own output at the
 * pinned VTI commit (wallet `scripts/openvtc/gen-approvals-fixtures.sh`).
 */
import cases from './fixtures/approvals-cases.json'
import generated from './fixtures/approvals-rego.json'
import {
  type ApprovalRule,
  ApprovalsError,
  isTaskTypeUri,
  synthesizeRego,
  validateApprovals,
} from '../module/approvalsPolicy'

describe('the approvals policy, byte for byte as the SDK writes it', () => {
  it('covers every case, generated at a pinned VTI commit', () => {
    expect(generated.vti).toMatch(/^[0-9a-f]{7,40}$/)
    expect(generated.cases.map((c) => c.name)).toEqual(cases.map((c) => c.name))
  })

  it.each(generated.cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    expect(synthesizeRego(c.rules as ApprovalRule[])).toBe(c.rego)
  })
})

describe('a model the VTA would refuse is refused here first, in its words', () => {
  const CREATE = 'https://trusttasks.org/spec/vta/contexts/create/1.0'
  const refused = (rules: ApprovalRule[], sets: Record<string, string[]>) => {
    try {
      validateApprovals(rules, sets)
    } catch (e) {
      return (e as ApprovalsError).code
    }
    return 'accepted'
  }

  it('a task type that is not a Trust Task Type URI', () => {
    expect(isTaskTypeUri(CREATE)).toBe(true)
    for (const bad of [
      '',
      'vta/contexts/create/1.0',
      'https://trusttasks.org/spec//1.0',
      'https://trusttasks.org/spec/x/1',
      'https://trusttasks.org/spec/x/v1.0',
    ]) {
      expect(refused([{ taskType: bad, requires: 'reauth' }], {})).toBe('MalformedTaskType')
    }
  })

  it('consent without a set, an unknown set, an empty set, a threshold the set cannot meet', () => {
    expect(refused([{ taskType: CREATE, requires: 'consent' }], {})).toBe('MissingApproverSet')
    expect(refused([{ taskType: CREATE, requires: 'consent', approverSet: 'ops' }], {})).toBe('UnknownApproverSet')
    expect(refused([{ taskType: CREATE, requires: 'consent', approverSet: 'ops' }], { ops: [] })).toBe(
      'EmptyApproverSet'
    )
    expect(
      refused([{ taskType: CREATE, requires: 'consent', approverSet: 'ops', minApprovals: 2 }], { ops: ['did:key:a'] })
    ).toBe('ThresholdExceedsSet')
  })

  it('consent-only fields, or a set, on a reauth rule', () => {
    expect(refused([{ taskType: CREATE, requires: 'reauth', approverSet: 'ops' }], { ops: ['a'] })).toBe(
      'ApproverSetOnReauth'
    )
    expect(refused([{ taskType: CREATE, requires: 'reauth', minApprovals: 1 }], {})).toBe('ConsentFieldOnReauth')
    expect(refused([{ taskType: CREATE, requires: 'reauth', excludeRequester: false }], {})).toBe(
      'ConsentFieldOnReauth'
    )
  })

  it('two rules for one task type must carry disjoint contexts', () => {
    const sets = { ops: ['did:key:a'] }
    expect(
      refused(
        [
          { taskType: CREATE, requires: 'reauth' },
          { taskType: CREATE, requires: 'reauth' },
        ],
        sets
      )
    ).toBe('OverlappingRules')
    expect(
      refused(
        [
          { taskType: CREATE, requires: 'reauth', contexts: ['a'] },
          { taskType: CREATE, requires: 'reauth', contexts: ['a', 'b'] },
        ],
        sets
      )
    ).toBe('OverlappingRules')
    expect(
      refused(
        [
          { taskType: CREATE, requires: 'reauth', contexts: ['a'] },
          { taskType: CREATE, requires: 'consent', approverSet: 'ops', contexts: ['b'] },
        ],
        sets
      )
    ).toBe('accepted')
  })
})
