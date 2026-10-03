import { DeviceEventEmitter } from 'react-native'
import type { EnrolmentOffer } from '@bifold/trust-tasks'

import {
  GRANT_HOLD_MS,
  MAX_RECONNECT_TRIES,
  SESSION_CONNECT_DEADLINE_MS,
  UNLINK_TELL_DEADLINE_MS,
  UNLINK_TELL_QUEUE_MS,
  VtaAgentController,
} from '../module/vtaAgent'
import { currentAgentDid } from '../module/currentAgent'
import { EnrolmentError } from '../module/vtaEnrolment'
import { VTI_PERSONA_KEYS_HELD_EVENT } from '../module/communityChanged'

// The controller runs the whole link — submit, wait for the admin, sign in as
// the temporary key, rotate onto a long-lived one, remember the agent — and
// every step moves the one state the screens read (plan §4.2).

const mockClient = {
  connect: jest.fn(async () => undefined),
  disconnect: jest.fn(async () => undefined),
  whoAmI: jest.fn(async (_timeoutMs?: number, _onSent?: () => void) => ({ roles: ['admin'] })),
  rotateManagerKey: jest.fn(async () => 'did:peer:2.permanent'),
  agentLabel: jest.fn(async (): Promise<{ label: string; source: string } | undefined> => undefined),
  managerDid: 'did:peer:2.permanent',
  isConnected: false,
  holdPersonaKeys: jest.fn(async () => false),
  borrowKey: jest.fn(async () => ({ keyId: 'k', curve: 'Ed25519' as const, publicKeyMultibase: 'z' })),
  /** Trust tasks sent through the client; unlink uses it to tell the agent. */
  task: jest.fn(
    async (
      _type: string,
      _payload: Record<string, unknown>,
      _timeoutMs?: number,
      _extras?: Record<string, unknown>,
      onSent?: () => void
    ): Promise<unknown> => {
      onSent?.()
      return {}
    }
  ),
  /** Drops the tasks queued and not yet sent; unlink calls it before telling the agent. */
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

const offer: EnrolmentOffer = {
  v: 1,
  t: 'vta-enrol',
  vta: 'did:webvh:Qm:alice',
  label: 'Lab agent',
  url: 'http://page/api/offers/n',
  n: 'NONCE0123456789ABCD',
  exp: 2_000_000_000,
}

function controller(
  overrides: { submit?: jest.Mock; waitForGrant?: jest.Mock; linked?: unknown; grantCheckDeadlineMs?: number } = {}
) {
  const saved: unknown[] = []
  let stored = overrides.linked as never
  const vta = new VtaAgentController()
  const current = () => stored as unknown
  const submit = overrides.submit ?? jest.fn(async () => ({ did: 'did:peer:2.temp', code: 'ABCD-EFGH' }))
  const waitForGrant = overrides.waitForGrant ?? jest.fn(async () => undefined)
  vta.configure({
    now: () => 1_000,
    linkStore: () => ({
      get: async () => stored,
      set: async (link) => {
        saved.push(link)
        stored = link as never
      },
      clear: async () => {
        stored = undefined as never
      },
    }),
    identityStore: () => ({ setManager: async () => undefined }) as never,
    enrol: { submit: submit as never, waitForGrant: waitForGrant as never },
    ...(overrides.grantCheckDeadlineMs ? { grantCheckDeadlineMs: overrides.grantCheckDeadlineMs } : {}),
  })
  return { vta, saved, submit, waitForGrant, current }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockClient.connect.mockImplementation(async () => undefined)
  mockClient.whoAmI.mockImplementation(async () => ({ roles: ['admin'] }))
  mockClient.agentLabel.mockImplementation(async () => undefined)
})

describe('linking through the controller', () => {
  it('asks before anything is minted, then links and remembers the agent', async () => {
    const { vta, saved, submit } = controller()
    vta.scanOffer(offer)
    expect(vta.getState().link.kind).toBe('confirming')
    expect(submit).not.toHaveBeenCalled()

    await vta.confirmOffer({} as never)
    expect(mockClient.connect).toHaveBeenCalled()
    expect(mockClient.rotateManagerKey).toHaveBeenCalled()
    expect(saved).toEqual([{ vtaDid: offer.vta, label: offer.label, linkedAt: new Date(1_000).toISOString() }])
    expect(vta.getState().link).toMatchObject({ kind: 'linked', vtaDid: offer.vta, connection: { kind: 'online' } })
    expect(vta.getState().status).toBe('connected')
  })

  it('shows the code while the admin decides', async () => {
    let release: () => void = () => undefined
    const waitForGrant = jest.fn(() => new Promise<void>((resolve) => (release = resolve)))
    const { vta } = controller({ waitForGrant })
    vta.scanOffer(offer)
    const done = vta.confirmOffer({} as never)
    await new Promise((resolve) => setImmediate(resolve))
    expect(vta.getState().link).toMatchObject({ kind: 'awaitingGrant', code: 'ABCD-EFGH' })
    release()
    await done
    expect(vta.getState().link.kind).toBe('linked')
  })

  it('a refusal ends the attempt with its reason, and nothing is remembered', async () => {
    const waitForGrant = jest.fn(async () => {
      throw new EnrolmentError('the admin refused this phone', 'refused')
    })
    const { vta, saved } = controller({ waitForGrant })
    vta.scanOffer(offer)
    await vta.confirmOffer({} as never)
    expect(vta.getState().link).toMatchObject({ kind: 'notLinked', lastError: { reason: 'refused' } })
    expect(saved).toEqual([])
    expect(mockClient.rotateManagerKey).not.toHaveBeenCalled()
  })

  it('a cancel while waiting wins over a grant that arrives late', async () => {
    let release: () => void = () => undefined
    const waitForGrant = jest.fn(() => new Promise<void>((resolve) => (release = resolve)))
    const { vta, saved } = controller({ waitForGrant })
    vta.scanOffer(offer)
    const done = vta.confirmOffer({} as never)
    await new Promise((resolve) => setImmediate(resolve))
    vta.cancelLink()
    release()
    await done
    expect(vta.getState().link.kind).toBe('notLinked')
    expect(mockClient.connect).not.toHaveBeenCalled()
    expect(saved).toEqual([])
  })

  // The 227 iOS link failure: the agent took the swap and the phone stored the
  // new key, but signing in as it stalled — and the whole link was reported as
  // failed. The swap is done; only the sign-in is outstanding, and that is the
  // ordinary one, retried.
  it('a swap that went through but whose new sign-in failed is a link, reconnecting, not a failure', async () => {
    jest.useFakeTimers()
    try {
      const { SwapDoneSignInFailed } = jest.requireActual('../module/VtaClient')
      mockClient.rotateManagerKey.mockImplementationOnce(async () => {
        throw new SwapDoneSignInFailed('did:peer:2.permanent', new Error('the mediator authenticate did not answer'))
      })
      const { vta, current } = controller()
      vta.scanOffer(offer)
      const before = mockClient.connect.mock.calls.length
      await vta.confirmOffer({} as never)
      await jest.advanceTimersByTimeAsync(2_000)
      // Linked, not failed; remembered, since the agent holds this phone's new key…
      expect(vta.getState().link).toMatchObject({ kind: 'linked', vtaDid: offer.vta })
      expect(current()).toMatchObject({ vtaDid: offer.vta })
      // …and it signed in again by itself, and is online.
      expect(mockClient.connect.mock.calls.length).toBeGreaterThan(before + 1)
      expect(vta.getState().link).toMatchObject({ kind: 'linked', connection: { kind: 'online' } })
    } finally {
      jest.useRealTimers()
    }
  })

  it('a rotation that fails leaves the phone unlinked, not half-linked', async () => {
    mockClient.rotateManagerKey.mockImplementationOnce(async () => {
      throw new Error('acl/swap-key refused')
    })
    const { vta, current } = controller()
    vta.scanOffer(offer)
    await vta.confirmOffer({} as never)
    expect(vta.getState().link).toMatchObject({ kind: 'notLinked', lastError: { reason: 'failed' } })
    // Remembered while the swap was in flight, forgotten once it settled as not done.
    expect(current()).toBeUndefined()
  })
})

