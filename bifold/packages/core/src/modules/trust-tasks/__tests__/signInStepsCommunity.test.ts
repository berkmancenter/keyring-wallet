/**
 * IN-249: a sign-in from a community showed its raw did:webvh when the phone
 * had no name on record for it, so the name the community publishes is read.
 * IN-340: a name on record was then kept for good, so a community that named
 * itself after the person joined, or renamed itself, was never seen by its new
 * name; and a membership held on a linked agent never had its name read at all.
 * Now a community the person belongs to has its name read again once the one
 * on record is over a day old, and kept. For a community they do not belong
 * to, nothing is resolved before the person continues (VTI-LNK-050, 051).
 */
import { agentSignInSteps, COMMUNITY_NAME_TTL_MS } from '../module/signInSteps'

const VTC = 'did:webvh:QmNvAiYMwoZMWGfY62gqNJuedQgH224FMpHenzJTK1wJrG:webvh.storm.ws:test-vtc'
const AGENT = 'did:webvh:QmA:dids.example:agent-a'

const mockReadPublicProfileName = jest.fn(async (): Promise<string | undefined> => 'Test VTC')
jest.mock('../module/vtiAgent', () => ({
  ...jest.requireActual('../module/vtiAgent'),
  readPublicProfileName: (...args: unknown[]) => mockReadPublicProfileName(...(args as [])),
}))
// The linked agents and what each one's vault lists (an identity there makes the person a member too, IN-296).
const mockAgents: { vtaDid: string; name: string; current: boolean }[] = []
const mockVault: Record<string, unknown[]> = {}
// Held until a test lets it go, to see what waits on the agents.
let mockAgentsReady: Promise<void> = Promise.resolve()
jest.mock('../module/vtaAgent', () => ({
  vtaAgent: {
    linkedAgents: async () => {
      await mockAgentsReady
      return mockAgents
    },
    withAgentSession: async (_a: unknown, vtaDid: string, use: (c: unknown) => Promise<unknown>) =>
      use({ vaultList: async () => mockVault[vtaDid] ?? [] }),
  },
}))
jest.mock('../module/VtiIdentityStore', () => ({
  ...jest.requireActual('../module/VtiIdentityStore'),
  GenericRecordsIdentityStore: jest.fn(() => ({ listPersonas: async () => [] })),
}))
// Names learned in memory, per test (the real one is a singleton every test would share).
const mockPublished = new Map<string, string>()
jest.mock('../module/vtiCommunityLink', () => ({
  ...jest.requireActual('../module/vtiCommunityLink'),
  communityTarget: {
    publishedNameOf: (did: string) => mockPublished.get(did),
    publishedName: (did: string, name: string) => void mockPublished.set(did, name),
  },
}))
const mockNames: { communityDid: string; name: string; at?: string }[] = []
const mockMemberships: { communityDid: string }[] = []
const mockSaveName = jest.fn(async (_did: string, _name?: string) => undefined)
jest.mock('../module/VtiCommunityStore', () => ({
  ...jest.requireActual('../module/VtiCommunityStore'),
  GenericRecordsCommunityStore: jest.fn(() => ({
    listMemberships: async () => mockMemberships,
    listCommunityNames: async () => mockNames,
    saveCommunityName: (did: string, name?: string) => mockSaveName(did, name),
  })),
}))

const agent = {
  config: { logger: { info: jest.fn() } },
  dids: {
    resolveDidDocument: jest.fn(async () => ({
      service: [{ type: 'VTCRest', serviceEndpoint: 'https://vtc.example/v1' }],
    })),
  },
}
const ago = (ms: number) => new Date(Date.now() - ms).toISOString()

beforeEach(() => {
  mockReadPublicProfileName.mockClear()
  agent.dids.resolveDidDocument.mockClear()
  mockSaveName.mockClear()
  mockNames.splice(0)
  mockMemberships.splice(0)
  mockAgents.splice(0)
  for (const k of Object.keys(mockVault)) delete mockVault[k]
  mockPublished.clear()
  mockMemberships.push({ communityDid: VTC })
  mockAgentsReady = Promise.resolve()
})

describe("a sign-in's community, by name", () => {
  it('a member with no name on record: the name it publishes, and it is kept', async () => {
    const found = await agentSignInSteps(agent as never).community(VTC)
    expect(found).toEqual({ member: true, name: 'Test VTC', identities: [] })
    expect(mockReadPublicProfileName).toHaveBeenCalledWith('https://vtc.example/v1', VTC)
    expect(mockSaveName).toHaveBeenCalledWith(VTC, 'Test VTC')
  })

  it('a community never joined: nothing is resolved or read before Continue', async () => {
    mockMemberships.splice(0)
    const found = await agentSignInSteps(agent as never).community(VTC)
    expect(found).toEqual({ member: false, name: undefined, identities: [] })
    expect(agent.dids.resolveDidDocument).not.toHaveBeenCalled()
    expect(mockReadPublicProfileName).not.toHaveBeenCalled()
  })

  it('a name on record said within the day is used as it is, and nothing is read', async () => {
    mockNames.push({ communityDid: VTC, name: 'Recorded', at: ago(60 * 60 * 1000) })
    const found = await agentSignInSteps(agent as never).community(VTC)
    expect(found.name).toBe('Recorded')
    expect(mockReadPublicProfileName).not.toHaveBeenCalled()
    expect(mockSaveName).not.toHaveBeenCalled()
  })

  it('no name published, or not reachable: no name, never the DID', async () => {
    mockReadPublicProfileName.mockResolvedValueOnce(undefined)
    expect((await agentSignInSteps(agent as never).community(VTC)).name).toBeUndefined()
    agent.dids.resolveDidDocument.mockRejectedValueOnce(new Error('unreachable'))
    expect((await agentSignInSteps(agent as never).community(VTC)).name).toBeUndefined()
  })
})

