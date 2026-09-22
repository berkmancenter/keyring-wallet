/**
 * The applicant's way out of a deferred join request (VTI-03, client half):
 * `supplement/0.1` answers a deferral in place, `withdraw/0.1` closes it.
 *
 * What is pinned here is our decision logic — which task goes out, what is
 * recorded, and what each declared refusal code means — not the wire, which
 * the agent owns. Refusals are read by their code, never by their prose.
 */
import { VtiRefusal, joinRequestRefusal, openJoinRequestOf } from '../module/vtiAgent'

const mockApply = jest.fn()
const mockSupplement = jest.fn()
const mockWithdraw = jest.fn()

jest.mock('../module/vtiAgent', () => {
  const actual = jest.requireActual('../module/vtiAgent')
  return {
    ...actual,
    vtiAgent: {
      apply: (...a: unknown[]) => mockApply(...a),
      supplement: (...a: unknown[]) => mockSupplement(...a),
      withdraw: (...a: unknown[]) => mockWithdraw(...a),
      onInbound: () => () => undefined,
    },
  }
})

// Imported after the mock so the applicant sees the mocked agent.
// eslint-disable-next-line import/order
import { VtiApplicant, type VettingApplication, type VtiVettingStore } from '../module/vtiVetting'

const COMMUNITY = 'did:webvh:community'
const persona = {
  communityDid: COMMUNITY,
  vtaDid: 'did:webvh:vta',
  did: 'did:webvh:persona',
  contextId: 'ctx',
  vtaKeyIds: { signing: 's', keyAgreement: 'k' },
}
const manifest = { criteria: [], requirementsDigest: 'digest-1' }

const memoryStore = (application: VettingApplication): VtiVettingStore & { current: () => VettingApplication } => {
  let app = application
  return {
    current: () => app,
    listTickets: async () => [],
    saveTicket: async () => undefined,
    listDesk: async () => [],
    saveDesk: async () => undefined,
    clearDesk: async () => undefined,
    getProfile: async () => undefined,
    saveProfile: async () => undefined,
    getApplication: async () => app,
    saveApplication: async (a) => {
      app = a
    },
    forget: async () => undefined,
  }
}

const baseApplication = (): VettingApplication => ({
  communityDid: COMMUNITY,
  joinDid: persona.did,
  minStatements: 1,
  requiredClaims: ['name.legal'],
  acceptedMethods: ['inPerson'],
  commitmentSalt: 'salt',
  claims: { 'name.legal': 'Alice Example' },
  requests: [],
  startedAt: '2026-09-21T00:00:00Z',
})

const applicantWith = (application: VettingApplication) => {
  const store = memoryStore(application)
  // The agent and community store are not reached by submit/withdraw.
  const applicant = new VtiApplicant({} as never, persona as never, store, {} as never)
  return { applicant, store }
}

beforeEach(() => {
  mockApply.mockReset()
  mockSupplement.mockReset()
  mockWithdraw.mockReset()
})

describe('reading a join-request refusal', () => {
  it('reads the meaning from the code, whichever task declared it', () => {
    expect(joinRequestRefusal(new VtiRefusal('vtc/join-requests/withdraw:notFound', 'x'))).toBe('notFound')
    expect(joinRequestRefusal(new VtiRefusal('vtc/join-requests/supplement:alreadyDecided', 'x'))).toBe(
      'alreadyDecided'
    )
    expect(joinRequestRefusal(new VtiRefusal('vtc/join-requests/supplement:notAwaitingEvidence', 'x'))).toBe(
      'notAwaitingEvidence'
    )
  })

  it('does not read the prose, and does not guess', () => {
    // The sentence says "not found" and the code says something else: the code wins.
    expect(joinRequestRefusal(new VtiRefusal('taskFailed', 'request not found'))).toBeUndefined()
    expect(joinRequestRefusal(new Error('vtc/join-requests/withdraw:notFound'))).toBeUndefined()
  })
})

