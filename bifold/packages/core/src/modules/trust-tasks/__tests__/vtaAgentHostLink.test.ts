/**
 * An agent host's automatic connection, through the controller: the person is
 * asked first, the phone's did:key goes to the host, the phone waits while the
 * host sets the agent up, then signs in and rotates like every link, and tells
 * the host it connected. Every step moves the one state the screens read.
 */
import { VtaAgentController } from '../module/vtaAgent'
import type { AgentHostOffer } from '../module/agentHostConnection'

const mockClient = {
  connect: jest.fn(async () => undefined),
  disconnect: jest.fn(async () => undefined),
  whoAmI: jest.fn(async (_timeoutMs?: number, _onSent?: () => void) => ({ roles: ['admin'] })),
  rotateManagerKey: jest.fn(async () => 'did:peer:2.permanent'),
  agentLabel: jest.fn(async (): Promise<{ label: string; source: string } | undefined> => undefined),
  labelAclEntry: jest.fn(async () => undefined),
  managerDid: 'did:peer:2.permanent',
  isConnected: false,
  holdPersonaKeys: jest.fn(async () => false),
  task: jest.fn(async () => ({})),
  dropQueued: jest.fn(),
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

const VTA = 'did:webvh:QmXo:dids.ic3.dev:keyring-runner-vta'
const CALLBACK = 'https://vtafarm-api.ic3.dev/api/v1/mobile-connections/callback/req.SECRET'
const PROGRESS = 'https://vtafarm-api.ic3.dev/api/v1/mobile-connections/req'
const COMPLETE = `${PROGRESS}/complete`
const hostOffer: AgentHostOffer = { vtaDid: VTA, callbackUrl: CALLBACK, host: 'vtafarm-api.ic3.dev' }

type Reply = { status: number; body?: unknown }
function mockHost(routes: Record<string, Reply[]>) {
  const calls: Array<{ url: string; method: string; body?: unknown }> = []
  const fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body as string) : undefined })
    const queue = routes[url]
    const next = queue.length > 1 ? queue.shift()! : queue[0]
    return { status: next.status, ok: next.status < 300, json: async () => next.body } as unknown as Response
  })
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls }
}
const accepted = {
  connection: { request_id: 'req', status: 'provisioning', vta_did: VTA },
  progress_token: 'TOKEN',
  progress_url: PROGRESS,
  completion_url: COMPLETE,
  progress_expires_at: '2099-01-01T00:00:00Z',
}
const at = (status: string, extra: Record<string, unknown> = {}): Reply => ({
  status: 200,
  body: { connection: { request_id: 'req', status, vta_did: VTA, ...extra } },
})

function controller(
  host: ReturnType<typeof mockHost>,
  overrides: { canOwn?: boolean; sleep?: (ms: number) => Promise<void> } = {}
) {
  const saved: unknown[] = []
  const managers: unknown[] = []
  const vta = new VtaAgentController()
  vta.configure({
    now: () => 1_000,
    fetch: host.fetch,
    linkStore: () => ({
      get: async () => undefined,
      set: async (link) => void saved.push(link),
      clear: async () => undefined,
    }),
    identityStore: () => ({ setManager: async (m: unknown) => void managers.push(m) }) as never,
    deviceCanOwn: async () => overrides.canOwn ?? true,
    agentHost: { sleep: overrides.sleep ?? (async () => undefined) },
    hostSignInRetryMs: 1,
  })
  return { vta, saved, managers }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockClient.connect.mockImplementation(async () => undefined)
  mockClient.whoAmI.mockImplementation(async () => ({ roles: ['admin'] }))
})

