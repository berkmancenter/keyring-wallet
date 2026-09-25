/**
 * A key swap whose answer is lost must not lock the phone out of its own agent.
 *
 * `acl/swap-key/0.1` moves the phone's grant from the key it signed in with
 * onto a fresh one and retires the old key, in one request
 * (`operations::acl::swap_acl`, which writes the new entry before deleting the
 * old). If the answer never reaches the phone — a timeout, a dropped socket,
 * the app killed — the phone used to keep only the old key, which the VTA may
 * no longer know. The successor is now recorded as pending before the swap is
 * sent, and settled by asking the VTA which key it accepts.
 *
 * The VTA below is a fake with an ACL: it refuses a sender not on it the way
 * vta-service does (`permissionDenied`, "forbidden: DID not in ACL: <did>"),
 * and performs a swap the way `swap_acl` does.
 */
const ENVELOPE = 'https://trusttasks.org/binding/didcomm/0.1/envelope'
const WHOAMI = 'https://trusttasks.org/spec/auth/whoami/0.1'
const SWAP = 'https://trusttasks.org/spec/acl/swap-key/0.1'
const VTA = 'did:webvh:vta'
const CURRENT = 'did:peer:2.current'
const NEXT = 'did:peer:2.next'

type Plain = { from: string; body: { type: string; payload: Record<string, unknown> } }

const mockVta = {
  acl: new Set<string>(),
  /** Perform a swap when asked. */
  performSwap: true,
  /** Say nothing in answer to a swap (performed or not). */
  dropSwapAnswer: false,
  /** Answer nothing at all. */
  down: false,
  /** Answer nothing from these senders. */
  silentFor: new Set<string>(),
  asked: [] as { from: string; type: string }[],
}
const mockSessions: { did: string; onMessage: (m: unknown) => void; open: boolean }[] = []

function mockAnswer(session: { onMessage: (m: unknown) => void }, type: string, payload: Record<string, unknown>) {
  setTimeout(
    () =>
      session.onMessage({
        type: ENVELOPE,
        created_time: Math.floor(Date.now() / 1000),
        body: { type, payload },
      }),
    0
  )
}

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
  createVtiClientDid: jest.fn(async () => 'did:peer:2.next'),
  resolveVtiMediator: jest.fn(async (_a: unknown, did: string) => ({ did })),
  resolveDidDocumentRetrying: jest.fn(async () => ({
    service: [{ type: 'DIDCommMessaging', serviceEndpoint: 'did:peer:2.mediator' }],
  })),
  vtiClientIdentityFromDid: jest.fn(async (_a: unknown, did: string) => ({ did })),
  VtiMediatorSession: class {
    readonly record: (typeof mockSessions)[number]
    constructor(_agent: unknown, identity: { did: string }, _m: unknown, opts: { onMessage: (m: unknown) => void }) {
      this.record = { did: identity.did, onMessage: opts.onMessage, open: false }
      mockSessions.push(this.record)
    }
    get isOpen() {
      return this.record.open
    }
    async start() {
      this.record.open = true
    }
    async stop() {
      this.record.open = false
    }
    async sendTo(_to: string, message: Plain) {
      const { from, body } = message
      mockVta.asked.push({ from, type: body.type })
      if (mockVta.down || mockVta.silentFor.has(from)) return
      if (!mockVta.acl.has(from)) {
        mockAnswer(this.record, 'https://trusttasks.org/spec/trust-task-error/0.1', {
          code: 'permissionDenied',
          message: `forbidden: DID not in ACL: ${from}`,
        })
        return
      }
      if (body.type === WHOAMI) {
        mockAnswer(this.record, `${WHOAMI}#response`, { roles: ['admin'] })
        return
      }
      if (body.type === SWAP) {
        const newSubject = String(body.payload.newSubject)
        if (mockVta.performSwap) {
          // swap_acl: create the new entry, then delete the caller's.
          mockVta.acl.add(newSubject)
          mockVta.acl.delete(from)
        }
        if (!mockVta.dropSwapAnswer)
          mockAnswer(this.record, `${SWAP}#response`, { entry: { subject: newSubject }, previousSubject: from })
      }
    }
  },
}))

