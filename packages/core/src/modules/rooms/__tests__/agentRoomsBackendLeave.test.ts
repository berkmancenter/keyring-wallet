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
let mockMemberships: { communityDid: string; personaDid: string; removal?: object }[] = []

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
jest.mock('../../trust-tasks/module/VtiCommunityStore', () => ({
  GenericRecordsCommunityStore: class {
    async listMemberships() {
      return mockMemberships
    }
  },
}))
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
  mockMemberships = []
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

  // 277.7, 11-03: removed by First VTC, the member still saw "Rooms · 3 rooms": a removal keeps the identity, and the
  // agent keeps the room keys.
  it('names an identity a community removed, still held on this phone', async () => {
    mockHeld = [{ did: 'did:key:removed' }]
    mockMemberships = [{ communityDid: COMMUNITY, personaDid: 'did:key:removed', removal: { code: 'adminRemoved' } }]
    expect(await createAgentRoomsBackend(agent).departedPersonas?.()).toEqual(['did:key:removed'])
  })

  // A known limit, not a judgement: the agent's key list names the identity a room's keys are held as, never its
  // community, so an identity removed from one community and a member of another keeps the rooms of both. Keyring
  // never makes such an identity: it mints one per community (VtaClient `ensurePersona`). One made by another client
  // on the same agent and adopted here could be one.
  it('not one still a member of another community (a known limit), nor a current member (control)', async () => {
    mockHeld = [{ did: 'did:key:both' }, { did: 'did:key:member' }]
    mockMemberships = [
      { communityDid: COMMUNITY, personaDid: 'did:key:both', removal: { code: 'adminRemoved' } },
      { communityDid: 'did:webvh:c:garden', personaDid: 'did:key:both' },
      { communityDid: 'did:webvh:c:garden', personaDid: 'did:key:member' },
    ]
    expect(await createAgentRoomsBackend(agent).departedPersonas?.()).toEqual([])
  })

  it('names one left and one removed once each', async () => {
    mockListKeyed.mockResolvedValueOnce([{ communityDid: COMMUNITY, personaDid: 'did:key:left' }])
    mockHeld = [{ did: 'did:key:removed' }]
    mockMemberships = [
      { communityDid: COMMUNITY, personaDid: 'did:key:removed', removal: { code: 'adminRemoved' } },
      { communityDid: 'did:webvh:c:old', personaDid: 'did:key:removed', removal: { code: 'purged' } },
    ]
    expect(await createAgentRoomsBackend(agent).departedPersonas?.()).toEqual(['did:key:left', 'did:key:removed'])
  })
})