describe('an application already open at the community (vti #1592)', () => {
  const already = (details: unknown) =>
    new VtiRefusal('vtc/join-requests/submit:requestAlreadyOpen', 'a request is already open', details)

  it('names the open request and who it waits on', () => {
    expect(joinRequestRefusal(already({ requestId: 'r9', status: 'deferred' }))).toBe('requestAlreadyOpen')
    expect(openJoinRequestOf(already({ requestId: 'r9', status: 'deferred', reason: 'conflict' }))).toEqual({
      requestId: 'r9',
      status: 'deferred',
    })
    expect(openJoinRequestOf(already({ requestId: 'r9' }))).toEqual({ requestId: 'r9', status: 'pending' })
  })

  it('reads nothing from another refusal, or one with no request named', () => {
    expect(openJoinRequestOf(new VtiRefusal('vtc/join-requests/withdraw:notFound', 'x', { requestId: 'r9' }))).toBeUndefined()
    expect(openJoinRequestOf(already(undefined))).toBeUndefined()
    expect(openJoinRequestOf(new Error('requestAlreadyOpen'))).toBeUndefined()
  })

  it('records the open request a refused apply names, so withdraw and supplement can act on it', async () => {
    const { applicant, store } = applicantWith(baseApplication())
    mockApply.mockRejectedValue(already({ requestId: 'r9', status: 'deferred' }))

    await expect(applicant.submit(manifest, ['s1'], 'digest-1')).rejects.toBeInstanceOf(VtiRefusal)

    expect(store.current().submission).toMatchObject({ requestId: 'r9', state: 'deferred' })
    // The next submit answers that request instead of opening another.
    mockSupplement.mockResolvedValue({ requestId: 'r9', effect: 'allow', needs: [] })
    await applicant.submit(manifest, ['s1'], 'digest-1')
    expect(mockSupplement).toHaveBeenCalledWith(COMMUNITY, expect.objectContaining({ requestId: 'r9' }))
  })

  it('records a pending one as waiting on the community', async () => {
    const { applicant, store } = applicantWith(baseApplication())
    mockApply.mockRejectedValue(already({ requestId: 'r7', status: 'pending' }))
    await expect(applicant.submit(manifest, ['s1'], 'digest-1')).rejects.toBeInstanceOf(VtiRefusal)
    expect(store.current().submission).toMatchObject({ requestId: 'r7', state: 'pending' })
  })
})

