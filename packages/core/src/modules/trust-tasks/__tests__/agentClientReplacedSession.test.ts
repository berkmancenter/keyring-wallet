/**
 * A VtaClient that opens a new session stops the one it replaces (replacedSessionSwitch).
 *
 * `connect()` opens a new session whenever the one it holds has no open socket: closed while the app was away, or by
 * the mediator. The old one was never stopped, so it kept its renewal timer and reopened its socket later as the same
 * DID; a mediator allows one socket per DID, so the two closed each other's at every renewal (report EFNN-34F9,
 * 11-17). The session below is a fake that records being started and stopped.
 */
const VTA = 'did:webvh:vta'
const PHONE = 'did:peer:2.phone'

const mockSessions: { did: string; open: boolean; started: number; stopped: number }[] = []

jest.mock('@bifold/trust-tasks', () => ({
  TRUST_TASK_V2_ENVELOPE_TYPE: 'https://trusttasks.org/binding/didcomm/0.1/envelope',
  tsp: { CODEC_FORMS_RELATIONSHIPS: false },
  signDocumentProof: jest.fn(async (_a: unknown, doc: Record<string, unknown>) => doc),
  signCompactJws: jest.fn(async () => 'header.payload.sig'),
}))
jest.mock('../module/tspCapability', () => ({ chooseCarriage: jest.fn(async () => 'didcomm') }))
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
    readonly record: (typeof mockSessions)[number]
    constructor(_agent: unknown, identity: { did: string }) {
      this.record = { did: identity.did, open: false, started: 0, stopped: 0 }
      mockSessions.push(this.record)
    }
    get isOpen() {
      return this.record.open
    }
    async start() {
      this.record.open = true
      this.record.started += 1
    }
    async stop() {
      this.record.open = false
      this.record.stopped += 1
    }
    checkAlive() {
      /* not used here */
    }
  },
}))

import { REPLACED_SESSION_STOPS, isReplacedSessionStopsOn } from '../module/replacedSessionSwitch'
import { VtaClient } from '../module/VtaClient'

const logger = { warn: jest.fn(), info: jest.fn(), debug: jest.fn(), error: jest.fn() }
const store = { getManager: jest.fn(async () => ({ vtaDid: VTA, did: PHONE, createdAt: 't' })) }
const newClient = () => new VtaClient({ config: { logger } } as never, VTA, store as never, { connectDrainMs: 0 })

let warn: jest.SpyInstance
const SHIPPED = { ...REPLACED_SESSION_STOPS }
beforeEach(() => {
  mockSessions.length = 0
  warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
})
afterEach(() => {
  warn.mockRestore()
  Object.assign(REPLACED_SESSION_STOPS, SHIPPED)
})
const saidReplaced = () =>
  warn.mock.calls.map((c) => String(c[0])).filter((line) => line.includes('is replaced by a new one'))

describe('what the release ships', () => {
  it('is on, and not killed', () => {
    expect(SHIPPED).toEqual({ on: true, remoteOff: false })
    expect(isReplacedSessionStopsOn()).toBe(true)
  })
})

describe('back in the foreground, the socket closed while the app was away', () => {
  it('the session it replaces is stopped before the new one is started, and the line says so', async () => {
    const client = newClient()
    await client.connect()
    expect(mockSessions).toHaveLength(1)
    mockSessions[0].open = false // the mediator or the OS closed it; nothing stopped the session
    await client.connect()
    expect(mockSessions).toHaveLength(2)
    expect(mockSessions[0]).toMatchObject({ stopped: 1, open: false })
    expect(mockSessions[1]).toMatchObject({ started: 1, stopped: 0, open: true })
    expect(saidReplaced()).toEqual([expect.stringContaining('its socket was closed')])
    // Names no DID: the line reaches a tester's report.
    expect(saidReplaced()[0]).not.toMatch(/did:/)
  })

  it('each later replacement stops the one before it: never two left running', async () => {
    const client = newClient()
    await client.connect()
    for (let i = 0; i < 3; i++) {
      mockSessions[mockSessions.length - 1].open = false
      await client.connect()
    }
    expect(mockSessions.map((s) => s.stopped)).toEqual([1, 1, 1, 0])
    expect(mockSessions.filter((s) => s.open)).toHaveLength(1)
  })

  it('a stop that throws does not keep the new session from opening', async () => {
    const client = newClient()
    await client.connect()
    mockSessions[0].open = false
    const held = (client as unknown as { session: { stop: () => Promise<void> } }).session
    held.stop = jest.fn(async () => {
      throw new Error('already gone')
    })
    await client.connect()
    expect(held.stop).toHaveBeenCalledTimes(1)
    expect(mockSessions[1]).toMatchObject({ started: 1, open: true })
  })
})

