/**
 * Coming back to the app should not read as the agent going away (277.6: "Reconnecting…" at moments of returning,
 * and nothing in a report to show when). A drop found while the app was suspended, or just after it came back, is
 * shown only if the link is not back within QUIET_DROP_MS, and it stays out of the activity list. Every drop, retry,
 * reconnect and give-up is one line in the log.
 */
import { VtaClient } from '../module/VtaClient'
import { MAX_RECONNECT_TRIES, RETURN_DROP_WINDOW_MS, VtaAgentController } from '../module/vtaAgent'
import { connectionShown, QUIET_DROP_MS } from '../module/vtaLinkMachine'

// The controller, on the same mocks as agentGone.test.ts.
const mockClient = {
  connect: jest.fn(async () => undefined),
  disconnect: jest.fn(async () => undefined),
  whoAmI: jest.fn(async () => ({ roles: ['admin'] })),
  agentLabel: jest.fn(async () => undefined),
  managerDid: 'did:peer:2.permanent',
  isConnected: true,
  holdPersonaKeys: jest.fn(async () => false),
  borrowKey: jest.fn(async () => ({ keyId: 'k', curve: 'Ed25519' as const, publicKeyMultibase: 'z' })),
  checkAlive: jest.fn(),
}
jest.mock('../module/VtaClient', () => ({
  VTA_TASK: jest.requireActual('../module/VtaClient').VTA_TASK,
  refusedAsNotOnAcl: jest.requireActual('../module/VtaClient').refusedAsNotOnAcl,
  TspReplyBreaker: jest.requireActual('../module/VtaClient').TspReplyBreaker,
  consentPendingOf: jest.requireActual('../module/VtaClient').consentPendingOf,
  ManagerKeyUnresolved: jest.requireActual('../module/VtaClient').ManagerKeyUnresolved,
  SwapDoneSignInFailed: jest.requireActual('../module/VtaClient').SwapDoneSignInFailed,
  VtaClient: jest.fn(() => mockClient),
  resolveVtaMediator: jest.fn(async () => ({ did: 'did:peer:2.mediator' })),
}))
jest.mock('../module/VtiMediatorTransport', () => ({
  createVtiClientDid: jest.fn(async () => 'did:peer:2.temporary'),
  createVtiTemporaryDidKey: jest.fn(async () => 'did:key:z6Mktemporary'),
}))

const mockedVtaClient = VtaClient as unknown as jest.Mock

const T0 = Date.parse('2026-11-03T06:00:00.000Z')
const settle = async () => {
  for (let i = 0; i < 8; i++) await new Promise((resolve) => setImmediate(resolve))
}

async function onlineController() {
  let clock = T0
  const vta = new VtaAgentController()
  vta.configure({
    now: () => clock,
    linkStore: () => ({
      get: async () => ({ vtaDid: 'did:webvh:QmAgent:host', label: 'Farm', linkedAt: '2026-11-01T00:00:00.000Z' }),
      set: async () => undefined,
      clear: async () => undefined,
    }),
    identityStore: () => ({ setManager: async () => undefined, listPersonas: async () => [] }) as never,
    agentAddress: jest.fn(async () => 'found' as const),
  })
  await vta.restore({} as never)
  await settle()
  expect(vta.getState().link).toMatchObject({ kind: 'linked', connection: { kind: 'online' } })
  const options = mockedVtaClient.mock.calls[mockedVtaClient.mock.calls.length - 1][3] as {
    onError: (e: Error) => void
  }
  // The start-up connect has its own entry already; what a test looks at is what came after it.
  const before = vta.getState().activity.length
  return {
    vta,
    at: (t: number) => {
      clock = t
    },
    // The socket goes away under the session: the client says so.
    drop: (message = 'socket closed (1001) for did:peer:2.Ez6LSabcdefghijklmnopqrstuvwxyz0123456789') => {
      mockClient.isConnected = false
      options.onError(new Error(message))
    },
    activity: () =>
      vta
        .getState()
        .activity.slice(0, vta.getState().activity.length - before)
        .map((a) => a.kind),
    connection: () => {
      const link = vta.getState().link
      if (link.kind !== 'linked') throw new Error('not linked')
      return link.connection
    },
  }
}

