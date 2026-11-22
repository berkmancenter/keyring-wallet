/**
 * The vetter's desk keeps the vetter ready to vouch privately without anyone
 * asking: enrolment and the token draw run from the desk, not behind a screen.
 *
 * A vetter holding a live test-vtc grant made no `vta/pcs/*` call all evening,
 * because enrolment sat behind a screen they never opened; a hidden request
 * then had no vetter credential and no token behind it.
 *
 * The rounds themselves (agent blinds, community signs, agent unblinds; one
 * draw per tick) are `hiddenVetterRounds`, tested through the vetter adapter;
 * here they are stubs, and what is tested is when the desk runs them.
 */
const mockCriterion = jest.fn()
const mockIsEnrolled = jest.fn()
const mockEnrol = jest.fn()
const mockDraw = jest.fn()
// The round's hold on the shared session: records whether each step ran inside it.
const mockHeld = { depth: 0, steps: [] as string[] }
const mockAsVetter = jest.fn(async (_agent: unknown, _community: string, round: (p: unknown) => Promise<unknown>) => {
  mockHeld.depth++
  try {
    return await round(undefined)
  } finally {
    mockHeld.depth--
  }
})
const inHold =
  (step: string, f: jest.Mock) =>
  (...a: unknown[]) => {
    mockHeld.steps.push(`${step}:${mockHeld.depth > 0 ? 'held' : 'unheld'}`)
    return f(...a)
  }
let mockNow = 1_000_000

jest.mock('../module/hiddenVetterRounds', () => ({
  currentHiddenCriterion: (...a: unknown[]) => mockCriterion(...a),
  asVetter: (...a: unknown[]) => mockAsVetter(...(a as Parameters<typeof mockAsVetter>)),
  isEnrolled: (...a: unknown[]) => inHold('isEnrolled', mockIsEnrolled)(...a),
  enrolVetter: (...a: unknown[]) => inHold('enrol', mockEnrol)(...a),
  drawVetterTokens: (...a: unknown[]) => inHold('draw', mockDraw)(...a),
  nowMs: () => mockNow,
}))
jest.mock('../module/vtiAgent', () => ({
  ...jest.requireActual('../module/vtiAgent'),
  vtiAgent: { onInbound: () => () => undefined, send: jest.fn(async () => undefined) },
}))
jest.mock('@bifold/credo-tsp-adapter', () => ({}))
jest.mock('@bifold/trust-tasks', () => {
  const actual = jest.requireActual('@bifold/trust-tasks')
  return { ...actual, signDocumentProof: jest.fn(async (_a: unknown, doc: unknown) => doc) }
})

import {
  HIDDEN_VETTER_READY_INTERVAL_MS,
  HIDDEN_VETTING_NS,
  VtiVetterDesk,
  type VettingTicket,
} from '../module/vtiVetting'

const COMMUNITY = 'did:webvh:QmCommScid:vtc.example:tvtc-zq91'
const VETTER = 'did:webvh:QmVetterScid:vta.example:vett-zq92'
const APPLICANT = 'did:webvh:QmApplScid:vta.example:appl-zq93'
const CRITERION = { id: 'Vetted-Member', admission: 'automatic', requirementsDigest: 'zQmDigest' }
const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
const agent = { config: { logger } } as never
const persona = {
  did: VETTER,
  communityDid: COMMUNITY,
  kmsKeyIds: { signing: 'sig' },
  vtaKeyIds: { signing: `${VETTER}#key-0` },
} as never
const ticket: VettingTicket = {
  ticketId: 'vt-1',
  code: 'AAAA-BBBB',
  secret: 's',
  communityDid: COMMUNITY,
  usesLeft: 5,
  expiresAt: '2099-01-01T00:00:00Z',
  createdAt: '2026-10-01T00:00:00Z',
}
const store = () =>
  ({
    listTickets: async () => [{ ...ticket }],
    saveTicket: jest.fn(async () => undefined),
    listDesk: async () => [],
    saveDesk: jest.fn(async () => undefined),
    getApplication: async () => undefined,
  }) as never
const communityStore = { listHeldCredentials: async () => [], getMembership: async () => undefined } as never

