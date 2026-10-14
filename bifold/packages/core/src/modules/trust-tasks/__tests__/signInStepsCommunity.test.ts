/**
 * IN-249: a sign-in from a community showed its raw did:webvh when the phone
 * had no name on record for it, so the name the community publishes is read
 * once. Only for a member: for a community the phone does not know, nothing
 * is resolved before the person continues (VTI-LNK-050, 051).
 */
import { agentSignInSteps } from '../module/signInSteps'

const VTC = 'did:webvh:QmNvAiYMwoZMWGfY62gqNJuedQgH224FMpHenzJTK1wJrG:webvh.storm.ws:test-vtc'

const mockReadPublicProfileName = jest.fn(async (): Promise<string | undefined> => 'Test VTC')
jest.mock('../module/vtiAgent', () => ({
  ...jest.requireActual('../module/vtiAgent'),
  readPublicProfileName: (...args: unknown[]) => mockReadPublicProfileName(...(args as [])),
}))
const mockNames: { communityDid: string; name: string }[] = []
const mockMemberships: { communityDid: string }[] = []
jest.mock('../module/VtiCommunityStore', () => ({
  ...jest.requireActual('../module/VtiCommunityStore'),
  GenericRecordsCommunityStore: jest.fn(() => ({
    listMemberships: async () => mockMemberships,
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
  agent.dids.resolveDidDocument.mockClear()
  mockNames.splice(0)
  mockMemberships.splice(0)
  mockMemberships.push({ communityDid: VTC })
})

describe("a sign-in's community, by name", () => {
  it('a member with no name on record: the name it publishes', async () => {
    const found = await agentSignInSteps(agent as never).community(VTC)
    expect(found).toEqual({ member: true, name: 'Test VTC' })
    expect(mockReadPublicProfileName).toHaveBeenCalledWith('https://vtc.example/v1', VTC)
  })

  it('a community never joined: nothing is resolved or read before Continue', async () => {
    mockMemberships.splice(0)
    const found = await agentSignInSteps(agent as never).community(VTC)
    expect(found).toEqual({ member: false, name: undefined })
    expect(agent.dids.resolveDidDocument).not.toHaveBeenCalled()
    expect(mockReadPublicProfileName).not.toHaveBeenCalled()
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
