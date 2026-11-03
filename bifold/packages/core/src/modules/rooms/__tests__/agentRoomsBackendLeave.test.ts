/**
 * The rooms backend's side of a leave (11-03): its leave ends in the same step as the community screen's
 * (`afterLeavingCommunity`), after the community was told; and the identities a leave left behind, whose rooms the
 * agent still holds keys to, are named so the listing leaves them out — unless the phone still holds that identity
 * for another community.
 */
const mockAfterLeaving = jest.fn(async (_agent: unknown, _did: string, _service?: unknown) => undefined)
const mockLeave = jest.fn(async (_deps: unknown, _did: string) => ({ disposition: 'purge' }))
const mockListKeyed = jest.fn(async (_agent: unknown, _type: string, _kind: string): Promise<unknown[]> => [])
let mockHeld: { did: string }[] = []

jest.mock('../roomsLeave', () => ({
  afterLeavingCommunity: (a: unknown, d: string, s?: unknown) => mockAfterLeaving(a, d, s),
}))
jest.mock('../../trust-tasks/module/vtiJoin', () => ({
  leaveCommunity: (deps: unknown, did: string) => mockLeave(deps, did),
}))
jest.mock('../../trust-tasks/module/keyedRecords', () => ({
  listKeyed: (a: unknown, t: string, k: string) => mockListKeyed(a, t, k),
  putKeyed: jest.fn(),
}))
jest.mock('../../trust-tasks/module/VtiIdentityStore', () => ({
  GenericRecordsIdentityStore: class {
    async listPersonas() {
      return mockHeld
    }
  },
}))
jest.mock('../../trust-tasks/module/VtiCommunityStore', () => ({ GenericRecordsCommunityStore: class {} }))
jest.mock('../../trust-tasks/module/vtiVetting', () => ({ GenericRecordsVettingStore: class {} }))
jest.mock('../../trust-tasks/module/vtiAgent', () => ({ vtiAgent: {} }))
jest.mock('../../trust-tasks/module/vtaAgent', () => ({ vtaAgent: {} }))
jest.mock('../../trust-tasks/module/vtiTsp', () => ({ GenericRecordsTspPeerRevisionStore: class {} }))

import { createAgentRoomsBackend } from '../real/agentRoomsBackend'

const agent = { config: { logger: { warn: jest.fn() } } } as never
const COMMUNITY = 'did:webvh:c:first-vtc'

beforeEach(() => {
  jest.clearAllMocks()
  mockHeld = []
})

describe("the rooms backend's leave", () => {
  it('tells the community, then drops what the phone kept of it', async () => {
    const order: string[] = []
    mockLeave.mockImplementationOnce(async () => (order.push('left'), { disposition: 'purge' }))
    mockAfterLeaving.mockImplementationOnce(async () => void order.push('after'))
    await createAgentRoomsBackend(agent).leaveCommunity(COMMUNITY)
    expect(mockAfterLeaving).toHaveBeenCalledWith(agent, COMMUNITY, undefined)
    expect(order).toEqual(['left', 'after'])
  })

  it('drops nothing when the community was not told (control)', async () => {
    mockLeave.mockRejectedValueOnce(new Error('no answer'))
    await expect(createAgentRoomsBackend(agent).leaveCommunity(COMMUNITY)).rejects.toThrow('no answer')
    expect(mockAfterLeaving).not.toHaveBeenCalled()
  })

  it('names the identities left as and no longer held', async () => {
    mockListKeyed.mockResolvedValueOnce([
      { communityDid: COMMUNITY, personaDid: 'did:key:left' },
      { communityDid: 'did:webvh:c:garden', personaDid: 'did:key:still-held' },
      { communityDid: 'did:webvh:c:old' }, // kept before departures named their identity: names none
    ])
    mockHeld = [{ did: 'did:key:still-held' }]
    expect(await createAgentRoomsBackend(agent).departedPersonas?.()).toEqual(['did:key:left'])
    expect(mockListKeyed).toHaveBeenCalledWith(agent, 'keyring/vti-community', 'departure')
  })
})