describe('a linked phone after a restart', () => {
  const linked = { vtaDid: offer.vta, label: offer.label, linkedAt: 't0' }

  // 233: until the saved link is read, "not linked" is not an answer yet.
  it('says when the saved link has been read, whether or not there was one', async () => {
    const withLink = controller({ linked }).vta
    expect(withLink.getState().linkRestored).toBe(false)
    expect(withLink.getState().link.kind).toBe('notLinked')
    await withLink.restore({} as never)
    expect(withLink.getState()).toMatchObject({ linkRestored: true, link: { kind: 'linked' } })

    const none = controller({}).vta
    await none.restore({} as never)
    expect(none.getState()).toMatchObject({ linkRestored: true, link: { kind: 'notLinked' } })
  })

  it('comes back offline and reconnects on its own', async () => {
    const { vta } = controller({ linked })
    await vta.restore({} as never)
    await new Promise((resolve) => setImmediate(resolve))
    expect(mockClient.connect).toHaveBeenCalled()
    expect(vta.getState().link).toMatchObject({ kind: 'linked', connection: { kind: 'online' } })
  })

  // IN-53 (226): a sign-in that never settled kept the "already reconnecting"
  // guard set, so every later attempt (foreground, unlock, retry) returned at
  // once and the phone never reached its agent again, with nothing in the log.
  it('a sign-in that never finishes does not block the next: past its deadline it retries and comes online', async () => {
    jest.useFakeTimers()
    try {
      mockClient.connect.mockImplementationOnce(() => new Promise<undefined>(() => undefined))
      const { vta } = controller({ linked })
      await vta.restore({} as never)
      await Promise.resolve()
      expect(mockClient.connect).toHaveBeenCalledTimes(1)
      // Past the deadline, and the first backoff: a second sign-in, which answers.
      await jest.advanceTimersByTimeAsync(SESSION_CONNECT_DEADLINE_MS + 2_000)
      expect(mockClient.connect).toHaveBeenCalledTimes(2)
      expect(vta.getState().link).toMatchObject({ kind: 'linked', connection: { kind: 'online' } })
    } finally {
      jest.useRealTimers()
    }
  })

  // A reconnect that can never succeed must not loop for ever out of sight:
  // after its tries, it stops and the agent screen says so, with Try again.
  it('stops after its tries and says so; Try again starts afresh', async () => {
    jest.useFakeTimers()
    try {
      mockClient.connect.mockImplementation(async () => {
        throw new Error('the mediator authenticate did not answer within 15000 ms')
      })
      const { vta } = controller({ linked })
      await vta.restore({} as never)
      await jest.advanceTimersByTimeAsync(10 * 60_000)
      expect(mockClient.connect).toHaveBeenCalledTimes(1 + MAX_RECONNECT_TRIES)
      expect(vta.getState().reconnectGaveUp).toBe(true)
      // Nothing more by itself…
      await jest.advanceTimersByTimeAsync(10 * 60_000)
      expect(mockClient.connect).toHaveBeenCalledTimes(1 + MAX_RECONNECT_TRIES)
      // …until the person asks; this time the agent answers.
      mockClient.connect.mockImplementation(async () => undefined)
      await vta.tryAgainNow({} as never)
      expect(vta.getState().reconnectGaveUp).toBe(false)
      expect(vta.getState().link).toMatchObject({ kind: 'linked', connection: { kind: 'online' } })
    } finally {
      jest.useRealTimers()
    }
  })

  // The #183 lesson: tries must never stack into parallel sign-ins.
  it('never runs two sign-ins at once: Try again and an unlock wait on the one in flight', async () => {
    jest.useFakeTimers()
    try {
      mockClient.connect.mockImplementation(() => new Promise<undefined>(() => undefined))
      const { vta } = controller({ linked })
      await vta.restore({} as never)
      await jest.advanceTimersByTimeAsync(1_000)
      void vta.tryAgainNow({} as never)
      void vta.tryAgainNow({} as never)
      void vta.restore({ tag: 'unlocked' } as never)
      await jest.advanceTimersByTimeAsync(5_000)
      expect(mockClient.connect).toHaveBeenCalledTimes(1)
    } finally {
      mockClient.connect.mockImplementation(async () => undefined)
      jest.useRealTimers()
    }
  })

  it('schedules a quiet retry when the agent cannot be reached', async () => {
    jest.useFakeTimers()
    try {
      mockClient.connect.mockImplementation(async () => {
        throw new Error('socket closed')
      })
      const { vta } = controller({ linked })
      await vta.restore({} as never)
      // Let the failed first sign-in settle (no timer is due yet: the retry is 1 s away).
      await jest.advanceTimersByTimeAsync(0)
      // Still connecting (IN-48: a start-up failure is not shown as offline yet)…
      expect(vta.getState().link).toMatchObject({
        connection: { kind: 'connecting', since: 1_000, reason: 'socket closed' },
      })
      // …with a retry scheduled: after the first backoff it tries again.
      const attempts = mockClient.connect.mock.calls.length
      await jest.advanceTimersByTimeAsync(1_000)
      expect(mockClient.connect.mock.calls).toHaveLength(attempts + 1)
    } finally {
      jest.useRealTimers()
    }
  })

  it('ends the link when the agent no longer accepts this phone', async () => {
    mockClient.connect.mockImplementation(async () => {
      throw new Error('refusing trust task: DID not in ACL')
    })
    const { vta } = controller({ linked })
    await vta.restore({} as never)
    await new Promise((resolve) => setImmediate(resolve))
    expect(vta.getState().link).toMatchObject({ kind: 'revoked', reason: expect.stringMatching(/not in ACL/) })
  })
})

