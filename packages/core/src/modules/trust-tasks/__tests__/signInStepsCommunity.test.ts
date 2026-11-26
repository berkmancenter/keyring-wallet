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
import { agentSignInSteps, COMMUNITY_NAME_TTL_MS, JOINABLE_WAIT_MS } from '../module/signInSteps'

const VTC = 'did:webvh:QmNvAiYMwoZMWGfY62gqNJuedQgH224FMpHenzJTK1wJrG:webvh.storm.ws:test-vtc'
const AGENT = 'did:webvh:QmA:dids.example:agent-a'

const mockReadPublicProfileName = jest.fn(async (): Promise<string | undefined> => 'Test VTC')
jest.mock('../module/vtiAgent', () => ({
  ...jest.requireActual('../module/vtiAgent'),
  readPublicProfileName: (...args: unknown[]) => mockReadPublicProfileName(...(args as [])),
}))
// The linked agents and what each one's vault lists (an identity there makes the person a member too, IN-296).
const mockAgents: { vtaDid: string; name: string; current: boolean; farmLogin?: { farmDid: string; did: string } }[] =
  []
let mockVaultAsked = 0
const mockVault: Record<string, unknown[]> = {}
// Held until a test lets it go, to see what waits on the agents.
let mockAgentsReady: Promise<void> = Promise.resolve()
// The links not read: on a cold start, before the app hands the agent over, linkedAgents waits and then throws.
let mockAgentsUnread: Error | undefined
// What the agent's state says of this phone's link: read, and no agent linked, unless a test says otherwise.
let mockAgentState: { linkRestored?: boolean; link: { kind: string } } = {
  linkRestored: true,
  link: { kind: 'none' },
}
const mockWarn = jest.fn()
jest.mock('../module/releaseLog', () => ({
  ...jest.requireActual('../module/releaseLog'),
  releaseWarn: (message: string) => mockWarn(message),
}))
jest.mock('../module/vtaAgent', () => ({
  vtaAgent: {
    linkedAgents: async () => {
      await mockAgentsReady
      if (mockAgentsUnread) throw mockAgentsUnread
      return mockAgents
    },
    getState: () => mockAgentState,
    withAgentSession: async (_a: unknown, vtaDid: string, use: (c: unknown) => Promise<unknown>) =>
      use({
        vaultList: async () => {
          mockVaultAsked++
          return mockVault[vtaDid] ?? []
        },
      }),
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
    // classifyDid's resolver ("Check and join", IN-406).
    resolve: jest.fn(
      async (): Promise<{ didDocument?: unknown; didResolutionMetadata?: { error?: string } }> => ({
        didDocument: { service: [{ type: 'VTCRest', serviceEndpoint: 'https://vtc.example/v1' }] },
      })
    ),
  },
}
const ago = (ms: number) => new Date(Date.now() - ms).toISOString()

beforeEach(() => {
  mockReadPublicProfileName.mockClear()
  agent.dids.resolveDidDocument.mockClear()
  agent.dids.resolve.mockClear()
  mockSaveName.mockClear()
  mockNames.splice(0)
  mockMemberships.splice(0)
  mockAgents.splice(0)
  for (const k of Object.keys(mockVault)) delete mockVault[k]
  mockPublished.clear()
  mockMemberships.push({ communityDid: VTC })
  mockAgentsReady = Promise.resolve()
  mockAgentsUnread = undefined
  mockAgentState = { linkRestored: true, link: { kind: 'none' } }
  mockWarn.mockClear()
  mockVaultAsked = 0
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

// IN-388: a sign-in code from a VTA Farm. The Farm knows the person by the key their agent was claimed with.
describe('a sign-in code from a Farm this phone claimed an agent from', () => {
  const FARM = 'did:webvh:QmFarm:vtafarm.example.com'
  const CLAIM_KEY = 'did:key:z6MkClaimKeyOfHomeAgent'

  it("is a member's: the agents claimed from it are who signs in, and no community or agent's vault is asked", async () => {
    mockMemberships.splice(0)
    mockAgents.push(
      { vtaDid: AGENT, name: 'Home agent', current: true, farmLogin: { farmDid: FARM, did: CLAIM_KEY } },
      { vtaDid: 'did:webvh:QmB:dids.example:agent-b', name: 'Other', current: false }
    )
    const found = await agentSignInSteps(agent as never).community(FARM)
    expect(found).toEqual({
      member: true,
      farm: true,
      identities: [{ source: 'farm', vtaDid: AGENT, agentName: 'Home agent', current: true, did: CLAIM_KEY }],
    })
    expect(agent.dids.resolveDidDocument).not.toHaveBeenCalled()
    expect(mockReadPublicProfileName).not.toHaveBeenCalled()
    expect(mockVaultAsked).toBe(0)
  })

  it('an agent claimed before its key was kept: not a member, said so, and nothing is resolved', async () => {
    mockMemberships.splice(0)
    mockAgents.push({ vtaDid: AGENT, name: 'Home agent', current: true })
    const found = await agentSignInSteps(agent as never).community(FARM)
    expect(found).toMatchObject({ member: false, olderAgents: true })
    expect(found.farm).toBeUndefined()
    expect(agent.dids.resolveDidDocument).not.toHaveBeenCalled()
  })

  // IN-388 step D on 276.10 (cold start, the code opened by a deep link): "not joined", and no older-agents line,
  // although the phone's only agent was linked by its owner code. A links read that failed was taken as no agents.
  it('links not read: a phone that may hold an agent still says the older-agents line, and the failure is logged', async () => {
    mockMemberships.splice(0)
    mockAgentsUnread = new Error("the link with this phone's agent was not read within 20 s")
    mockAgentState = { linkRestored: false, link: { kind: 'none' } }
    const found = await agentSignInSteps(agent as never).community(FARM)
    expect(found).toMatchObject({ member: false, olderAgents: true })
    expect(found.farm).toBeUndefined()
    expect(mockWarn).toHaveBeenCalledWith(expect.stringMatching(/^\[SignIn\] linked agents not read: /))
  })

  it("links read as none while the agent's own state says one is linked: the line is said", async () => {
    // linkedAgents gives [] when its store reads fail, the same as for a phone with no agent.
    mockMemberships.splice(0)
    mockAgentState = { linkRestored: true, link: { kind: 'linked' } }
    expect(await agentSignInSteps(agent as never).community(FARM)).toMatchObject({ member: false, olderAgents: true })
    expect(mockWarn).toHaveBeenCalledWith(
      '[SignIn] not joined: 0 linked agent(s) read, 0 with a Farm key, 0 for this sender; link linked'
    )
  })

  it('links not read on a phone whose link was read and holds no agent: no older-agents line', async () => {
    mockMemberships.splice(0)
    mockAgentsUnread = new Error('the store failed')
    mockAgentState = { linkRestored: true, link: { kind: 'none' } }
    expect((await agentSignInSteps(agent as never).community(FARM)).olderAgents).toBeUndefined()
  })

  it('a code opened while the links are still being read waits for them, then says the line', async () => {
    mockMemberships.splice(0)
    let release: () => void = () => undefined
    mockAgentsReady = new Promise((resolve) => (release = resolve))
    const asked = agentSignInSteps(agent as never).community(FARM)
    let settled = false
    void asked.then(() => (settled = true))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(settled).toBe(false)
    mockAgents.push({ vtaDid: AGENT, name: 'mini1', current: true })
    release()
    expect(await asked).toMatchObject({ member: false, olderAgents: true })
  })

  it('a phone whose agents all kept their Farm key says nothing of older agents', async () => {
    mockMemberships.splice(0)
    mockAgents.push({ vtaDid: AGENT, name: 'Home agent', current: true, farmLogin: { farmDid: FARM, did: CLAIM_KEY } })
    const found = await agentSignInSteps(agent as never).community('did:webvh:QmElse:else.example')
    expect(found).toMatchObject({ member: false })
    expect(found.olderAgents).toBeUndefined()
  })
})

// IN-406: a community's join page shows its sign-in code, so a code from a community this phone has not joined can
// be one to join. Whether it is, is asked only when the person taps "Check and join" (VTI-LNK-050).
describe('"Check and join": whether an unjoined sender is a community', () => {
  const FARM = 'did:webvh:QmFarm:vtafarm.example.com'

  it('reading the sender for the screen resolves nothing; the check resolves its DID once', async () => {
    mockMemberships.splice(0)
    const steps = agentSignInSteps(agent as never)
    expect(await steps.community(VTC)).toMatchObject({ member: false })
    expect(agent.dids.resolve).not.toHaveBeenCalled()
    expect(agent.dids.resolveDidDocument).not.toHaveBeenCalled()

    expect(await steps.joinable?.(VTC)).toBe(true)
    expect(agent.dids.resolve).toHaveBeenCalledTimes(1)
    expect(agent.dids.resolve).toHaveBeenCalledWith(VTC)
    expect(mockReadPublicProfileName).not.toHaveBeenCalled()
  })

  it('a Farm code on a phone with no agent claimed from it is not a community to join', async () => {
    mockMemberships.splice(0)
    mockAgents.push({ vtaDid: AGENT, name: 'Home agent', current: true })
    agent.dids.resolve.mockResolvedValueOnce({
      didDocument: {
        service: [
          { type: 'TrustTaskHTTPS', serviceEndpoint: 'https://vtafarm.example.com/v1' },
          { type: 'SignInPortal', serviceEndpoint: 'https://vtafarm.example.com/' },
        ],
      },
    })
    const steps = agentSignInSteps(agent as never)
    expect(await steps.community(FARM)).toMatchObject({ member: false, olderAgents: true })
    expect(await steps.joinable?.(FARM)).toBe(false)
  })

  it('a sender whose DID host says there is no such DID is not joinable', async () => {
    agent.dids.resolve.mockResolvedValue({ didResolutionMetadata: { error: 'notFound' } })
    try {
      expect(await agentSignInSteps(agent as never).joinable?.(VTC)).toBe(false)
    } finally {
      agent.dids.resolve.mockReset()
    }
  })

  it('a DID host that never answers: unchecked (not a "no") once the wait is over, not before', async () => {
    jest.useFakeTimers()
    try {
      agent.dids.resolve.mockImplementation(() => new Promise(() => undefined))
      let settled = false
      let answer: boolean | undefined = false
      void agentSignInSteps(agent as never)
        .joinable?.(VTC)
        .then((a) => {
          settled = true
          answer = a
        })
      await jest.advanceTimersByTimeAsync(JOINABLE_WAIT_MS - 1)
      expect(settled).toBe(false)
      await jest.advanceTimersByTimeAsync(1)
      expect(settled).toBe(true)
      expect(answer).toBeUndefined()
    } finally {
      agent.dids.resolve.mockReset()
      jest.useRealTimers()
    }
  })
})
