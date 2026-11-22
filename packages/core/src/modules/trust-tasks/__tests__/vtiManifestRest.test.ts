/**
 * The join manifest over REST, before any community session exists.
 *
 * A fresh phone reaches Join before it has opened a session, and the
 * controller only learned an agent when a session opened — so the REST read,
 * the one path that works with no session, was skipped, and a community that
 * publishes a name was shown as having none (Farm gate, 2026-09-23). The
 * caller's agent now carries the read.
 */
import { readPublicProfileName, vtiAgent } from '../module/vtiAgent'
import { communityTarget } from '../module/vtiCommunityLink'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const communityDid = 'did:webvh:QmCommunity:vtc.example.org'
const restBase = 'https://vtc.example.org/v1'

function fakeAgent() {
  return {
    dids: {
      resolveDidDocument: jest.fn(async () => ({
        id: communityDid,
        service: [{ id: '#rest', type: 'VTCRest', serviceEndpoint: restBase }],
      })),
    },
    config: { logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } },
  }
}

describe('the join manifest with no session', () => {
  const realFetch = global.fetch
  beforeEach(() => {
    communityTarget.clear()
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        type: 'https://trusttasks.org/spec/vtc/join-requests/manifest/0.2#response',
        payload: {
          communityDid,
          criteria: [{ type: 'invited-member' }],
          branding: { displayName: 'Keyring Lab Community' },
        },
      }),
    })) as unknown as typeof fetch
  })
  afterEach(() => {
    global.fetch = realFetch
  })

  it('reads it over REST with the caller’s agent, and learns the published name', async () => {
    const agent = fakeAgent()
    const manifest = await vtiAgent.fetchManifest(communityDid, agent as never)
    expect(global.fetch).toHaveBeenCalledWith(`${restBase}/trust-tasks`, expect.objectContaining({ method: 'POST' }))
    expect(manifest.criteria).toHaveLength(1)
    expect(communityTarget.publishedNameOf(communityDid)).toBe('Keyring Lab Community')
  })

  it('does not ask the public profile when the manifest names the community', async () => {
    await vtiAgent.fetchManifest(communityDid, fakeAgent() as never)
    await vtiAgent.profileNameRead
    expect(global.fetch).not.toHaveBeenCalledWith(`${restBase}/community/public-profile`, expect.anything())
  })
})

/**
 * A manifest names a community only when its operator set branding, which a
 * fresh community has not — so it read as "a community" while its public
 * profile carried a name all along.
 */
describe("a community's name from its public profile, when the manifest has none", () => {
  const realFetch = global.fetch
  const answer = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body })
  function serve(profile: () => ReturnType<typeof answer>) {
    global.fetch = jest.fn(async (url: string) =>
      url.endsWith('/community/public-profile')
        ? profile()
        : answer(200, {
            type: 'https://trusttasks.org/spec/vtc/join-requests/manifest/0.2#response',
            payload: { communityDid, criteria: [{ type: 'invited-member' }] },
          })
    ) as unknown as typeof fetch
  }
  beforeEach(() => communityTarget.clear())
  afterEach(() => {
    global.fetch = realFetch
  })

  it('learns the profile’s name as the community’s own, from the same REST base', async () => {
    serve(() => answer(200, { communityDid, name: '  First Person Lab  ', description: '' }))
    await vtiAgent.fetchManifest(communityDid, fakeAgent() as never)
    await vtiAgent.profileNameRead
    expect(global.fetch).toHaveBeenCalledWith(
      `${restBase}/community/public-profile`,
      expect.objectContaining({ method: 'GET' })
    )
    expect(communityTarget.publishedNameOf(communityDid)).toBe('First Person Lab')
  })

  it('leaves it unnamed when the profile’s name is empty, as a new community’s is', async () => {
    serve(() => answer(200, { communityDid, name: '' }))
    await vtiAgent.fetchManifest(communityDid, fakeAgent() as never)
    await vtiAgent.profileNameRead
    expect(communityTarget.publishedNameOf(communityDid)).toBeUndefined()
  })

  it('never takes a name from a profile about another community — communities share hosts', async () => {
    serve(() => answer(200, { communityDid: 'did:webvh:QmOther:vtc.example.org', name: 'Someone Else' }))
    await vtiAgent.fetchManifest(communityDid, fakeAgent() as never)
    await vtiAgent.profileNameRead
    expect(communityTarget.publishedNameOf(communityDid)).toBeUndefined()
  })

  it('leaves it unnamed when there is no profile, or no answer at all', async () => {
    serve(() => answer(404, { error: 'community profile not initialised' }))
    await vtiAgent.fetchManifest(communityDid, fakeAgent() as never)
    await vtiAgent.profileNameRead
    expect(communityTarget.publishedNameOf(communityDid)).toBeUndefined()

    serve(() => {
      throw new TypeError('Network request failed')
    })
    const manifest = await vtiAgent.fetchManifest(communityDid, fakeAgent() as never)
    await vtiAgent.profileNameRead
    expect(manifest.criteria).toHaveLength(1)
    expect(communityTarget.publishedNameOf(communityDid)).toBeUndefined()
  })
})