describe('two reconnects in the same moment (the foreground handler and the dropped-session reconnect)', () => {
  it('open one session between them, and both get its outcome', async () => {
    const client = newClient()
    await Promise.all([client.connect(), client.connect(), client.connect()])
    expect(mockSessions).toHaveLength(1)
    expect(mockSessions[0]).toMatchObject({ started: 1, stopped: 0, open: true })
  })

  it('after the socket closed while away: one new session, the old one stopped once', async () => {
    const client = newClient()
    await client.connect()
    mockSessions[0].open = false
    await Promise.all([client.connect(), client.connect()])
    expect(mockSessions).toHaveLength(2)
    expect(mockSessions.map((s) => s.stopped)).toEqual([1, 0])
    expect(mockSessions.filter((s) => s.open)).toHaveLength(1)
    expect(saidReplaced()).toHaveLength(1)
  })

  it('a connect that fails fails for both, and the next one tries again', async () => {
    const client = newClient()
    store.getManager.mockRejectedValueOnce(new Error('store not ready'))
    const both = await Promise.allSettled([client.connect(), client.connect()])
    expect(both.map((r) => r.status)).toEqual(['rejected', 'rejected'])
    expect(mockSessions).toHaveLength(0)
    await client.connect()
    expect(mockSessions).toHaveLength(1)
  })

  it('CONTROL: with the switch off, each connect opens its own, as before', async () => {
    REPLACED_SESSION_STOPS.remoteOff = true
    const client = newClient()
    await Promise.all([client.connect(), client.connect()])
    expect(mockSessions).toHaveLength(2)
    expect(mockSessions.filter((s) => s.open)).toHaveLength(2)
  })
})

describe('controls', () => {
  it('a session whose socket is open is kept: nothing is replaced, stopped or said', async () => {
    const client = newClient()
    await client.connect()
    await client.connect()
    expect(mockSessions).toHaveLength(1)
    expect(mockSessions[0]).toMatchObject({ started: 1, stopped: 0, open: true })
    expect(saidReplaced()).toEqual([])
  })

  it('the first connect replaces nothing', async () => {
    await newClient().connect()
    expect(mockSessions).toHaveLength(1)
    expect(saidReplaced()).toEqual([])
  })

  it('after a disconnect there is nothing to replace: stopped once, by the disconnect', async () => {
    const client = newClient()
    await client.connect()
    await client.disconnect()
    await client.connect()
    expect(mockSessions.map((s) => s.stopped)).toEqual([1, 0])
    expect(saidReplaced()).toEqual([])
  })
})

describe('the switch', () => {
  it.each([
    ['remoteOff', { remoteOff: true }],
    ['on false', { on: false }],
    ['on not a boolean', { on: 'true' }],
  ])('%s: the replaced session is left as before, not stopped, and nothing is said', async (_name, values) => {
    Object.assign(REPLACED_SESSION_STOPS, values)
    expect(isReplacedSessionStopsOn()).toBe(false)
    const client = newClient()
    await client.connect()
    mockSessions[0].open = false
    await client.connect()
    expect(mockSessions).toHaveLength(2)
    expect(mockSessions[0].stopped).toBe(0)
    expect(saidReplaced()).toEqual([])
  })
})
