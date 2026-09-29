/**
 * When the linked agent is gone for good, the phone says so and offers a new
 * one, instead of retrying forever (228; the Farm wipe of 09-29 left testers
 * linked to agents that no longer existed).
 *
 * Gone is one of two things, each a named threshold waiting on decision #41:
 *  - the agent's address does not exist: its DID host answered "not found"
 *    on two checks at least an hour apart (one could be a host mid-redeploy);
 *  - this phone has not reached the agent for three days.
 * An agent that is only unreachable — the network, a host that did not answer
 * — is offline, and stays offline, never gone on one failure. Reaching the
 * agent again undoes it.
 */
import { AGENT_NOT_FOUND_CONFIRM_MS, AGENT_UNREACHABLE_GONE_MS, agentGoneVerdict } from '../module/agentGone'
import { reduceLink, showsOfflineBanner, type VtaLinkState } from '../module/vtaLinkMachine'
import { VtaAgentController } from '../module/vtaAgent'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const LINKED_AT = '2026-09-20T00:00:00.000Z'
const T0 = Date.parse(LINKED_AT)

describe('the thresholds', () => {
  it('are the recommended values waiting on decision #41', () => {
    expect(AGENT_NOT_FOUND_CONFIRM_MS).toBe(HOUR)
    expect(AGENT_UNREACHABLE_GONE_MS).toBe(3 * DAY)
  })
})

describe('the verdict', () => {
  const link = { linkedAt: LINKED_AT, lastOnlineAt: T0 + DAY }

  it('one "not found" is noted, not a verdict', () => {
    expect(agentGoneVerdict(link, { notFound: true, now: T0 + DAY + HOUR })).toEqual({
      notFoundAt: T0 + DAY + HOUR,
    })
  })

  it('"not found" again an hour or more after the first is gone', () => {
    const first = T0 + DAY + HOUR
    expect(agentGoneVerdict({ ...link, notFoundAt: first }, { notFound: true, now: first + HOUR - 1 })).toEqual({
      notFoundAt: first,
    })
    expect(agentGoneVerdict({ ...link, notFoundAt: first }, { notFound: true, now: first + HOUR })).toEqual({
      notFoundAt: first,
      gone: 'notFound',
    })
  })

  it('an answer that is not "not found" forgets an earlier one', () => {
    expect(
      agentGoneVerdict({ ...link, notFoundAt: T0 + DAY + HOUR }, { notFound: false, now: T0 + DAY + 3 * HOUR })
    ).toEqual({})
  })

  it('a lookup that could not tell keeps an earlier "not found", and does not confirm it', () => {
    const first = T0 + DAY + HOUR
    expect(agentGoneVerdict({ ...link, notFoundAt: first }, { now: first + 2 * HOUR })).toEqual({ notFoundAt: first })
  })

  it('three days without reaching the agent is gone, counted from the last time online', () => {
    expect(agentGoneVerdict(link, { notFound: false, now: T0 + DAY + 3 * DAY - 1 })).toEqual({})
    expect(agentGoneVerdict(link, { notFound: false, now: T0 + DAY + 3 * DAY })).toEqual({ gone: 'unreachable' })
  })

  it('counts from the link when the phone was never online since', () => {
    expect(agentGoneVerdict({ linkedAt: LINKED_AT }, { notFound: false, now: T0 + 3 * DAY })).toEqual({
      gone: 'unreachable',
    })
  })
})

describe('the link machine', () => {
  const linked = (connection: Extract<VtaLinkState, { kind: 'linked' }>['connection']): VtaLinkState => ({
    kind: 'linked',
    vtaDid: 'did:webvh:gone',
    label: 'Farm',
    linkedAt: LINKED_AT,
    connection,
  })

  it('a link that is not online can be found gone, keeping which agent it was', () => {
    const next = reduceLink(linked({ kind: 'offline', since: 5 }), { type: 'agentGone', why: 'notFound', now: 9 })
    expect(next).toMatchObject({
      kind: 'linked',
      vtaDid: 'did:webvh:gone',
      connection: { kind: 'gone', why: 'notFound', since: 9 },
    })
  })

  it('an online link is never gone', () => {
    const online = linked({ kind: 'online' })
    expect(reduceLink(online, { type: 'agentGone', why: 'unreachable', now: 9 })).toBe(online)
  })

  it('stays gone through drops and retries, and comes back online if the agent answers', () => {
    const gone = linked({ kind: 'gone', why: 'notFound', since: 9 })
    expect(reduceLink(gone, { type: 'sessionDropped', now: 10 })).toBe(gone)
    expect(reduceLink(gone, { type: 'retryScheduled', attempt: 2, nextRetryAt: 20 })).toBe(gone)
    expect(reduceLink(gone, { type: 'sessionOpened' })).toMatchObject({ connection: { kind: 'online' } })
  })

  it('the offline banner leaves it to the card', () => {
    expect(showsOfflineBanner(linked({ kind: 'gone', why: 'notFound', since: 0 }), DAY)).toBe(false)
  })
})