describe('linking without a QR through the controller', () => {
  it('shows the key, reports "not yet" while the agent refuses it, then links and rotates', async () => {
    const { vta, saved } = controller()
    await vta.startManualLink({} as never, offer.vta, 'alice host')
    // The Farm's Admin DID field takes only a did:key.
    expect(vta.getState().link).toMatchObject({ kind: 'showingKey', did: 'did:key:z6Mktemporary' })
    expect(jest.requireMock('../module/VtiMediatorTransport').createVtiClientDid).not.toHaveBeenCalled()

    mockClient.whoAmI.mockImplementationOnce(async () => {
      throw new Error('refusing trust task: DID not in ACL')
    })
    await vta.checkManualGrant({} as never)
    expect(vta.getState().link).toMatchObject({ kind: 'showingKey', notYet: true, checking: false })
    expect(mockClient.rotateManagerKey).not.toHaveBeenCalled()

    await vta.checkManualGrant({} as never)
    expect(mockClient.rotateManagerKey).toHaveBeenCalledTimes(1)
    expect(saved).toEqual([{ vtaDid: offer.vta, label: 'alice host', linkedAt: new Date(1_000).toISOString() }])
    expect(vta.getState().link).toMatchObject({ kind: 'linked', connection: { kind: 'online' } })
  })

  /**
   * An agent can fail to answer at all rather than refuse: its reply is lost
   * when it is produced before the transport's relationship can carry it (seen
   * on a lab VTA, 2026-09-22). Nothing else ever settles the attempt, so the
   * deadline has to, or the person watches a spinner for as long as they can
   * bear it.
   */
  it('says so when the agent does not answer, and keeps the key on screen', async () => {
    const { vta } = controller({ grantCheckDeadlineMs: 20 })
    await vta.startManualLink({} as never, offer.vta, 'alice host')
    let answer: (value: { roles: string[] }) => void = () => undefined
    mockClient.whoAmI.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)))

    await vta.checkManualGrant({} as never)
    expect(vta.getState().link).toMatchObject({
      kind: 'showingKey',
      did: 'did:key:z6Mktemporary',
      checking: false,
      noAnswer: true,
      notYet: false,
    })

    // The answer we gave up on arrives late: it must not link the phone behind
    // the person's back.
    answer({ roles: ['admin'] })
    await new Promise((resolve) => setImmediate(resolve))
    expect(vta.getState().link).toMatchObject({ kind: 'showingKey', noAnswer: true })
    expect(mockClient.rotateManagerKey).not.toHaveBeenCalled()

    // Trying again takes the answer that arrived late, and links as usual.
    await vta.checkManualGrant({} as never)
    expect(mockClient.rotateManagerKey).toHaveBeenCalledTimes(1)
    expect(vta.getState().link).toMatchObject({ kind: 'linked' })
  })

  /**
   * Android, 2026-09-24: signing in took about 5.5 s on a slow emulator and the
   * agent answered about 4.3 s after the question, so one shared 10 s budget ran
   * out 0.1 s before the answer arrived. The check gave up, disconnected, and
   * threw the answer away. Signing in has its own bound; the agent's time to
   * answer starts when the question is sent.
   */
  it('a slow sign-in does not use up the time the agent has to answer', async () => {
    const { vta } = controller({ grantCheckDeadlineMs: 30 })
    await vta.startManualLink({} as never, offer.vta, 'alice host')
    mockClient.connect.mockImplementationOnce(() => new Promise<undefined>((resolve) => setTimeout(resolve, 80)))

    await vta.checkManualGrant({} as never)
    expect(mockClient.whoAmI.mock.calls[0][0]).toBe(GRANT_HOLD_MS)
    expect(vta.getState().link).toMatchObject({ kind: 'linked' })
  })

  /**
   * On a slow link the answer can arrive after the deadline. It is kept, and
   * the next "I've been added" settles from it at once: no second sign-in, no
   * second question, both of which would be just as slow.
   */
  it('an answer that arrives after the deadline settles the next tap at once', async () => {
    const { vta } = controller({ grantCheckDeadlineMs: 20 })
    await vta.startManualLink({} as never, offer.vta, 'alice host')
    let refuse: (error: Error) => void = () => undefined
    mockClient.whoAmI.mockImplementationOnce((_timeoutMs?: number, onSent?: () => void) => {
      onSent?.()
      return new Promise((_resolve, reject) => (refuse = reject))
    })

    await vta.checkManualGrant({} as never)
    expect(vta.getState().link).toMatchObject({ kind: 'showingKey', noAnswer: true })

    refuse(new Error('refusing trust task: DID not in ACL'))
    await vta.checkManualGrant({} as never)
    expect(vta.getState().link).toMatchObject({ kind: 'showingKey', notYet: true, noAnswer: false })
    expect(mockClient.connect).toHaveBeenCalledTimes(1)
    expect(mockClient.whoAmI).toHaveBeenCalledTimes(1)
  })

  it('the client giving up on an answer reads as no answer, not as a failure', async () => {
    const { vta } = controller({ grantCheckDeadlineMs: 20 })
    await vta.startManualLink({} as never, offer.vta, 'alice host')
    mockClient.whoAmI.mockImplementationOnce(async () => {
      throw new Error('[TrustTasks:VtaClient] the VTA did not answer https://trusttasks.org/spec/auth/whoami/0.1')
    })

    await vta.checkManualGrant({} as never)
    expect(vta.getState().link).toMatchObject({ kind: 'showingKey', checking: false, noAnswer: true })
  })

  it('an error other than "not added yet" ends the attempt', async () => {
    const { vta } = controller()
    await vta.startManualLink({} as never, offer.vta, 'alice host')
    mockClient.connect.mockImplementationOnce(async () => {
      throw new Error('the mediator refused the socket')
    })
    await vta.checkManualGrant({} as never)
    expect(vta.getState().link).toMatchObject({ kind: 'notLinked', lastError: { reason: 'failed' } })
  })
})

