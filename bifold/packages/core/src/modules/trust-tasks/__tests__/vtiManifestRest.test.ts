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
