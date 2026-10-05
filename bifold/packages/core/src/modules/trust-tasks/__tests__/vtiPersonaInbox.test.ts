/**
 * The mockPersona inbox: a grant sent while the person is elsewhere is stored and
 * announced, the session is opened only when nothing holds it, and the
 * listener exists before the connect (so a drained backlog is not missed).
 */
import { DeviceEventEmitter } from 'react-native'

const mockHandlers: Array<(m: unknown) => void> = []
const mockOrder: string[] = []
const mockAgentState = {
  isConnected: false,
  status: 'disconnected' as string,
  signingInAs: undefined as string | undefined,
  /** Whom the session is connected as, when not this inbox's persona. */
  otherDid: undefined as string | undefined,
}
const mockAgentListeners = new Set<() => void>()
const mockAgentChanged = () => mockAgentListeners.forEach((l) => l())
jest.mock('../module/vtiAgent', () => ({
  vtiAgent: {
    subscribe: (l: () => void) => {
      mockAgentListeners.add(l)
      return () => mockAgentListeners.delete(l)
    },
    onInbound: (h: (m: unknown) => void) => {
      mockOrder.push('listen')
      mockHandlers.push(h)
      return () => mockHandlers.splice(mockHandlers.indexOf(h), 1)
    },
    getState: () => ({
      status: mockAgentState.status,
      did: mockAgentState.otherDid ?? (mockAgentState.isConnected ? mockPersona.did : undefined),
      signingInAs: mockAgentState.signingInAs,
    }),
    get isConnected() {
      return mockAgentState.isConnected
    },
    connect: jest.fn(async () => {
      mockOrder.push('connect')
      mockAgentState.isConnected = true
    }),
  },
}))
/** What listPersonas returns, when a test sets it: every agent's identities on this phone. */
let mockPersonas: Array<typeof mockPersona> | undefined
const mockPersona = {
  did: 'did:webvh:p:host:craft-fatal',
  communityDid: 'did:webvh:c:host',
  createdAt: '2026-09-22T00:00:00Z',
  kmsKeyIds: { keyAgreement: 'ka', signing: 'sig' },
}
jest.mock('../module/VtiIdentityStore', () => ({
  GenericRecordsIdentityStore: jest.fn().mockImplementation(() => ({
    getPersona: async (c: string) => (c === mockPersona.communityDid ? mockPersona : null),
    listPersonas: async () => mockPersonas ?? [mockPersona],
  })),
}))
const mockSaveInvitation = jest.fn(async () => undefined)
jest.mock('../module/VtiCommunityStore', () => ({
  GenericRecordsCommunityStore: jest.fn().mockImplementation(() => ({ saveInvitation: mockSaveInvitation })),
}))
const mockRedeem = jest.fn()
jest.mock('../module/vtiInvitationOffer', () => {
  const actual = jest.requireActual('../module/vtiInvitationOffer')
  return { ...actual, redeemInvitationOffer: (...a: unknown[]) => mockRedeem(...a) }
})
jest.mock('../module/vtiTsp', () => ({ GenericRecordsTspPeerRevisionStore: jest.fn() }))
const mockReceiveIssue = jest.fn()
jest.mock('../module/vtiInbox', () => ({ receiveIssue: (...a: unknown[]) => mockReceiveIssue(...a) }))
const mockReceiveStatement = jest.fn(async () => undefined)
const mockForgetApplication = jest.fn(async () => undefined)
jest.mock('../module/vtiVetting', () => ({
  GenericRecordsVettingStore: jest.fn().mockImplementation(() => ({ forgetApplication: mockForgetApplication })),
  VtiApplicant: jest.fn().mockImplementation(() => ({ receiveStatement: mockReceiveStatement })),
}))
const mockReceiveNotice = jest.fn(async (): Promise<string> => 'ignored')
jest.mock('../module/vtiCommunityNotices', () => ({
  ...jest.requireActual('../module/vtiCommunityNotices'),
  receiveCommunityNotice: (...a: unknown[]) => mockReceiveNotice(...(a as [])),
}))

