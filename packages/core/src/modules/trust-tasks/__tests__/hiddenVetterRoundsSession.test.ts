/**
 * The vetter's rounds sign the shared session in as the vetter's own persona
 * for the community, and bind tokens to that persona and nothing else.
 *
 * 277, a vetter's phone (01:41Z): the one session `vtiAgent` holds changed
 * hands between two of the phone's personas every 10 to 20 s. A round read
 * `vtiAgent.did` while a sign-in was in flight, found none, and stopped
 * `noIdentity`. Had it read the other persona instead, it would have bound
 * the draw to that DID, and the community refuses every opening made under
 * another name (`badOpeningProof`).
 *
 * The session here is a model: `did` is whoever holds it now, and `holding`
 * signs it in as the persona it is given, as `vtiAgent.holding` does.
 */
const VETTER = 'did:webvh:QmVetterScid:vta.example:celery-zoo'
const OTHER = 'did:webvh:QmOtherScid:vta.example:swing-expose'
const COMMUNITY = 'did:webvh:QmCommScid:vtc.example:first-vtc'

const mockSession: { did: string | undefined; heldAs: string[]; askedAs: (string | undefined)[] } = {
  did: undefined,
  heldAs: [],
  askedAs: [],
}
const mockHolding = jest.fn(
  async (_agent: unknown, _mediator: unknown, persona: { did: string }, fn: (did: string) => Promise<unknown>) => {
    mockSession.did = persona.did
    mockSession.heldAs.push(persona.did)
    return fn(persona.did)
  }
)
const mockAsk = jest.fn(async (_did: string, type: string) => {
  mockSession.askedAs.push(mockSession.did)
  return {
    body: {
      payload: type.includes('pcs-root')
        ? { label: 'vetter/2026-10', preCredential: 'z2BxCdEfGhJk' }
        : { label: 'token/2026-10', tick: 0, preCredentials: ['z2TokenAaa', 'z2TokenBbb', 'z2TokenCcc'] },
    },
  }
})
jest.mock('../module/vtiAgent', () => ({
  ...jest.requireActual('../module/vtiAgent'),
  vtiAgent: {
    get did() {
      return mockSession.did
    },
    ask: (...a: unknown[]) => mockAsk(...(a as [string, string])),
    holding: (...a: unknown[]) => mockHolding(...(a as Parameters<typeof mockHolding>)),
  },
}))

let mockEngine: { memberDid?: string; enrolledLabels?: string[]; id?: string } | undefined
const mockPcsRootRequest = jest.fn(async () => ({
  label: 'vetter/2026-10',
  id: 'z4FvpxtVbqEuVvYVCsPCWxpLJvJ9nnyLpAVfyFiM3Cxyz',
  request: { proof: 'z2AaBbCcDdEeFfGgHhJjKkMmNnPpQqRrSsTtUuVvWwXxYyZz' },
}))
const mockPcsTokensRequest = jest.fn(async () => ({
  label: 'token/2026-10',
  tick: 0,
  requests: [1, 2, 3].map((n) => ({ commitment: `z${n}Cm`, openingProof: `z${n}Op` })),
}))
jest.mock('../module/vtaAgent', () => ({
  vtaAgent: {
    agentAddress: () => 'did:webvh:QmAgent:example:agent',
    client: () => ({
      connect: async () => undefined,
      listContexts: async () => [{ id: 'vta' }],
      showPcsVetter: async () => mockEngine,
      pcsRootRequest: mockPcsRootRequest,
      pcsRootAccept: async () => undefined,
      pcsTokensRequest: mockPcsTokensRequest,
      pcsTokensAccept: async () => undefined,
      pcsTokensAbandon: async () => undefined,
    }),
  },
}))

let mockPersona: { did: string; communityDid: string } | undefined
jest.mock('../module/VtiIdentityStore', () => ({
  GenericRecordsIdentityStore: class {
    getPersona = async () => mockPersona
  },
}))
jest.mock('@bifold/credo-tsp-adapter', () => ({}))