// The controller, on the same mocks as vtaAgentLink.
const mockClient = {
  connect: jest.fn(async () => undefined),
  disconnect: jest.fn(async () => undefined),
  whoAmI: jest.fn(async () => ({ roles: ['admin'] })),
  agentLabel: jest.fn(async () => undefined),
  managerDid: 'did:peer:2.permanent',
  isConnected: false,
  holdPersonaKeys: jest.fn(async () => false),
  borrowKey: jest.fn(async () => ({ keyId: 'k', curve: 'Ed25519' as const, publicKeyMultibase: 'z' })),
}
jest.mock('../module/VtaClient', () => ({
  VTA_TASK: jest.requireActual('../module/VtaClient').VTA_TASK,
  ManagerKeyUnresolved: jest.requireActual('../module/VtaClient').ManagerKeyUnresolved,
  SwapDoneSignInFailed: jest.requireActual('../module/VtaClient').SwapDoneSignInFailed,
  VtaClient: jest.fn(() => mockClient),
  resolveVtaMediator: jest.fn(async () => ({ did: 'did:peer:2.mediator' })),
}))
jest.mock('../module/VtiMediatorTransport', () => ({
  createVtiClientDid: jest.fn(async () => 'did:peer:2.temporary'),
  createVtiTemporaryDidKey: jest.fn(async () => 'did:key:z6Mktemporary'),
}))

describe('the controller', () => {
  // Still trying: connecting (at start-up), offline or reconnecting — never gone.
  const notGone = (vta: VtaAgentController) => {
    const link = vta.getState().link
    return link.kind === 'linked' && ['connecting', 'offline', 'reconnecting'].includes(link.connection.kind)
  }
  const settle = async () => {
    for (let i = 0; i < 6; i++) await new Promise((resolve) => setImmediate(resolve))
  }

  function controller(stored: Record<string, unknown>, lookup: 'notFound' | 'found' | 'unknown') {
    let clock = T0
    let record: Record<string, unknown> | undefined = { vtaDid: 'did:webvh:gone', label: 'Farm', ...stored }
    const vta = new VtaAgentController()
    const agentAddress = jest.fn(async () => lookup)
    vta.configure({
      now: () => clock,
      linkStore: () => ({
        get: async () => record as never,
        set: async (link) => {
          record = link as never
        },
        clear: async () => {
          record = undefined
        },
      }),
      identityStore: () => ({ setManager: async () => undefined, listPersonas: async () => [] }) as never,
      agentAddress,
    })
    return {
      vta,
      agentAddress,
      record: () => record,
      at: (t: number) => {
        clock = t
      },
    }
  }

  // Retries are timers: faked, so none from one test fires in the next.
  beforeAll(() => jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] }))
  afterAll(() => jest.useRealTimers())

  beforeEach(() => {
    jest.clearAllMocks()
    mockClient.connect.mockImplementation(async () => {
      throw new Error('the VTA did not answer: signing in took over 30 s')
    })
  })

  it('a sign-in that fails with the address not found is noted; confirmed an hour later, the agent is gone', async () => {
    const c = controller({ linkedAt: LINKED_AT, lastOnlineAt: T0 }, 'notFound')
    c.at(T0 + HOUR)
    await c.vta.restore({} as never)
    await settle()
    expect(c.record()).toMatchObject({ notFoundAt: T0 + HOUR })
    expect(notGone(c.vta)).toBe(true)

    c.at(T0 + 2 * HOUR)
    await c.vta.tryAgainNow({} as never)
    await settle()
    expect(c.vta.getState().link).toMatchObject({ kind: 'linked', connection: { kind: 'gone', why: 'notFound' } })
  })

  it('a sign-in that fails while the address still resolves is only offline', async () => {
    const c = controller({ linkedAt: LINKED_AT, lastOnlineAt: T0, notFoundAt: T0 }, 'found')
    c.at(T0 + 2 * HOUR)
    await c.vta.restore({} as never)
    await settle()
    expect(notGone(c.vta)).toBe(true)
    expect(c.record()).not.toHaveProperty('notFoundAt')
  })

  it('a host that did not answer is neither here nor there: offline, nothing noted', async () => {
    const c = controller({ linkedAt: LINKED_AT, lastOnlineAt: T0 }, 'unknown')
    c.at(T0 + 2 * HOUR)
    await c.vta.restore({} as never)
    await settle()
    expect(notGone(c.vta)).toBe(true)
    expect(c.record()).not.toHaveProperty('notFoundAt')
  })

  it('three days without reaching it is gone, and it stops retrying', async () => {
    const c = controller({ linkedAt: LINKED_AT, lastOnlineAt: T0 }, 'unknown')
    c.at(T0 + 3 * DAY)
    await c.vta.restore({} as never)
    await settle()
    expect(c.vta.getState().link).toMatchObject({ connection: { kind: 'gone', why: 'unreachable' } })
    expect(mockClient.connect).toHaveBeenCalledTimes(1)
  })

  it('reaching the agent records when, and forgets a "not found"', async () => {
    mockClient.connect.mockImplementation(async () => undefined)
    const c = controller({ linkedAt: LINKED_AT, notFoundAt: T0 }, 'found')
    c.at(T0 + DAY)
    await c.vta.restore({} as never)
    await settle()
    expect(c.vta.getState().link).toMatchObject({ connection: { kind: 'online' } })
    expect(c.record()).toMatchObject({ lastOnlineAt: T0 + DAY })
    expect(c.record()).not.toHaveProperty('notFoundAt')
    expect(c.agentAddress).not.toHaveBeenCalled()
  })
})