import { ManagerKeyUnresolved, VtaClient, setVtaSwapTestHook } from '../module/VtaClient'
import type { VtiManagerIdentity } from '../module/VtiIdentityStore'

function memoryStore(initial?: VtiManagerIdentity) {
  let manager = initial
  return {
    get manager() {
      return manager
    },
    getManager: jest.fn(async () => manager),
    setManager: jest.fn(async (m: VtiManagerIdentity) => {
      manager = { ...m }
    }),
  }
}

const logger = { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() }
const agent = { config: { logger } } as never

function client(store: ReturnType<typeof memoryStore>) {
  return new VtaClient(agent, VTA, store as never, {
    connectDrainMs: 0,
    swapTimeoutMs: 50,
    probeTimeoutMs: 50,
    consentWaitMs: 0,
  })
}

const temporary: VtiManagerIdentity = {
  vtaDid: VTA,
  did: CURRENT,
  createdAt: '2026-09-25T00:00:00Z',
  stage: 'temporary',
}

beforeEach(() => {
  mockVta.acl = new Set([CURRENT])
  mockVta.performSwap = true
  mockVta.dropSwapAnswer = false
  mockVta.down = false
  mockVta.silentFor = new Set()
  mockVta.asked = []
  jest.clearAllMocks()
  mockSessions.length = 0
  setVtaSwapTestHook(undefined)
})

const openSession = () => mockSessions.filter((s) => s.open)

