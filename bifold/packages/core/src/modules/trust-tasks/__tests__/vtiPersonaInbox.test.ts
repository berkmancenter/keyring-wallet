/**
 * The mockPersona inbox: a grant sent while the person is elsewhere is stored and
 * announced, the session is opened only when nothing holds it, and the
 * listener exists before the connect (so a drained backlog is not missed).
 */
import { DeviceEventEmitter } from 'react-native'

const mockHandlers: Array<(m: unknown) => void> = []
const mockOrder: string[] = []
const mockAgentState = { isConnected: false, status: 'disconnected' as string }
jest.mock('../module/vtiAgent', () => ({
  vtiAgent: {
    onInbound: (h: (m: unknown) => void) => {
      mockOrder.push('listen')
      mockHandlers.push(h)
      return () => mockHandlers.splice(mockHandlers.indexOf(h), 1)
    },
    getState: () => ({ status: mockAgentState.status }),
    get isConnected() {
      return mockAgentState.isConnected
    },
    connect: jest.fn(async () => {
      mockOrder.push('connect')
      mockAgentState.isConnected = true
    }),
  },
}))
const mockPersona = {
  did: 'did:webvh:p:host:craft-fatal',
  communityDid: 'did:webvh:c:host',
  createdAt: '2026-09-22T00:00:00Z',
  kmsKeyIds: { keyAgreement: 'ka', signing: 'sig' },
}
jest.mock('../module/VtiIdentityStore', () => ({
  GenericRecordsIdentityStore: jest.fn().mockImplementation(() => ({
    getPersona: async (c: string) => (c === mockPersona.communityDid ? mockPersona : null),
    listPersonas: async () => [mockPersona],
  })),
}))
jest.mock('../module/VtiCommunityStore', () => ({ GenericRecordsCommunityStore: jest.fn().mockImplementation(() => ({})) }))
jest.mock('../module/vtiTsp', () => ({ GenericRecordsTspPeerRevisionStore: jest.fn() }))
const mockReceiveIssue = jest.fn()
jest.mock('../module/vtiInbox', () => ({ receiveIssue: (...a: unknown[]) => mockReceiveIssue(...a) }))

import { startPersonaInbox as start, VTI_PERSONA_DELIVERIES_EVENT } from '../module/vtiPersonaInbox'
import { vtiAgent } from '../module/vtiAgent'

const agent = {} as never
const flush = () => new Promise((r) => setTimeout(r, 0))
// Every inbox a test starts is stopped, even when an expectation fails first.
const running: Array<() => void> = []
const startPersonaInbox = (...a: Parameters<typeof start>) => {
  const stop = start(...a)
  running.push(stop)
  return stop
}
afterEach(() => running.splice(0).forEach((stop) => stop()))

describe('startPersonaInbox', () => {
  beforeEach(() => {
    mockHandlers.length = 0
    mockOrder.length = 0
    mockAgentState.isConnected = false
    mockAgentState.status = 'disconnected'
    ;(vtiAgent.connect as jest.Mock).mockClear()
    mockReceiveIssue.mockReset()
  })

  it('listens before it connects, as the persona', async () => {
    const stop = startPersonaInbox(agent, { mediatorDid: 'did:peer:m', intervalMs: 60_000 })
    await flush()
    expect(mockOrder).toEqual(['listen', 'connect'])
    expect((vtiAgent.connect as jest.Mock).mock.calls[0][2].persona.did).toBe(mockPersona.did)
    stop()
  })

  it('stores a grant and announces it', async () => {
    mockReceiveIssue.mockResolvedValue([{ kind: 'vetter-grant', communityDid: mockPersona.communityDid }])
    const seen: unknown[] = []
    const sub = DeviceEventEmitter.addListener(VTI_PERSONA_DELIVERIES_EVENT, (e) => seen.push(e))
    const stop = startPersonaInbox(agent, { mediatorDid: 'did:peer:m', communityDid: mockPersona.communityDid, intervalMs: 60_000 })
    await flush()
    mockHandlers[0]({ type: 'https://trusttasks.org/spec/credential-exchange/issue/0.1' })
    await flush()
    expect(mockReceiveIssue).toHaveBeenCalledWith(expect.anything(), mockPersona.did, expect.anything())
    expect(seen).toEqual([{ communityDid: mockPersona.communityDid, kinds: ['vetter-grant'] }])
    sub.remove()
    stop()
  })

  it('never takes a session another flow holds', async () => {
    mockAgentState.isConnected = true
    const stop = startPersonaInbox(agent, { mediatorDid: 'did:peer:m', intervalMs: 60_000 })
    await flush()
    expect(vtiAgent.connect).not.toHaveBeenCalled()
    mockAgentState.isConnected = false
    mockAgentState.status = 'authenticating'
    stop()
    const stop2 = startPersonaInbox(agent, { mediatorDid: 'did:peer:m', intervalMs: 60_000 })
    await flush()
    expect(vtiAgent.connect).not.toHaveBeenCalled()
    stop2()
  })

  it('does nothing without a persona for the community, and stops listening when stopped', async () => {
    const stop = startPersonaInbox(agent, { mediatorDid: 'did:peer:m', communityDid: 'did:webvh:other', intervalMs: 60_000 })
    await flush()
    expect(vtiAgent.connect).not.toHaveBeenCalled()
    expect(mockHandlers).toHaveLength(1)
    stop()
    expect(mockHandlers).toHaveLength(0)
  })
})
