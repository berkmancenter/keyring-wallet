/**
 * Row V (Alberto, 11-17): a vetting under way has a way out. On the 11-16 demo, step 3 ("waiting for the vetter to
 * open the session") had no time limit, no cancel and no box for the vetter's new ticket.
 *  - stopWaiting: stop waiting for one vetter on this phone, so a new ticket can be used (V2, V3);
 *  - stopVetting: forget the vetting and the identity made for it, only while nothing has gone to the community (V4).
 */
import { stopVetting } from '../module/vtiJoin'
import { VtiApplicant, type VettingApplication, type VtiVettingStore } from '../module/vtiVetting'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

// stopVetting announces the change on a timer (emitCommunityChanged): run it before the environment goes.
beforeEach(() => jest.useFakeTimers())
afterEach(() => {
  jest.runOnlyPendingTimers()
  jest.useRealTimers()
})

const COMMUNITY = 'did:webvh:Qm:vtc.example:lab'
const VETTER = 'did:webvh:Qm:vta.example:brendan'

const application = (over: Partial<VettingApplication> = {}): VettingApplication =>
  ({
    communityDid: COMMUNITY,
    joinDid: 'did:webvh:Qm:vta.example:me',
    minStatements: 1,
    requiredClaims: [],
    acceptedMethods: ['inPerson'],
    commitmentSalt: 's',
    claims: {},
    requests: [{ vetterDid: VETTER, requestDocumentId: 'req-1', status: 'sent', sentAt: '2026-11-17T01:58:00Z' }],
    startedAt: '2026-11-17T01:50:00Z',
    ...over,
  }) as VettingApplication

function stores(
  opts: {
    app?: VettingApplication
    submission?: unknown
    membership?: unknown
    fails?: 'application' | 'submission' | 'membership'
  } = {}
) {
  const read = <T>(what: string, value: T) =>
    jest.fn(async () => {
      if (opts.fails === what) throw new Error('Error executing query. Invalid store handle')
      return value
    })
  const vettingStore = {
    getApplication: read('application', opts.app),
    forgetApplication: jest.fn(async () => undefined),
  }
  const communityStore = {
    getMembership: read('membership', opts.membership),
    getSubmission: read('submission', opts.submission) as jest.Mock | undefined,
  }
  const identityStore = { forgetPersona: jest.fn(async () => undefined) }
  return { deps: { vettingStore, communityStore, identityStore } as never, vettingStore, communityStore, identityStore }
}

describe('stopVetting: forget the vetting and its identity, only while nothing has gone to the community', () => {
  test('nothing sent: the application and the identity made for it are forgotten', async () => {
    const s = stores({ app: application() })
    expect(await stopVetting(s.deps, COMMUNITY)).toBe('stopped')
    expect(s.vettingStore.forgetApplication).toHaveBeenCalledWith(COMMUNITY)
    expect(s.identityStore.forgetPersona).toHaveBeenCalledWith(COMMUNITY)
  })

  test.each([
    ['the application was submitted', { app: application({ submission: { requestId: 'j-1' } as never }) }],
    ['a join request is on record for the community', { app: application(), submission: { requestId: 'j-1' } }],
  ])('%s: refused as sent, and nothing is cleared', async (_label, opts) => {
    const s = stores(opts)
    expect(await stopVetting(s.deps, COMMUNITY)).toBe('sent')
    expect(s.vettingStore.forgetApplication).not.toHaveBeenCalled()
    expect(s.identityStore.forgetPersona).not.toHaveBeenCalled()
  })

  test.each(['application', 'submission', 'membership'] as const)(
    'the %s cannot be read: unreadable, and nothing is cleared (it fails toward refusing, never as "nothing sent")',
    async (fails) => {
      const s = stores({ app: application(), fails })
      expect(await stopVetting(s.deps, COMMUNITY)).toBe('unreadable')
      expect(s.vettingStore.forgetApplication).not.toHaveBeenCalled()
      expect(s.identityStore.forgetPersona).not.toHaveBeenCalled()
    }
  )

  test.each([
    ['the application', 'vettingStore', 'forgetApplication'],
    ['the identity', 'identityStore', 'forgetPersona'],
  ] as const)(
    'clearing %s fails: partial, never "stopped" and never "nothing removed" (part may be gone)',
    async (_l, store, method) => {
      const s = stores({ app: application() })
      ;(s[store] as Record<string, jest.Mock>)[method].mockRejectedValue(new Error('Invalid store handle'))
      expect(await stopVetting(s.deps, COMMUNITY)).toBe('partial')
    }
  )

  test('a store that cannot say what was sent: unreadable, and nothing is cleared', async () => {
    const s = stores({ app: application() })
    s.communityStore.getSubmission = undefined
    expect(await stopVetting(s.deps, COMMUNITY)).toBe('unreadable')
    expect(s.identityStore.forgetPersona).not.toHaveBeenCalled()
  })

  test('an identity that holds a membership here is not the vetting’s to forget (control: the application still goes)', async () => {
    const s = stores({ app: application(), membership: { communityDid: COMMUNITY } })
    expect(await stopVetting(s.deps, COMMUNITY)).toBe('stopped')
    expect(s.vettingStore.forgetApplication).toHaveBeenCalledWith(COMMUNITY)
    expect(s.identityStore.forgetPersona).not.toHaveBeenCalled()
  })
})

describe('stopWaiting: stop waiting for one vetter, so a new ticket can be used', () => {
  test('the request ends on this phone, marked as stopped by the person; nothing is sent', async () => {
    let kept = application()
    const store = {
      getApplication: jest.fn(async () => kept),
      saveApplication: jest.fn(async (a: VettingApplication) => void (kept = a)),
    } as unknown as VtiVettingStore
    const agent = { genericRecords: {} } as never
    const applicant = new VtiApplicant(agent, { did: 'did:me', communityDid: COMMUNITY } as never, store, {} as never)
    await applicant.stopWaiting(VETTER)
    expect(kept.requests[0]).toMatchObject({ status: 'declined', stoppedAt: expect.any(String) })
    // Control: abandonSession (codes differ) ends it too, but is not a stop by the person.
    kept = application()
    await applicant.abandonSession(VETTER)
    expect(kept.requests[0].status).toBe('declined')
    expect(kept.requests[0].stoppedAt).toBeUndefined()
  })
})
