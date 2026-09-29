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

// The ids the waiting task sent: its DIDComm message, its document, its thread.
const SENT = { envelopeId: 'urn:uuid:envelope-hb', docId: 'urn:uuid:doc-hb', threadId: 'urn:uuid:thread-hb' }

function waitingClient() {
  const onInbound = jest.fn()
  const warn = jest.fn()
  const client = new VtaClient(
    { config: { logger: { warn, info: jest.fn(), debug: jest.fn() } } } as never,
    'did:webvh:agent',
    {} as never,
    {
      onInbound,
    }
  )
  const resolve = jest.fn()
  const internals = client as unknown as {
    pending?: { resolve: (m: unknown) => void; sentAt: number; ids: Set<string> }
    deliver: (m: unknown) => void
  }
  internals.pending = { resolve, sentAt: Date.now(), ids: new Set(Object.values(SENT)) }
  return { onInbound, resolve, warn, deliver: (m: unknown) => internals.deliver(m), internals }
}
const reply = (
  body: Record<string, unknown>,
  thread: { thid?: string; threadId?: string } = { thid: SENT.envelopeId }
) => ({
  ...message({ ...body, ...(thread.threadId ? { threadId: thread.threadId } : {}) }),
  ...(thread.thid ? { thid: thread.thid } : {}),
})
const HEARTBEAT = 'https://trusttasks.org/spec/device/heartbeat/0.2'

describe('a message the agent sends of its own accord, while a task waits for its answer', () => {
  it('a consent request goes to the approvals, not to the waiting task', () => {
    const { onInbound, resolve, deliver, internals } = waitingClient()
    const request = message({ type: VTA_TASK.consentRequest, payload: { challenge: 'c'.repeat(32) } }, 4)
    deliver(request)
    expect(onInbound).toHaveBeenCalledWith(request)
    expect(resolve).not.toHaveBeenCalled()
    // The task still waits for its own answer, and gets it.
    expect(internals.pending).toBeDefined()
    const answer = reply({ type: HEARTBEAT, payload: { ok: true } })
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
    const answer = reply({ type: 'https://trusttasks.org/spec/acl/list/0.1', payload: { entries: [] } })
    deliver(answer)
    expect(resolve).toHaveBeenCalledWith(answer)
    expect(onInbound).not.toHaveBeenCalled()
  })
})

// Upstream threads every reply to its request: the DIDComm reply's `thid` names
// the request message (vta-service messaging/service.rs:673-677), and the reply
// document's `threadId` names the request (vta-mobile-core reply.rs:124-203).
describe('a reply is matched to its request by thread', () => {
  it('matched by the reply message thid', () => {
    const { resolve, deliver } = waitingClient()
    const answer = reply({ type: HEARTBEAT }, { thid: SENT.envelopeId })
    deliver(answer)
    expect(resolve).toHaveBeenCalledWith(answer)
  })

  it('matched by the reply document threadId, as a TSP reply carries it', () => {
    const { resolve, deliver } = waitingClient()
    const answer = reply({ type: HEARTBEAT }, { threadId: SENT.docId })
    deliver(answer)
    expect(resolve).toHaveBeenCalledWith(answer)
  })

  it("a stale reply to an earlier task is not this task's answer", () => {
    const { onInbound, resolve, deliver, internals } = waitingClient()
    const stale = reply(
      { type: 'https://trusttasks.org/spec/acl/list/0.1' },
      { thid: 'urn:uuid:envelope-of-an-earlier-task' }
    )
    deliver(stale)
    expect(resolve).not.toHaveBeenCalled()
    expect(onInbound).toHaveBeenCalledWith(stale)
    expect(internals.pending).toBeDefined()
  })

  it('a reply with no thread at all falls back to arriving next, and says so', () => {
    const { resolve, warn, deliver } = waitingClient()
    const unthreaded = message({ type: HEARTBEAT })
    deliver(unthreaded)
    expect(resolve).toHaveBeenCalledWith(unthreaded)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no thread'))
  })

  it('an unthreaded message older than the request is still not its answer', () => {
    const { onInbound, resolve, deliver } = waitingClient()
    const old = message({ type: HEARTBEAT }, 60)
    deliver(old)
    expect(resolve).not.toHaveBeenCalled()
    expect(onInbound).toHaveBeenCalledWith(old)
  })
})
