/**
 * One record per community (IN-26): a tester's fresh install, after one join
 * through vetting, listed the same community four times. The stores saved with
 * find-then-save, and three listeners stored the same arriving membership at
 * once, so each found nothing and each saved. These tests race the writes the
 * way the join does, heal the exact state that phone is in, and keep a
 * community's published name across a relaunch.
 */
import { communityTarget } from '../module/vtiCommunityLink'
import { GenericRecordsCommunityStore, type VtiMembership } from '../module/VtiCommunityStore'
import { GenericRecordsIdentityStore, type VtiPersona } from '../module/VtiIdentityStore'
import { VtaClient } from '../module/VtaClient'
import { communityLabelOf } from '../screens/communityName'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

type Rec = {
  id: string
  content: Record<string, unknown>
  tags: Record<string, string>
  createdAt: Date
  updatedAt?: Date
}

/**
 * Generic records in memory. Every call yields before it acts, so concurrent
 * callers interleave between a lookup and a save, as they do on the device.
 */
function fakeAgent(seed: Rec[] = []) {
  const records: Rec[] = [...seed]
  let clock = 1_000
  let next = seed.length
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
  const agent = {
    genericRecords: {
      findAllByQuery: async (query: Record<string, string>) => {
        await tick()
        return records.filter((r) => Object.entries(query).every(([k, v]) => r.tags[k] === v))
      },
      save: async ({ content, tags }: { content: Record<string, unknown>; tags: Record<string, string> }) => {
        await tick()
        records.push({ id: `r${next++}`, content, tags, createdAt: new Date(clock++) })
      },
      update: async (record: Rec) => {
        await tick()
        const at = records.findIndex((r) => r.id === record.id)
        if (at >= 0) records[at] = { ...record, updatedAt: new Date(clock++) }
      },
      delete: async (record: Rec) => {
        await tick()
        const at = records.findIndex((r) => r.id === record.id)
        if (at >= 0) records.splice(at, 1)
      },
    },
  }
  return { agent: agent as never, records }
}

const COMMUNITY = 'did:webvh:QmCommunity:dids.example:first-vtc'
const PERSONA = 'did:webvh:QmPersona:dids.example:negative-weird'

const membership = (grantedAt: string): VtiMembership =>
  ({ communityDid: COMMUNITY, personaDid: PERSONA, role: 'member', vmc: {}, grantedAt, via: 'vetting' }) as never

const persona: VtiPersona = {
  communityDid: COMMUNITY,
  vtaDid: 'did:webvh:QmVta:dids.example:agent',
  did: PERSONA,
  contextId: 'ctx',
  vtaKeyIds: { signing: 's', keyAgreement: 'k' },
  kmsKeyIds: { signing: 'ks', keyAgreement: 'kk' },
  createdAt: '2026-09-26T00:00:00Z',
}

const communityRecord = (id: string, kind: string, key: string, content: Record<string, unknown>, at: number): Rec => ({
  id,
  content,
  tags: { recordType: 'keyring/vti-community', kind, key },
  createdAt: new Date(at),
})
const identityRecord = (id: string, content: Record<string, unknown>, at: number): Rec => ({
  id,
  content,
  tags: { recordType: 'keyring/vti-identity', kind: 'persona', key: COMMUNITY },
  createdAt: new Date(at),
})

describe('one membership, however many listeners store it at once', () => {
  it('three concurrent saves of the same membership leave one record', async () => {
    const { agent, records } = fakeAgent()
    // Three store instances, as the persona inbox, the vetting screen and the
    // vetting join each make their own.
    await Promise.all([
      new GenericRecordsCommunityStore(agent).saveMembership(membership('2026-09-26T09:00:00Z')),
      new GenericRecordsCommunityStore(agent).saveMembership(membership('2026-09-26T09:00:00Z')),
      new GenericRecordsCommunityStore(agent).saveMembership(membership('2026-09-26T09:00:00Z')),
    ])
    expect(records.filter((r) => r.tags.kind === 'membership')).toHaveLength(1)
    expect(await new GenericRecordsCommunityStore(agent).listMemberships()).toHaveLength(1)
  })

  it('three concurrent saves of the same persona leave one record', async () => {
    const { agent, records } = fakeAgent()
    await Promise.all([1, 2, 3].map(() => new GenericRecordsIdentityStore(agent).setPersona(persona)))
    expect(records.filter((r) => r.tags.kind === 'persona')).toHaveLength(1)
  })
})

