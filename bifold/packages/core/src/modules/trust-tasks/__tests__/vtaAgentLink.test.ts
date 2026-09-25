import type { EnrolmentOffer } from '@bifold/trust-tasks'

import { GRANT_HOLD_MS, VtaAgentController } from '../module/vtaAgent'
import { EnrolmentError } from '../module/vtaEnrolment'

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
}

jest.mock('../module/VtaClient', () => ({
  VTA_TASK: jest.requireActual('../module/VtaClient').VTA_TASK,
  ManagerKeyUnresolved: jest.requireActual('../module/VtaClient').ManagerKeyUnresolved,
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

  it('comes back offline and reconnects on its own', async () => {
    const { vta } = controller({ linked })
    await vta.restore({} as never)
    await new Promise((resolve) => setImmediate(resolve))
    expect(mockClient.connect).toHaveBeenCalled()
    expect(vta.getState().link).toMatchObject({ kind: 'linked', connection: { kind: 'online' } })
  })

  it('schedules a quiet retry when the agent cannot be reached', async () => {
    jest.useFakeTimers()
    try {
      mockClient.connect.mockImplementation(async () => {
        throw new Error('socket closed')
      })
      const { vta } = controller({ linked })
      await vta.restore({} as never)
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      expect(vta.getState().link).toMatchObject({ connection: { kind: 'reconnecting', attempt: 1, since: 1_000 } })
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
      expect(vta.getState().link).toMatchObject({ connection: { kind: 'reconnecting' } })
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