describe('rotating the manager key', () => {
  it('(e) adopts the new key when the VTA answers the swap, and keeps nothing pending', async () => {
    const store = memoryStore(temporary)
    const vta = client(store)
    await vta.connect()

    await expect(vta.rotateManagerKey()).resolves.toBe(NEXT)

    expect(store.manager).toMatchObject({ did: NEXT, stage: 'permanent' })
    expect(store.manager?.pendingNext).toBeUndefined()
    // The successor was on record before the swap left the phone.
    expect(store.setManager.mock.calls[0][0]).toMatchObject({ did: CURRENT, pendingNext: { did: NEXT } })
    expect(vta.managerDid).toBe(NEXT)
    expect(openSession().map((s) => s.did)).toEqual([NEXT])
    expect(mockVta.asked.filter((a) => a.type === SWAP)).toHaveLength(1)
  })

  it('(a) adopts the new key when the VTA swapped but its answer was lost', async () => {
    mockVta.dropSwapAnswer = true
    const store = memoryStore(temporary)
    const vta = client(store)
    await vta.connect()

    await expect(vta.rotateManagerKey()).resolves.toBe(NEXT)

    expect(store.manager).toMatchObject({ did: NEXT, stage: 'permanent' })
    expect(store.manager?.pendingNext).toBeUndefined()
    expect(vta.managerDid).toBe(NEXT)
    expect(vta.isConnected).toBe(true)
    // Settled by asking, not assumed: whoami as the new key after the swap.
    expect(mockVta.asked.slice(-1)[0]).toEqual({ from: NEXT, type: WHOAMI })
  })

  it('(b) keeps the old key when the answer was lost and the swap never happened', async () => {
    mockVta.dropSwapAnswer = true
    mockVta.performSwap = false
    const store = memoryStore(temporary)
    const vta = client(store)
    await vta.connect()

    await expect(vta.rotateManagerKey()).rejects.toThrow(/did not answer/)

    expect(store.manager).toEqual(temporary)
    expect(vta.managerDid).toBe(CURRENT)
    expect(vta.isConnected).toBe(true)
    // The VTA refused the new key before the old one was kept.
    expect(mockVta.asked.slice(-2)).toEqual([
      { from: NEXT, type: WHOAMI },
      { from: CURRENT, type: WHOAMI },
    ])
  })

  it('(d) keeps both keys and says so when the VTA accepts neither', async () => {
    mockVta.dropSwapAnswer = true
    mockVta.performSwap = false
    const store = memoryStore(temporary)
    const vta = client(store)
    await vta.connect()
    // The temporary grant lapses before the swap arrives: the swap is refused,
    // and so is each key when asked.
    mockVta.acl.clear()

    const failure = await vta.rotateManagerKey().catch((e: unknown) => e)
    expect(failure).toBeInstanceOf(ManagerKeyUnresolved)
    // Read by the link machine as access revoked: the VTA refused both.
    expect((failure as ManagerKeyUnresolved).refusedBoth).toBe(true)
    expect((failure as Error).message).toMatch(/not in ACL/)
    expect(store.manager).toMatchObject({ did: CURRENT, pendingNext: { did: NEXT } })
    expect(vta.isConnected).toBe(false)
  })

  it('(d) keeps both keys when the VTA cannot be asked at all', async () => {
    const store = memoryStore(temporary)
    const vta = client(store)
    await vta.connect()
    mockVta.down = true

    const failure = await vta.rotateManagerKey().catch((e: unknown) => e)
    expect(failure).toBeInstanceOf(ManagerKeyUnresolved)
    // Read as a dropped session, which the link machine retries — not as revoked.
    expect((failure as Error).message).not.toMatch(/not in (the )?ACL|unauthori[sz]ed|forbidden|revoked/i)
    expect(store.manager).toMatchObject({ did: CURRENT, pendingNext: { did: NEXT } })
  })

  it('keeps the new key pending when the old key works but the new one cannot be asked', async () => {
    const pending = { ...temporary, pendingNext: { did: NEXT, createdAt: '2026-09-25T00:01:00Z' } }
    const store = memoryStore(pending)
    const vta = client(store)
    mockVta.silentFor.add(NEXT)

    await vta.connect()

    // Signed in as the old key, which works; whether the VTA also wrote the
    // new one is unknown, so it stays on record for the next connect.
    expect(vta.managerDid).toBe(CURRENT)
    expect(store.manager).toEqual(pending)
  })
})

describe('connecting with a swap pending (the app was killed mid-swap)', () => {
  it('(c) adopts the new key on connect when the VTA had swapped', async () => {
    mockVta.acl = new Set([NEXT])
    const store = memoryStore({ ...temporary, pendingNext: { did: NEXT, createdAt: '2026-09-25T00:01:00Z' } })
    const vta = client(store)

    await vta.connect()

    expect(store.manager).toMatchObject({ did: NEXT, stage: 'permanent' })
    expect(store.manager?.pendingNext).toBeUndefined()
    expect(vta.managerDid).toBe(NEXT)
    expect(openSession().map((s) => s.did)).toEqual([NEXT])
    // Nothing signed as the retired key.
    expect(mockVta.asked.every((a) => a.from === NEXT)).toBe(true)
  })

  it('(c) keeps the old key on connect when the swap had not happened', async () => {
    const store = memoryStore({ ...temporary, pendingNext: { did: NEXT, createdAt: '2026-09-25T00:01:00Z' } })
    const vta = client(store)

    await vta.connect()

    expect(store.manager).toEqual(temporary)
    expect(vta.managerDid).toBe(CURRENT)
  })

  it('(c) prefers the new key when the VTA wrote it but had not yet retired the old one', async () => {
    // swap_acl writes the new entry before deleting the old: a crash between
    // the two leaves both, and the new one is the one without an expiry.
    mockVta.acl = new Set([CURRENT, NEXT])
    const store = memoryStore({ ...temporary, pendingNext: { did: NEXT, createdAt: '2026-09-25T00:01:00Z' } })
    const vta = client(store)

    await vta.connect()

    expect(store.manager).toMatchObject({ did: NEXT, stage: 'permanent' })
  })

  it('(d) fails the connect and keeps both keys when neither is accepted', async () => {
    mockVta.acl.clear()
    const pending = { ...temporary, pendingNext: { did: NEXT, createdAt: '2026-09-25T00:01:00Z' } }
    const store = memoryStore(pending)
    const vta = client(store)

    await expect(vta.connect()).rejects.toBeInstanceOf(ManagerKeyUnresolved)
    expect(store.manager).toEqual(pending)
  })
})