describe("the agent screen's state", () => {
  it('a fresh link plays the introduction once, and dismissing it is remembered', async () => {
    const { vta, saved } = controller()
    vta.scanOffer(offer)
    await vta.confirmOffer({} as never)
    expect(vta.getState().introSeen).toBe(false)
    expect(vta.getState().activity.map((a) => a.kind)).toEqual(['linked'])
    await vta.markIntroSeen({} as never)
    expect(vta.getState().introSeen).toBe(true)
    expect(saved[saved.length - 1]).toMatchObject({ introSeenAt: new Date(1_000).toISOString() })
    vta.showIntro()
    expect(vta.getState().introSeen).toBe(false)
  })

  it('a restored link that already saw the introduction does not show it again', async () => {
    const { vta } = controller({ linked: { vtaDid: offer.vta, label: 'x', linkedAt: 't0', introSeenAt: 't1' } })
    await vta.restore({} as never)
    expect(vta.getState().introSeen).toBe(true)
  })

  it('records going offline and coming back, not every retry', async () => {
    const { vta } = controller({ linked: { vtaDid: offer.vta, label: 'x', linkedAt: 't0', introSeenAt: 't1' } })
    await vta.restore({} as never)
    await new Promise((resolve) => setImmediate(resolve))
    expect(vta.getState().link).toMatchObject({ connection: { kind: 'online' } })
    // restored → online is the first connect of the session, noted as back online
    expect(vta.getState().activity.map((a) => a.kind)).toEqual(['reconnected'])
  })
})

describe("the agent's own name", () => {
  const linked = { vtaDid: offer.vta, label: offer.label, linkedAt: 't0', introSeenAt: 't1' }
  const settle = () => new Promise((resolve) => setImmediate(resolve))

  it('is read once linked, and arrives after the link: nothing waits for it', async () => {
    let answer: (label: { label: string; source: string }) => void = () => undefined
    mockClient.agentLabel.mockImplementation(() => new Promise((resolve) => (answer = resolve)))
    const { vta } = controller()
    vta.scanOffer(offer)
    await vta.confirmOffer({} as never)
    // Linked while the name is still on its way: the screen shows the host meanwhile.
    expect(vta.getState().link).toMatchObject({ kind: 'linked' })
    expect(vta.getState().agentNames?.[offer.vta]).toBeUndefined()
    answer({ label: 'Alberto’s agent', source: 'agentName' })
    await settle()
    expect(vta.getState().agentNames).toEqual({ [offer.vta]: { label: 'Alberto’s agent', source: 'agentName' } })
  })

  it('is asked once per agent per app run, not on every reconnect', async () => {
    mockClient.agentLabel.mockImplementation(async () => ({ label: 'runner', source: 'vtaName' }))
    const { vta } = controller({ linked })
    await vta.restore({} as never)
    await settle()
    await vta.connect({} as never, offer.vta)
    await settle()
    expect(mockClient.agentLabel).toHaveBeenCalledTimes(1)
    expect(vta.getState().agentNames).toEqual({ [offer.vta]: { label: 'runner', source: 'vtaName' } })
  })

  it('no name is no name — and asked again next session, as "none" can mean unreachable', async () => {
    mockClient.agentLabel.mockImplementation(async () => {
      throw new Error('never happens: agentLabel does not throw, but a bug must not break linking')
    })
    const { vta } = controller({ linked })
    await vta.restore({} as never)
    await settle()
    expect(vta.getState().link).toMatchObject({ kind: 'linked', connection: { kind: 'online' } })
    expect(vta.getState().agentNames).toBeUndefined()
    mockClient.agentLabel.mockImplementation(async () => undefined)
    await vta.connect({} as never, offer.vta)
    await settle()
    expect(mockClient.agentLabel).toHaveBeenCalledTimes(2)
    expect(vta.getState().agentNames).toBeUndefined()
  })
})

