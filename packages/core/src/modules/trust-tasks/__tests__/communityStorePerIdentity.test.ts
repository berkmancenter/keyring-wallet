/**
 * Memberships, join requests and departures are kept per identity, so two
 * agents' identities in one community each keep their own. One record per
 * community let a second agent's join overwrite the first's membership
 * (several-agents device check, 10-04). Records kept by community alone,
 * before, are still read, and move under their identity at the next write.
 */
import { fakeAgent } from '../../../../__tests__/helpers/cardVault'
import { setCurrentAgentDid } from '../module/currentAgent'
import { GenericRecordsCommunityStore, type VtiMembership } from '../module/VtiCommunityStore'
import { GenericRecordsIdentityStore } from '../module/VtiIdentityStore'
import { CREDENTIAL_EXCHANGE_ISSUE, receiveIssue } from '../module/vtiInbox'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))
// The change events are deferred on a timer; nothing here listens for them.
jest.mock('../module/communityChanged', () => ({
  ...jest.requireActual('../module/communityChanged'),
  emitCommunityChanged: jest.fn(),
}))

const C = 'did:webvh:store:community'
const AGENT_A = 'did:webvh:store:vta-a'
const AGENT_B = 'did:webvh:store:vta-b'
const ME_AT_A = 'did:webvh:store:me-at-a'
const ME_AT_B = 'did:webvh:store:me-at-b'

const membership = (personaDid: string, id: string): VtiMembership => ({
  communityDid: C,
  personaDid,
  role: 'member',
  vmc: { id },
  grantedAt: '2026-10-04T00:00:00Z',
  via: 'approval',
})

async function phoneWithTwoAgents() {
  const { agent, records } = fakeAgent()
  const identities = new GenericRecordsIdentityStore(agent)
  const persona = (did: string, vtaDid: string) =>
    identities.setPersona({
      did,
      communityDid: C,
      vtaDid,
      contextId: 'ctx',
      vtaKeyIds: { signing: 's', keyAgreement: 'k' },
      kmsKeyIds: { signing: 's', keyAgreement: 'k' },
      createdAt: 't',
    } as never)
  await persona(ME_AT_A, AGENT_A)
  await persona(ME_AT_B, AGENT_B)
  return { agent, records, store: new GenericRecordsCommunityStore(agent) }
}

afterEach(() => setCurrentAgentDid(undefined))

describe("two agents' identities in one community", () => {
  it('both memberships survive, each read as its own agent', async () => {
    const { store } = await phoneWithTwoAgents()
    await store.saveMembership(membership(ME_AT_A, 'urn:vmc:a'))
    await store.saveMembership(membership(ME_AT_B, 'urn:vmc:b'))

    expect((await store.listMemberships()).map((m) => m.vmc.id).sort()).toEqual(['urn:vmc:a', 'urn:vmc:b'])
    setCurrentAgentDid(AGENT_A)
    expect((await store.getMembership(C))?.vmc.id).toBe('urn:vmc:a')
    setCurrentAgentDid(AGENT_B)
    expect((await store.getMembership(C))?.vmc.id).toBe('urn:vmc:b')
    expect((await store.getMembership(C, ME_AT_A))?.vmc.id).toBe('urn:vmc:a')
  })

  it('a join request is per identity too', async () => {
    const { store } = await phoneWithTwoAgents()
    const sent = (personaDid: string, sentAt: string) => ({
      communityDid: C,
      personaDid,
      sentAt,
      withInvitation: false,
      via: 'join' as const,
    })
    await store.saveSubmission(sent(ME_AT_A, 'a'))
    await store.saveSubmission(sent(ME_AT_B, 'b'))
    setCurrentAgentDid(AGENT_A)
    expect((await store.getSubmission(C))?.sentAt).toBe('a')
    setCurrentAgentDid(AGENT_B)
    expect((await store.getSubmission(C))?.sentAt).toBe('b')
  })

  it("leaving with one identity forgets only that identity's membership", async () => {
    const { store } = await phoneWithTwoAgents()
    await store.saveMembership(membership(ME_AT_A, 'urn:vmc:a'))
    await store.saveMembership(membership(ME_AT_B, 'urn:vmc:b'))
    await store.forgetCommunity(C, ME_AT_B)
    expect((await store.listMemberships()).map((m) => m.personaDid)).toEqual([ME_AT_A])
  })

  it('an agent with no identity in the community reads no membership there when another agent has one', async () => {
    const { store } = await phoneWithTwoAgents()
    await store.saveMembership(membership(ME_AT_A, 'urn:vmc:a'))
    setCurrentAgentDid(AGENT_B)
    expect(await store.getMembership(C)).toBeUndefined()
  })
})

