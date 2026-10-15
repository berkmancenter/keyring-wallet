/**
 * The vetter module as the vetter screens see it.
 *
 * Three of the six methods are live and three are stated gaps. The last test
 * names exactly which, so the set cannot drift quietly in either direction —
 * a half-wired seam reaching a tester's phone is a mistake this workstream has
 * already made once.
 */
import { hiddenVetterSeam } from '../screens/hiddenVetterSeam'
import { pcsErrorCode } from '../screens/hiddenVettingSeam'

const mockShowPcsVetter = jest.fn(async () => ({
  contextId: 'vta',
  community: 'did:webvh:QmC:example:hv',
  enrolledLabels: ['vetter/2026-10'],
  tokensFree: 2,
  tokensHeld: 3,
}))
const mockPcsRootRequest = jest.fn(async () => ({ id: 'z4Fvpxt', request: { blinded: 'z2Aaa' } }))
const mockPcsRootAccept = jest.fn(async () => undefined)
const mockPcsTokensRequest = jest.fn(async () => ({ requests: [{ r: 1 }, { r: 2 }, { r: 3 }] }))
const mockPcsTokensAccept = jest.fn(async () => undefined)

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
jest.mock('../module/vtiAgent', () => ({ vtiAgent: { ask: (...a: unknown[]) => mockAsk(...(a as [string, string])) } }))
jest.mock('@bifold/credo-tsp-adapter', () => ({}))

import '../module/hiddenVetterAdapter'

const COMMUNITY = 'did:webvh:QmC:example:hv'
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

describe('what this build does not carry yet', () => {
  it('names exactly the three gaps, and no others', async () => {
    const seam = hiddenVetterSeam() as never as Record<string, (...a: unknown[]) => Promise<unknown>>
    const codes = await Promise.all(
      ['standing', 'enrol', 'drawTokens', 'requests', 'attest', 'decline'].map(async (name) => {
        const code = await seam[name](fakeAgent(), COMMUNITY, criterion)
          .then(() => undefined)
          .catch((error: unknown) => pcsErrorCode(error))
        return [name, code?.endsWith(':notImplemented') ?? false] as const
      })
    )
    expect(Object.fromEntries(codes)).toEqual({
      standing: false,
      enrol: false,
      drawTokens: false,
      requests: true,
      attest: true,
      decline: true,
    })
  })
})