describe('when the app replaces its agent (an unlock after a lock builds a new one)', () => {
  const linked = { vtaDid: offer.vta, label: offer.label, linkedAt: 't0', introSeenAt: 't1' }
  const persona = {
    communityDid: 'did:c:x',
    vtaDid: offer.vta,
    did: 'did:webvh:Q:x',
    contextId: 'ctx',
    vtaKeyIds: { signing: 's', keyAgreement: 'ka' },
    kmsKeyIds: { signing: `vta-copy:${offer.vta}:s`, keyAgreement: `vta-copy:${offer.vta}:ka` },
    createdAt: 't0',
  }

  it("reconnects on the new agent and fetches every identity's keys into it", async () => {
    const vta = new VtaAgentController()
    vta.configure({
      now: () => 1_000,
      linkStore: () => ({ get: async () => linked as never, set: async () => undefined, clear: async () => undefined }),
      identityStore: () => ({ setManager: async () => undefined, listPersonas: async () => [persona] }) as never,
    })
    const agentA = { tag: 'A' } as never
    const agentB = { tag: 'B' } as never
    await vta.restore(agentA)
    await new Promise((resolve) => setImmediate(resolve))
    expect(vta.getState().link).toMatchObject({ kind: 'linked', connection: { kind: 'online' } })
    const VtaClientMock = jest.requireMock('../module/VtaClient').VtaClient as jest.Mock
    VtaClientMock.mockClear()
    mockClient.connect.mockClear()
    mockClient.holdPersonaKeys.mockClear()

    // Locking dropped the in-memory keys and the agent; unlocking made agent B.
    await vta.restore(agentB)
    await new Promise((resolve) => setImmediate(resolve))
    await new Promise((resolve) => setImmediate(resolve))

    expect(VtaClientMock.mock.calls.map((call) => call[0])).toContain(agentB)
    expect(mockClient.connect).toHaveBeenCalled()
    expect(mockClient.holdPersonaKeys).toHaveBeenCalledWith(persona)
    expect(vta.getState().link).toMatchObject({ kind: 'linked', connection: { kind: 'online' } })
  })

  it('fetches the keys again when the SAME agent comes back from a lock (it was shut down and restarted)', async () => {
    const vta = new VtaAgentController()
    vta.configure({
      now: () => 1_000,
      linkStore: () => ({ get: async () => linked as never, set: async () => undefined, clear: async () => undefined }),
      identityStore: () => ({ setManager: async () => undefined, listPersonas: async () => [persona] }) as never,
    })
    const agent = { tag: 'same' } as never
    await vta.restore(agent)
    await new Promise((resolve) => setImmediate(resolve))
    mockClient.connect.mockClear()
    mockClient.holdPersonaKeys.mockClear()

    // Lock → unlock: the app restarts the same agent (its in-memory keys were
    // dropped at the lock) and restores the controller again.
    await vta.restore(agent)
    await new Promise((resolve) => setImmediate(resolve))
    await new Promise((resolve) => setImmediate(resolve))

    expect(mockClient.connect).toHaveBeenCalled()
    expect(mockClient.holdPersonaKeys).toHaveBeenCalledWith(persona)
    expect(vta.getState().link).toMatchObject({ kind: 'linked', connection: { kind: 'online' } })
  })

  it("says when an identity's keys are back, so its inbox can sign in then", async () => {
    const vta = new VtaAgentController()
    vta.configure({
      now: () => 1_000,
      linkStore: () => ({ get: async () => linked as never, set: async () => undefined, clear: async () => undefined }),
      identityStore: () => ({ setManager: async () => undefined, listPersonas: async () => [persona] }) as never,
    })
    const held: unknown[] = []
    const sub = DeviceEventEmitter.addListener(VTI_PERSONA_KEYS_HELD_EVENT, (e) => held.push(e))
    await vta.restore({ tag: 'unlocked' } as never)
    await new Promise((resolve) => setImmediate(resolve))
    await new Promise((resolve) => setImmediate(resolve))
    sub.remove()
    expect(held).toEqual([{ did: persona.did }])
  })

  it('says nothing for an identity whose keys could not be fetched', async () => {
    const vta = new VtaAgentController()
    vta.configure({
      now: () => 1_000,
      linkStore: () => ({ get: async () => linked as never, set: async () => undefined, clear: async () => undefined }),
      identityStore: () => ({ setManager: async () => undefined, listPersonas: async () => [persona] }) as never,
    })
    mockClient.holdPersonaKeys.mockRejectedValueOnce(new Error('the VTA did not answer'))
    const held: unknown[] = []
    const sub = DeviceEventEmitter.addListener(VTI_PERSONA_KEYS_HELD_EVENT, (e) => held.push(e))
    await vta.restore({ tag: 'unlocked' } as never)
    await new Promise((resolve) => setImmediate(resolve))
    await new Promise((resolve) => setImmediate(resolve))
    sub.remove()
    expect(held).toEqual([])
  })

  /** Unlocking is the commonest thing a person does: it must not flash "Signing in" or "offline". */
  it('keeps the link shown online and connected while the new session opens, and opens only one', async () => {
    const vta = new VtaAgentController()
    vta.configure({
      now: () => 1_000,
      linkStore: () => ({ get: async () => linked as never, set: async () => undefined, clear: async () => undefined }),
      identityStore: () => ({ setManager: async () => undefined, listPersonas: async () => [persona] }) as never,
    })
    const agentA = { tag: 'A' } as never
    const agentB = { tag: 'B' } as never
    await vta.restore(agentA)
    await new Promise((resolve) => setImmediate(resolve))
    expect(vta.getState().status).toBe('connected')
    const seen: string[] = []
    const stop = vta.subscribe(() =>
      seen.push(
        `${vta.getState().status}/${(vta.getState().link as { connection?: { kind: string } }).connection?.kind}`
      )
    )
    mockClient.connect.mockClear()
    let open!: () => void
    mockClient.connect.mockImplementationOnce(
      () => new Promise<undefined>((resolve) => (open = () => resolve(undefined)))
    )

    // The screen's own effect asks for a session while the unlock reopens one.
    const restoring = vta.restore(agentB)
    await new Promise((resolve) => setImmediate(resolve))
    const screen = vta.connect(agentB, offer.vta)
    open()
    await Promise.all([restoring, screen])
    await new Promise((resolve) => setImmediate(resolve))
    stop()

    expect(mockClient.connect).toHaveBeenCalledTimes(1)
    expect(seen.every((s) => s === 'connected/online')).toBe(true)
    expect(vta.getState().link).toMatchObject({ kind: 'linked', connection: { kind: 'online' } })
  })

  it('counts a reopen that fails as a drop, and retries', async () => {
    const vta = new VtaAgentController()
    vta.configure({
      now: () => 1_000,
      linkStore: () => ({ get: async () => linked as never, set: async () => undefined, clear: async () => undefined }),
      identityStore: () => ({ setManager: async () => undefined, listPersonas: async () => [persona] }) as never,
    })
    await vta.restore({ tag: 'A' } as never)
    await new Promise((resolve) => setImmediate(resolve))
    mockClient.connect.mockRejectedValueOnce(new Error('mediator unreachable'))

    await vta.restore({ tag: 'B' } as never)

    expect(vta.getState().link).toMatchObject({ kind: 'linked', connection: { kind: 'reconnecting' } })
    await vta.unlink({ tag: 'B' } as never)
  })

  it('never hands out a client built for another agent', async () => {
    const vta = new VtaAgentController()
    vta.configure({
      now: () => 1_000,
      linkStore: () => ({ get: async () => linked as never, set: async () => undefined, clear: async () => undefined }),
      identityStore: () => ({ setManager: async () => undefined, listPersonas: async () => [] }) as never,
    })
    const agentA = { tag: 'A' } as never
    const agentB = { tag: 'B' } as never
    const VtaClientMock = jest.requireMock('../module/VtaClient').VtaClient as jest.Mock
    VtaClientMock.mockClear()
    vta.client(agentA, offer.vta)
    vta.client(agentB, offer.vta)
    expect(VtaClientMock.mock.calls.map((call) => call[0])).toEqual([agentA, agentB])
  })
})

