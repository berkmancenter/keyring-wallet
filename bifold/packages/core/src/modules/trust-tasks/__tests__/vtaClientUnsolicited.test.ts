/**
 * What the agent sends of its own accord is never the answer to a task.
 *
 * Push finding F3 (09-29, iPhone 11, the push-test agent): a consent request
 * for this phone was delivered and collected, and no approval ever showed.
 * The app had just come to the foreground and sent its heartbeat; the client,
 * waiting for that answer, took the next message — the consent request,
 * minted 4 s before the heartbeat — as the heartbeat's reply, so it never
 * reached the agent home. Any consent request that lands while a task waits
 * went the same way.
 */
import { VTA_TASK, VtaClient } from '../module/VtaClient'

const nowSec = () => Math.floor(Date.now() / 1000)
const message = (body: Record<string, unknown>, createdAgo = 0) => ({
  id: `urn:uuid:${Math.random().toString(16).slice(2)}`,
  type: 'https://trusttasks.org/binding/didcomm/v2',
  from: 'did:webvh:agent',
  created_time: nowSec() - createdAgo,
  body,
})

function waitingClient() {
  const onInbound = jest.fn()
  const client = new VtaClient({} as never, 'did:webvh:agent', {} as never, { onInbound })
  const resolve = jest.fn()
  const internals = client as unknown as {
    pending?: { resolve: (m: unknown) => void; sentAt: number }
    deliver: (m: unknown) => void
  }
  internals.pending = { resolve, sentAt: Date.now() }
  return { onInbound, resolve, deliver: (m: unknown) => internals.deliver(m), internals }
}

describe('a message the agent sends of its own accord, while a task waits for its answer', () => {
  it('a consent request goes to the approvals, not to the waiting task', () => {
    const { onInbound, resolve, deliver, internals } = waitingClient()
    const request = message({ type: VTA_TASK.consentRequest, payload: { challenge: 'c'.repeat(32) } }, 4)
    deliver(request)
    expect(onInbound).toHaveBeenCalledWith(request)
    expect(resolve).not.toHaveBeenCalled()
    // The task still waits for its own answer, and gets it.
    expect(internals.pending).toBeDefined()
    const answer = message({ type: 'https://trusttasks.org/spec/device/heartbeat/0.2', payload: { ok: true } })
    deliver(answer)
    expect(resolve).toHaveBeenCalledWith(answer)
  })

  it('so does a step-up approve-request, of either version', () => {
    for (const v of ['0.1', '0.2']) {
      const { onInbound, resolve, deliver } = waitingClient()
      const request = message({ type: `https://trusttasks.org/spec/auth/step-up/approve-request/${v}`, payload: {} })
      deliver(request)
      expect(onInbound).toHaveBeenCalledWith(request)
      expect(resolve).not.toHaveBeenCalled()
    }
  })

  it('an answer is still the answer', () => {
    const { onInbound, resolve, deliver } = waitingClient()
    const answer = message({ type: 'https://trusttasks.org/spec/acl/list/0.1', payload: { entries: [] } })
    deliver(answer)
    expect(resolve).toHaveBeenCalledWith(answer)
    expect(onInbound).not.toHaveBeenCalled()
  })
})
