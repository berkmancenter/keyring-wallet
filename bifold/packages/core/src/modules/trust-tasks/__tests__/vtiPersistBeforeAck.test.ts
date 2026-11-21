/**
 * Persist before ack. The mediator drops its copy of a message when it is
 * acknowledged, and a community sends a membership credential once: nothing
 * gets it again (VTI-Q27). So the session tells the mediator a message was
 * taken only after the consumer has stored it — and not at all when the
 * consumer fails, so the message comes back.
 *
 * Found 2026-09-25: the session called `onMessage` without waiting and
 * acknowledged at once, and every inbox handler fired its store as `void`,
 * so a wallet stopped in between had acknowledged a credential it never kept.
 */
import { VtiMediatorSession, type VtiClientIdentity, type VtiMediatorEndpoints } from '../module/VtiMediatorTransport'

jest.mock('@bifold/trust-tasks', () => ({
  tsp: { CODEC_FORMS_RELATIONSHIPS: true, peekRevision: () => ({ minor: 0 }), isTspFrameText: () => false },
  TRUST_TASK_V2_ENVELOPE_TYPE: 'https://trusttasks.org/binding/didcomm/0.1/envelope',
}))

const identity: VtiClientIdentity = {
  did: 'did:peer:2:member',
  kid: 'did:peer:2:member#key-2',
  senderKey: {} as never,
}
const mediator: VtiMediatorEndpoints = {
  did: 'did:peer:2:mediator',
  authEndpoint: 'https://mediator.example/mediator/v1',
  wsEndpoint: 'wss://mediator.example/mediator/v1/ws',
  publicJwk: {} as never,
  kid: 'did:peer:2:mediator#key-1',
}
const agent = {
  config: { logger: { info: () => undefined, debug: () => undefined, warn: () => undefined, error: () => undefined } },
} as never

const ISSUE = {
  type: 'https://trusttasks.org/spec/credential-exchange/issue/0.1',
  from: 'did:webvh:community',
  id: 'issue-1',
  body: {},
}
const DELIVERY = 'https://didcomm.org/messagepickup/3.0/delivery'

/** A session whose decrypt step returns `plaintext`, with every ack recorded in order. */
function sessionWith(onMessage: (m: unknown) => void | Promise<void>, plaintext: Record<string, unknown> = ISSUE) {
  const events: string[] = []
  const onError = jest.fn()
  const session = new VtiMediatorSession(agent, identity, mediator, {
    onMessage: onMessage as never,
    onError,
  })
  const internals = session as unknown as {
    unpack: (jwe: unknown) => Promise<unknown>
    acknowledge: (ids: string[]) => Promise<void>
    handleFrame: (raw: string) => Promise<void>
    handleDelivery: (d: unknown) => Promise<void>
  }
  internals.unpack = async () => plaintext
  const acknowledge = jest.fn(async (ids: string[]) => {
    events.push(`ack:${ids.join(',')}`)
  })
  internals.acknowledge = acknowledge
  const frame = JSON.stringify({ protected: 'e30', ciphertext: 'x' })
  const receive = () => internals.handleFrame(frame)
  return { receive, internals, acknowledge, events, onError }
}

describe('the mediator session acknowledges only what was taken', () => {
  it('waits for the consumer to finish before acknowledging a live delivery', async () => {
    let finish!: () => void
    const stored = new Promise<void>((resolve) => (finish = resolve))
    const s = sessionWith(async () => {
      await stored
      s.events.push('stored')
    })
    const receiving = s.receive()
    await new Promise((resolve) => setTimeout(resolve, 10))
    // Still storing: the mediator must not have been told yet.
    expect(s.acknowledge).not.toHaveBeenCalled()
    finish()
    await receiving
    expect(s.events).toEqual(['stored', expect.stringMatching(/^ack:/)])
  })

  it('does not acknowledge a message the consumer failed to store, and takes its redelivery afresh', async () => {
    let attempts = 0
    const s = sessionWith(async () => {
      attempts++
      if (attempts === 1) throw new Error('store unavailable')
    })
    await s.receive()
    expect(s.acknowledge).not.toHaveBeenCalled()
    expect(s.onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'store unavailable' }))
    // The mediator delivers it again. It was never taken, so it is not a
    // duplicate to wave through: the consumer runs, and only then the ack.
    await s.receive()
    expect(attempts).toBe(2)
    expect(s.acknowledge).toHaveBeenCalledTimes(1)
  })

  it('in a pickup delivery, acknowledges the stored messages and leaves the failed one queued', async () => {
    const byId: Record<string, Record<string, unknown>> = {
      a: { ...ISSUE, id: 'a' },
      b: { ...ISSUE, id: 'b' },
    }
    const s = sessionWith(async (m) => {
      if ((m as { id: string }).id === 'b') throw new Error('store unavailable')
    })
    s.internals.unpack = async (jwe) => byId[(jwe as { marker: string }).marker]
    const attach = (id: string) => ({ id, data: { json: { marker: id, protected: 'e30' } } })
    await s.internals.handleDelivery({ type: DELIVERY, attachments: [attach('a'), attach('b')] })
    expect(s.acknowledge).toHaveBeenCalledTimes(1)
    expect(s.acknowledge).toHaveBeenCalledWith(['a'])
  })
})

describe('the inbox fails the delivery when a handler fails', () => {
  // The controller's own dispatch: every handler runs, and any failure is the
  // delivery's, so the session withholds the ack.
  const load = () => (require('../module/vtiAgent') as typeof import('../module/vtiAgent')).vtiAgent
  const deliver = (a: unknown, m: unknown) => (a as { deliver: (m: unknown) => Promise<void> }).deliver(m)

  it('resolves only after every handler has stored', async () => {
    const vtiAgent = load()
    const order: string[] = []
    const stop = vtiAgent.onInbound(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      order.push('stored')
    })
    try {
      await deliver(vtiAgent, ISSUE)
      order.push('delivered')
      expect(order).toEqual(['stored', 'delivered'])
    } finally {
      stop()
    }
  })

  it('runs every handler, then fails if any failed', async () => {
    const vtiAgent = load()
    const second = jest.fn(async () => undefined)
    const stopA = vtiAgent.onInbound(async () => {
      throw new Error('store unavailable')
    })
    const stopB = vtiAgent.onInbound(second)
    try {
      await expect(deliver(vtiAgent, ISSUE)).rejects.toThrow(/left on the mediator for redelivery: store unavailable/)
      expect(second).toHaveBeenCalledTimes(1)
    } finally {
      stopA()
      stopB()
    }
  })
})
