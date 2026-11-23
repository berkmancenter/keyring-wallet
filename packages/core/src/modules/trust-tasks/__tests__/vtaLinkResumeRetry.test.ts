/**
 * A link picked back up after a relaunch is checked once (IN-135). When that one check gets no answer in time (a slow
 * network, a busy agent; the 1018-2239 gate's runner), the link sat on "Continue linking" though the agent had
 * granted it. Now it is checked again after 5, 15 and 45 s while the app is in the foreground and the same key is
 * still shown unanswered: only after no answer, never after "not added yet" or a refusal, and any change ends it.
 */
import { AppState } from 'react-native'

import { RESUME_RETRY_DELAYS_MS, VtaAgentController } from '../module/vtaAgent'

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
const VTA = 'did:webvh:Qm:dids.example:home'
const NOW = Date.parse('2026-10-19T12:00:00Z')
/** A connect this short counts as no answer, so a hung connect is a quick "no answer" here. */
const CONNECT_MS = 100
const hang = () => new Promise<undefined>(() => undefined)

let appState = 'active'
let appStateHandlers: ((next: string) => void)[] = []

function controller() {
  const managers = new Map([
    [
      VTA,
      {
        vtaDid: VTA,
        did: 'did:key:z6MkEarlier',
        createdAt: new Date(NOW - 5 * 60 * 1000).toISOString(),
        stage: 'temporary',
      },
    ],
  ])
  const vta = new VtaAgentController()
  vta.configure({
    now: () => NOW,
    grantConnectDeadlineMs: CONNECT_MS,
    linkStore: () => ({ get: async () => undefined, set: async () => undefined, clear: async () => undefined }),
    identityStore: () =>
      ({
        getManager: async (did: string) => managers.get(did),
        setManager: async (m: { vtaDid: string }) => void managers.set(m.vtaDid, m as never),
        forgetManager: async (did: string) => void managers.delete(did),
        listManagers: async () => [...managers.values()],
      }) as never,
  } as never)
  ;(vta as unknown as Setter).set({ link: { kind: 'notLinked' } })
  return vta
}

/** Pick the link up as a relaunch does, its first check running out of time. */
async function resumedUnanswered(vta: VtaAgentController) {
  const resumed = vta.resumeLink({} as never)
  await jest.advanceTimersByTimeAsync(CONNECT_MS + 10)
  await resumed
  expect(vta.getState().link).toMatchObject({ kind: 'showingKey', resumed: true, noAnswer: true, checking: false })
}

beforeEach(() => {
  jest.useFakeTimers({ now: NOW })
  jest.clearAllMocks()
  mockClient.connect.mockImplementation(async () => undefined)
  appState = 'active'
  appStateHandlers = []
  Object.defineProperty(AppState, 'currentState', { configurable: true, get: () => appState })
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, handler: (next: string) => void) => {
    appStateHandlers.push(handler)
    return { remove: () => (appStateHandlers = appStateHandlers.filter((h) => h !== handler)) }
  }) as never)
})
afterEach(() => {
  jest.useRealTimers()
  jest.restoreAllMocks()
})

describe('a resumed link whose one check got no answer', () => {
  it('is checked again after 5 s, and links by itself once the agent answers', async () => {
    mockClient.connect.mockImplementationOnce(hang)
    const vta = controller()
    await resumedUnanswered(vta)
    expect(mockClient.connect).toHaveBeenCalledTimes(1)

    // The 5 s count starts when the first check gave up, a little before resumedUnanswered's own wait ended.
    await jest.advanceTimersByTimeAsync(RESUME_RETRY_DELAYS_MS[0] - 2 * CONNECT_MS)
    expect(mockClient.connect).toHaveBeenCalledTimes(1)
    await jest.advanceTimersByTimeAsync(3 * CONNECT_MS)
    expect(mockClient.connect).toHaveBeenCalledTimes(2)
    // The link's own last steps (the key swap) may wait on timers of their own.
    await jest.advanceTimersByTimeAsync(1000)
    expect(vta.getState().link.kind).toBe('linked')
  })

  it('is checked three more times at most (5, 15, 45 s), then left to the person', async () => {
    mockClient.connect.mockImplementation(hang)
    const vta = controller()
    await resumedUnanswered(vta)
    for (const delay of RESUME_RETRY_DELAYS_MS) await jest.advanceTimersByTimeAsync(delay + CONNECT_MS + 10)
    expect(mockClient.connect).toHaveBeenCalledTimes(1 + RESUME_RETRY_DELAYS_MS.length)
    await jest.advanceTimersByTimeAsync(10 * 60 * 1000)
    expect(mockClient.connect).toHaveBeenCalledTimes(1 + RESUME_RETRY_DELAYS_MS.length)
    expect(vta.getState().link).toMatchObject({ kind: 'showingKey', noAnswer: true })
  })

  it('in the background waits, and checks at once back in the foreground', async () => {
    mockClient.connect.mockImplementationOnce(hang)
    const vta = controller()
    await resumedUnanswered(vta)
    appState = 'background'
    await jest.advanceTimersByTimeAsync(60 * 1000)
    expect(mockClient.connect).toHaveBeenCalledTimes(1)
    appState = 'active'
    appStateHandlers.forEach((h) => h('active'))
    await jest.advanceTimersByTimeAsync(CONNECT_MS)
    expect(mockClient.connect).toHaveBeenCalledTimes(2)
    await jest.advanceTimersByTimeAsync(1000)
    expect(vta.getState().link.kind).toBe('linked')
    expect(appStateHandlers).toHaveLength(0)
  })

  it.each([
    [
      'linked',
      // The person taps "Continue linking" meanwhile, and the agent answers (the real way to linked).
      async (vta: VtaAgentController) => {
        await vta.checkManualGrant({} as never)
        await jest.advanceTimersByTimeAsync(1000)
      },
      'linked',
    ],
    [
      'refused',
      async (vta: VtaAgentController) =>
        (vta as unknown as { dispatch(e: unknown): void }).dispatch({ type: 'failed', failure: { reason: 'refused' } }),
      'notLinked',
    ],
  ])('a wait for the foreground ends when the link is %s meanwhile: no listener stays', async (_, end, kind) => {
    mockClient.connect.mockImplementationOnce(hang)
    const vta = controller()
    await resumedUnanswered(vta)
    appState = 'background'
    await jest.advanceTimersByTimeAsync(RESUME_RETRY_DELAYS_MS[0] + 10)
    expect(mockClient.connect).toHaveBeenCalledTimes(1)
    expect(appStateHandlers).toHaveLength(1)
    await end(vta)
    expect(vta.getState().link.kind).toBe(kind)
    expect(appStateHandlers).toHaveLength(0)
  })

  it('ends when the link changes: the person cancels', async () => {
    mockClient.connect.mockImplementation(hang)
    const vta = controller()
    await resumedUnanswered(vta)
    vta.cancelLink()
    await jest.advanceTimersByTimeAsync(2 * 60 * 1000)
    expect(mockClient.connect).toHaveBeenCalledTimes(1)
    expect(appStateHandlers).toHaveLength(0)
  })
})

describe('a resumed link whose check was answered', () => {
  it('"not added yet" is not checked again by itself: that is the person\'s or the host\'s move', async () => {
    mockClient.whoAmI.mockRejectedValueOnce(new Error('caller is not in the ACL'))
    const vta = controller()
    await vta.resumeLink({} as never)
    expect(vta.getState().link).toMatchObject({ kind: 'showingKey', notYet: true })
    await jest.advanceTimersByTimeAsync(2 * 60 * 1000)
    expect(mockClient.connect).toHaveBeenCalledTimes(1)
  })
})