import { asVetter, boundElsewhere, drawVetterTokens, enrolVetter, isEnrolled } from '../module/hiddenVetterRounds'

const criterion = {
  id: 'Vetted-Member',
  requirementsDigest: 'zQmPublished',
  vetting: {
    minStatements: 1,
    ext: {
      'org.openvtc.hidden-vetting': {
        suite: 'ps-ddh-bls12381',
        helperKey: 'z6MkhelperKey',
        tokenKey: 'z6MktokenKey',
        vetterLabels: ['vetter/2026-10'],
        tokenLabels: ['token/2026-10'],
        dripPerTick: 3,
        tickLength: 'P3D',
        events: [],
      },
    },
  },
} as never

/** Generic records in memory, enough for the vetter's own small record. */
function fakeAgent() {
  const rows: { content: Record<string, unknown>; tags: Record<string, string>; id: string; createdAt: Date }[] = []
  return {
    genericRecords: {
      findAllByQuery: async (q: Record<string, string>) =>
        rows.filter((r) => Object.entries(q).every(([k, v]) => r.tags[k] === v)),
      save: async ({ content, tags }: { content: Record<string, unknown>; tags: Record<string, string> }) => {
        rows.push({ content, tags, id: `r${rows.length}`, createdAt: new Date() })
      },
      update: async () => undefined,
      delete: async () => undefined,
    },
  } as never
}

beforeEach(() => {
  jest.clearAllMocks()
  mockSession.did = undefined
  mockSession.heldAs = []
  mockSession.askedAs = []
  mockPersona = { did: VETTER, communityDid: COMMUNITY }
  mockEngine = undefined
  // 12:00Z on 1 October: tick 0 of token/2026-10 is the one tick owed.
  jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 9, 1, 12))
})

describe('a round signs the session in as the vetter, whoever held it', () => {
  it('mid-sign-in (no DID yet): enrols bound to the vetter, not refused as not signed in', async () => {
    await enrolVetter(fakeAgent(), COMMUNITY, criterion)
    expect(mockHolding).toHaveBeenCalledWith(expect.anything(), undefined, mockPersona, expect.any(Function), {
      reason: 'a step',
    })
    expect(mockPcsRootRequest).toHaveBeenCalledWith(expect.objectContaining({ memberDid: VETTER }))
    expect(mockSession.askedAs).toEqual([VETTER])
  })

  it("held by another of this phone's personas: enrols bound to the vetter, never the holder", async () => {
    mockSession.did = OTHER
    await enrolVetter(fakeAgent(), COMMUNITY, criterion)
    expect(mockPcsRootRequest).toHaveBeenCalledWith(expect.objectContaining({ memberDid: VETTER }))
    expect(mockSession.askedAs).toEqual([VETTER])
  })

  it('held by another persona: draws from the engine bound to the vetter, signed as the vetter', async () => {
    mockSession.did = OTHER
    mockEngine = { memberDid: VETTER, enrolledLabels: ['vetter/2026-10'] }
    expect(await drawVetterTokens(fakeAgent(), COMMUNITY, criterion)).toEqual({ drawn: 3 })
    expect(mockSession.askedAs).toEqual([VETTER])
  })

  it('held by another persona: an engine bound to the vetter reads as enrolled', async () => {
    mockSession.did = OTHER
    mockEngine = { memberDid: VETTER, enrolledLabels: ['vetter/2026-10'] }
    expect(await isEnrolled(fakeAgent(), COMMUNITY, criterion)).toBe(true)
    expect(mockSession.heldAs).toEqual([VETTER])
  })
})