describe('a phone that already holds the duplicates heals when it looks', () => {
  // The tester's state: three records of one membership and a duplicated
  // identity, all for the same community, from one join before the fix.
  const seed = () =>
    fakeAgent([
      communityRecord('m1', 'membership', COMMUNITY, { ...membership('2026-09-26T09:00:01Z') }, 1),
      communityRecord('m2', 'membership', COMMUNITY, { ...membership('2026-09-26T09:00:02Z') }, 2),
      communityRecord('m3', 'membership', COMMUNITY, { ...membership('2026-09-26T09:00:03Z') }, 3),
      identityRecord('p1', { ...persona }, 4),
      identityRecord('p2', { ...persona }, 5),
    ])

  it('lists one membership and one identity, and removes the extra records', async () => {
    const { agent, records } = seed()
    const memberships = await new GenericRecordsCommunityStore(agent).listMemberships()
    const personas = await new GenericRecordsIdentityStore(agent).listPersonas()
    expect(memberships).toHaveLength(1)
    expect(personas).toHaveLength(1)
    // The newest of each is the one kept.
    expect(memberships[0].grantedAt).toBe('2026-09-26T09:00:03Z')
    expect(records.map((r) => r.id).sort()).toEqual(['m3', 'p2'])
  })

  it('a write to a duplicated key keeps one record and removes the rest', async () => {
    const { agent, records } = seed()
    await new GenericRecordsCommunityStore(agent).saveMembership(membership('2026-09-26T10:00:00Z'))
    const left = records.filter((r) => r.tags.kind === 'membership')
    expect(left).toHaveLength(1)
    expect((left[0].content as unknown as VtiMembership).grantedAt).toBe('2026-09-26T10:00:00Z')
  })

  it('reading one membership gives the newest, whatever the order they were found in', async () => {
    const { agent } = seed()
    const one = await new GenericRecordsCommunityStore(agent).getMembership(COMMUNITY)
    expect(one?.grantedAt).toBe('2026-09-26T09:00:03Z')
  })
})

describe('one persona per community, however many screens ask at once', () => {
  it('concurrent ensurePersona calls do the work once and share its answer', async () => {
    const { agent } = fakeAgent()
    const client = new VtaClient(
      agent,
      'did:webvh:QmVta:dids.example:agent',
      new GenericRecordsIdentityStore(agent),
      {}
    )
    let runs = 0
    jest
      .spyOn(client as unknown as { ensurePersonaOnce: () => Promise<VtiPersona> }, 'ensurePersonaOnce')
      .mockImplementation(async () => {
        runs++
        await new Promise((resolve) => setTimeout(resolve, 5))
        return persona
      })
    const answers = await Promise.all([1, 2, 3].map(() => client.ensurePersona({ communityDid: COMMUNITY })))
    expect(runs).toBe(1)
    expect(answers.every((p) => p.did === PERSONA)).toBe(true)
    // Once it has settled, a later call does the work again (for example after a Join again).
    await client.ensurePersona({ communityDid: COMMUNITY })
    expect(runs).toBe(2)
  })
})

describe("a community's published name survives a relaunch", () => {
  const t = ((key: string) => key) as never

  it('is kept when a manifest names it, and read back by a new store after a relaunch', async () => {
    const { agent } = fakeAgent()
    const did = 'did:webvh:QmNamed:dids.example:named-community'
    await new GenericRecordsCommunityStore(agent).saveCommunityName(did, 'First VTC')
    // A relaunch: nothing in memory, a new store over the same records.
    expect(communityTarget.publishedNameOf(did)).toBeUndefined()
    const names = await new GenericRecordsCommunityStore(agent).listCommunityNames()
    expect(names).toEqual([expect.objectContaining({ communityDid: did, name: 'First VTC' })])
    // What the agent home does on load.
    for (const n of names) communityTarget.publishedName(n.communityDid, n.name)
    expect(communityLabelOf(did, t)).toBe('First VTC')
  })

  it('is stored once however often the manifest is read', async () => {
    const { agent, records } = fakeAgent()
    const did = 'did:webvh:QmOnce:dids.example:once'
    const store = new GenericRecordsCommunityStore(agent)
    await Promise.all([store.saveCommunityName(did, 'Once'), store.saveCommunityName(did, 'Once')])
    await store.saveCommunityName(did, 'Once')
    expect(records.filter((r) => r.tags.kind === 'community-name')).toHaveLength(1)
  })

  it('with no name known, a community is "a community", never its host', () => {
    const label = communityLabelOf('did:webvh:QmNoName:dids.ic3.dev:no-name', t)
    expect(label).toBe('Community.Unnamed')
    expect(label).not.toContain('dids.ic3.dev')
  })
})
