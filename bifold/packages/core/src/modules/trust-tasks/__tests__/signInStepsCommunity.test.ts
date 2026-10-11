/**
 * IN-249: a sign-in from a community this phone never joined showed its raw
 * did:webvh. The phone has no name on record for it, so the name the community
 * publishes is read once.
 */
import { agentSignInSteps } from '../module/signInSteps'

const VTC = 'did:webvh:QmNvAiYMwoZMWGfY62gqNJuedQgH224FMpHenzJTK1wJrG:webvh.storm.ws:test-vtc'

const mockReadPublicProfileName = jest.fn(async (): Promise<string | undefined> => 'Test VTC')
jest.mock('../module/vtiAgent', () => ({
  ...jest.requireActual('../module/vtiAgent'),
  readPublicProfileName: (...args: unknown[]) => mockReadPublicProfileName(...(args as [])),
}))
const mockNames: { communityDid: string; name: string }[] = []
jest.mock('../module/VtiCommunityStore', () => ({
  ...jest.requireActual('../module/VtiCommunityStore'),
  GenericRecordsCommunityStore: jest.fn(() => ({
    listMemberships: async () => [],
    listCommunityNames: async () => mockNames,
  })),
}))

const agent = {
  dids: {
    resolveDidDocument: jest.fn(async () => ({
      service: [{ type: 'VTCRest', serviceEndpoint: 'https://vtc.example/v1' }],
    })),
  },
}

beforeEach(() => {
  mockReadPublicProfileName.mockClear()
  mockNames.splice(0)
})

describe("a sign-in's community, by name", () => {
  it('a community never joined: the name it publishes', async () => {
    const found = await agentSignInSteps(agent as never).community(VTC)
    expect(found).toEqual({ member: false, name: 'Test VTC' })
    expect(mockReadPublicProfileName).toHaveBeenCalledWith('https://vtc.example/v1', VTC)
  })

  it('a name on record is used as it is, and nothing is read', async () => {
    mockNames.push({ communityDid: VTC, name: 'Recorded' })
    const found = await agentSignInSteps(agent as never).community(VTC)
    expect(found.name).toBe('Recorded')
    expect(mockReadPublicProfileName).not.toHaveBeenCalled()
  })

  it('no name published, or not reachable: no name, never the DID', async () => {
    mockReadPublicProfileName.mockResolvedValueOnce(undefined)
    expect((await agentSignInSteps(agent as never).community(VTC)).name).toBeUndefined()
    agent.dids.resolveDidDocument.mockRejectedValueOnce(new Error('unreachable'))
    expect((await agentSignInSteps(agent as never).community(VTC)).name).toBeUndefined()
  })
})