import { setCurrentAgentDid } from '../module/currentAgent'
import { startPersonaInbox as start, VTI_PERSONA_DELIVERIES_EVENT } from '../module/vtiPersonaInbox'
import { VTI_PERSONA_KEYS_HELD_EVENT } from '../module/communityChanged'
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
  // 227 gate, Android lock probe: after an unlock the inbox asked the mediator
  // to sign in before the persona's keys were back in memory, could not sign,
  // and waited for its next look — ~30 s of community messages not arriving
  // while the agent itself was back in 2 s. The keys coming back is the cue.
  describe('after an unlock', () => {
    const connect = vtiAgent.connect as jest.Mock
    beforeEach(() => {
      mockOrder.length = 0
      mockAgentState.isConnected = false
      mockAgentState.status = 'disconnected'
      connect.mockClear()
      mockAgentListeners.clear()
    })

    it("signs in again the moment the persona's keys are back, not at its next look", async () => {
      connect.mockRejectedValueOnce(new Error('key not found: sig')).mockImplementationOnce(async () => {
        mockAgentState.isConnected = true
      })
      startPersonaInbox(agent, { mediatorDid: 'did:peer:m', intervalMs: 60_000 })
      await flush()
      expect(vtiAgent.connect).toHaveBeenCalledTimes(1)

      DeviceEventEmitter.emit(VTI_PERSONA_KEYS_HELD_EVENT, { did: mockPersona.did })
      await flush()
      expect(vtiAgent.connect).toHaveBeenCalledTimes(2)
      expect(mockAgentState.isConnected).toBe(true)
    })

    it("does not stir for another identity's keys", async () => {
      connect.mockRejectedValueOnce(new Error('key not found: sig'))
      startPersonaInbox(agent, { mediatorDid: 'did:peer:m', intervalMs: 60_000 })
      await flush()
      DeviceEventEmitter.emit(VTI_PERSONA_KEYS_HELD_EVENT, { did: 'did:webvh:p:host:someone-else' })
      await flush()
      expect(vtiAgent.connect).toHaveBeenCalledTimes(1)
    })

    // 228 lab check (09-29, bob): the unlock restarted the inbox, so the cue
    // and the new inbox's first look both met the OLD inbox's sign-in still in
    // flight (vtiAgent busy) and were dropped; the identity signed in only at
    // the next look, 29.4 s after the agent. A look that meets someone else's
    // sign-in waits for it to settle, then looks again.
    it('a look that meets another sign-in in flight looks again once it settles', async () => {
      mockAgentState.status = 'authenticating' // another inbox's attempt, still running
      connect.mockImplementationOnce(async () => {
        mockAgentState.isConnected = true
      })
      startPersonaInbox(agent, { mediatorDid: 'did:peer:m', intervalMs: 60_000 })
      await flush()
      DeviceEventEmitter.emit(VTI_PERSONA_KEYS_HELD_EVENT, { did: mockPersona.did })
      await flush()
      expect(connect).not.toHaveBeenCalled()

      mockAgentState.status = 'failed' // that attempt gave up
      mockAgentChanged()
      await flush()
      expect(connect).toHaveBeenCalledTimes(1)
      expect(mockAgentState.isConnected).toBe(true)
    })

    it('does not stir when the agent changes while nothing waits on it', async () => {
      connect.mockImplementationOnce(async () => {
        mockAgentState.isConnected = true
      })
      startPersonaInbox(agent, { mediatorDid: 'did:peer:m', intervalMs: 60_000 })
      await flush()
      expect(connect).toHaveBeenCalledTimes(1)
      mockAgentChanged()
      mockAgentChanged()
      await flush()
      expect(connect).toHaveBeenCalledTimes(1)
    })

    it('keys that come back while a sign-in is still failing are not missed', async () => {
      let fail: (e: Error) => void = () => undefined
      connect
        .mockImplementationOnce(() => new Promise((_, reject) => (fail = reject)))
        .mockImplementationOnce(async () => {
          mockAgentState.isConnected = true
        })
      startPersonaInbox(agent, { mediatorDid: 'did:peer:m', intervalMs: 60_000 })
      await flush()
      DeviceEventEmitter.emit(VTI_PERSONA_KEYS_HELD_EVENT, { did: mockPersona.did })
      fail(new Error('key not found: sig'))
      await flush()
      await flush()
      expect(vtiAgent.connect).toHaveBeenCalledTimes(2)
      expect(mockAgentState.isConnected).toBe(true)
    })
  })

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

  // IN-114 (237): a second agent current, the inbox signed in as the first
  // agent's newer persona, whose key is borrowed only while that agent is
  // connected — "key not found", then "no persona yet".
  describe('with identities under two agents', () => {
    const A = 'did:webvh:a:host:vta-a'
    const B = 'did:webvh:b:host:vta-b'
    const olderUnderA = {
      ...mockPersona,
      did: 'did:webvh:p:host:under-a',
      vtaDid: A,
      createdAt: '2026-09-01T00:00:00Z',
    }
    const newerUnderB = {
      ...mockPersona,
      did: 'did:webvh:p:host:under-b',
      vtaDid: B,
      createdAt: '2026-10-01T00:00:00Z',
    }
    afterEach(() => {
      mockPersonas = undefined
      setCurrentAgentDid(undefined)
    })

    it("signs in as the current agent's latest identity, never another agent's newer one", async () => {
      mockPersonas = [olderUnderA, newerUnderB]
      setCurrentAgentDid(A)
      startPersonaInbox(agent, { mediatorDid: 'did:peer:m', intervalMs: 60_000 })
      await flush()
      expect((vtiAgent.connect as jest.Mock).mock.calls[0][2].persona.did).toBe(olderUnderA.did)
    })

    it('signs in as nobody when the current agent holds no identity on this phone', async () => {
      mockPersonas = [newerUnderB]
      setCurrentAgentDid(A)
      startPersonaInbox(agent, { mediatorDid: 'did:peer:m', intervalMs: 60_000 })
      await flush()
      expect(vtiAgent.connect).not.toHaveBeenCalled()
    })
  })

  it('stores a grant and announces it', async () => {
    mockReceiveIssue.mockResolvedValue([{ kind: 'vetter-grant', communityDid: mockPersona.communityDid }])
    const seen: unknown[] = []
    const sub = DeviceEventEmitter.addListener(VTI_PERSONA_DELIVERIES_EVENT, (e) => seen.push(e))
    const stop = startPersonaInbox(agent, {
      mediatorDid: 'did:peer:m',
      communityDid: mockPersona.communityDid,
      intervalMs: 60_000,
    })
    await flush()
    mockHandlers[0]({ type: 'https://trusttasks.org/spec/credential-exchange/issue/0.1' })
    await flush()
    expect(mockReceiveIssue).toHaveBeenCalledWith(
      expect.anything(),
      mockPersona.did,
      expect.anything(),
      expect.anything()
    )
    expect(seen).toEqual([{ communityDid: mockPersona.communityDid, kinds: ['vetter-grant'] }])
    sub.remove()
    stop()
  })

  // IN-104: an application gathered by the removed identity read, on joining
  // again, as statements held — "Join, admitted straight away" for a request
  // that carried none. A removal ends the application with the membership.
  it('a removal notice clears the vetting application for that community; a join receipt does not', async () => {
    startPersonaInbox(agent, { mediatorDid: 'did:peer:m', communityDid: mockPersona.communityDid, intervalMs: 60_000 })
    await flush()
    mockForgetApplication.mockClear()
    mockReceiveNotice.mockResolvedValueOnce('acknowledged')
    mockHandlers[0]({ type: 'https://trusttasks.org/spec/vtc/join-requests/submit-receipt/0.1' })
    await flush()
    expect(mockForgetApplication).not.toHaveBeenCalled()
    mockReceiveNotice.mockResolvedValueOnce('removed')
    mockHandlers[0]({ type: 'https://trusttasks.org/spec/vtc/members/removal-notice/0.1' })
    await flush()
    expect(mockForgetApplication).toHaveBeenCalledWith(mockPersona.communityDid)
  })

  it("hands a vetter's statement to the applicant's full check, never storing it itself", async () => {
    // Until PR D the inbox stored every statement as it came, and the
    // checklist counted it (conformance inventory, the statement bypass).
    mockReceiveIssue.mockResolvedValue([])
    const stop = startPersonaInbox(agent, {
      mediatorDid: 'did:peer:m',
      communityDid: mockPersona.communityDid,
      intervalMs: 60_000,
    })
    await flush()
    const issue = { type: 'https://trusttasks.org/spec/credential-exchange/issue/0.1' }
    mockHandlers[0](issue)
    await flush()
    const options = mockReceiveIssue.mock.calls[0][3] as { acceptStatement?: (m: unknown) => Promise<void> }
    expect(options?.acceptStatement).toEqual(expect.any(Function))
    await options.acceptStatement!(issue)
    expect(mockReceiveStatement).toHaveBeenCalledWith(issue)
    stop()
  })

  it('stores nothing while the session belongs to another identity', async () => {
    mockReceiveIssue.mockResolvedValue([{ kind: 'vetter-grant', communityDid: mockPersona.communityDid }])
    mockAgentState.isConnected = true // held by another flow…
    const stop = startPersonaInbox(agent, { mediatorDid: 'did:peer:m', intervalMs: 60_000 })
    await flush()
    mockAgentState.otherDid = 'did:webvh:p:host:someone-else' // …and now connected as nobody this inbox knows
    try {
      mockHandlers[0]({ type: 'https://trusttasks.org/spec/credential-exchange/issue/0.1' })
      await flush()
      expect(mockReceiveIssue).not.toHaveBeenCalled()
    } finally {
      mockAgentState.otherDid = undefined
      stop()
    }
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
    const stop = startPersonaInbox(agent, {
      mediatorDid: 'did:peer:m',
      communityDid: 'did:webvh:other',
      intervalMs: 60_000,
    })
    await flush()
    expect(vtiAgent.connect).not.toHaveBeenCalled()
    expect(mockHandlers).toHaveLength(1)
    stop()
    expect(mockHandlers).toHaveLength(0)
  })
})