describe('sending an application', () => {
  it('submits the first time, and records a deferral as open and waiting on the applicant', async () => {
    const { applicant, store } = applicantWith(baseApplication())
    mockApply.mockResolvedValue({ requestId: 'r1', effect: 'requestMore', needs: ['vetting:statements:1'] })

    const verdict = await applicant.submit(manifest, ['s1'], 'digest-1')

    expect(verdict.effect).toBe('requestMore')
    expect(mockApply).toHaveBeenCalledTimes(1)
    expect(mockSupplement).not.toHaveBeenCalled()
    expect(store.current().submission).toMatchObject({
      requestId: 'r1',
      state: 'deferred',
      needs: ['vetting:statements:1'],
    })
  })

  it('answers an open deferral with supplement, re-presenting every statement', async () => {
    const { applicant, store } = applicantWith({
      ...baseApplication(),
      submission: { requestId: 'r1', state: 'deferred', at: '2026-09-21T00:00:00Z' },
    })
    mockSupplement.mockResolvedValue({ requestId: 'r1', effect: 'allow', needs: [] })

    await applicant.submit(manifest, ['s1', 's2'], 'digest-1')

    // A second submit while one is open would be refused (VTI-04).
    expect(mockApply).not.toHaveBeenCalled()
    // The supplement REPLACES the presentation, so it carries both statements.
    expect(mockSupplement).toHaveBeenCalledWith(COMMUNITY, {
      credentials: ['s1', 's2'],
      requestId: 'r1',
      requirementsDigest: 'digest-1',
    })
    expect(store.current().submission).toMatchObject({ state: 'decided', effect: 'allow' })
  })

  it('falls back to a fresh submission when the open request is gone', async () => {
    const { applicant, store } = applicantWith({
      ...baseApplication(),
      submission: { requestId: 'r1', state: 'deferred', at: '2026-09-21T00:00:00Z' },
    })
    mockSupplement.mockRejectedValue(new VtiRefusal('vtc/join-requests/supplement:notFound', 'no open request'))
    mockApply.mockResolvedValue({ requestId: 'r2', effect: 'allow', needs: [] })

    await applicant.submit(manifest, ['s1'], 'digest-1')

    expect(mockApply).toHaveBeenCalledTimes(1)
    expect(store.current().submission).toMatchObject({ requestId: 'r2', state: 'decided' })
  })

  it('records an outcome that already stands, and surfaces it', async () => {
    const { applicant, store } = applicantWith({
      ...baseApplication(),
      submission: { requestId: 'r1', state: 'deferred', at: '2026-09-21T00:00:00Z' },
    })
    mockSupplement.mockRejectedValue(new VtiRefusal('vtc/join-requests/supplement:alreadyDecided', 'decided'))

    await expect(applicant.submit(manifest, ['s1'])).rejects.toBeInstanceOf(VtiRefusal)
    expect(mockApply).not.toHaveBeenCalled()
    expect(store.current().submission?.state).toBe('decided')
  })

  it('does not supplement a request the community owes a decision on', async () => {
    const { applicant } = applicantWith({
      ...baseApplication(),
      submission: { requestId: 'r1', state: 'pending', at: '2026-09-21T00:00:00Z' },
    })
    mockApply.mockResolvedValue({ requestId: 'r1', effect: 'refer', needs: [] })

    await applicant.submit(manifest, ['s1'])

    expect(mockSupplement).not.toHaveBeenCalled()
  })
})

describe('withdrawing', () => {
  it('closes the open request by its id and records it', async () => {
    const { applicant, store } = applicantWith({
      ...baseApplication(),
      submission: { requestId: 'r1', state: 'deferred', at: '2026-09-21T00:00:00Z' },
    })
    mockWithdraw.mockResolvedValue({ requestId: 'r1', status: 'withdrawn' })

    expect(await applicant.withdraw()).toBe('withdrawn')
    expect(mockWithdraw).toHaveBeenCalledWith(COMMUNITY, { requestId: 'r1', reason: undefined })
    expect(store.current().submission).toMatchObject({ requestId: 'r1', state: 'withdrawn' })
  })

  it('treats "nothing open" as the state a withdrawal would have left, not as a failure', async () => {
    const { applicant, store } = applicantWith({
      ...baseApplication(),
      submission: { requestId: 'r1', state: 'deferred', at: '2026-09-21T00:00:00Z' },
    })
    mockWithdraw.mockRejectedValue(new VtiRefusal('vtc/join-requests/withdraw:notFound', 'nothing open'))

    expect(await applicant.withdraw()).toBe('nothingOpen')
    expect(store.current().submission).toBeUndefined()
  })

  it('keeps an outcome that already stands', async () => {
    const { applicant, store } = applicantWith({
      ...baseApplication(),
      submission: { requestId: 'r1', state: 'pending', at: '2026-09-21T00:00:00Z' },
    })
    mockWithdraw.mockRejectedValue(new VtiRefusal('vtc/join-requests/withdraw:alreadyDecided', 'decided'))

    expect(await applicant.withdraw()).toBe('alreadyDecided')
    expect(store.current().submission?.state).toBe('decided')
  })

  it('does not swallow a refusal it does not understand', async () => {
    const { applicant } = applicantWith({
      ...baseApplication(),
      submission: { requestId: 'r1', state: 'deferred', at: '2026-09-21T00:00:00Z' },
    })
    mockWithdraw.mockRejectedValue(new VtiRefusal('taskFailed', 'something else'))

    await expect(applicant.withdraw()).rejects.toBeInstanceOf(VtiRefusal)
  })
})