const active = (statusChecked = true, reason?: string) =>
  ({ state: { state: 'active', statusChecked, ...(reason ? { reason } : {}) } }) as never

function desk(grant: unknown = active()) {
  const d = new VtiVetterDesk(agent, persona, store(), communityStore)
  jest.spyOn(d, 'grantWithState').mockResolvedValue(grant as never)
  jest.spyOn(d, 'grant').mockResolvedValue(undefined)
  return d
}
const logged = () => JSON.stringify([logger.info.mock.calls, logger.warn.mock.calls])

beforeEach(() => {
  jest.restoreAllMocks()
  for (const f of [mockCriterion, mockIsEnrolled, mockEnrol, mockDraw, ...Object.values(logger)]) f.mockReset()
  mockCriterion.mockResolvedValue(CRITERION)
  mockIsEnrolled.mockResolvedValue(false)
  mockEnrol.mockResolvedValue(undefined)
  mockDraw.mockResolvedValue({ drawn: 3 })
  mockNow = 1_000_000
  mockHeld.depth = 0
  mockHeld.steps = []
  mockAsVetter.mockClear()
})

describe('on its own, when the desk starts', () => {
  it('enrols for the period and draws, for a community with a hidden criterion and a live grant', async () => {
    const d = desk()
    await d.keepHiddenVetterReady('listen')
    expect(mockEnrol).toHaveBeenCalledWith(agent, COMMUNITY, CRITERION)
    expect(mockDraw).toHaveBeenCalledWith(agent, COMMUNITY, CRITERION)
    expect(mockEnrol.mock.invocationCallOrder[0]).toBeLessThan(mockDraw.mock.invocationCallOrder[0])
  })

  it("runs enrolment and the draw inside one hold of the session, as the desk's own persona", async () => {
    await desk().keepHiddenVetterReady('listen')
    expect(mockAsVetter).toHaveBeenCalledTimes(1)
    expect(mockAsVetter).toHaveBeenCalledWith(agent, COMMUNITY, expect.any(Function), persona)
    expect(mockHeld.steps).toEqual(['isEnrolled:held', 'enrol:held', 'draw:held'])
  })

  it('listen() starts it, without anyone opening a vetter screen', async () => {
    const d = desk()
    d.listen()
    await d.keepHiddenVetterReady('listen') // joins the round listen() started
    expect(mockEnrol).toHaveBeenCalledTimes(1)
    expect(mockDraw).toHaveBeenCalledTimes(1)
  })

  it('an enrolled vetter only draws', async () => {
    mockIsEnrolled.mockResolvedValue(true)
    await desk().keepHiddenVetterReady('listen')
    expect(mockEnrol).not.toHaveBeenCalled()
    expect(mockDraw).toHaveBeenCalledTimes(1)
  })

  it('does nothing, and says nothing, for a community that publishes no hidden criterion', async () => {
    mockCriterion.mockResolvedValue(undefined)
    await desk().keepHiddenVetterReady('listen')
    expect(mockIsEnrolled).not.toHaveBeenCalled()
    expect(mockEnrol).not.toHaveBeenCalled()
    expect(mockDraw).not.toHaveBeenCalled()
    expect(logger.info).not.toHaveBeenCalled()
  })

  it.each(['revoked', 'expired', 'notYetValid', 'none'])(
    'with a %s grant, does not enrol, and says why',
    async (state) => {
      await desk({ state: { state } }).keepHiddenVetterReady('listen')
      expect(mockEnrol).not.toHaveBeenCalled()
      expect(mockDraw).not.toHaveBeenCalled()
      expect(logged()).toContain(`no live vetter grant (${state})`)
    }
  )

  it('enrols on a grant whose status could not be read, and says it was not checked', async () => {
    await desk(active(false, 'fetch failed')).keepHiddenVetterReady('listen')
    expect(mockEnrol).toHaveBeenCalledTimes(1)
    expect(logged()).toContain('status not checked (fetch failed)')
  })

  it('says when the status was checked', async () => {
    await desk().keepHiddenVetterReady('listen')
    expect(logged()).toContain('status checked')
  })
})

