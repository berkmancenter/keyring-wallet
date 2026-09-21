import type { EnrolmentOffer } from '@bifold/trust-tasks'

import { VtaAgentController } from '../module/vtaAgent'
import { EnrolmentError } from '../module/vtaEnrolment'

// The controller runs the whole link — submit, wait for the admin, sign in as
// the temporary key, rotate onto a long-lived one, remember the agent — and
// every step moves the one state the screens read (plan §4.2).

const mockClient = {
  connect: jest.fn(async () => undefined),
  disconnect: jest.fn(async () => undefined),
  whoAmI: jest.fn(async () => ({ roles: ['admin'] })),
  rotateManagerKey: jest.fn(async () => 'did:peer:2.permanent'),
  managerDid: 'did:peer:2.permanent',
  isConnected: false,
}

jest.mock('../module/VtaClient', () => ({
  VTA_TASK: jest.requireActual('../module/VtaClient').VTA_TASK,
  VtaClient: jest.fn(() => mockClient),
  resolveVtaMediator: jest.fn(async () => ({ did: 'did:peer:2.mediator' })),
}))
jest.mock('../module/VtiMediatorTransport', () => ({
  createVtiClientDid: jest.fn(async () => 'did:peer:2.temporary'),
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

function controller(overrides: { submit?: jest.Mock; waitForGrant?: jest.Mock; linked?: unknown } = {}) {
  const saved: unknown[] = []
  const vta = new VtaAgentController()
  const submit = overrides.submit ?? jest.fn(async () => ({ did: 'did:peer:2.temp', code: 'ABCD-EFGH' }))
  const waitForGrant = overrides.waitForGrant ?? jest.fn(async () => undefined)
  vta.configure({
    now: () => 1_000,
    linkStore: () => ({
      get: async () => overrides.linked as never,
      set: async (link) => void saved.push(link),
      clear: async () => undefined,
    }),
    identityStore: () => ({ setManager: async () => undefined }) as never,
    enrol: { submit: submit as never, waitForGrant: waitForGrant as never },
  })
  return { vta, saved, submit, waitForGrant }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockClient.connect.mockImplementation(async () => undefined)
  mockClient.whoAmI.mockImplementation(async () => ({ roles: ['admin'] }))
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
    const { vta, saved } = controller()
    vta.scanOffer(offer)
    await vta.confirmOffer({} as never)
    expect(vta.getState().link).toMatchObject({ kind: 'notLinked', lastError: { reason: 'failed' } })
    expect(saved).toEqual([])
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
    expect(vta.getState().link).toMatchObject({ kind: 'showingKey', did: 'did:peer:2.temporary' })

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
