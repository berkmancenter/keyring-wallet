/**
 * IN-296: a sign-in used only a persona this phone joined with, on its current
 * agent. A member made in the browser plugin, or a persona on another linked
 * agent, read "not a member". Now every linked agent's vault is asked for the
 * community's self-issued entries (matched here, as the plugin matches them),
 * and the sign-in goes through whichever agent holds the persona chosen.
 */
import type { VtaVaultEntry } from '../module/VtaClient'
import { agentSignInSteps, signInIdentitiesFrom, type SignInIdentity } from '../module/signInSteps'

const VTC = 'did:webvh:QmNvAiYMwoZMWGfY62gqNJuedQgH224FMpHenzJTK1wJrG:webvh.storm.ws:test-vtc'
const OTHER_VTC = 'did:webvh:QmOther:webvh.storm.ws:other-vtc'
const A = 'did:webvh:QmA:dids.example:agent-a'
const B = 'did:webvh:QmB:dids.example:agent-b'
// Literals, not A and B: the agents fake below names AGENTS, so jest hoists it above them.
const AGENTS = [
  { vtaDid: 'did:webvh:QmA:dids.example:agent-a', name: 'Home agent', current: true },
  { vtaDid: 'did:webvh:QmB:dids.example:agent-b', name: 'Work agent', current: false },
]

const entry = (over: Partial<VtaVaultEntry> = {}): VtaVaultEntry => ({
  id: 'entry-plugin',
  contextId: 'ctx-plugin',
  principalDid: 'did:webvh:QmP:host:plugin-persona',
  secretKind: 'didSelfIssued',
  targets: [{ kind: 'did', did: VTC }],
  label: 'Test VTC (browser)',
  ...over,
})

