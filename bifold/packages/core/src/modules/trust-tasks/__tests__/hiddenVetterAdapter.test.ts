/**
 * The vetter module as the vetter screens see it.
 *
 * All six methods are live. The last test asserts that none of them still
 * answers `:notImplemented`, so a half-wired seam cannot reach a tester's
 * phone unnoticed — a mistake this workstream has already made once.
 */
const COMMUNITY_DID = 'did:webvh:QmC:example:hv'

import { hiddenVetterSeam } from '../screens/hiddenVetterSeam'
import { pcsErrorCode } from '../screens/hiddenVettingSeam'

const mockShowPcsVetter = jest.fn(async () => ({
  contextId: 'vta',
  community: 'did:webvh:QmC:example:hv',
  enrolledLabels: ['vetter/2026-10'],
  tokensFree: 2,
  tokensHeld: 3,
}))
// The shape the community really takes: `$defs/RootRequest` requires `proof`
// and allows only `encoding` and `t0` beside it, each base58btc. An earlier
// fake here said `blinded`, which the schema forbids. And it is the inner
// `request` of the agent's answer, whole, label included — what the client
// hands on (graded end to end in hiddenVetterRoundsWire.test.ts).
const mockPcsRootRequest = jest.fn(async () => ({
  label: 'vetter/2026-10',
  id: 'z4FvpxtVbqEuVvYVCsPCWxpLJvJ9nnyLpAVfyFiM3Cxyz',
  request: { proof: 'z2AaBbCcDdEeFfGgHhJjKkMmNnPpQqRrSsTtUuVvWwXxYyZz' },
}))
const mockPcsRootAccept = jest.fn(async () => undefined)
const mockPcsTokensRequest = jest.fn(async () => ({
  label: 'token/2026-10',
  tick: 1,
  requests: [1, 2, 3].map((n) => ({ commitment: `z${n}Cm`, openingProof: `z${n}Op` })),
}))
const mockPcsTokensAccept = jest.fn(async () => undefined)
const mockPcsAttest = jest.fn(async () => ({ '@type': 'vtc/vetting/attestation/0.3', proof: { blinded: 'z2Att' } }))

jest.mock('../module/vtaAgent', () => ({
  vtaAgent: {
    agentAddress: () => 'did:webvh:QmAgent:example:agent',
    client: () => ({
      connect: async () => undefined,
      listContexts: async () => [{ id: 'vta' }],
      managerDid: 'did:peer:2.Ephone',
      showPcsVetter: mockShowPcsVetter,
      pcsRootRequest: mockPcsRootRequest,
      pcsRootAccept: mockPcsRootAccept,
      pcsTokensRequest: mockPcsTokensRequest,
      pcsTokensAccept: mockPcsTokensAccept,
      pcsTokensAbandon: async () => undefined,
      pcsAttest: mockPcsAttest,
    }),
  },
}))

const mockAsk = jest.fn(async (_did: string, type: string) => ({
  body: {
    payload: type.includes('pcs-root')
      ? { label: 'vetter/2026-10', preCredential: 'z2BxCdEfGhJk' }
      : { label: 'token/2026-10', tick: 1, preCredentials: ['z2TokenAaa', 'z2TokenBbb', 'z2TokenCcc'] },
  },
}))
const mockFetchManifest = jest.fn(async () => ({ criteria: [publishedCriterion] }))
jest.mock('../module/vtiAgent', () => ({
  vtiAgent: {
    did: 'did:webvh:QmP:example:persona',
    ask: (...a: unknown[]) => mockAsk(...(a as [string, string])),
    fetchManifest: (...a: unknown[]) => mockFetchManifest(...(a as [])),
    // The rounds sign the session in as the persona and run inside the hold.
    holding: (_agent: unknown, _mediator: unknown, persona: { did: string }, fn: (did: string) => unknown) =>
      fn(persona.did),
  },
}))