describe("erasing this phone's copy of its agent", () => {
  const linked = { vtaDid: offer.vta, label: offer.label, linkedAt: 't0', introSeenAt: 't1' }
  const persona = (communityDid: string, vtaDid: string) => ({
    communityDid,
    vtaDid,
    did: `did:webvh:Q:${communityDid}`,
    contextId: 'ctx',
    vtaKeyIds: { signing: 's', keyAgreement: 'ka' },
    kmsKeyIds: { signing: `kms-s-${communityDid}`, keyAgreement: `kms-ka-${communityDid}` },
    createdAt: 't0',
  })

  it("erases only this agent's identities, their key copies and community records, then unlinks", async () => {
    let stored: unknown = linked
    const forgetPersona = jest.fn(async () => undefined)
    const forgetManager = jest.fn(async () => undefined)
    const forgetCommunity = jest.fn(async () => undefined)
    const deleteKey = jest.fn(async () => true)
    const vta = new VtaAgentController()
    vta.configure({
      now: () => 1_000,
      linkStore: () => ({
        get: async () => stored as never,
        set: async (l) => void (stored = l),
        clear: async () => void (stored = undefined),
      }),
      identityStore: () =>
        ({
          setManager: async () => undefined,
          forgetManager,
          forgetPersona,
          listPersonas: async () => [
            persona('did:c:mine', offer.vta),
            persona('did:c:other', 'did:webvh:another-agent'),
          ],
        }) as never,
      communityStore: () => ({ forgetCommunity }),
    })
    await vta.restore({} as never)
    await new Promise((resolve) => setImmediate(resolve))

    await vta.eraseThisPhonesCopy({ kms: { deleteKey } } as never)

    expect(deleteKey.mock.calls.map(([o]) => (o as { keyId: string }).keyId).sort()).toEqual([
      'kms-ka-did:c:mine',
      'kms-s-did:c:mine',
    ])
    expect(forgetPersona).toHaveBeenCalledTimes(1)
    // Under its own agent: another agent's identity for the same community stays.
    expect(forgetPersona).toHaveBeenCalledWith('did:c:mine', 'did:webvh:Qm:alice')
    expect(forgetCommunity).toHaveBeenCalledWith('did:c:mine')
    expect(forgetCommunity).not.toHaveBeenCalledWith('did:c:other')
    expect(forgetManager).toHaveBeenCalledWith(offer.vta)
    expect(stored).toBeUndefined()
    expect(vta.getState().link).toEqual({ kind: 'notLinked' })
  })
})