describe('the e2e hook that drops the swap answer', () => {
  it('drop: the VTA swaps, the answer is discarded, and the phone recovers in place', async () => {
    setVtaSwapTestHook('drop')
    const store = memoryStore(temporary)
    const vta = client(store)
    await vta.connect()

    await expect(vta.rotateManagerKey()).resolves.toBe(NEXT)
    expect(mockVta.acl.has(NEXT)).toBe(true)
    expect(store.manager).toMatchObject({ did: NEXT, stage: 'permanent' })
  })

  it('drop-and-stop: the successor is left pending for the next connect to settle', async () => {
    setVtaSwapTestHook('drop-and-stop')
    const store = memoryStore(temporary)
    const vta = client(store)
    await vta.connect()

    await expect(vta.rotateManagerKey()).rejects.toThrow(/dropped by the e2e hook/)
    expect(store.manager).toMatchObject({ did: CURRENT, pendingNext: { did: NEXT } })

    setVtaSwapTestHook(undefined)
    const relaunched = client(store)
    await relaunched.connect()
    expect(store.manager).toMatchObject({ did: NEXT, stage: 'permanent' })
  })

  it('ignores anything but the two named modes', async () => {
    setVtaSwapTestHook('yes')
    const store = memoryStore(temporary)
    const vta = client(store)
    await vta.connect()
    await expect(vta.rotateManagerKey()).resolves.toBe(NEXT)
    expect(logger.warn).not.toHaveBeenCalledWith(expect.stringMatching(/did not complete/))
  })
})

describe('what an unsettled swap tells the person', () => {
  // Required before release (review of #127): "revoked" only when the VTA
  // refused both keys; a VTA that could not be asked is reachability.
  const { connectFailureRevokes } = require('../module/vtaAgent') as typeof import('../module/vtaAgent')
  const { ManagerKeyUnresolved } = require('../module/VtaClient') as typeof import('../module/VtaClient')

  it('both keys refused: access revoked, so the person relinks', () => {
    expect(
      connectFailureRevokes(new ManagerKeyUnresolved('did:vta', 'did:key:old', 'did:key:new', true, 'both not in ACL'))
    ).toBe(true)
  })

  it('neither answered: not revoked — the phone cannot reach its agent, keeps both keys and retries', () => {
    expect(
      connectFailureRevokes(new ManagerKeyUnresolved('did:vta', 'did:key:old', 'did:key:new', false, 'timeouts'))
    ).toBe(false)
  })

  it("other failures are still read from the VTA's words", () => {
    expect(connectFailureRevokes(new Error('forbidden: DID not in ACL: did:key:x'))).toBe(true)
    expect(connectFailureRevokes(new Error('socket closed'))).toBe(false)
  })
})

describe('the swap hook in a release build', () => {
  it('is inert when __DEV__ is false: the swap answer is never dropped', () => {
    const g = global as unknown as { __DEV__?: boolean }
    const saved = g.__DEV__
    g.__DEV__ = false
    try {
      jest.isolateModules(() => {
        const client = require('../module/VtaClient') as typeof import('../module/VtaClient')
        client.setVtaSwapTestHook('drop-and-stop')
        expect(client.activeSwapTestHook()).toBeUndefined()
      })
    } finally {
      g.__DEV__ = saved
    }
  })
})
