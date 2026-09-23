/**
 * The join manifest over REST, before any community session exists.
 *
 * A fresh phone reaches Join before it has opened a session, and the
 * controller only learned an agent when a session opened — so the REST read,
 * the one path that works with no session, was skipped, and a community that
 * publishes a name was shown as having none (Farm gate, 2026-09-23). The
 * caller's agent now carries the read.
 */
import { vtiAgent } from '../module/vtiAgent'
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
})