describe('readPublicProfileName', () => {
  it('adds the API prefix to a community published without it, never twice', async () => {
    const doFetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ communityDid, name: 'N' }) }))
    await readPublicProfileName('https://vtc.example.org', communityDid, doFetch as never)
    await readPublicProfileName('https://vtc.example.org/v1/', communityDid, doFetch as never)
    expect(doFetch.mock.calls.map((c) => (c as unknown[])[0])).toEqual([
      'https://vtc.example.org/v1/community/public-profile',
      'https://vtc.example.org/v1/community/public-profile',
    ])
  })

  it('reads nothing from a name that is not a string', async () => {
    const doFetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ communityDid, name: 42 }) }))
    expect(await readPublicProfileName(restBase, communityDid, doFetch as never)).toBeUndefined()
  })
})

/**
 * How a community's cards look is kept from the same reads: its manifest's accent colour and logo, and the public
 * profile's logo when the manifest gives none. Kept even when there is none, so the Wallet knows it was asked.
 */
describe("a community's card look, kept from its manifest and profile", () => {
  const realFetch = global.fetch
  const answer = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body })
  const { memoryGenericRecords } = jest.requireActual('../../../../__tests__/modules/vrc/fixtures/memoryGenericRecords')
  const { GenericRecordsCommunityStore } = jest.requireActual('../module/VtiCommunityStore')

  /** `answeredFor`: the community the answer names (another's at a shared host); null names none. */
  function serve(branding: unknown, profile: unknown, answeredFor: string | null = communityDid) {
    global.fetch = jest.fn(async (url: string) =>
      url.endsWith('/community/public-profile')
        ? answer(200, profile)
        : answer(200, {
            type: 'https://trusttasks.org/spec/vtc/join-requests/manifest/0.2#response',
            payload: {
              ...(answeredFor ? { communityDid: answeredFor } : {}),
              criteria: [{ type: 'invited-member' }],
              ...(branding ? { branding } : {}),
            },
          })
    ) as unknown as typeof fetch
  }
  const newAgent = () => ({ ...fakeAgent(), genericRecords: memoryGenericRecords() })
  async function keptAfterRead(agent = newAgent()) {
    await vtiAgent.fetchManifest(communityDid, agent as never)
    await vtiAgent.profileNameRead
    // The brand is kept in the background; let it land.
    await new Promise((resolve) => setTimeout(resolve, 0))
    return new GenericRecordsCommunityStore(agent).listCommunityBrands()
  }
  beforeEach(() => communityTarget.clear())
  afterEach(() => {
    global.fetch = realFetch
  })

  it('keeps the manifest’s accent colour and https logo, as given', async () => {
    serve({ displayName: 'Harbor', accentColor: '#1A4D80', logoUrl: 'https://vtc.example.org/logo.png' }, {})
    expect(await keptAfterRead()).toEqual([
      expect.objectContaining({
        communityDid,
        accentColor: '#1a4d80',
        logoUrl: 'https://vtc.example.org/logo.png',
      }),
    ])
  })

  it('keeps "none" when the community gives none, so the Wallet knows it was asked', async () => {
    serve(undefined, { communityDid, name: '' })
    const kept = await keptAfterRead()
    expect(kept).toHaveLength(1)
    expect(kept[0]).toMatchObject({ communityDid, accentColor: undefined, logoUrl: undefined })
  })

  it('takes the public profile’s https logo when the manifest gives none', async () => {
    serve(undefined, { communityDid, name: 'Harbor', logo_url: 'https://vtc.example.org/profile-logo.png' })
    expect(await keptAfterRead()).toEqual([
      expect.objectContaining({ communityDid, logoUrl: 'https://vtc.example.org/profile-logo.png' }),
    ])
  })

  // This read runs each time a community's screen opens: "none" kept first took the logo away until the profile
  // answered, and on a first open said there was none.
  it('keeps the profile’s logo in one write, never "none" first', async () => {
    serve(undefined, { communityDid, name: 'Harbor', logo_url: 'https://vtc.example.org/profile-logo.png' })
    const save = jest.spyOn(GenericRecordsCommunityStore.prototype, 'saveCommunityBrand')
    try {
      await keptAfterRead()
      expect(save.mock.calls).toEqual([
        [communityDid, expect.objectContaining({ logoUrl: 'https://vtc.example.org/profile-logo.png' })],
      ])
    } finally {
      save.mockRestore()
    }
  })

  it('still keeps the look when the profile cannot be read', async () => {
    serve({ accentColor: '#1A4D80' }, {})
    const agent = newAgent()
    // The manifest is answered, and the phone is offline by the time it looks up where the profile is.
    const answers = global.fetch
    global.fetch = jest.fn(async (...args: Parameters<typeof fetch>) => {
      ;(agent.dids.resolveDidDocument as jest.Mock).mockRejectedValue(new Error('offline'))
      return answers(...args)
    }) as unknown as typeof fetch
    const kept = await keptAfterRead(agent)
    expect(kept[0]).toMatchObject({ communityDid, accentColor: '#1a4d80', logoUrl: undefined })
  })

  // A name and no logo is the ordinary branded community. Its profile is never read, so nothing later would keep this.
  it('a community with a name and no logo: its look is kept, with no profile read', async () => {
    serve({ displayName: 'Harbor' }, { communityDid, name: '', logo_url: 'https://vtc.example.org/profile-logo.png' })
    const kept = await keptAfterRead()
    expect(kept).toHaveLength(1)
    expect(kept[0]).toMatchObject({ communityDid, accentColor: undefined, logoUrl: undefined })
    expect(global.fetch).not.toHaveBeenCalledWith(expect.stringContaining('public-profile'), expect.anything())
  })

  it('still keeps the look when the community lists no address for its profile', async () => {
    serve({ accentColor: '#1A4D80' }, {})
    const agent = newAgent()
    // The manifest is answered, and the document read for the profile has no REST service.
    const answers = global.fetch
    global.fetch = jest.fn(async (...args: Parameters<typeof fetch>) => {
      ;(agent.dids.resolveDidDocument as jest.Mock).mockResolvedValue({ id: communityDid, service: [] })
      return answers(...args)
    }) as unknown as typeof fetch
    const kept = await keptAfterRead(agent)
    expect(kept[0]).toMatchObject({ communityDid, accentColor: '#1a4d80', logoUrl: undefined })
  })

  it('never keeps an http logo or an unusable colour', async () => {
    serve(
      { accentColor: 'red', logoUrl: 'http://vtc.example.org/logo.png' },
      { communityDid, name: '', logo_url: 'http://vtc.example.org/profile-logo.png' }
    )
    const kept = await keptAfterRead()
    expect(kept[0]).toMatchObject({ communityDid, accentColor: undefined, logoUrl: undefined })
  })

  // 272: a pass took another community's colour. Communities can share a host, and an answer naming another
  // community was kept as this one's look.
  it('keeps nothing from an answer that names another community, and asks this one over DIDComm instead', async () => {
    serve({ displayName: 'Other', accentColor: '#0033FF' }, {}, 'did:webvh:QmOther:vtc.example.org')
    const ask = jest.spyOn(vtiAgent as unknown as { ask: () => Promise<undefined> }, 'ask').mockResolvedValue(undefined)
    const agent = newAgent()
    try {
      await expect(vtiAgent.fetchManifest(communityDid, agent as never)).rejects.toBeDefined()
      expect(ask).toHaveBeenCalled()
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(await new GenericRecordsCommunityStore(agent).listCommunityBrands()).toEqual([])
      expect(communityTarget.publishedNameOf(communityDid)).toBeUndefined()
    } finally {
      ask.mockRestore()
    }
  })

  it('an answer that names no community adds a look but never clears a kept one', async () => {
    const agent = newAgent()
    serve({ accentColor: '#1A4D80' }, {})
    expect((await keptAfterRead(agent))[0]).toMatchObject({ accentColor: '#1a4d80' })
    serve(undefined, { communityDid, name: '' }, null)
    expect((await keptAfterRead(agent))[0]).toMatchObject({ accentColor: '#1a4d80' })
    // The control: the same answer naming this community does clear it (the test above, "keeps none").
    serve(undefined, { communityDid, name: '' })
    expect((await keptAfterRead(agent))[0]).toMatchObject({ accentColor: undefined })
  })

  it('over DIDComm too: an answer naming another community teaches this one nothing', async () => {
    // No REST answer, so the read goes over DIDComm, where the answer names another community.
    global.fetch = jest.fn(async () => answer(503, {})) as unknown as typeof fetch
    const ask = jest.spyOn(vtiAgent as unknown as { ask: () => Promise<unknown> }, 'ask').mockResolvedValue({
      type: 'https://trusttasks.org/spec/vtc/join-requests/manifest/0.4#response',
      body: {
        payload: {
          communityDid: 'did:webvh:QmOther:vtc.example.org',
          criteria: [],
          branding: { displayName: 'Other', accentColor: '#0033FF' },
        },
      },
    })
    const agent = newAgent()
    try {
      await vtiAgent.fetchManifest(communityDid, agent as never)
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(await new GenericRecordsCommunityStore(agent).listCommunityBrands()).toEqual([])
      expect(communityTarget.publishedNameOf(communityDid)).toBeUndefined()
    } finally {
      ask.mockRestore()
    }
  })
})

describe('sameCommunity', () => {
  const { sameCommunity } = jest.requireActual('../module/vtiAgent')
  it('one did:webvh wherever it is hosted; another SCID or another method is another community', () => {
    expect(sameCommunity('did:webvh:QmA:old.example.org', 'did:webvh:QmA:new.example.org:vtc')).toBe(true)
    expect(sameCommunity('did:webvh:QmA:vtc.example.org', 'did:webvh:QmB:vtc.example.org')).toBe(false)
    expect(sameCommunity('did:web:vtc.example.org', 'did:web:other.example.org')).toBe(false)
    expect(sameCommunity('did:web:vtc.example.org', 'did:web:vtc.example.org')).toBe(true)
  })
})