// IN-340: "vtc (no name published yet)" stayed on a community that had since published a name.
describe('a name on record that is over a day old, or a membership held on a linked agent', () => {
  it('an old name is read again: a community that renamed itself is shown by its new name, which is kept', async () => {
    mockNames.push({ communityDid: VTC, name: 'Old name', at: ago(COMMUNITY_NAME_TTL_MS + 60 * 1000) })
    const found = await agentSignInSteps(agent as never).community(VTC)
    expect(found.name).toBe('Test VTC')
    expect(mockSaveName).toHaveBeenCalledWith(VTC, 'Test VTC')
  })

  it('a name on record from before `at` was kept reads as old, and is read again', async () => {
    mockNames.push({ communityDid: VTC, name: 'Old name' })
    expect((await agentSignInSteps(agent as never).community(VTC)).name).toBe('Test VTC')
  })

  it('a read that fails keeps the name on record', async () => {
    mockNames.push({ communityDid: VTC, name: 'Old name', at: ago(2 * COMMUNITY_NAME_TTL_MS) })
    mockReadPublicProfileName.mockResolvedValueOnce(undefined)
    expect((await agentSignInSteps(agent as never).community(VTC)).name).toBe('Old name')
    agent.dids.resolveDidDocument.mockRejectedValueOnce(new Error('unreachable'))
    expect((await agentSignInSteps(agent as never).community(VTC)).name).toBe('Old name')
    expect(mockSaveName).not.toHaveBeenCalled()
  })

  it('a membership held only on a linked agent: the name is read too', async () => {
    mockMemberships.splice(0)
    mockAgents.push({ vtaDid: AGENT, name: 'Home agent', current: true })
    mockVault[AGENT] = [
      {
        id: 'entry-plugin',
        contextId: 'ctx',
        principalDid: 'did:webvh:QmP:host:plugin-persona',
        secretKind: 'didSelfIssued',
        targets: [{ kind: 'did', did: VTC }],
        label: 'Test (browser)',
      },
    ]
    const found = await agentSignInSteps(agent as never).community(VTC)
    expect(found).toMatchObject({ member: true, name: 'Test VTC' })
    expect(mockReadPublicProfileName).toHaveBeenCalledTimes(1)
  })

  it('a community the person does not belong to is never read, however old the name on record', async () => {
    mockMemberships.splice(0)
    mockAgents.push({ vtaDid: AGENT, name: 'Home agent', current: true })
    mockNames.push({ communityDid: VTC, name: 'Old name', at: ago(10 * COMMUNITY_NAME_TTL_MS) })
    const found = await agentSignInSteps(agent as never).community(VTC)
    expect(found).toMatchObject({ member: false, name: 'Old name' })
    expect(agent.dids.resolveDidDocument).not.toHaveBeenCalled()
    expect(mockReadPublicProfileName).not.toHaveBeenCalled()
  })
})

// 7a on #451: finding the identities first held every name up behind the slowest agent (up to 8 s), read or not.
describe('the name does not wait on the linked agents unless they decide it', () => {
  const slowAgents = () => {
    let release = () => undefined as void
    mockAgentsReady = new Promise<void>((resolve) => (release = resolve))
    return () => release()
  }
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

  it('a member with an old name: the name is read while a slow agent is still being asked', async () => {
    const release = slowAgents()
    mockNames.push({ communityDid: VTC, name: 'Old name', at: ago(2 * COMMUNITY_NAME_TTL_MS) })
    const pending = agentSignInSteps(agent as never).community(VTC)
    await settle()
    expect(mockReadPublicProfileName).toHaveBeenCalledTimes(1)
    release()
    expect((await pending).name).toBe('Test VTC')
  })

  it('a fresh name on record: nothing is read, and nothing waits on the agents to decide it', async () => {
    const release = slowAgents()
    mockMemberships.splice(0)
    mockNames.push({ communityDid: VTC, name: 'Recorded', at: ago(60 * 1000) })
    const pending = agentSignInSteps(agent as never).community(VTC)
    await settle()
    release()
    expect((await pending).name).toBe('Recorded')
    expect(mockReadPublicProfileName).not.toHaveBeenCalled()
  })

  it('no membership on this phone and an old name: the agents decide, and with no identity there nothing is read', async () => {
    const release = slowAgents()
    mockMemberships.splice(0)
    mockNames.push({ communityDid: VTC, name: 'Old name', at: ago(2 * COMMUNITY_NAME_TTL_MS) })
    const pending = agentSignInSteps(agent as never).community(VTC)
    await settle()
    expect(mockReadPublicProfileName).not.toHaveBeenCalled()
    release()
    expect((await pending).name).toBe('Old name')
    expect(agent.dids.resolveDidDocument).not.toHaveBeenCalled()
  })
})
