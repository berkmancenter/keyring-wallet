/**
 * A record kept for an identity counts for an agent only when something ties
 * it to that agent: a persona of its own, or the identity being the agent
 * itself. A membership nothing ties to the agent stayed on the phone when its
 * agent went, and a new agent then read "You're a member" and could not apply.
 * Nothing here removes a record: each is only read past, so linking its agent
 * again shows it again.
 */
import { fakeAgent } from '../../../../__tests__/helpers/cardVault'
import { defaultJourneyReaders } from '../module/communityJourney'
import { setCurrentAgentDid } from '../module/currentAgent'
import { heldByAgent } from '../module/heldByAgent'
import { GenericRecordsCommunityStore, type VtiMembership } from '../module/VtiCommunityStore'
import { GenericRecordsIdentityStore } from '../module/VtiIdentityStore'
import { readJoinState } from '../module/vtiJoin'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))
// The change events are deferred on a timer; nothing here listens for them.
jest.mock('../module/communityChanged', () => ({
  ...jest.requireActual('../module/communityChanged'),
  emitCommunityChanged: jest.fn(),
}))
const mockPick = jest.fn()
jest.mock('../module/vtiGrantState', () => ({
  ...jest.requireActual('../module/vtiGrantState'),
  pickOwnVetterGrant: (...args: unknown[]) => mockPick(...args),
}))

const C = 'did:webvh:QmCommunity:store:community'
const OLD_AGENT = 'did:webvh:QmOldAgent:store:vta-old'
const NEW_AGENT = 'did:webvh:QmNewAgent:store:vta-new'
const PERSONA_OF_OLD = 'did:webvh:QmPersona:store:persona-old'

const membership = (personaDid: string, extra: Partial<VtiMembership> = {}): VtiMembership => ({
  communityDid: C,
  personaDid,
  role: 'member',
  vmc: { id: `urn:vmc:${personaDid}` },
  grantedAt: '2026-10-30T00:00:00Z',
  via: 'approval',
  ...extra,
})

const stores = (agent: ReturnType<typeof fakeAgent>['agent']) => ({
  communities: new GenericRecordsCommunityStore(agent),
  identities: new GenericRecordsIdentityStore(agent),
})

const persona = (did: string, vtaDid: string) =>
  ({
    did,
    communityDid: C,
    vtaDid,
    contextId: 'ctx',
    vtaKeyIds: { signing: 's', keyAgreement: 'k' },
    kmsKeyIds: { signing: 's', keyAgreement: 'k' },
    createdAt: 't',
  }) as never

afterEach(() => {
  setCurrentAgentDid(undefined)
  mockPick.mockReset()
})

describe('whose a record is', () => {
  const personas = [
    { did: PERSONA_OF_OLD, vtaDid: OLD_AGENT },
    { did: 'did:webvh:QmLegacy:store:legacy', vtaDid: '' },
  ]

  it('is the agent its persona names', () => {
    expect(heldByAgent(PERSONA_OF_OLD, personas, OLD_AGENT)).toBe(true)
    expect(heldByAgent(PERSONA_OF_OLD, personas, NEW_AGENT)).toBe(false)
  })

  it('is whichever agent is current for a persona kept from before agents', () => {
    expect(heldByAgent('did:webvh:QmLegacy:store:legacy', personas, NEW_AGENT)).toBe(true)
  })

  it('is the agent itself when the identity is that agent, with no persona for it', () => {
    expect(heldByAgent(OLD_AGENT, personas, OLD_AGENT)).toBe(true)
    expect(heldByAgent(OLD_AGENT, personas, NEW_AGENT)).toBe(false)
  })

  it('is no agent when nothing ties it to one', () => {
    expect(heldByAgent('did:webvh:QmNobody:store:nobody', personas, NEW_AGENT)).toBe(false)
  })

  it('reads a persona through the other form of its DID', () => {
    const scid = 'did:scid:vh:1:QmPersona'
    expect(heldByAgent(scid, personas, OLD_AGENT)).toBe(true)
    expect(heldByAgent(scid, personas, NEW_AGENT)).toBe(false)
  })

  it('takes a record that names no identity, and one with no agent known, as before', () => {
    expect(heldByAgent(undefined, personas, NEW_AGENT)).toBe(true)
    expect(heldByAgent('did:webvh:QmNobody:store:nobody', personas, undefined)).toBe(true)
  })
})