describe('a drop found because the app was away', () => {
  let warn: jest.SpyInstance
  const lines = () => warn.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith('[VTA] '))

  beforeAll(() => jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] }))
  afterAll(() => jest.useRealTimers())
  beforeEach(() => {
    jest.clearAllMocks()
    mockClient.isConnected = true
    mockClient.connect.mockImplementation(async () => undefined)
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  })
  afterEach(() => {
    warn.mockRestore()
    // A test's retries stay its own: none fires in the next.
    jest.clearAllTimers()
  })

  it('while suspended: shows nothing, adds nothing to the activity list, and is said in the log', async () => {
    const c = await onlineController()
    c.vta.backgrounded()
    c.at(T0 + 60_000)
    c.drop()
    expect(c.connection()).toMatchObject({ kind: 'reconnecting', since: T0 + 60_000 })
    expect(c.connection()).toMatchObject({ untilReturn: true })
    // Ten minutes away, then back: the wait counts from the return.
    c.at(T0 + 660_000)
    mockClient.connect.mockImplementation(async () => {
      mockClient.isConnected = true
    })
    const back = c.vta.foregrounded({} as never)
    expect(connectionShown(c.connection(), T0 + 660_000 + QUIET_DROP_MS - 1)).toEqual({ kind: 'online' })
    c.at(T0 + 661_500)
    await back
    await settle()
    expect(c.connection()).toEqual({ kind: 'online' })
    expect(c.activity()).not.toContain('wentOffline')
    expect(c.activity()).not.toContain('reconnected')
    expect(lines()).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /^\[VTA\] session dropped, found while away: shown only if not back in 5 s: socket closed/
        ),
        expect.stringMatching(/^\[VTA\] reconnect try 1 of 5 in 1 s$/),
        expect.stringMatching(/^\[VTA\] back online 601\.5 s after the drop \(1 retry\)$/),
      ])
    )
    // Identifiers as prefixes only.
    expect(lines().join('\n')).not.toContain('0123456789')
  })

  it('just after coming back (the alive check finds it): quiet too, and shown once its 5 s are up', async () => {
    const c = await onlineController()
    c.vta.backgrounded()
    c.at(T0 + 60_000)
    mockClient.connect.mockImplementation(async () => {
      throw new Error('the VTA did not answer')
    })
    await c.vta.foregrounded({} as never)
    c.at(T0 + 70_000)
    c.drop()
    const shown = c.connection()
    expect(connectionShown(shown, T0 + 70_000 + QUIET_DROP_MS - 1)).toEqual({ kind: 'online' })
    // A drop books its first retry at once: shown as reconnecting.
    expect(connectionShown(shown, T0 + 70_000 + QUIET_DROP_MS)).toMatchObject({
      kind: 'reconnecting',
      since: T0 + 70_000,
    })
    expect(c.activity()).not.toContain('wentOffline')
    // Found after the return, it waits for no other: the controller does not mark it, and the next return leaves it.
    expect(shown).not.toHaveProperty('untilReturn')
    c.vta.backgrounded()
    c.at(T0 + 120_000)
    void c.vta.foregrounded({} as never)
    expect(connectionShown(c.connection(), T0 + 120_001)).toMatchObject({ kind: 'reconnecting', since: T0 + 70_000 })
  })

  // Control: the same drop with the app in use is a real one, said at once and listed, as before.
  it('with the app in use: shown at once and listed, as before', async () => {
    const c = await onlineController()
    c.at(T0 + 60_000)
    c.drop()
    expect(connectionShown(c.connection(), T0 + 60_001)).toMatchObject({ kind: 'reconnecting', since: T0 + 60_000 })
    expect(c.activity()).toContain('wentOffline')
    expect(lines()).toEqual(expect.arrayContaining([expect.stringMatching(/^\[VTA\] session dropped: socket closed/)]))
    mockClient.connect.mockImplementation(async () => {
      mockClient.isConnected = true
    })
    c.at(T0 + 61_000)
    jest.advanceTimersByTime(1000)
    await settle()
    expect(c.connection()).toEqual({ kind: 'online' })
    expect(c.activity()).toContain('reconnected')
  })

  it('a drop well after the return is an ordinary one', async () => {
    const c = await onlineController()
    c.vta.backgrounded()
    c.at(T0 + 60_000)
    await c.vta.foregrounded({} as never)
    c.at(T0 + 60_000 + RETURN_DROP_WINDOW_MS)
    c.drop()
    expect(c.connection()).not.toHaveProperty('quietUntil')
    expect(c.activity()).toContain('wentOffline')
  })

  it('each failed try and the give-up are said', async () => {
    const c = await onlineController()
    mockClient.connect.mockImplementation(async () => {
      throw new Error('the VTA did not answer')
    })
    c.drop()
    for (let i = 0; i < MAX_RECONNECT_TRIES; i++) {
      jest.advanceTimersByTime(30_000)
      await settle()
    }
    const said = lines()
    expect(said.filter((l) => l.startsWith('[VTA] reconnect try '))).toHaveLength(MAX_RECONNECT_TRIES)
    expect(said.filter((l) => l.startsWith('[VTA] reconnect failed: the VTA did not answer'))).toHaveLength(
      MAX_RECONNECT_TRIES
    )
    expect(said).toEqual(expect.arrayContaining([expect.stringMatching(/^\[VTA\] reconnecting stopped after 5 tries/)]))
    expect(c.vta.getState().reconnectGaveUp).toBe(true)
  })
})