describe("a community admin console's Send: a pushed invitation offer", () => {
  const OFFER_TYPE = 'https://trusttasks.org/spec/credential-exchange/offer/0.1'
  const offerFrom = (community: string) => ({
    type: OFFER_TYPE,
    from: community,
    body: {
      credential_offer: {
        credential_configuration_ids: ['VIC'],
        credential_issuer: community,
        grants: { 'urn:ietf:params:oauth:grant-type:pre-authorized_code': { 'pre-authorized_code': 'pac_2' } },
      },
    },
  })
  const invitation = { id: 'urn:uuid:vic', communityDid: mockPersona.communityDid, subjectDid: mockPersona.did }

  beforeEach(() => {
    mockHandlers.length = 0
    mockAgentState.isConnected = false
    mockAgentState.status = 'disconnected'
    mockReceiveIssue.mockReset()
    mockRedeem.mockReset()
    mockSaveInvitation.mockClear()
  })

  async function listening() {
    startPersonaInbox(agent, { mediatorDid: 'did:peer:m', intervalMs: 60_000 })
    await flush()
    expect(mockAgentState.isConnected).toBe(true)
  }

  it('is redeemed as this persona, kept as an invitation, and announced', async () => {
    await listening()
    mockRedeem.mockResolvedValue(invitation)
    const seen: unknown[] = []
    const sub = DeviceEventEmitter.addListener(VTI_PERSONA_DELIVERIES_EVENT, (e) => seen.push(e))
    await mockHandlers[0](offerFrom(mockPersona.communityDid))
    sub.remove()
    expect(mockRedeem).toHaveBeenCalledWith(
      agent,
      { communityDid: mockPersona.communityDid, configurationIds: ['VIC'], preAuthorizedCode: 'pac_2' },
      mockPersona
    )
    expect(mockSaveInvitation).toHaveBeenCalledWith(invitation)
    expect(seen).toEqual([{ communityDid: mockPersona.communityDid, kinds: ['invitation'] }])
    expect(mockReceiveIssue).not.toHaveBeenCalled()
  })

  it('taken twice (a redelivery), the used code is let go, not retried forever', async () => {
    await listening()
    const { VtiInvitationOfferError } = jest.requireActual('../module/vtiInvitationOffer')
    mockRedeem.mockRejectedValue(new VtiInvitationOfferError('used'))
    await expect(mockHandlers[0](offerFrom(mockPersona.communityDid))).resolves.toBeUndefined()
    expect(mockSaveInvitation).not.toHaveBeenCalled()
  })

  it('a community it cannot reach leaves the message for another try', async () => {
    await listening()
    const { VtiInvitationOfferError } = jest.requireActual('../module/vtiInvitationOffer')
    mockRedeem.mockRejectedValue(new VtiInvitationOfferError('unreachable'))
    await expect(mockHandlers[0](offerFrom(mockPersona.communityDid))).rejects.toMatchObject({ reason: 'unreachable' })
  })

  it("is not taken from anyone but the community it names, nor for another community's identity", async () => {
    await listening()
    // What is not an offer goes on to the issue handler, which takes only issues.
    mockReceiveIssue.mockResolvedValue([])
    const spoofed = { ...offerFrom(mockPersona.communityDid), from: 'did:webvh:QmSomeoneElse:x' }
    await mockHandlers[0](spoofed)
    await mockHandlers[0](offerFrom('did:webvh:QmOtherCommunity:x'))
    expect(mockRedeem).not.toHaveBeenCalled()
  })

  // A notice the inbox would apply, skipped without a word, looks exactly like
  // one that never arrived (lab, 2026-09-29: a removal delivered, nothing applied,
  // nothing logged). The skip says which message and why.
  it('says so when it skips a message it owns because the session is another identity', async () => {
    const warn = jest.fn()
    const logged = { config: { logger: { warn, info: jest.fn(), debug: jest.fn() } } } as never
    startPersonaInbox(logged, { communityDid: mockPersona.communityDid })
    await flush()
    mockAgentState.otherDid = 'did:webvh:p:host:someone-else'
    try {
      mockHandlers.forEach((h) =>
        h({
          type: 'https://trusttasks.org/spec/vtc/members/removal-notice/0.1',
          from: mockPersona.communityDid,
          body: {},
        })
      )
      await flush()
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/persona inbox skipped .*removal-notice.*session/))
    } finally {
      mockAgentState.otherDid = undefined
    }
  })

  // IN-102: the session signed in as another of this phone's identities (a
  // community other than the chosen one) used to drop what came for it, as
  // "no persona". It is kept for that identity now.
  it('keeps what comes for another of this phone’s identities while the session is signed in as it', async () => {
    const warn = jest.fn()
    const logged = { config: { logger: { warn, info: jest.fn(), debug: jest.fn() } } } as never
    startPersonaInbox(logged, { communityDid: 'did:webvh:other:host' })
    await flush()
    mockReceiveNotice.mockClear()
    mockAgentState.isConnected = true // the session is this phone's identity for another community
    mockHandlers.forEach((h) =>
      h({
        type: 'https://trusttasks.org/spec/vtc/members/removal-notice/0.1',
        from: mockPersona.communityDid,
        body: {},
      })
    )
    await flush()
    expect(mockReceiveNotice).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      mockPersona.did,
      expect.anything()
    )
    expect(warn).not.toHaveBeenCalledWith(expect.stringMatching(/persona inbox skipped .*removal-notice/))
  })
})