describe('unlinking this phone from its agent', () => {
  const linked = { vtaDid: offer.vta, label: offer.label, linkedAt: 't0', introSeenAt: 't1' }

  function unlinkable(overrides: { clear?: jest.Mock; forgetManager?: jest.Mock } = {}) {
    let stored: unknown = linked
    const clear = overrides.clear ?? jest.fn(async () => void (stored = undefined))
    const forgetManager = overrides.forgetManager ?? jest.fn(async () => undefined)
    const vta = new VtaAgentController()
    vta.configure({
      now: () => 1_000,
      linkStore: () => ({ get: async () => stored as never, set: async (l) => void (stored = l), clear }),
      identityStore: () => ({ setManager: async () => undefined, forgetManager }) as never,
    })
    return { vta, clear, forgetManager, stored: () => stored }
  }

  // A6 (228, upstream alignment): Unlink also tells the agent — stop waking this
  // phone, and end its sessions (auth/revoke-session/0.2, all) — best-effort,
  // bounded, and never in the way of the local unlink.
  const SET_WAKE = 'https://trusttasks.org/spec/device/set-wake/0.2'
  const REVOKE = 'https://trusttasks.org/spec/auth/revoke-session/0.2'
  const told = () => mockClient.task.mock.calls.map(([type, payload]) => ({ type, payload }))

  it('tells a reachable agent first: stop waking this phone, then end its sessions', async () => {
    mockClient.task.mockClear()
    const { vta, stored } = unlinkable()
    await vta.restore({} as never)
    await new Promise((resolve) => setImmediate(resolve))
    await vta.unlink({} as never)
    expect(told()).toEqual([
      { type: SET_WAKE, payload: {} },
      { type: REVOKE, payload: { all: true, reason: 'Unlinked on this phone' } },
    ])
    expect(stored()).toBeUndefined()
    expect(vta.getState().link).toEqual({ kind: 'notLinked' })
  })

  it('still unlinks when the agent refuses either step', async () => {
    mockClient.task.mockClear()
    mockClient.task.mockImplementation(async () => {
      throw new Error('forbidden')
    })
    try {
      const { vta, stored } = unlinkable()
      await vta.restore({} as never)
      await new Promise((resolve) => setImmediate(resolve))
      await vta.unlink({} as never)
      expect(told().map((t) => t.type)).toEqual([SET_WAKE, REVOKE])
      expect(stored()).toBeUndefined()
      expect(vta.getState().link).toEqual({ kind: 'notLinked' })
    } finally {
      mockClient.task.mockImplementation(async (_t, _p, _x, _e, onSent) => {
        onSent?.()
        return {}
      })
    }
  })

  it('does not wait on a silent agent past its deadline', async () => {
    jest.useFakeTimers()
    mockClient.task.mockClear()
    // Told, and no answer.
    mockClient.task.mockImplementation((_t, _p, _x, _e, onSent) => {
      onSent?.()
      return new Promise(() => undefined)
    })
    try {
      const { vta, stored } = unlinkable()
      await vta.restore({} as never)
      await jest.advanceTimersByTimeAsync(0)
      const done = vta.unlink({} as never)
      await jest.advanceTimersByTimeAsync(UNLINK_TELL_DEADLINE_MS + 100)
      await done
      expect(stored()).toBeUndefined()
      expect(vta.getState().link).toEqual({ kind: 'notLinked' })
    } finally {
      mockClient.task.mockImplementation(async (_t, _p, _x, _e, onSent) => {
        onSent?.()
        return {}
      })
      jest.useRealTimers()
    }
  })

  // 227 gate U4 (09-30, lab): an unlink tapped while the phone's startup
  // tasks were still queued (whoami … device/list, ~9 s) never reached the
  // agent: the tell queued behind them and the 5 s deadline, counted from the
  // tap, ran out first; the agent's session stayed open. The queued tasks are
  // dropped (they are pointless once the phone unlinks), and the deadline
  // counts from when the tell leaves the phone.
  it('drops the tasks still queued, then tells the agent', async () => {
    mockClient.task.mockClear()
    mockClient.dropQueued.mockClear()
    const { vta } = unlinkable()
    await vta.restore({} as never)
    await new Promise((resolve) => setImmediate(resolve))
    await vta.unlink({} as never)
    expect(mockClient.dropQueued).toHaveBeenCalledTimes(1)
    expect(mockClient.dropQueued.mock.invocationCallOrder[0]).toBeLessThan(mockClient.task.mock.invocationCallOrder[0])
  })

  it('waits for the tell behind a task already in flight, past the old 5 s', async () => {
    jest.useFakeTimers()
    mockClient.task.mockClear()
    // The task in flight takes 6 s; only then does set-wake leave the phone.
    mockClient.task.mockImplementation(async (type, _p, _t, _e, onSent) => {
      if (type === SET_WAKE) await new Promise((resolve) => setTimeout(resolve, 6_000))
      onSent?.()
      return {}
    })
    try {
      const { vta, stored, clear } = unlinkable()
      await vta.restore({} as never)
      await jest.advanceTimersByTimeAsync(0)
      const done = vta.unlink({} as never)
      await jest.advanceTimersByTimeAsync(6_100)
      await done
      expect(told().map((t) => t.type)).toEqual([SET_WAKE, REVOKE])
      // Told before the phone let go of the link: the agent heard it while this phone could still say it.
      const revoked = mockClient.task.mock.invocationCallOrder[told().findIndex((t) => t.type === REVOKE)]
      expect(revoked).toBeLessThan(clear.mock.invocationCallOrder[0])
      expect(stored()).toBeUndefined()
    } finally {
      mockClient.task.mockImplementation(async (_t, _p, _x, _e, onSent) => {
        onSent?.()
        return {}
      })
      jest.useRealTimers()
    }
  })

  it('never waits past the cap in all, even for a tell sent late', async () => {
    jest.useFakeTimers()
    mockClient.task.mockClear()
    // Sent 9 s in, behind a slow task, and never answered.
    mockClient.task.mockImplementation(async (type, _p, _t, _e, onSent) => {
      if (type === SET_WAKE) await new Promise((resolve) => setTimeout(resolve, 9_000))
      onSent?.()
      return new Promise(() => undefined)
    })
    try {
      const { vta, stored } = unlinkable()
      await vta.restore({} as never)
      await jest.advanceTimersByTimeAsync(0)
      let finished = false
      const done = vta.unlink({} as never).then(() => {
        finished = true
      })
      await jest.advanceTimersByTimeAsync(UNLINK_TELL_QUEUE_MS + 100)
      expect(finished).toBe(true)
      await done
      expect(stored()).toBeUndefined()
    } finally {
      mockClient.task.mockImplementation(async (_t, _p, _x, _e, onSent) => {
        onSent?.()
        return {}
      })
      jest.useRealTimers()
    }
  })

  it('a tell that never leaves the phone is given up on: the phone unlinks', async () => {
    jest.useFakeTimers()
    mockClient.task.mockClear()
    mockClient.task.mockImplementation(() => new Promise(() => undefined))
    try {
      const { vta, stored } = unlinkable()
      await vta.restore({} as never)
      await jest.advanceTimersByTimeAsync(0)
      const done = vta.unlink({} as never)
      await jest.advanceTimersByTimeAsync(UNLINK_TELL_QUEUE_MS + 100)
      await done
      expect(stored()).toBeUndefined()
      expect(vta.getState().link).toEqual({ kind: 'notLinked' })
    } finally {
      mockClient.task.mockImplementation(async (_t, _p, _x, _e, onSent) => {
        onSent?.()
        return {}
      })
      jest.useRealTimers()
    }
  })

  // 227 gate U5: unlinking with the network off finished in 1.8 s. The link can
  // still read online while the socket is gone; the telling then fails at once
  // ("not connected") and the phone unlinks without waiting out a deadline.
  it('a telling that cannot be sent fails at once: the phone unlinks without waiting', async () => {
    jest.useFakeTimers()
    mockClient.task.mockClear()
    mockClient.task.mockImplementation(async () => {
      throw new Error('[TrustTasks:VtaClient] not connected')
    })
    try {
      const { vta, stored } = unlinkable()
      await vta.restore({} as never)
      await jest.advanceTimersByTimeAsync(0)
      let finished = false
      const done = vta.unlink({} as never).then(() => {
        finished = true
      })
      await jest.advanceTimersByTimeAsync(10)
      expect(finished).toBe(true)
      await done
      expect(stored()).toBeUndefined()
    } finally {
      mockClient.task.mockImplementation(async (_t, _p, _x, _e, onSent) => {
        onSent?.()
        return {}
      })
      jest.useRealTimers()
    }
  })

  it('offline, sends nothing and unlinks at once', async () => {
    mockClient.task.mockClear()
    mockClient.connect.mockImplementationOnce(async () => {
      throw new Error('socket closed')
    })
    const { vta, stored } = unlinkable()
    await vta.restore({} as never)
    await new Promise((resolve) => setImmediate(resolve))
    expect(vta.getState().link).not.toMatchObject({ connection: { kind: 'online' } })
    await vta.unlink({} as never)
    expect(told()).toEqual([])
    expect(stored()).toBeUndefined()
  })

  it('closes the session, forgets the link and the manager key, and lands on no agent', async () => {
    const { vta, clear, forgetManager, stored } = unlinkable()
    await vta.restore({} as never)
    await new Promise((resolve) => setImmediate(resolve))
    expect(vta.getState().link).toMatchObject({ kind: 'linked', connection: { kind: 'online' } })

    await vta.unlink({} as never)

    expect(mockClient.disconnect).toHaveBeenCalled()
    expect(clear).toHaveBeenCalled()
    expect(stored()).toBeUndefined()
    expect(forgetManager).toHaveBeenCalledWith(offer.vta)
    expect(vta.getState()).toMatchObject({
      link: { kind: 'notLinked' },
      status: 'disconnected',
      vtaDid: undefined,
      managerDid: undefined,
      approvals: [],
    })
    expect(vta.getState().activity[0]).toMatchObject({ kind: 'unlinked' })
  })

  it('stays unlinked after a restart', async () => {
    const { vta, stored } = unlinkable()
    await vta.restore({} as never)
    await new Promise((resolve) => setImmediate(resolve))
    await vta.unlink({} as never)
    // The next app start reads the same store, which unlinking cleared.
    const next = new VtaAgentController()
    next.configure({
      now: () => 2_000,
      linkStore: () => ({
        get: async () => stored() as never,
        set: async () => undefined,
        clear: async () => undefined,
      }),
      identityStore: () => ({ setManager: async () => undefined }) as never,
    })
    await next.restore({} as never)
    expect(next.getState().link).toEqual({ kind: 'notLinked' })
  })

  it('unlinks an agent that cannot be reached, and stops trying to reach it', async () => {
    jest.useFakeTimers()
    try {
      mockClient.connect.mockImplementation(async () => {
        throw new Error('socket closed')
      })
      const { vta } = unlinkable()
      await vta.restore({} as never)
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      expect(vta.getState().link).toMatchObject({ connection: { kind: 'connecting' } })
      const attempts = mockClient.connect.mock.calls.length

      await vta.unlink({} as never)
      await jest.advanceTimersByTimeAsync(120_000)

      expect(vta.getState().link).toEqual({ kind: 'notLinked' })
      expect(mockClient.connect.mock.calls).toHaveLength(attempts)
    } finally {
      jest.useRealTimers()
    }
  })

  it('unlinks even when the stores fail', async () => {
    const failing = jest.fn(async () => {
      throw new Error('storage unavailable')
    })
    const { vta } = unlinkable({ clear: failing, forgetManager: failing })
    await vta.restore({} as never)
    await new Promise((resolve) => setImmediate(resolve))
    await expect(vta.unlink({} as never)).resolves.toBeUndefined()
    expect(vta.getState().link).toEqual({ kind: 'notLinked' })
  })

  it('can link again afterwards, to the same agent or another', async () => {
    const { vta } = unlinkable()
    await vta.restore({} as never)
    await new Promise((resolve) => setImmediate(resolve))
    await vta.unlink({} as never)
    await vta.startManualLink({} as never, 'did:webvh:Qm:another', 'another host')
    expect(vta.getState().link).toMatchObject({ kind: 'showingKey', vtaDid: 'did:webvh:Qm:another' })
  })
})