describe('a new agent, and a membership nothing ties to it', () => {
  it('reads no membership, and the record stays on the phone', async () => {
    const { agent, records } = fakeAgent()
    const { communities } = stores(agent)
    await communities.saveMembership(membership(OLD_AGENT))
    const before = records.length
    setCurrentAgentDid(NEW_AGENT)

    expect(await communities.getMembership(C)).toBeUndefined()
    expect(records).toHaveLength(before)
    expect((await communities.listMemberships()).map((m) => m.personaDid)).toEqual([OLD_AGENT])
  })

  it('is free to apply: where it stands is nowhere yet', async () => {
    const { agent } = fakeAgent()
    const { communities, identities } = stores(agent)
    await communities.saveMembership(membership(OLD_AGENT))
    setCurrentAgentDid(NEW_AGENT)

    expect(
      await readJoinState(agent, C, { communityStore: communities, identityStore: identities, local: true })
    ).toEqual({ kind: 'none' })
  })

  it('does not read the request or the leaving of an identity nothing ties to it', async () => {
    const { agent } = fakeAgent()
    const { communities, identities } = stores(agent)
    await communities.saveSubmission({
      communityDid: C,
      personaDid: OLD_AGENT,
      sentAt: '2026-10-30T00:00:00Z',
      withInvitation: false,
      via: 'join',
    })
    await communities.saveDeparture({ communityDid: C, personaDid: OLD_AGENT, disposition: 'purge', at: 't' })
    setCurrentAgentDid(NEW_AGENT)

    expect(await communities.getSubmission(C)).toBeUndefined()
    expect(await communities.getDeparture(C)).toBeUndefined()
    expect(
      await readJoinState(agent, C, { communityStore: communities, identityStore: identities, local: true })
    ).toEqual({ kind: 'none' })
  })

  it("does not read another agent's persona's membership either", async () => {
    const { agent } = fakeAgent()
    const { communities, identities } = stores(agent)
    await identities.setPersona(persona(PERSONA_OF_OLD, OLD_AGENT))
    await communities.saveMembership(membership(PERSONA_OF_OLD))
    setCurrentAgentDid(NEW_AGENT)

    expect(await communities.getMembership(C)).toBeUndefined()
  })

  it('does not read a vetter grant nothing ties to it', async () => {
    const { agent } = fakeAgent()
    const { communities } = stores(agent)
    const grant = {
      kind: 'vetter-grant',
      communityDid: C,
      subjectDid: OLD_AGENT,
      credential: {},
      receivedAt: 't',
    } as never
    await communities.saveHeldCredential(grant)
    mockPick.mockImplementation(async (_agent, grants: unknown[]) => ({
      state: { state: grants.length > 0 ? 'active' : 'none' },
    }))

    setCurrentAgentDid(NEW_AGENT)
    expect(await defaultJourneyReaders.vetterGrant(agent, C)).toEqual({ state: 'none' })
    setCurrentAgentDid(OLD_AGENT)
    expect(await defaultJourneyReaders.vetterGrant(agent, C)).toEqual({ state: 'active' })
  })
})

describe('a real membership keeps showing', () => {
  it('held as the agent itself, under that agent', async () => {
    const { agent } = fakeAgent()
    const { communities, identities } = stores(agent)
    await communities.saveMembership(membership(OLD_AGENT))
    setCurrentAgentDid(OLD_AGENT)

    expect((await communities.getMembership(C))?.personaDid).toBe(OLD_AGENT)
    expect(
      await readJoinState(agent, C, { communityStore: communities, identityStore: identities, local: true })
    ).toMatchObject({ kind: 'member', membership: { personaDid: OLD_AGENT } })
  })

  it('held by a persona, under its agent', async () => {
    const { agent } = fakeAgent()
    const { communities, identities } = stores(agent)
    await identities.setPersona(persona(PERSONA_OF_OLD, OLD_AGENT))
    await communities.saveMembership(membership(PERSONA_OF_OLD))
    setCurrentAgentDid(OLD_AGENT)

    expect(
      await readJoinState(agent, C, { communityStore: communities, identityStore: identities, local: true })
    ).toMatchObject({ kind: 'member', membership: { personaDid: PERSONA_OF_OLD } })
  })

  it("beside a record nothing ties to the agent, the agent's own is the one read", async () => {
    const { agent } = fakeAgent()
    const { communities } = stores(agent)
    await communities.saveMembership(membership(OLD_AGENT))
    await communities.saveMembership(membership(NEW_AGENT))
    setCurrentAgentDid(NEW_AGENT)

    expect((await communities.getMembership(C))?.personaDid).toBe(NEW_AGENT)
  })

  it('comes back when its agent is current again', async () => {
    const { agent } = fakeAgent()
    const { communities } = stores(agent)
    await communities.saveMembership(membership(OLD_AGENT))
    setCurrentAgentDid(NEW_AGENT)
    expect(await communities.getMembership(C)).toBeUndefined()
    setCurrentAgentDid(OLD_AGENT)
    expect((await communities.getMembership(C))?.personaDid).toBe(OLD_AGENT)
  })

  it('is read as before while no agent is known, a start before the link is read', async () => {
    const { agent } = fakeAgent()
    const { communities, identities } = stores(agent)
    await identities.setPersona(persona(PERSONA_OF_OLD, OLD_AGENT))
    await communities.saveMembership(membership(PERSONA_OF_OLD))

    expect((await communities.getMembership(C))?.personaDid).toBe(PERSONA_OF_OLD)
  })

  it('is read as before when the identities cannot be read', async () => {
    const { agent } = fakeAgent()
    const { communities } = stores(agent)
    await communities.saveMembership(membership(OLD_AGENT))
    setCurrentAgentDid(NEW_AGENT)
    jest.spyOn(GenericRecordsIdentityStore.prototype, 'listPersonas').mockRejectedValueOnce(new Error('locked'))

    expect((await communities.getMembership(C))?.personaDid).toBe(OLD_AGENT)
  })
})
