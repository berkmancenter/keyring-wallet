import { mayApprove } from '../module/afterStepDown'

const UPSERT = 'https://trusttasks.org/spec/policy/upsert/0.3'
const JOIN = 'https://trusttasks.org/spec/vtc/membership/join/0.1'

describe('after a step-down, only a change to who approves can be approved (278.22 deadlock, 11-16)', () => {
  test('stop-asked: a change to who approves yes, anything else no (control: not stop-asked, anything)', () => {
    const stopped = { forAgent: { stopAsked: true as const } }
    expect(mayApprove({ ...stopped, taskType: UPSERT })).toBe(true)
    expect(mayApprove({ ...stopped, taskType: 'https://trusttasks.org/spec/policy/upsert/0.2' })).toBe(true)
    expect(mayApprove({ ...stopped, taskType: JOIN })).toBe(false)
    expect(mayApprove({ ...stopped })).toBe(false)
    expect(mayApprove({ taskType: JOIN })).toBe(true)
    expect(mayApprove({ taskType: JOIN, forAgent: {} })).toBe(true)
  })
})
