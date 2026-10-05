/**
 * Answering a consent request, bounded (al-phone, 10-05): the agent never took
 * an Approve, and the phone waited with Approve and Deny dimmed, saying nothing.
 */
import { VtaAgentController } from '../module/vtaAgent'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const approval = {
  id: 'a',
  challenge: 'c'.repeat(32),
  payloadDigest: 'zQmDigestDigestDigestDigest',
  status: 'pending',
  requester: 'did:peer:2.requester',
  taskType: 'https://trusttasks.org/spec/vta/contexts/create/1.0',
  expiresAt: '2099-01-01T00:00:00Z',
}

const controllerWith = (decideConsent: jest.Mock, deadlineMs = 20) => {
  const vta = new VtaAgentController()
  vta.configure({ decisionDeadlineMs: deadlineMs } as never)
  const internals = vta as unknown as {
    current?: { client: unknown; vtaDid: string }
    set(next: Record<string, unknown>): void
  }
  internals.current = { client: { decideConsent }, vtaDid: 'did:webvh:vta' }
  internals.set({ approvals: [approval] })
  return vta
}

describe('answering a consent request', () => {
  it('an answer the agent never takes is "failed" at the deadline, with why, not a wait for ever', async () => {
    const vta = controllerWith(jest.fn(() => new Promise(() => undefined)))
    await expect(vta.decide('a', 'approve')).rejects.toThrow(/did not take the decision/)
    expect(vta.getState().approvals[0]).toMatchObject({ status: 'failed', error: expect.stringMatching(/within/) })
  })

  it("the agent's own refusal is kept as the reason", async () => {
    const vta = controllerWith(jest.fn(async () => Promise.reject(new Error('task-consent/decision:noPending'))))
    await expect(vta.decide('a', 'deny')).rejects.toThrow('noPending')
    expect(vta.getState().approvals[0]).toMatchObject({ status: 'failed', error: 'task-consent/decision:noPending' })
  })

  it('an answer taken in time is recorded as decided', async () => {
    const vta = controllerWith(jest.fn(async () => ({ status: 'granted' })))
    await vta.decide('a', 'approve')
    expect(vta.getState().approvals[0]).toMatchObject({ status: 'approved' })
  })
})
