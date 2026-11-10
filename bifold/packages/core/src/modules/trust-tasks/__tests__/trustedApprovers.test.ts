import { EMPTY_APPROVALS, withPhoneRule } from '../module/approvalRules'
import {
  TRUSTED_SET,
  TrustedRuleRefused,
  trustedApproversView,
  withTrustedApproverReplaced,
  withTrustedApprovers,
} from '../module/trustedApprovers'

const SPEC = 'https://trusttasks.org/spec/'
const ME = 'did:peer:2.this-phone'
const JORDAN = 'did:peer:2.jordans-phone'
const RILEY = 'did:peer:2.rileys-phone'

describe('trusted approvers', () => {
  it('names the approver in one set, and holds each chosen action for one approval, never the requester own', () => {
    const row = withTrustedApprovers(EMPTY_APPROVALS, [JORDAN], ['shareCredential', 'joinCommunity'])
    expect(row.sets).toEqual({ [TRUSTED_SET]: [JORDAN] })
    expect(row.rules).toEqual([
      {
        taskType: `${SPEC}vault/credentials/present/0.1`,
        requires: 'consent',
        approverSet: TRUSTED_SET,
        minApprovals: 1,
        excludeRequester: true,
      },
      ...['1.2', '1.1', '1.0'].map((v) => ({
        taskType: `${SPEC}vta/webvh/dids/create/${v}`,
        requires: 'consent',
        approverSet: TRUSTED_SET,
        minApprovals: 1,
        excludeRequester: true,
      })),
    ])
    expect(trustedApproversView(row)).toEqual({
      approvers: [JORDAN],
      keys: ['shareCredential', 'joinCommunity'],
      heldElsewhere: [],
    })
  })

  it('keeps the phone own rules and other sets exactly as they were', () => {
    const phone = withPhoneRule(EMPTY_APPROVALS, `${SPEC}vta/contexts/create/1.0`, true, ME)
    const before = { rules: phone.rules, sets: { ...phone.sets, ops: ['did:key:z6Mkops'] } }
    const row = withTrustedApprovers(before, [JORDAN], ['joinCommunity'])
    expect(row.rules.slice(0, before.rules.length)).toEqual(before.rules)
    expect(row.sets).toMatchObject(before.sets)
    // Control: removing the trusted approver leaves the row as it was.
    expect(withTrustedApprovers(row, [], [])).toEqual(before)
  })

  it('writes only the versions the agent dispatches, when it is known', () => {
    const row = withTrustedApprovers(EMPTY_APPROVALS, [JORDAN], ['addDevice'], [`${SPEC}acl/grant/0.2`])
    expect(row.rules.map((r) => r.taskType)).toEqual([`${SPEC}acl/grant/0.2`])
    // VTI main 887370a3b dispatches acl/grant only at 0.3: the rule is written there, not for nothing.
    const main = withTrustedApprovers(EMPTY_APPROVALS, [JORDAN], ['addDevice'], [`${SPEC}acl/grant/0.3`])
    expect(main.rules.map((r) => r.taskType)).toEqual([`${SPEC}acl/grant/0.3`])
    // Unknown: every listed version.
    const all = withTrustedApprovers(EMPTY_APPROVALS, [JORDAN], ['addDevice'])
    expect(all.rules.map((r) => r.taskType)).toEqual([
      `${SPEC}acl/grant/0.3`,
      `${SPEC}acl/grant/0.2`,
      `${SPEC}acl/grant/0.1`,
    ])
  })

  it('replaces its own rules rather than adding to them, and keeps each approver once', () => {
    const first = withTrustedApprovers(EMPTY_APPROVALS, [JORDAN], ['shareCredential', 'joinCommunity'])
    const second = withTrustedApprovers(first, [JORDAN, RILEY, JORDAN], ['joinCommunity'])
    expect(second.rules.map((r) => r.taskType).every((u) => u.includes('dids/create'))).toBe(true)
    expect(second.rules).toHaveLength(3)
    expect(second.sets[TRUSTED_SET]).toEqual([JORDAN, RILEY])
  })

  it('refuses an action another rule already holds, and says which', () => {
    const elsewhere = {
      rules: [{ taskType: `${SPEC}vta/webvh/dids/create/1.1`, requires: 'consent' as const, approverSet: 'ops' }],
      sets: { ops: ['did:key:z6Mkops'] },
    }
    expect(() => withTrustedApprovers(elsewhere, [JORDAN], ['joinCommunity'])).toThrow(TrustedRuleRefused)
    expect(trustedApproversView(elsewhere).heldElsewhere).toEqual(['joinCommunity'])
    // Control: an action no other rule holds is accepted on the same row.
    expect(withTrustedApprovers(elsewhere, [JORDAN], ['shareCredential']).rules).toHaveLength(2)
  })

  it('refuses an approver that is not a DID, and an action it does not know', () => {
    expect(() => withTrustedApprovers(EMPTY_APPROVALS, ['jordan'], ['joinCommunity'])).toThrow(/not-a-did/)
    expect(() => withTrustedApprovers(EMPTY_APPROVALS, [JORDAN], ['launchRockets' as never])).toThrow(/unknown-action/)
  })

  it('never holds the routine key borrow, whatever is chosen', () => {
    // The phone borrows persona keys again on its own (fetched when needed, a rotation): a rule there would ask
    // the approver about routine work. Control: joining a community is held, through the persona mint.
    const row = withTrustedApprovers(
      EMPTY_APPROVALS,
      [JORDAN],
      ['shareCredential', 'joinCommunity', 'addDevice', 'changeApprovers']
    )
    expect(row.rules.map((r) => r.taskType)).not.toContain(`${SPEC}keys/export-secret/0.1`)
    expect(row.rules.map((r) => r.taskType)).toContain(`${SPEC}vta/webvh/dids/create/1.2`)
  })

  it('follows an approver whose phone swapped its key, and says when nothing changed', () => {
    const row = withTrustedApprovers(EMPTY_APPROVALS, [JORDAN], ['joinCommunity'])
    const swapped = withTrustedApproverReplaced(row, JORDAN, 'did:peer:2.jordans-new-key')
    expect(swapped.changed).toBe(true)
    expect(swapped.sets[TRUSTED_SET]).toEqual(['did:peer:2.jordans-new-key'])
    expect(withTrustedApproverReplaced(row, RILEY, 'did:peer:2.x').changed).toBe(false)
  })
})