describe('never bound to another DID', () => {
  it('a session that is not the vetter inside the round stops it before anything reaches the community', async () => {
    // A hold that failed to keep the session: the round refuses rather than
    // sign as whoever holds it.
    mockHolding.mockImplementationOnce(async (_a, _m, _p, fn) => {
      mockSession.did = OTHER
      return fn(OTHER)
    })
    await expect(enrolVetter(fakeAgent(), COMMUNITY, criterion)).rejects.toMatchObject({
      code: 'keyring/hidden-vetter:noIdentity',
    })
    expect(mockPcsRootRequest).not.toHaveBeenCalled()
    expect(mockAsk).not.toHaveBeenCalled()
  })

  it('no persona for the community: says so, and signs nothing in', async () => {
    mockPersona = undefined
    await expect(enrolVetter(fakeAgent(), COMMUNITY, criterion)).rejects.toMatchObject({
      code: 'keyring/hidden-vetter:noPersona',
    })
    expect(mockHolding).not.toHaveBeenCalled()
    expect(mockAsk).not.toHaveBeenCalled()
  })
})

describe('a round inside a hold', () => {
  it('uses the held persona, even when the store now answers another', async () => {
    await asVetter(fakeAgent(), COMMUNITY, async () => {
      // A repaired record rewritten between two reads.
      mockPersona = { did: OTHER, communityDid: COMMUNITY }
      await enrolVetter(fakeAgent(), COMMUNITY, criterion)
    })
    expect(mockSession.heldAs).toEqual([VETTER, VETTER])
    expect(mockPcsRootRequest).toHaveBeenCalledWith(expect.objectContaining({ memberDid: VETTER }))
    expect(mockSession.askedAs).toEqual([VETTER])
  })

  it('naming another persona is refused at once, not left waiting on the hold around it', async () => {
    const vetter = { did: VETTER, communityDid: COMMUNITY } as never
    const other = { did: OTHER, communityDid: COMMUNITY } as never
    const inner = jest.fn(async () => 'inner')
    await expect(
      asVetter(fakeAgent(), COMMUNITY, () => asVetter(fakeAgent(), COMMUNITY, inner, other), vetter)
    ).rejects.toMatchObject({ code: 'keyring/hidden-vetter:noPersona' })
    expect(inner).not.toHaveBeenCalled()
    expect(mockSession.heldAs).toEqual([VETTER])
  })

  it('once the hold ends, the next round reads the store again', async () => {
    await asVetter(fakeAgent(), COMMUNITY, async () => undefined)
    mockPersona = { did: OTHER, communityDid: COMMUNITY }
    await asVetter(fakeAgent(), COMMUNITY, async () => undefined)
    expect(mockSession.heldAs).toEqual([VETTER, OTHER])
  })

  it('a round that fails lets go too: the next round reads the store again', async () => {
    const failed = Object.assign(new Error('refused'), { code: 'keyring/hidden-vetter:noIdentity' })
    await expect(asVetter(fakeAgent(), COMMUNITY, async () => Promise.reject(failed))).rejects.toBe(failed)
    mockHolding.mockRejectedValueOnce(new Error('sign-in failed'))
    await expect(asVetter(fakeAgent(), COMMUNITY, async () => undefined)).rejects.toThrow('sign-in failed')
    mockPersona = { did: OTHER, communityDid: COMMUNITY }
    await asVetter(fakeAgent(), COMMUNITY, async () => undefined)
    expect(mockSession.heldAs).toEqual([VETTER, OTHER])
  })
})

describe('bound elsewhere is measured against the persona, not the session', () => {
  it('an engine bound to the vetter is not stuck while another persona holds the session', () => {
    mockSession.did = OTHER
    expect(boundElsewhere({ memberDid: VETTER }, { did: VETTER })).toBe(false)
  })

  it('an engine bound to another DID is stuck', () => {
    mockSession.did = VETTER
    expect(boundElsewhere({ memberDid: OTHER }, { did: VETTER })).toBe(true)
    expect(boundElsewhere(undefined, { did: VETTER })).toBe(false)
  })
})
