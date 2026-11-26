/**
 * The proposer's VRC delivery after the acceptance (deliverAfterAcceptance, ceremony.ts): when it fails, the flow ends
 * as an error at once, so the overlay says "didn't complete" now rather than after the stall timeout. A send the
 * mailbox refused is the case that found it (2026-11-22). Only while the status is still this delivery's.
 */
import { deliverAfterAcceptance } from '../ceremony'
import { vrcFlowStore } from '../../vrc/witnessStatusStore'

const settle = async () => {
  for (let i = 0; i < 6; i++) await new Promise((resolve) => setImmediate(resolve))
}

function fakeAgent(getById: () => Promise<unknown>) {
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
  const agent = {
    config: { logger },
    context: {},
    modules: { didcomm: { connections: { getById: jest.fn(getById) } } },
  }
  return { agent: agent as never, logger }
}

afterEach(() => {
  vrcFlowStore.clearFlow('c-1')
})

describe('the delivery after the acceptance failing', () => {
  test('while the flow is still preparing: it ends as an error, said in the log', async () => {
    const { agent, logger } = fakeAgent(async () => {
      throw new Error('[TrustTasks:WalletMailbox] no mailbox is open to send through')
    })
    vrcFlowStore.setStatus('c-1', 'preparing-offer', false)
    deliverAfterAcceptance(agent, 'c-1', 'ex-1', true)
    await settle()
    expect(vrcFlowStore.flowEndedWith('c-1')).toBe('error')
    expect(vrcFlowStore.getStatus('c-1')).toBe('idle')
    expect(logger.error.mock.calls.map((c) => String(c[0]))).toEqual([
      expect.stringMatching(/VRC delivery after acceptance failed: .*no mailbox is open/),
    ])
  })

  test('CONTROL: when the status is no longer this delivery’s (already issued, offer sent), nothing is ended', async () => {
    const { agent } = fakeAgent(async () => {
      throw new Error('no mailbox is open to send through')
    })
    vrcFlowStore.setStatus('c-1', 'offer-sent', false)
    deliverAfterAcceptance(agent, 'c-1', 'ex-2', true)
    await settle()
    expect(vrcFlowStore.getStatus('c-1')).toBe('offer-sent')
    expect(vrcFlowStore.flowEndedWith('c-1')).toBeUndefined()
  })

  test('CONTROL: a delivery that does not throw ends nothing by itself', async () => {
    // A connection with no DIDs makes the delivery return "skipped" without throwing: the status is left to the
    // acceptance path, as before.
    const { agent, logger } = fakeAgent(async () => ({ id: 'c-1' }))
    vrcFlowStore.setStatus('c-1', 'preparing-offer', false)
    deliverAfterAcceptance(agent, 'c-1', 'ex-3', true)
    await settle()
    expect(vrcFlowStore.getStatus('c-1')).toBe('preparing-offer')
    expect(vrcFlowStore.flowEndedWith('c-1')).toBeUndefined()
    expect(logger.error).not.toHaveBeenCalled()
  })
})
