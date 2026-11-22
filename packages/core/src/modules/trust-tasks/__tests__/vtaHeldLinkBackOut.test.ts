/**
 * A link the person backed out of while an approval held its key swap must not
 * finish on its own later. 240 gate (R11, then R4): an approval rule held the
 * swap to a second agent; the swap was turned down and the person went back.
 * The temporary key stayed, still granted on that agent, and after the last
 * agent was unlinked the app's own pick-up (IN-135) found it, swapped it and
 * linked an agent the person had left.
 */
import { VtaAgentController } from '../module/vtaAgent'

const mockClient = {
  connect: jest.fn(async () => undefined),
  disconnect: jest.fn(async () => undefined),
  whoAmI: jest.fn(async (_timeoutMs?: number, onSent?: () => void) => {
    onSent?.()
    return { roles: ['admin'] }
  }),
  rotateManagerKey: jest.fn(async (): Promise<string> => 'did:peer:2.permanent'),
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
  createVtiTemporaryDidKey: jest.fn(async () => 'did:key:z6MkFresh'),
}))

type Setter = { set(next: Record<string, unknown>): void }
const HELD = 'did:webvh:Qm:dids.example:prague'
const NOW = Date.parse('2026-10-13T22:19:00Z')
const tick = () => new Promise((resolve) => setImmediate(resolve))

function controller() {
  const store = new Map<string, Record<string, unknown>>([
    [
      HELD,
      {
        vtaDid: HELD,
        did: 'did:key:z6MkHeld',
        createdAt: new Date(NOW - 3 * 60 * 1000).toISOString(),
        stage: 'temporary',
      },
    ],
  ])
  const forgetManager = jest.fn(async (did: string) => void store.delete(did))
  const links = {
    get: jest.fn(async () => undefined),
    set: jest.fn(async () => undefined),
    clear: jest.fn(async () => undefined),
    remove: jest.fn(async () => undefined),
  }
  const vta = new VtaAgentController()
  vta.configure({
    now: () => NOW,
    linkStore: () => links as never,
    identityStore: () =>
      ({
        getManager: async (did: string) => store.get(did),
        setManager: async (m: Record<string, unknown>) => void store.set(m.vtaDid as string, m),
        forgetManager,
        listManagers: async () => [...store.values()],
      }) as never,
  })
  ;(vta as unknown as { agent: unknown }).agent = {}
  return { vta, forgetManager, links }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockClient.rotateManagerKey.mockImplementation(async () => 'did:peer:2.permanent')
})

describe('backing out of a link held for an approval', () => {
  it('from the "held" failure: the key goes, and nothing links once the phone has no agent', async () => {
    const { vta, forgetManager } = controller()
    ;(vta as unknown as Setter).set({
      link: { kind: 'notLinked', lastError: { reason: 'failed', vtaDid: HELD, label: 'prague', swap: 'held' } },
    })
    vta.cancelLink()
    await tick()
    expect(forgetManager).toHaveBeenCalledWith(HELD)

    // Later the last agent is unlinked: notLinked, no failure on screen.
    ;(vta as unknown as Setter).set({ link: { kind: 'notLinked' } })
    expect(await vta.resumeLink({} as never)).toBe(false)
    expect(mockClient.rotateManagerKey).not.toHaveBeenCalled()
    expect(vta.getState().link.kind).toBe('notLinked')
  })

  it('while the swap is held: not offered again, the key goes when the swap settles, and the agent gone back to stays', async () => {
    const { vta, forgetManager, links } = controller()
    let turnDown: (error: Error) => void = () => undefined
    mockClient.rotateManagerKey.mockImplementation(() => new Promise<string>((_resolve, reject) => (turnDown = reject)))
    ;(vta as unknown as Setter).set({
      link: { kind: 'showingKey', vtaDid: HELD, label: 'prague', did: 'did:key:z6MkHeld', checking: false },
    })
    const check = vta.checkManualGrant({} as never)
    for (let i = 0; i < 20 && vta.getState().link.kind !== 'linking'; i++) await tick()
    for (let i = 0; i < 20 && mockClient.rotateManagerKey.mock.calls.length === 0; i++) await tick()
    expect(vta.getState().link).toMatchObject({ kind: 'linking', step: 'rotating' })

    vta.cancelLink()
    await tick()
    // A rotate is in flight: the key is kept until it settles…
    expect(forgetManager).not.toHaveBeenCalled()
    // …but the app's own pick-up does not offer it.
    expect(await vta.pendingLinkKey({} as never)).toBeUndefined()

    turnDown(new Error('task failed: auth:consent_required'))
    await check
    await tick()
    expect(forgetManager).toHaveBeenCalledWith(HELD)
    // Only the held agent's link record goes, never the current one's.
    expect(links.remove).toHaveBeenCalledWith(HELD)
    expect(links.clear).not.toHaveBeenCalled()
  })

  it('linking that agent again afterwards is the person asking: it is offered as usual', async () => {
    const { vta } = controller()
    ;(vta as unknown as Setter).set({
      link: { kind: 'linking', step: 'rotating', vtaDid: HELD, label: 'prague' },
    })
    vta.cancelLink()
    ;(vta as unknown as Setter).set({ link: { kind: 'notLinked' } })
    expect(await vta.pendingLinkKey({} as never)).toBeUndefined()
    await vta.startManualLink({} as never, HELD, 'prague')
    expect(vta.getState().link).toMatchObject({ kind: 'showingKey', did: 'did:key:z6MkHeld' })
    ;(vta as unknown as Setter).set({ link: { kind: 'notLinked' } })
    expect(await vta.pendingLinkKey({} as never)).toMatchObject({ vtaDid: HELD })
  })
})
