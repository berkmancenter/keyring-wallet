/**
 * A VtaClient's connect goes on when the mediator has handed over its queue, with the old fixed wait as the ceiling
 * (connectDrainSwitch).
 *
 * After the socket opened, connect always waited 2000 ms so that stale replies queued for this DID were taken before
 * the first ask: the largest single step of connecting to the agent at every launch (DDTB-QVVX, GH5F-WDE3, 11-17).
 * The session below is a fake whose `firstDrained` the test settles.
 */
const VTA = 'did:webvh:vta'
const PHONE = 'did:peer:2.phone'
const ENVELOPE = 'https://trusttasks.org/binding/didcomm/0.1/envelope'
const WHOAMI = 'https://trusttasks.org/spec/auth/whoami/0.1'

const mockDrain: { answered: () => void; has: boolean; onMessage?: (m: unknown) => void; sent: unknown[] } = {
  answered: () => undefined,
  has: true,
  sent: [],
}

jest.mock('@bifold/trust-tasks', () => ({
  TRUST_TASK_V2_ENVELOPE_TYPE: 'https://trusttasks.org/binding/didcomm/0.1/envelope',
  tsp: { CODEC_FORMS_RELATIONSHIPS: false },
  signDocumentProof: jest.fn(async (_a: unknown, doc: Record<string, unknown>) => doc),
  signCompactJws: jest.fn(async () => 'header.payload.sig'),
}))
jest.mock('../module/tspCapability', () => ({ chooseCarriage: jest.fn(async () => 'didcomm') }))
jest.mock('../module/vtaReplyProof', () => ({ checkVtaReply: jest.fn(async () => ({ kind: 'unsigned' })) }))
jest.mock('../module/vtiTsp', () => ({
  tspSessionForManager: jest.fn(async () => {
    throw new Error('no TSP in this test')
  }),
  packTrustTaskForPeer: jest.fn(),
  unpackTrustTaskFromPeer: jest.fn(),
}))
jest.mock('../module/VtiMediatorTransport', () => ({
  createVtiClientDid: jest.fn(async () => 'did:peer:2.phone'),
  resolveVtiMediator: jest.fn(async (_a: unknown, did: string) => ({ did })),
  resolveDidDocumentRetrying: jest.fn(async () => ({
    service: [{ type: 'DIDCommMessaging', serviceEndpoint: 'did:peer:2.mediator' }],
  })),
  vtiClientIdentityFromDid: jest.fn(async (_a: unknown, did: string) => ({ did })),
  VtiMediatorSession: class {
    isOpen = false
    firstDrained?: () => Promise<void>
    constructor(_agent: unknown, _identity: unknown, _m: unknown, opts: { onMessage: (m: unknown) => void }) {
      mockDrain.onMessage = opts.onMessage
      // A session of a build before this one has no such method: `has` false models it.
      if (mockDrain.has) {
        const drained = new Promise<void>((resolve) => {
          mockDrain.answered = resolve
        })
        this.firstDrained = () => drained
      }
    }
    async start() {
      this.isOpen = true
    }
    async stop() {
      this.isOpen = false
    }
    async sendTo(_to: string, message: unknown) {
      mockDrain.sent.push(message)
    }
  },
}))

import { CONNECT_DRAIN_EARLY, isConnectDrainEarlyOn } from '../module/connectDrainSwitch'
import { VtaClient } from '../module/VtaClient'

const logger = { warn: jest.fn(), info: jest.fn(), debug: jest.fn(), error: jest.fn() }
const store = { getManager: jest.fn(async () => ({ vtaDid: VTA, did: PHONE, createdAt: 't' })) }
const newClient = () => new VtaClient({ config: { logger } } as never, VTA, store as never, {})
const said = () =>
  logger.info.mock.calls.map((c) => String(c[0])).filter((line) => line.includes('connect: the mediator'))

/** Start a connect and report when it settles, in ms of the fake clock since it began. */
function connecting(client: VtaClient) {
  const began = Date.now()
  let doneAt: number | undefined
  const done = client.connect().then(() => void (doneAt = Date.now() - began))
  return { done, doneAt: () => doneAt }
}

const SHIPPED = { ...CONNECT_DRAIN_EARLY }
beforeEach(() => {
  jest.useFakeTimers()
  mockDrain.has = true
  mockDrain.sent = []
  logger.info.mockClear()
})
afterEach(() => {
  jest.useRealTimers()
  Object.assign(CONNECT_DRAIN_EARLY, SHIPPED)
})

describe('what the release ships', () => {
  it('is on, and not killed', () => {
    expect(SHIPPED).toEqual({ on: true, remoteOff: false })
    expect(isConnectDrainEarlyOn()).toBe(true)
  })
})

describe('the wait after the socket opens', () => {
  it('ends when the mediator has handed over its queue, and says how long that took', async () => {
    const c = connecting(newClient())
    await jest.advanceTimersByTimeAsync(300)
    expect(c.doneAt()).toBeUndefined()
    mockDrain.answered()
    await jest.advanceTimersByTimeAsync(0)
    expect(c.doneAt()).toBe(300)
    expect(said()).toEqual([expect.stringMatching(/handed over its queue in 300 ms; going on$/)])
  })

  it('CONTROL: a mediator that never answers costs the whole 2 s, as before, and that is said', async () => {
    const c = connecting(newClient())
    await jest.advanceTimersByTimeAsync(1999)
    expect(c.doneAt()).toBeUndefined()
    await jest.advanceTimersByTimeAsync(1)
    expect(c.doneAt()).toBe(2000)
    expect(said()).toEqual([expect.stringMatching(/did not answer the queue request within 2000 ms; going on$/)])
  })

  it('an answer after the ceiling changes nothing', async () => {
    const c = connecting(newClient())
    await jest.advanceTimersByTimeAsync(2000)
    mockDrain.answered()
    await jest.advanceTimersByTimeAsync(0)
    expect(c.doneAt()).toBe(2000)
    expect(said()).toHaveLength(1)
  })

  it('a session with no such signal waits the whole time, and says nothing new', async () => {
    mockDrain.has = false
    const c = connecting(newClient())
    await jest.advanceTimersByTimeAsync(1999)
    expect(c.doneAt()).toBeUndefined()
    await jest.advanceTimersByTimeAsync(1)
    expect(c.doneAt()).toBe(2000)
    expect(said()).toEqual([])
  })
})