describe('which identities a sign-in can use', () => {
  it('a persona made in the browser plugin, on the current agent: found from its vault', () => {
    expect(signInIdentitiesFrom(VTC, AGENTS, [], { [A]: [entry()], [B]: [] })).toEqual([
      {
        vtaDid: A,
        agentName: 'Home agent',
        current: true,
        did: 'did:webvh:QmP:host:plugin-persona',
        contextId: 'ctx-plugin',
        entryId: 'entry-plugin',
        label: 'Test VTC (browser)',
        source: 'agent',
      },
    ])
  })

  it('a persona on a linked agent that is not the current one: found, and named by that agent', () => {
    const [found] = signInIdentitiesFrom(VTC, AGENTS, [], { [A]: [], [B]: [entry({ id: 'entry-b' })] })
    expect(found).toMatchObject({ vtaDid: B, agentName: 'Work agent', current: false, entryId: 'entry-b' })
  })

  it("a persona this phone joined with is the phone's own, its entry taken from the vault when there is one", () => {
    const persona = { communityDid: VTC, vtaDid: A, did: 'did:webvh:QmJ:host:joined', contextId: 'ctx-j', label: 'Me' }
    const found = signInIdentitiesFrom(VTC, AGENTS, [persona], {
      [A]: [entry({ id: 'entry-j', principalDid: persona.did, contextId: 'ctx-j' })],
    })
    expect(found).toEqual([
      expect.objectContaining({ did: persona.did, entryId: 'entry-j', label: 'Me', source: 'thisPhone' }),
    ])
  })

  it("an agent that could not be asked: the phone's own personas on it still count, without an entry", () => {
    const persona = { communityDid: VTC, vtaDid: B, did: 'did:webvh:QmJ:host:joined', contextId: 'ctx-j' }
    const found = signInIdentitiesFrom(VTC, AGENTS, [persona], { [A]: [], [B]: undefined })
    expect(found).toEqual([expect.objectContaining({ vtaDid: B, entryId: undefined, source: 'thisPhone' })])
  })

  it('several: the current agent first, the phone-joined before the agent-only', () => {
    const joined = { communityDid: VTC, vtaDid: B, did: 'did:webvh:QmJ:host:joined', contextId: 'ctx-j' }
    const found = signInIdentitiesFrom(VTC, AGENTS, [joined], {
      [A]: [entry()],
      [B]: [entry({ id: 'entry-b2', principalDid: 'did:webvh:QmQ:host:second' })],
    })
    expect(found.map((f) => [f.vtaDid, f.source])).toEqual([
      [A, 'agent'],
      [B, 'thisPhone'],
      [B, 'agent'],
    ])
  })

  it('none: another community, another kind, a revoked entry, or no principal are not identities', () => {
    const entries = [
      entry({ targets: [{ kind: 'did', did: OTHER_VTC }] }),
      entry({ secretKind: 'password' }),
      entry({ status: 'revoked' }),
      entry({ principalDid: undefined }),
      entry({ targets: [{ kind: 'url', did: VTC }] }),
    ]
    expect(signInIdentitiesFrom(VTC, AGENTS, [], { [A]: entries, [B]: entries })).toEqual([])
    // A persona this phone holds for another community is not one either.
    expect(
      signInIdentitiesFrom(VTC, AGENTS, [{ communityDid: OTHER_VTC, vtaDid: A, did: 'did:x', contextId: 'c' }], {})
    ).toEqual([])
  })

  // Gate 1019-1815: a fresh phone joined through a runner earlier phones had signed in through, and the picker
  // listed their leftover "Keyring sign-in · <community>" entries beside its own persona.
  it("the phone's persona, its own sign-in entry and another persona's Keyring entry: one identity, no picker", () => {
    const persona = {
      communityDid: VTC,
      vtaDid: AGENTS[0].vtaDid,
      did: 'did:webvh:QmJ:host:party-dirt',
      contextId: 'ctx-j',
      label: 'keyring-mvfmgsvu',
    }
    const keyringLabel = `Keyring sign-in · ${VTC}`
    const counts = {}
    const found = signInIdentitiesFrom(
      VTC,
      AGENTS,
      [persona],
      {
        [AGENTS[0].vtaDid]: [
          entry({ id: 'own', principalDid: persona.did, contextId: 'ctx-j', label: keyringLabel }),
          entry({
            id: 'stale-1',
            principalDid: 'did:webvh:QmS:host:gone-member',
            contextId: 'ctx-s',
            label: keyringLabel,
          }),
          entry({
            id: 'stale-2',
            principalDid: 'did:webvh:QmT:host:other-gone',
            contextId: 'ctx-t',
            label: keyringLabel,
          }),
        ],
      },
      counts
    )
    expect(found).toEqual([
      expect.objectContaining({ did: persona.did, entryId: 'own', label: 'keyring-mvfmgsvu', source: 'thisPhone' }),
    ])
    expect(counts).toEqual({
      [AGENTS[0].vtaDid]: { listed: 3, matched: 3, keyringMadeDropped: 2 },
      [AGENTS[1].vtaDid]: { listed: 0, matched: 0, keyringMadeDropped: 0 },
    })
  })

  it("a foreign entry is offered, but a label naming the community is never shown as the persona's name", () => {
    const [found] = signInIdentitiesFrom(VTC, AGENTS, [], {
      [AGENTS[0].vtaDid]: [entry({ label: `Sign-in for ${VTC}` })],
    })
    expect(found).toMatchObject({ source: 'agent', label: undefined })
  })

  // 276.10: an admin console invited the agent's own DID; an earlier sign-in made its Keyring entry. The phone no
  // longer holds the agent as an identity, so the entry is the only way to it, and the agent signs as itself.
  it("the agent's own DID, in an entry Keyring made: offered, where another persona's Keyring entry is not", () => {
    const keyringLabel = `Keyring sign-in · ${VTC}`
    const counts = {}
    const found = signInIdentitiesFrom(
      VTC,
      AGENTS,
      [],
      {
        [A]: [
          entry({ id: 'agent', principalDid: A, contextId: 'ctx-a', label: keyringLabel }),
          entry({
            id: 'stale',
            principalDid: 'did:webvh:QmS:host:gone-member',
            contextId: 'ctx-s',
            label: keyringLabel,
          }),
        ],
      },
      counts
    )
    expect(found).toEqual([expect.objectContaining({ did: A, entryId: 'agent', source: 'agent', vtaDid: A })])
    expect(counts).toMatchObject({ [A]: { listed: 2, matched: 2, keyringMadeDropped: 1 } })
  })

  it('0.1 spells the kind did-self-issued: taken too', () => {
    expect(signInIdentitiesFrom(VTC, AGENTS, [], { [A]: [entry({ secretKind: 'did-self-issued' })] })).toHaveLength(1)
  })
})