// The desk is 32's; this stands in for it so the adapter's own wiring is what
// the test exercises — which request it looks up, what it hands the agent, and
// what it refuses to spend a token on.
const DESK_REQUEST = {
  requestId: 'req-1',
  applicantDid: 'did:peer:2.Eapplicant',
  communityDid: 'did:webvh:QmC:example:hv',
  receivedAt: '2026-10-15T09:00:00.000Z',
  preferredMethod: 'in-person' as const,
  hiddenApplicantId: 'z6MkApplicantId',
  requirementsDigest: 'zQmPublished',
  status: 'cardReceived' as const,
}
const mockListDesk = jest.fn(async () => [DESK_REQUEST])
const mockHiddenRequests = jest.fn(async () => [DESK_REQUEST])
const mockDecline = jest.fn(async () => undefined)
let attestMeta = { community: COMMUNITY_DID, requirementsDigest: 'zQmPublished' }
const mockAttestHidden = jest.fn(
  async (_id: string, _statement: unknown, build: (i: { applicantId: string; meta: unknown }) => Promise<unknown>) =>
    build({ applicantId: DESK_REQUEST.hiddenApplicantId, meta: attestMeta })
)
jest.mock('../module/vtiVetting', () => ({
  GenericRecordsVettingStore: class {
    listDesk = mockListDesk
  },
  VtiVetterDesk: class {
    hiddenRequests = mockHiddenRequests
    attestHidden = mockAttestHidden
    decline = mockDecline
  },
}))
jest.mock('../module/VtiIdentityStore', () => ({
  GenericRecordsIdentityStore: class {
    getPersona = async () => ({ communityDid: COMMUNITY_DID, did: 'did:webvh:QmP:example:persona' })
  },
}))
jest.mock('../module/VtiCommunityStore', () => ({ GenericRecordsCommunityStore: class {} }))
jest.mock('@bifold/credo-tsp-adapter', () => ({}))

import '../module/hiddenVetterAdapter'

const COMMUNITY = 'did:webvh:QmC:example:hv'
const publishedCriterion = {
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
const criterion = publishedCriterion

/** Generic records in memory, enough for the vetter's own small record. */
function fakeAgent() {
  const rows: { content: Record<string, unknown>; tags: Record<string, string>; id: string; createdAt: Date }[] = []
  const self = {
    __rows: rows,
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
  return self as never
}

beforeEach(() => jest.clearAllMocks())

describe('standing, as the agent reports it', () => {
  it('reads enrolment from the labels and tokens from tokensFree', async () => {
    const standing = await hiddenVetterSeam()?.standing(fakeAgent(), COMMUNITY, criterion)
    expect(standing).toMatchObject({ enrolled: true, period: 'vetter/2026-10', tokens: 2, tokenLabel: 'token/2026-10' })
  })

  it('says nothing about a draw it cannot know, and never "enrolled until"', async () => {
    // A phone that has never drawn here has no last draw, so no next draw and
    // no lapse — absent, not zero. And the agent reports no enrolment expiry
    // at all: parsing a date out of "vetter/2026-10" would present an
    // inference as a fact.
    const standing = await hiddenVetterSeam()?.standing(fakeAgent(), COMMUNITY, criterion)
    expect(standing?.lastDrawAt).toBeUndefined()
    expect(standing?.nextDrawAt).toBeUndefined()
    expect(standing?.enrolledUntil).toBeUndefined()
  })
})

describe('enrolling, which crosses the agent and the community and back', () => {
  it('blinds at the agent, signs at the community, unblinds at the agent', async () => {
    await hiddenVetterSeam()?.enrol(fakeAgent(), COMMUNITY, criterion)
    expect(mockPcsRootRequest).toHaveBeenCalledTimes(1)
    expect(mockAsk).toHaveBeenCalledWith(COMMUNITY, expect.stringContaining('vetters/pcs-root'), expect.anything())
    // The community's answer goes back whole and in its declared shape: the
    // phone never holds an unblinded credential.
    expect(mockPcsRootAccept).toHaveBeenCalledWith(
      expect.objectContaining({ response: { label: 'vetter/2026-10', preCredential: 'z2BxCdEfGhJk' } })
    )
  })
})

describe('drawing tokens', () => {
  // 12:00Z on 1 October: tick 0 of token/2026-10 is the one tick owed.
  beforeEach(() => jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 9, 1, 12)))

  it('asks for exactly the published drip, never more', async () => {
    const drawn = await hiddenVetterSeam()?.drawTokens(fakeAgent(), COMMUNITY, criterion)
    expect(mockPcsTokensRequest).toHaveBeenCalledWith(expect.objectContaining({ count: 3, label: 'token/2026-10' }))
    expect(drawn).toEqual({ drawn: 3 })
  })

  it('does not draw twice in one tick', async () => {
    const agent = fakeAgent()
    await hiddenVetterSeam()?.drawTokens(agent, COMMUNITY, criterion)
    jest.clearAllMocks()
    expect(await hiddenVetterSeam()?.drawTokens(agent, COMMUNITY, criterion)).toEqual({ drawn: 0 })
    expect(mockPcsTokensRequest).not.toHaveBeenCalled()
  })
})