// Several agents, step 2: the phone keeps every linked agent and acts with one.
describe('several agents', () => {
  const HOME = { vtaDid: 'did:webvh:home-vta', label: 'Home', linkedAt: '2026-10-01T00:00:00Z' }
  const WORK = { vtaDid: 'did:webvh:work-vta', label: 'Work', linkedAt: '2026-10-02T00:00:00Z' }

  /** An in-memory store of several links, one current, as GenericRecordsVtaLinkStore keeps them. */
  function twoAgents() {
    let links = [HOME, WORK] as Array<typeof HOME & Record<string, unknown>>
    let current: string | undefined = HOME.vtaDid
    const vta = new VtaAgentController()
    vta.configure({
      now: () => 1_000,
      linkStore: () => ({
        get: async () => links.find((l) => l.vtaDid === current) as never,
        set: async (l) => {
          links = [...links.filter((x) => x.vtaDid !== l.vtaDid), l as never]
        },
        clear: async () => {
          links = links.filter((x) => x.vtaDid !== current)
          current = links[0]?.vtaDid
        },
        list: async () => links as never,
        current: async () => current,
        use: async (did: string) => {
          current = did
        },
        remove: async (did: string) => {
          links = links.filter((x) => x.vtaDid !== did)
          if (current === did) current = links[0]?.vtaDid
        },
      }),
      identityStore: () => ({ setManager: async () => undefined, forgetManager: async () => undefined }) as never,
    })
    return { vta, current: () => current }
  }

  it('lists every agent and switches to another, which becomes current and connects', async () => {
    const { vta, current } = twoAgents()
    await vta.restore({} as never)
    expect(vta.getState().link).toMatchObject({ kind: 'linked', vtaDid: HOME.vtaDid })
    expect(vta.getState().agents?.map((a) => a.vtaDid)).toEqual([HOME.vtaDid, WORK.vtaDid])

    await vta.useAgent({} as never, WORK.vtaDid)
    expect(current()).toBe(WORK.vtaDid)
    expect(vta.getState().link).toMatchObject({ kind: 'linked', vtaDid: WORK.vtaDid })
    expect(currentAgentDid()).toBe(WORK.vtaDid)
    // The agent before was left, not forgotten.
    expect(vta.getState().agents).toHaveLength(2)
    await vta.useAgent({} as never, HOME.vtaDid)
    expect(vta.getState().link).toMatchObject({ kind: 'linked', vtaDid: HOME.vtaDid })
  })

  it('unlinking the current agent brings up the next one, not "no agent"', async () => {
    const { vta } = twoAgents()
    await vta.restore({} as never)
    await vta.unlink({} as never)
    expect(vta.getState().link).toMatchObject({ kind: 'linked', vtaDid: WORK.vtaDid })
    expect(vta.getState().agents?.map((a) => a.vtaDid)).toEqual([WORK.vtaDid])
  })

  it('adding another agent leaves the current one until the link ends; given up, it goes back', async () => {
    const { vta } = twoAgents()
    await vta.restore({} as never)
    await vta.startAddingAgent()
    expect(vta.getState()).toMatchObject({ addingAgent: true, link: { kind: 'notLinked' } })
    vta.scanOffer(offer)
    expect(vta.getState().link.kind).toBe('confirming')
    vta.cancelLink()
    await new Promise((resolve) => setImmediate(resolve))
    expect(vta.getState()).toMatchObject({ addingAgent: false, link: { kind: 'linked', vtaDid: HOME.vtaDid } })
  })
})