describe('an agent host’s automatic connection', () => {
  it('asks first, naming the agent and the host’s site — and sends nothing yet', () => {
    const host = mockHost({})
    const { vta } = controller(host)
    vta.scanHostOffer(hostOffer)
    expect(vta.getState().link).toMatchObject({
      kind: 'confirming',
      via: 'host',
      vtaDid: VTA,
      label: 'dids.ic3.dev',
      offerUrl: 'vtafarm-api.ic3.dev',
    })
    // The callback is a credential: it is not in the state the screens read.
    expect(JSON.stringify(vta.getState())).not.toContain('SECRET')
    expect(host.calls).toEqual([])
  })

  it('confirmed: sends the did:key, waits for the host, links, rotates, and reports connected', async () => {
    const host = mockHost({
      [CALLBACK]: [{ status: 202, body: accepted }],
      [PROGRESS]: [at('provisioning'), at('awaiting_mobile')],
      [COMPLETE]: [at('connected')],
    })
    const { vta, saved, managers } = controller(host)
    vta.scanHostOffer(hostOffer)
    await vta.confirmOffer({} as never)
    expect(host.calls[0]).toMatchObject({ url: CALLBACK, method: 'POST', body: { admin_did: 'did:key:z6Mktemporary' } })
    expect(managers).toEqual([
      expect.objectContaining({ vtaDid: VTA, did: 'did:key:z6Mktemporary', stage: 'temporary' }),
    ])
    expect(mockClient.rotateManagerKey).toHaveBeenCalled()
    // Created from this phone: remembered as its own.
    expect(saved).toEqual([expect.objectContaining({ vtaDid: VTA, owner: true })])
    expect(vta.getState().link).toMatchObject({ kind: 'linked', vtaDid: VTA })
    expect(vta.getState().ownsAgent).toBe(true)
    expect(host.calls.at(-1)).toMatchObject({ url: COMPLETE, method: 'POST', body: { status: 'connected' } })
  })

  it('shows "setting up" while the host provisions, with no code to compare', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => (release = resolve))
    const host = mockHost({
      [CALLBACK]: [{ status: 202, body: accepted }],
      [PROGRESS]: [at('provisioning'), at('awaiting_mobile')],
      [COMPLETE]: [at('connected')],
    })
    const { vta } = controller(host, { sleep: () => gate })
    vta.scanHostOffer(hostOffer)
    const done = vta.confirmOffer({} as never)
    await new Promise((resolve) => setImmediate(resolve))
    await new Promise((resolve) => setImmediate(resolve))
    expect(vta.getState().link).toMatchObject({ kind: 'awaitingGrant', via: 'host', code: '' })
    release()
    await done
    expect(vta.getState().link.kind).toBe('linked')
  })

  it('signs in again while the restarted agent does not know this phone yet', async () => {
    let tries = 0
    mockClient.whoAmI.mockImplementation(async () => {
      if (++tries < 3) throw new Error('not in ACL')
      return { roles: ['admin'] }
    })
    const host = mockHost({
      [CALLBACK]: [{ status: 202, body: accepted }],
      [PROGRESS]: [at('awaiting_mobile')],
      [COMPLETE]: [at('connected')],
    })
    const { vta } = controller(host)
    vta.scanHostOffer(hostOffer)
    await vta.confirmOffer({} as never)
    expect(vta.getState().link.kind).toBe('linked')
  })

  it.each([
    [410, 'expired', 'expired'],
    [409, 'taken', 'refused'],
    [503, 'unavailable', 'unreachable'],
  ])('a callback %i ends the attempt as %s, nothing remembered', async (status, hostReason, reason) => {
    const host = mockHost({ [CALLBACK]: [{ status, body: {} }] })
    const { vta, saved } = controller(host)
    vta.scanHostOffer(hostOffer)
    await vta.confirmOffer({} as never)
    expect(vta.getState().link).toMatchObject({ kind: 'notLinked', lastError: { reason, hostReason } })
    expect(saved).toEqual([])
  })

  it('a host that could not set the agent up says so', async () => {
    const host = mockHost({
      [CALLBACK]: [{ status: 202, body: accepted }],
      [PROGRESS]: [at('failed', { error: 'deployment failed' })],
    })
    const { vta } = controller(host)
    vta.scanHostOffer(hostOffer)
    await vta.confirmOffer({} as never)
    expect(vta.getState().link).toMatchObject({ kind: 'notLinked', lastError: { hostReason: 'setupFailed' } })
    expect(mockClient.connect).not.toHaveBeenCalled()
  })

  it('a phone with no screen lock is refused before anything is made or sent', async () => {
    const host = mockHost({ [CALLBACK]: [{ status: 202, body: accepted }] })
    const { vta, managers } = controller(host, { canOwn: false })
    vta.scanHostOffer(hostOffer)
    await vta.confirmOffer({} as never)
    expect(vta.getState().link).toMatchObject({ kind: 'notLinked', lastError: { hostReason: 'needsScreenLock' } })
    expect(host.calls).toEqual([])
    expect(managers).toEqual([])
  })

  it('Stop while the host sets up ends it quietly: no error, no more calls, not linked', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => (release = resolve))
    const host = mockHost({
      [CALLBACK]: [{ status: 202, body: accepted }],
      [PROGRESS]: [at('provisioning')],
    })
    const { vta } = controller(host, { sleep: () => gate })
    vta.scanHostOffer(hostOffer)
    const done = vta.confirmOffer({} as never)
    await new Promise((resolve) => setImmediate(resolve))
    await new Promise((resolve) => setImmediate(resolve))
    vta.cancelLink()
    const callsAtCancel = host.calls.length
    release()
    await done
    expect(vta.getState().link).toEqual({ kind: 'notLinked' })
    expect(host.calls).toHaveLength(callsAtCancel)
  })

  it('a completion report that fails leaves the phone linked', async () => {
    const host = mockHost({
      [CALLBACK]: [{ status: 202, body: accepted }],
      [PROGRESS]: [at('awaiting_mobile')],
      [COMPLETE]: [{ status: 410, body: {} }],
    })
    const { vta } = controller(host)
    vta.scanHostOffer(hostOffer)
    await vta.confirmOffer({} as never)
    expect(vta.getState().link.kind).toBe('linked')
  })

  it('a scanned enrolment offer after a host offer replaces it', () => {
    const { vta } = controller(mockHost({}))
    vta.scanHostOffer(hostOffer)
    vta.scanOffer({
      v: 1,
      t: 'vta-enrol',
      vta: 'did:webvh:Qm:alice',
      label: 'Lab',
      url: 'http://p/o',
      n: 'N',
      exp: 2e9,
    })
    expect(vta.getState().link).not.toHaveProperty('via')
  })
})