describe("the vetter's own queue", () => {
  it("is the desk's hidden queue, carrying no name for anyone", async () => {
    const open = await hiddenVetterSeam()?.requests(fakeAgent(), COMMUNITY)
    expect(mockHiddenRequests).toHaveBeenCalledWith(COMMUNITY)
    expect(open).toEqual([
      {
        id: 'req-1',
        applicantDid: 'did:peer:2.Eapplicant',
        receivedAt: '2026-10-15T09:00:00.000Z',
        method: 'in-person',
      },
    ])
    expect(JSON.stringify(open)).not.toContain('applicantName')
  })
})

const statement = {
  method: 'inPerson' as const,
  claimsVerified: ['LegalName'],
  livenessConfirmed: true,
  declaredRelationship: 'closeFriend' as const,
}

describe('attesting', () => {
  it('has the agent build the attestation for the id the desk holds', async () => {
    attestMeta = { community: COMMUNITY, requirementsDigest: 'zQmPublished' }
    await hiddenVetterSeam()?.attest(fakeAgent(), 'req-1', statement)
    expect(mockAttestHidden).toHaveBeenCalledWith('req-1', statement, expect.any(Function))
    expect(mockPcsAttest).toHaveBeenCalledWith(
      expect.objectContaining({ community: COMMUNITY, applicantId: 'z6MkApplicantId', meta: attestMeta })
    )
  })

  it('spends no token when the community changed what it asks', async () => {
    // The applicant's proof binds to the digest their application gathered
    // for. If the criterion has moved since, that proof cannot verify, so
    // attesting would burn one of this vetter's scarce tokens on a dead
    // application.
    attestMeta = { community: COMMUNITY, requirementsDigest: 'zQmSomethingElse' }
    const code = await hiddenVetterSeam()
      ?.attest(fakeAgent(), 'req-1', statement)
      .then(() => undefined)
      .catch((error: unknown) => pcsErrorCode(error))
    expect(code).toBe('keyring/hidden-vetter/attest:requirementsChanged')
    expect(mockPcsAttest).not.toHaveBeenCalled()
  })
})

describe('declining', () => {
  it('declines through the desk, and says which request it could not find', async () => {
    await hiddenVetterSeam()?.decline(fakeAgent(), 'req-1')
    expect(mockDecline).toHaveBeenCalledWith('req-1')

    mockListDesk.mockResolvedValueOnce([])
    const code = await hiddenVetterSeam()
      ?.decline(fakeAgent(), 'req-gone')
      .then(() => undefined)
      .catch((error: unknown) => pcsErrorCode(error))
    expect(code).toBe('keyring/hidden-vetter:noSuchRequest')
  })
})

describe('what this build carries', () => {
  it('leaves no method answering notImplemented', async () => {
    attestMeta = { community: COMMUNITY, requirementsDigest: 'zQmPublished' }
    const seam = hiddenVetterSeam() as never as Record<string, (...a: unknown[]) => Promise<unknown>>
    const stillAGap = await Promise.all(
      ['standing', 'enrol', 'drawTokens', 'requests', 'attest', 'decline'].map(async (name) => {
        const code = await seam[name](fakeAgent(), COMMUNITY, criterion)
          .then(() => undefined)
          .catch((error: unknown) => pcsErrorCode(error))
        return [name, code?.endsWith(':notImplemented') ?? false] as const
      })
    )
    expect(stillAGap.filter(([, gap]) => gap).map(([name]) => name)).toEqual([])
  })
})