// 227 gate, Farm: the invitation push never reached the phone, and the persona
// inbox left no line in the Release log. It now says why it did not open the
// session, once per change, and says so when a look has hung.
describe('what the inbox says in the Release log', () => {
  const connect = vtiAgent.connect as jest.Mock
  let warn: jest.SpyInstance
  const lines = () => warn.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith('[VTI] persona inbox'))
  beforeEach(() => {
    mockAgentState.isConnected = false
    mockAgentState.status = 'disconnected'
    connect.mockReset()
    mockAgentListeners.clear()
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  })
  afterEach(() => {
    warn.mockRestore()
    jest.useRealTimers()
  })

  it('says there is no persona for the community once, not at every look', async () => {
    startPersonaInbox(agent, { communityDid: 'did:webvh:c:elsewhere', intervalMs: 60_000 })
    await flush()
    DeviceEventEmitter.emit(VTI_PERSONA_KEYS_HELD_EVENT, { did: 'did:webvh:p:any' })
    await flush()
    expect(lines()).toEqual([
      expect.stringMatching(/\(did:webvh:c:elsew.*\): no persona for this community yet; persona none/),
    ])
    expect(connect).not.toHaveBeenCalled()
  })

  it('says it signs in, with the session and status it found, and that it signed in', async () => {
    connect.mockImplementation(async () => {
      mockAgentState.isConnected = true
    })
    startPersonaInbox(agent, { mediatorDid: 'did:peer:m', intervalMs: 60_000 })
    await flush()
    expect(lines()).toEqual([
      expect.stringMatching(
        /signing in as the persona; persona did:webvh:p:host.*keyAgreement yes, session closed, status disconnected/
      ),
      expect.stringMatching(/signed in/),
    ])
  })

  it('says why a sign-in failed', async () => {
    connect.mockRejectedValue(new Error('resolving did:webvh:m took over 15 s'))
    startPersonaInbox(agent, { mediatorDid: 'did:peer:m', intervalMs: 60_000 })
    await flush()
    expect(lines().at(-1)).toMatch(/sign-in failed: resolving did:webvh:m took over 15 s/)
  })

  it('says so once when a look has been running over a minute', async () => {
    jest.useFakeTimers()
    connect.mockImplementation(() => new Promise(() => undefined))
    startPersonaInbox(agent, { mediatorDid: 'did:peer:m', intervalMs: 30_000 })
    await jest.advanceTimersByTimeAsync(30_000)
    expect(lines().filter((l) => /has been running/.test(l))).toEqual([])
    await jest.advanceTimersByTimeAsync(60_000)
    await jest.advanceTimersByTimeAsync(60_000)
    expect(lines().filter((l) => /has been running/.test(l))).toEqual([
      expect.stringMatching(/a look has been running (6|9)\d s \(status disconnected\); later looks wait for it/),
    ])
  })
})