// The steps, over fakes for the agents and the protocol.
const mockVault: Record<string, VtaVaultEntry[] | Error> = {}
const mockSessions: string[] = []
jest.mock('../module/vtaAgent', () => ({
  vtaAgent: {
    linkedAgents: jest.fn(async () => AGENTS),
    getState: () => ({ linkRestored: true, link: { kind: 'linked' } }),
    withAgentSession: jest.fn(async (_agent: unknown, vtaDid: string, use: (c: unknown) => Promise<unknown>) => {
      mockSessions.push(vtaDid)
      const listed = mockVault[vtaDid]
      return use({
        vtaDid,
        vaultList: async () => {
          if (listed instanceof Error) throw listed
          return listed ?? []
        },
      })
    }),
  },
}))
jest.mock('../module/VtiCommunityStore', () => ({
  ...jest.requireActual('../module/VtiCommunityStore'),
  GenericRecordsCommunityStore: jest.fn(() => ({
    listMemberships: async () => [],
    listCommunityNames: async () => [],
  })),
}))
jest.mock('../module/VtiIdentityStore', () => ({
  ...jest.requireActual('../module/VtiIdentityStore'),
  GenericRecordsIdentityStore: jest.fn(() => ({ listPersonas: async () => [] })),
}))
const mockIdentify = jest.fn(async (..._args: unknown[]) => ({ claimed: { vtcDid: VTC }, persona: {} }))
const mockApprove = jest.fn(async (..._args: unknown[]) => ({ status: 'approved' as const }))
const mockEnsureEntry = jest.fn(async () => 'entry-made')
jest.mock('../module/oobSignInAgent', () => ({
  ...jest.requireActual('../module/oobSignInAgent'),
  signInAgentDeps: (_agent: unknown, client: { vtaDid: string }) => ({ vta: { did: client.vtaDid } }),
  identifyAndProve: (...args: unknown[]) => mockIdentify(...args),
  approveSignInWithUvKey: (...args: unknown[]) => mockApprove(...args),
  ensureSignInVaultEntry: (..._args: unknown[]) => mockEnsureEntry(),
}))

const agent = { config: { logger: { info: jest.fn() } }, dids: { resolveDidDocument: jest.fn() } }
const claimed = { vtcDid: VTC } as never

beforeEach(() => {
  for (const k of Object.keys(mockVault)) delete mockVault[k]
  mockSessions.splice(0)
  mockIdentify.mockClear()
  mockApprove.mockClear()
  mockEnsureEntry.mockClear()
  agent.dids.resolveDidDocument.mockClear()
})

describe('signing in through the agent that holds the persona', () => {
  it('a plugin-made persona on the current agent makes a member, and identify goes through that agent', async () => {
    mockVault[A] = [entry()]
    const steps = agentSignInSteps(agent as never)
    const found = await steps.community(VTC)
    expect(found.member).toBe(true)
    expect(found.identities).toHaveLength(1)
    // Before Continue, the community itself is asked for its published name only, and only because the person belongs
    // to it through this identity (IN-340, the IN-249 allowance); nothing else about it is resolved.
    expect(agent.dids.resolveDidDocument.mock.calls).toEqual([[VTC]])

    mockSessions.splice(0)
    await steps.identifyAndProve(claimed, '42')
    expect(mockSessions).toEqual([A])
    expect(mockIdentify).toHaveBeenCalledWith(
      claimed,
      '42',
      expect.objectContaining({
        vta: { did: A },
        persona: { did: 'did:webvh:QmP:host:plugin-persona', entryId: 'entry-plugin' },
      })
    )
    // The plugin's own entry signs: none is made.
    expect(mockEnsureEntry).not.toHaveBeenCalled()
  })

  it('a persona on a non-current linked agent: identify and approve both go through that agent', async () => {
    mockVault[B] = [entry({ id: 'entry-b', principalDid: 'did:webvh:QmB:host:persona-b', contextId: 'ctx-b' })]
    const steps = agentSignInSteps(agent as never)
    const [identity] = (await steps.community(VTC)).identities as SignInIdentity[]
    expect(identity).toMatchObject({ vtaDid: B, current: false })

    mockSessions.splice(0)
    await steps.identifyAndProve(claimed, '42', identity)
    await steps.approve({ claimed: { vtcDid: VTC }, persona: { did: identity.did, entryId: 'entry-b' } } as never)
    expect(mockSessions).toEqual([B, B])
    expect(mockApprove).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ vta: { did: B } }))
  })

  it('several: the one the person chose is the one identify proves', async () => {
    mockVault[A] = [entry()]
    mockVault[B] = [entry({ id: 'entry-b', principalDid: 'did:webvh:QmB:host:persona-b' })]
    const steps = agentSignInSteps(agent as never)
    const identities = (await steps.community(VTC)).identities as SignInIdentity[]
    expect(identities).toHaveLength(2)
    await steps.identifyAndProve(claimed, '42', identities[1])
    expect(mockIdentify).toHaveBeenCalledWith(
      claimed,
      '42',
      expect.objectContaining({ persona: { did: 'did:webvh:QmB:host:persona-b', entryId: 'entry-b' } })
    )
  })

  it("none: not a member, as today, and identify says so; an agent that won't list is gone round", async () => {
    mockVault[B] = new Error('unreachable')
    const steps = agentSignInSteps(agent as never)
    const found = await steps.community(VTC)
    expect(found).toMatchObject({ member: false, identities: [] })
    await expect(steps.identifyAndProve(claimed, '42')).rejects.toMatchObject({ reason: 'notAMember' })
  })
})
