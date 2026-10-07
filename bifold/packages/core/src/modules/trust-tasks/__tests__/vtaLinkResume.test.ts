/**
 * IN-135: a link left part-way — the phone slept, Keyring locked, the app
 * restarted, or a check failed for a reason that was not a refusal — picks
 * back up with the same temporary key, which the agent may already hold.
 * A new key would leave that grant unused.
 */
import { VtaAgentController, TEMPORARY_KEY_REUSE_MS } from '../module/vtaAgent'

const mockClient = {
  connect: jest.fn(async () => undefined),
  disconnect: jest.fn(async () => undefined),
  whoAmI: jest.fn(async (_timeoutMs?: number, onSent?: () => void) => {
    onSent?.()
    return { roles: ['admin'] }
  }),
  rotateManagerKey: jest.fn(async () => 'did:peer:2.permanent'),
  agentLabel: jest.fn(async () => undefined),
  managerDid: 'did:peer:2.permanent',
  isConnected: false,
  holdPersonaKeys: jest.fn(async () => false),
  task: jest.fn(async () => ({})),
  dropQueued: jest.fn(),
  listContexts: jest.fn(async () => []),
}
jest.mock('@bifold/credo-tsp-adapter', () => ({}))
jest.mock('../module/VtaClient', () => ({
  VTA_TASK: jest.requireActual('../module/VtaClient').VTA_TASK,
  ManagerKeyUnresolved: jest.requireActual('../module/VtaClient').ManagerKeyUnresolved,
  SwapDoneSignInFailed: jest.requireActual('../module/VtaClient').SwapDoneSignInFailed,
  VtaClient: jest.fn(() => mockClient),
  resolveVtaMediator: jest.fn(async () => ({ did: 'did:peer:2.mediator' })),
}))
const mockMint = jest.fn(async () => 'did:key:z6MkFresh')
jest.mock('../module/VtiMediatorTransport', () => ({
  createVtiClientDid: jest.fn(async () => 'did:peer:2.temporary'),
  createVtiTemporaryDidKey: () => mockMint(),
}))

type Setter = { set(next: Record<string, unknown>): void }
const VTA = 'did:webvh:Qm:dids.example:home'
const NOW = Date.parse('2026-10-07T12:00:00Z')

function controller(managers: Record<string, unknown>[] = [], options: { linked?: unknown } = {}) {
  const store = new Map(managers.map((m) => [m.vtaDid as string, m]))
  const saved: unknown[] = []
  const vta = new VtaAgentController()
  const setManager = jest.fn(async (m: Record<string, unknown>) => void store.set(m.vtaDid as string, m))
  const forgetManager = jest.fn(async (did: string) => void store.delete(did))
  vta.configure({
    now: () => NOW,
    linkStore: () => ({
      get: async () => options.linked as never,
      set: async (link) => void saved.push(link),
      clear: async () => undefined,
    }),
    identityStore: () =>
      ({
        getManager: async (did: string) => store.get(did),
        setManager,
        forgetManager,
        listManagers: async () => [...store.values()],
      }) as never,
  })
  return { vta, saved, setManager, forgetManager, store }
}
const temporary = (ageMs: number, extra: Record<string, unknown> = {}) => ({
  vtaDid: VTA,
  did: 'did:key:z6MkEarlier',
  createdAt: new Date(NOW - ageMs).toISOString(),
  stage: 'temporary',
  ...extra,
})

beforeEach(() => {
  jest.clearAllMocks()
  mockClient.connect.mockImplementation(async () => undefined)
})