// 227.1 (10-01, lab, Android): community messages waiting while the app was
// closed were drained the moment the persona's socket opened — before the
// agent called itself connected as that persona — and the inbox skipped each
// ("the session is not connected") and returned, so the mediator was told they
// were taken. Five invitation offers, gone; a vetter grant the same way (227
// gate, lab). The inbox now knows whom the session is signing in as, and an
// owned message it cannot place yet is not acknowledged.
describe('a message drained as the session opens', () => {
  const ISSUE = { type: 'https://trusttasks.org/spec/credential-exchange/issue/0.1', from: 'did:webvh:c:host' }
  beforeEach(() => {
    mockHandlers.length = 0
    mockAgentState.isConnected = false
    mockAgentState.signingInAs = undefined
    mockReceiveIssue.mockReset()
    mockReceiveIssue.mockResolvedValue([{ kind: 'vetter-grant', communityDid: mockPersona.communityDid }])
    ;(vtiAgent.connect as jest.Mock).mockClear()
  })
  afterEach(() => {
    mockAgentState.signingInAs = undefined
    mockAgentState.status = 'disconnected'
  })

  it("while the persona is signing in, is the persona's and is kept", async () => {
    mockAgentState.status = 'authenticating'
    mockAgentState.signingInAs = mockPersona.did
    startPersonaInbox(agent, { mediatorDid: 'did:peer:m', communityDid: mockPersona.communityDid, intervalMs: 60_000 })
    await flush()
    await expect(Promise.resolve(mockHandlers[0](ISSUE))).resolves.toBeUndefined()
    expect(mockReceiveIssue).toHaveBeenCalledWith(expect.anything(), mockPersona.did, ISSUE, expect.anything())
  })

  it('before the inbox has looked for its persona, it looks then and keeps it', async () => {
    mockAgentState.status = 'authenticating'
    mockAgentState.signingInAs = mockPersona.did
    startPersonaInbox(agent, { mediatorDid: 'did:peer:m', communityDid: mockPersona.communityDid, intervalMs: 60_000 })
    // At once: the first look has not finished reading the persona.
    await expect(Promise.resolve(mockHandlers[0](ISSUE))).resolves.toBeUndefined()
    expect(mockReceiveIssue).toHaveBeenCalledWith(expect.anything(), mockPersona.did, ISSUE, expect.anything())
  })

  it("while the session's identity is not known yet, is not acknowledged: the mediator keeps it", async () => {
    mockAgentState.status = 'resolving'
    startPersonaInbox(agent, { mediatorDid: 'did:peer:m', communityDid: mockPersona.communityDid, intervalMs: 60_000 })
    await flush()
    await expect(Promise.resolve(mockHandlers[0](ISSUE))).rejects.toThrow(/not taken yet/)
    expect(mockReceiveIssue).not.toHaveBeenCalled()
  })

  it('what the inbox does not own is let go as before, whatever the session', async () => {
    mockAgentState.status = 'resolving'
    startPersonaInbox(agent, { mediatorDid: 'did:peer:m', communityDid: mockPersona.communityDid, intervalMs: 60_000 })
    await flush()
    await expect(
      Promise.resolve(mockHandlers[0]({ type: 'https://didcomm.org/trust-ping/2.0/ping' }))
    ).resolves.toBeUndefined()
  })
})