describe('how often', () => {
  it('the Vetting screen calls listen every few seconds: one round per interval', async () => {
    const d = desk()
    await d.keepHiddenVetterReady('listen')
    mockNow += 3000
    await d.keepHiddenVetterReady('listen')
    expect(mockDraw).toHaveBeenCalledTimes(1)
    mockNow += HIDDEN_VETTER_READY_INTERVAL_MS
    await d.keepHiddenVetterReady('listen')
    expect(mockDraw).toHaveBeenCalledTimes(2)
  })

  it('a hidden request runs a round at once, whatever the interval', async () => {
    const d = desk()
    await d.keepHiddenVetterReady('listen')
    mockNow += 1000
    await d.keepHiddenVetterReady('request')
    expect(mockDraw).toHaveBeenCalledTimes(2)
  })

  it('two triggers at once share one round', async () => {
    let release: () => void = () => undefined
    mockDraw.mockImplementation(() => new Promise((resolve) => (release = () => resolve({ drawn: 1 }))))
    const d = desk()
    const first = d.keepHiddenVetterReady('listen')
    const second = d.keepHiddenVetterReady('request')
    await new Promise((r) => setTimeout(r, 0))
    release()
    await Promise.all([first, second])
    expect(mockDraw).toHaveBeenCalledTimes(1)
  })
})

describe('quietly', () => {
  it('a failure is logged with its code, never thrown, and the desk goes on', async () => {
    mockEnrol.mockRejectedValue(
      Object.assign(new Error('label not live'), { code: 'vtc/vetting/vetters/pcs-root:labelNotLive' })
    )
    await expect(desk().keepHiddenVetterReady('listen')).resolves.toBeUndefined()
    expect(mockDraw).not.toHaveBeenCalled()
    expect(logger.warn.mock.calls[0][0]).toMatch(/did not finish \(vtc\/vetting\/vetters\/pcs-root:labelNotLive\)/)
  })

  it('keeps the failure code for a screen to word, and clears it after a round that finishes', async () => {
    mockDraw.mockRejectedValueOnce(
      Object.assign(new Error('bound to another DID'), { code: 'keyring/hidden-vetter:memberMismatch' })
    )
    const d = desk()
    await d.keepHiddenVetterReady('request')
    expect(d.hiddenVetterBlockedBy).toBe('keyring/hidden-vetter:memberMismatch')
    await d.keepHiddenVetterReady('request')
    expect(d.hiddenVetterBlockedBy).toBeUndefined()
  })

  it('no DID, nor any segment of one, reaches the log', async () => {
    mockEnrol.mockRejectedValue(new Error('the agent did not answer'))
    await desk(active(false, 'fetch failed')).keepHiddenVetterReady('listen')
    for (const did of [COMMUNITY, VETTER])
      for (const piece of [did, ...did.split(':').filter((p) => p.length > 6)]) expect(logged()).not.toContain(piece)
  })
})

describe('when a request arrives', () => {
  const request = (ext?: Record<string, unknown>) => ({
    id: 'urn:uuid:req-1',
    type: 'https://trusttasks.org/spec/vetting/request/0.1',
    from: APPLICANT,
    body: {
      id: 'urn:uuid:req-1',
      type: 'https://trusttasks.org/spec/vetting/request/0.1',
      issuer: APPLICANT,
      payload: { community: COMMUNITY, joinDid: APPLICANT, ticket: { code: 'AAAA-BBBB' }, ...(ext ? { ext } : {}) },
    },
  })
  const take = async (ext?: Record<string, unknown>) => {
    const d = desk()
    const ready = jest.spyOn(d, 'keepHiddenVetterReady')
    await (d as unknown as { takeRequest: (m: unknown) => Promise<void> }).takeRequest(request(ext))
    return ready
  }

  it('a private one gets the vetter ready at once', async () => {
    const ready = await take({ [HIDDEN_VETTING_NS]: { suite: 'ps-ddh-bls12381', id: 'zPcsId' } })
    expect(ready).toHaveBeenCalledWith('request')
  })

  it('a named one does not', async () => {
    const ready = await take()
    expect(ready).not.toHaveBeenCalled()
  })
})