describe('records kept by community alone, before', () => {
  const legacy = (records: ReturnType<typeof fakeAgent>['records'], m: VtiMembership) =>
    records.push({
      id: `legacy-${m.personaDid}`,
      content: { ...m },
      tags: { recordType: 'keyring/vti-community', kind: 'membership', key: m.communityDid },
      createdAt: new Date(0),
    })

  it('are still read, and move under their identity at the next write', async () => {
    const { store, records } = await phoneWithTwoAgents()
    legacy(records, membership(ME_AT_A, 'urn:vmc:a'))
    setCurrentAgentDid(AGENT_A)
    expect((await store.getMembership(C))?.vmc.id).toBe('urn:vmc:a')

    await store.saveMembership({ ...membership(ME_AT_A, 'urn:vmc:a'), role: 'admin' })
    const kept = records.filter((r) => r.tags.recordType === 'keyring/vti-community' && r.tags.kind === 'membership')
    expect(kept.map((r) => r.tags.key)).toEqual([`${ME_AT_A}|${C}`])
    expect((await store.getMembership(C))?.role).toBe('admin')
  })

  it("another identity's join does not overwrite the membership kept the old way", async () => {
    const { store, records } = await phoneWithTwoAgents()
    legacy(records, membership(ME_AT_A, 'urn:vmc:a'))
    await store.saveMembership(membership(ME_AT_B, 'urn:vmc:b'))
    expect((await store.listMemberships()).map((m) => m.vmc.id).sort()).toEqual(['urn:vmc:a', 'urn:vmc:b'])
  })

  it('a phone with one agent and no persona record reads what it has, as before', async () => {
    const { agent, records } = fakeAgent()
    legacy(records, membership(ME_AT_A, 'urn:vmc:a'))
    expect((await new GenericRecordsCommunityStore(agent).getMembership(C))?.vmc.id).toBe('urn:vmc:a')
  })
})

describe('cards delivered to two identities in one community', () => {
  const card = (subject: string, id: string) => ({
    id,
    type: ['VerifiableCredential', 'DTGCredential', 'MembershipCredential'],
    issuer: C,
    validFrom: '2026-10-04T00:00:00Z',
    credentialSubject: { id: subject },
  })
  const issue = (subject: string, id: string) => ({
    id: `urn:uuid:msg-${id}`,
    type: CREDENTIAL_EXCHANGE_ISSUE,
    from: C,
    body: { credential_response: { credential: card(subject, id) } },
  })

  it("B's card, delivered after A's, keeps both memberships", async () => {
    const { store } = await phoneWithTwoAgents()
    const options = { checkCard: async () => undefined } as never
    await receiveIssue(store, ME_AT_A, issue(ME_AT_A, 'urn:vmc:a') as never, options)
    await receiveIssue(store, ME_AT_B, issue(ME_AT_B, 'urn:vmc:b') as never, options)
    expect((await store.getMembership(C, ME_AT_A))?.vmc.id).toBe('urn:vmc:a')
    expect((await store.getMembership(C, ME_AT_B))?.vmc.id).toBe('urn:vmc:b')
  })
})
