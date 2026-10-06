/**
 * Answering a consent request, bounded (al-phone, 10-05): the agent never took
 * an Approve, and the phone waited with Approve and Deny dimmed, saying nothing.
 */
import { APPROVE_REASON, VtaAgentController } from '../module/vtaAgent'
import { OwnerNotConfirmed } from '../module/vtaOwner'

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

const confirmed = () => jest.fn(async () => ({ ok: true as const }))

const controllerWith = (decideConsent: jest.Mock, deadlineMs = 20, confirmOwner: jest.Mock = confirmed()) => {
  const vta = new VtaAgentController()
  vta.configure({ decisionDeadlineMs: deadlineMs, confirmOwner } as never)
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

  // Alberto's iPhone, 10-06: Approve asked for nothing, as Remove and Rename do.
  describe('the owner check', () => {
    it('Approve asks for Face ID, a fingerprint or the passcode first, then sends', async () => {
      const order: string[] = []
      const confirmOwner = jest.fn(async () => {
        order.push('confirm')
        return { ok: true as const }
      })
      const decideConsent = jest.fn(async () => {
        order.push('send')
        return { status: 'granted' }
      })
      const vta = controllerWith(decideConsent, 20, confirmOwner)
      await vta.decide('a', 'approve')
      expect(confirmOwner).toHaveBeenCalledWith(APPROVE_REASON)
      expect(order).toEqual(['confirm', 'send'])
      expect(vta.getState().approvals[0]).toMatchObject({ status: 'approved' })
    })

    it('not confirmed: nothing is sent, and the request still waits — it did not fail', async () => {
      const decideConsent = jest.fn(async () => ({ status: 'granted' }))
      const vta = controllerWith(
        decideConsent,
        20,
        jest.fn(async () => ({ ok: false as const, reason: 'cancelled' as const }))
      )
      await expect(vta.decide('a', 'approve')).rejects.toBeInstanceOf(OwnerNotConfirmed)
      expect(decideConsent).not.toHaveBeenCalled()
      expect(vta.getState().approvals[0]).toMatchObject({ status: 'pending' })
      expect(vta.getState().approvals[0]).not.toHaveProperty('error')
    })

    it('Decline grants nothing and stays one tap: no check', async () => {
      const confirmOwner = confirmed()
      const vta = controllerWith(
        jest.fn(async () => ({ status: 'denied' })),
        20,
        confirmOwner
      )
      await vta.decide('a', 'deny')
      expect(confirmOwner).not.toHaveBeenCalled()
      expect(vta.getState().approvals[0]).toMatchObject({ status: 'denied' })
    })
  })
})
