/**
 * A join whose answer comes after the 30 s clock (7b's R5, 10-06: 0.2 s late).
 * The request stays recorded as sent and the error goes to the screen, as
 * before; the late answer, when it comes while the ask is held, is recorded
 * as an answer in time would have been, so whatever reads the request learns
 * the verdict.
 */
const mockApply = jest.fn()
const mockLateVerdict = jest.fn()

jest.mock('@bifold/credo-tsp-adapter', () => ({}))
jest.mock('../module/vtaAgent', () => ({
  vtaAgent: {
    client: () => ({
      ensurePersona: async () => ({
        did: 'did:webvh:p:me',
        communityDid: 'did:webvh:c:late',
        kmsKeyIds: { keyAgreement: 'ka', signing: 'sig' },
      }),
    }),
  },
}))
jest.mock('../module/vtiTsp', () => ({ GenericRecordsTspPeerRevisionStore: class {} }))
jest.mock('../module/vtiAgent', () => {
  const actual = jest.requireActual('../module/vtiAgent')
  return {
    ...actual,
    vtiAgent: {
      connect: async () => undefined,
      onInbound: () => () => undefined,
      fetchManifest: async () => ({ wire: '0.3', criteria: [] }),
      apply: (...args: unknown[]) => mockApply(...args),
      lateVerdict: (...args: unknown[]) => mockLateVerdict(...args),
    },
  }
})

import { VtiRefusal, VtiSentNoAnswer } from '../module/vtiAgent'
import { joinCommunity } from '../module/vtiJoin'

const COMMUNITY = 'did:webvh:c:late'

function store() {
  let submission: Record<string, unknown> | undefined
  return {
    saveSubmission: jest.fn(async (s: Record<string, unknown>) => {
      submission = s
    }),
    getSubmission: jest.fn(async () => submission),
    current: () => submission,
  }
}

const deps = (communityStore: ReturnType<typeof store>) =>
  ({
    agent: { config: { logger: { warn: jest.fn(), info: jest.fn() } } },
    identityStore: {},
    communityStore,
    vtaDid: 'did:webvh:vta',
    mediatorDid: 'did:peer:lab',
    communityDid: COMMUNITY,
  }) as never

const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

describe('a join answered after its clock ran out', () => {
  const noAnswer = new VtiSentNoAnswer(
    'https://trusttasks.org/spec/vtc/join-requests/submit/0.3',
    'urn:uuid:r',
    0,
    COMMUNITY
  )

  beforeEach(() => {
    // The inbox stays open a while after a failure: a timer, not a wait.
    jest.useFakeTimers()
    mockApply.mockReset().mockRejectedValue(noAnswer)
    mockLateVerdict.mockReset()
  })
  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
  })

  it('still says "sent, no answer yet" to the caller, and records the late verdict when it comes', async () => {
    let arrive: (v: unknown) => void = () => undefined
    mockLateVerdict.mockReturnValue(new Promise((resolve) => (arrive = resolve)))
    const communityStore = store()
    await expect(joinCommunity(deps(communityStore))).rejects.toBe(noAnswer)
    expect(mockLateVerdict).toHaveBeenCalledWith(noAnswer)
    expect(communityStore.current()).not.toHaveProperty('acknowledgedAt')

    arrive({ requestId: 'r7', effect: 'refer', needs: [] })
    await settle()
    expect(communityStore.current()).toMatchObject({
      requestId: 'r7',
      status: 'pending',
      acknowledgedAt: expect.any(String),
    })
  })

  it('no late answer: the request stays as sent', async () => {
    mockLateVerdict.mockResolvedValue(undefined)
    const communityStore = store()
    await expect(joinCommunity(deps(communityStore))).rejects.toBe(noAnswer)
    await settle()
    expect(communityStore.current()).not.toHaveProperty('acknowledgedAt')
    expect(communityStore.current()).not.toHaveProperty('status')
  })

  it('a late refusal is recorded as an answer', async () => {
    mockLateVerdict.mockRejectedValue(new VtiRefusal('vtc/join-requests/submit:requestAlreadyOpen', 'open'))
    const communityStore = store()
    await expect(joinCommunity(deps(communityStore))).rejects.toBe(noAnswer)
    await settle()
    expect(communityStore.current()).toHaveProperty('acknowledgedAt')
  })

  it('any other failure does not wait for a late answer', async () => {
    mockApply.mockRejectedValue(new Error('vtiAgent: not connected'))
    const communityStore = store()
    await expect(joinCommunity(deps(communityStore))).rejects.toThrow('not connected')
    expect(mockLateVerdict).not.toHaveBeenCalled()
  })
})