describe('the switch', () => {
  it.each([
    ['remoteOff', { remoteOff: true }],
    ['on false', { on: false }],
    ['on not a boolean', { on: 'true' }],
  ])('%s: the whole 2 s, even when the mediator answered at once', async (_name, values) => {
    Object.assign(CONNECT_DRAIN_EARLY, values)
    expect(isConnectDrainEarlyOn()).toBe(false)
    const c = connecting(newClient())
    await jest.advanceTimersByTimeAsync(0)
    mockDrain.answered()
    await jest.advanceTimersByTimeAsync(1999)
    expect(c.doneAt()).toBeUndefined()
    await jest.advanceTimersByTimeAsync(1)
    expect(c.doneAt()).toBe(2000)
    expect(said()).toEqual([])
  })
})

describe('a stale reply that arrives after the wait ended early', () => {
  it('answers no ask of this session: the first ask still waits for its own answer', async () => {
    const client = newClient()
    const c = connecting(client)
    await jest.advanceTimersByTimeAsync(50) // the session exists and has started
    mockDrain.answered()
    await jest.advanceTimersByTimeAsync(0)
    await c.done
    expect(c.doneAt()).toBe(50)
    let answer: unknown
    const asked = client.whoAmI(5000).then(
      (a) => void (answer = a),
      (e) => void (answer = e)
    )
    await jest.advanceTimersByTimeAsync(0)
    expect(mockDrain.sent).toHaveLength(1)
    const sent = mockDrain.sent[0] as { body: { threadId: string } }
    // A reply to an ask of an earlier session, taken late: another thread.
    mockDrain.onMessage?.({
      type: ENVELOPE,
      created_time: Math.floor(Date.now() / 1000),
      body: { type: `${WHOAMI}#response`, threadId: 'urn:uuid:an-earlier-session', payload: { did: 'did:peer:2.old' } },
    })
    await jest.advanceTimersByTimeAsync(10)
    expect(answer).toBeUndefined()
    // One with no thread at all, made well before this ask (an agent that does not thread): not taken either.
    mockDrain.onMessage?.({
      type: ENVELOPE,
      created_time: Math.floor(Date.now() / 1000) - 60,
      body: { type: `${WHOAMI}#response`, payload: { did: 'did:peer:2.old' } },
    })
    await jest.advanceTimersByTimeAsync(10)
    expect(answer).toBeUndefined()
    // Its own answer, on its own thread, is the one it takes.
    mockDrain.onMessage?.({
      type: ENVELOPE,
      created_time: Math.floor(Date.now() / 1000),
      body: { type: `${WHOAMI}#response`, threadId: sent.body.threadId, payload: { did: PHONE } },
    })
    await jest.advanceTimersByTimeAsync(10)
    await asked
    expect(answer).toMatchObject({ did: PHONE })
  })

  describe('a reply with no thread and no time, from an agent that does not thread', () => {
    const untimed = () =>
      mockDrain.onMessage?.({
        type: ENVELOPE,
        body: { type: `${WHOAMI}#response`, payload: { did: 'did:peer:2.old' } },
      })
    /** Connect, with the wait ending at `at` ms (or at the ceiling when undefined), then ask whoami. */
    async function askedAfter(at: number | undefined) {
      const client = newClient()
      const c = connecting(client)
      if (at === undefined) await jest.advanceTimersByTimeAsync(2000)
      else {
        await jest.advanceTimersByTimeAsync(at)
        mockDrain.answered()
        await jest.advanceTimersByTimeAsync(0)
      }
      await c.done
      let answer: unknown
      void client.whoAmI(5000).then(
        (a) => void (answer = a),
        (e) => void (answer = e)
      )
      await jest.advanceTimersByTimeAsync(0)
      return { answer: () => answer }
    }

    it('is not taken while the drain may still be arriving (the wait ended early)', async () => {
      const a = await askedAfter(100)
      untimed()
      await jest.advanceTimersByTimeAsync(10)
      expect(a.answer()).toBeUndefined()
    })

    it('CONTROL: once the whole drain time has passed, it is taken as before', async () => {
      const a = await askedAfter(100)
      await jest.advanceTimersByTimeAsync(1900) // 2000 ms since the wait began
      untimed()
      await jest.advanceTimersByTimeAsync(10)
      expect(a.answer()).toMatchObject({ did: 'did:peer:2.old' })
    })

    it('CONTROL: when the wait ran its whole time, it is taken as before', async () => {
      const a = await askedAfter(undefined)
      untimed()
      await jest.advanceTimersByTimeAsync(10)
      expect(a.answer()).toMatchObject({ did: 'did:peer:2.old' })
    })

    it('CONTROL: with the switch off, it is taken as before', async () => {
      CONNECT_DRAIN_EARLY.remoteOff = true
      const a = await askedAfter(undefined)
      untimed()
      await jest.advanceTimersByTimeAsync(10)
      expect(a.answer()).toMatchObject({ did: 'did:peer:2.old' })
    })
  })
})