describe('a link left part-way picks back up with the same key', () => {
  it('after a restart: the same key is shown again, checked once, and the link finishes', async () => {
    const { vta, saved } = controller([temporary(10 * 60 * 1000)])
    const shown: unknown[] = []
    vta.subscribe(() => {
      const link = vta.getState().link
      if (link.kind === 'showingKey') shown.push(link)
    })
    await vta.restore({} as never)
    await new Promise((resolve) => setImmediate(resolve))
    await new Promise((resolve) => setImmediate(resolve))
    expect(shown[0]).toMatchObject({ vtaDid: VTA, did: 'did:key:z6MkEarlier', resumed: true })
    expect(vta.getState().link.kind).toBe('linked')
    expect(saved).toHaveLength(1)
    expect(mockMint).not.toHaveBeenCalled()
  })

  it('a key older than its grant can last, or one in the middle of a swap, is not picked up', async () => {
    const stale = controller([temporary(TEMPORARY_KEY_REUSE_MS + 1)])
    expect(await stale.vta.pendingLinkKey({} as never)).toBeUndefined()
    const swapping = controller([temporary(60 * 1000, { pendingNext: { did: 'did:key:z6MkNext' } })])
    expect(await swapping.vta.pendingLinkKey({} as never)).toBeUndefined()
  })

  it('linking the same agent again shows the earlier key rather than making a new one', async () => {
    const { vta, setManager } = controller([temporary(5 * 60 * 1000)])
    ;(vta as unknown as Setter).set({ link: { kind: 'notLinked' } })
    await vta.startManualLink({} as never, VTA, 'home')
    expect(vta.getState().link).toMatchObject({ kind: 'showingKey', did: 'did:key:z6MkEarlier' })
    expect(mockMint).not.toHaveBeenCalled()
    expect(setManager).not.toHaveBeenCalled()
  })

  it('Try again after a failure: the failure names its agent, and the same key is checked and links', async () => {
    const { vta, saved } = controller([temporary(5 * 60 * 1000)])
    ;(vta as unknown as Setter).set({
      link: { kind: 'notLinked', lastError: { reason: 'failed', vtaDid: VTA, label: 'home' } },
    })
    expect(await vta.resumeLink({} as never, VTA)).toBe(true)
    expect(vta.getState().link.kind).toBe('linked')
    expect(saved).toEqual([expect.objectContaining({ vtaDid: VTA, label: 'home' })])
    expect(mockMint).not.toHaveBeenCalled()
  })

  it('a cancel drops the key: given up on purpose, it is not offered again', async () => {
    const { vta, forgetManager } = controller([temporary(5 * 60 * 1000)])
    ;(vta as unknown as Setter).set({ link: { kind: 'notLinked' } })
    ;(vta as unknown as { agent: unknown }).agent = {}
    await vta.startManualLink({} as never, VTA, 'home')
    vta.cancelLink()
    await new Promise((resolve) => setImmediate(resolve))
    expect(forgetManager).toHaveBeenCalledWith(VTA)
    expect(await vta.pendingLinkKey({} as never)).toBeUndefined()
  })

  it('nothing is picked up while something is linked or another agent is being added', async () => {
    const { vta } = controller([temporary(5 * 60 * 1000)])
    ;(vta as unknown as Setter).set({
      link: {
        kind: 'linked',
        vtaDid: 'did:webvh:Qm:other',
        label: 'x',
        linkedAt: 't',
        connection: { kind: 'online', since: 0 },
      },
    })
    expect(await vta.resumeLink({} as never)).toBe(false)
    ;(vta as unknown as Setter).set({ link: { kind: 'notLinked' }, addingAgent: true })
    expect(await vta.resumeLink({} as never)).toBe(false)
  })

  // A refusal is not retried behind the person's back: every foreground would
  // sign in again and be refused again (#355 review).
  type Dispatcher = { dispatch(event: unknown): void; agent: unknown }
  const failWhileShowingKey = (vta: VtaAgentController, failure: Record<string, unknown>) => {
    ;(vta as unknown as Setter).set({
      link: { kind: 'showingKey', vtaDid: VTA, label: 'home', did: 'did:key:z6MkEarlier', checking: true },
    })
    ;(vta as unknown as Dispatcher).agent = {}
    ;(vta as unknown as Dispatcher).dispatch({ type: 'failed', failure })
  }

  it.each([
    ['a community agent', { reason: 'communityAgent' }],
    ['a swap the agent refused', { reason: 'failed', swap: 'refused' }],
    ['a swap held for approval', { reason: 'failed', swap: 'held' }],
    ['an expired host code', { reason: 'failed', hostReason: 'expired' }],
  ])('after %s, a foreground does not pick the link up, and the key is dropped', async (_, failure) => {
    const { vta, forgetManager } = controller([temporary(5 * 60 * 1000)])
    failWhileShowingKey(vta, failure)
    await vta.ensureOnline({} as never)
    await new Promise((resolve) => setImmediate(resolve))
    expect(vta.getState().link.kind).toBe('notLinked')
    expect(mockClient.connect).not.toHaveBeenCalled()
    expect(forgetManager).toHaveBeenCalledWith(VTA)
  })

  it('after a check that broke off, a foreground picks the link up with the same key', async () => {
    const { vta, forgetManager } = controller([temporary(5 * 60 * 1000)])
    failWhileShowingKey(vta, { reason: 'failed', detail: 'socket closed' })
    await vta.ensureOnline({} as never)
    await new Promise((resolve) => setImmediate(resolve))
    await new Promise((resolve) => setImmediate(resolve))
    expect(forgetManager).not.toHaveBeenCalled()
    expect(vta.getState().link.kind).toBe('linked')
    expect(mockMint).not.toHaveBeenCalled()
  })

  it('a cancel during the key swap keeps the record: a rotate in flight would write it back', async () => {
    const { vta, forgetManager } = controller([temporary(5 * 60 * 1000)])
    ;(vta as unknown as Setter).set({ link: { kind: 'linking', vtaDid: VTA, label: 'home' } })
    ;(vta as unknown as Dispatcher).agent = {}
    vta.cancelLink()
    await new Promise((resolve) => setImmediate(resolve))
    expect(forgetManager).not.toHaveBeenCalled()
  })
})
