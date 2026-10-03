/**
 * Several agents, step 1: an identity is kept per agent and community, so a
 * second agent's identity for a community is its own. Records kept by
 * community alone (before) are still read for their agent, and moved under it
 * at the next write.
 */
import { setCurrentAgentDid } from '../module/currentAgent'
import { agentScoped, GenericRecordsIdentityStore, type VtiPersona } from '../module/VtiIdentityStore'

type Rec = { id: string; content: Record<string, unknown>; tags: Record<string, string>; createdAt: Date }

function fakeAgent() {
  const records: Rec[] = []
  let n = 0
  const matches = (r: Rec, q: Record<string, string>) => Object.entries(q).every(([k, v]) => r.tags[k] === v)
  return {
    records,
    agent: {
      genericRecords: {
        findAllByQuery: async (q: Record<string, string>) => records.filter((r) => matches(r, q)),
        save: async ({ content, tags }: { content: Record<string, unknown>; tags: Record<string, string> }) => {
          records.push({ id: `r${++n}`, content, tags, createdAt: new Date(Date.now() + n) })
        },
        update: async (r: Rec) => {
          const i = records.findIndex((x) => x.id === r.id)
          records[i] = r
        },
        delete: async (r: Rec) => {
          const i = records.findIndex((x) => x.id === r.id)
          if (i >= 0) records.splice(i, 1)
        },
        deleteById: async (id: string) => {
          const i = records.findIndex((x) => x.id === id)
          if (i >= 0) records.splice(i, 1)
        },
      },
    },
  }
}

const COMMUNITY = 'did:webvh:community'
const WORK = 'did:webvh:work-vta'
const HOME = 'did:webvh:home-vta'
const persona = (vtaDid: string, name: string): VtiPersona =>
  ({
    did: `did:webvh:${name}`,
    communityDid: COMMUNITY,
    vtaDid,
    contextId: 'ctx',
    vtaKeyIds: { signing: 's', keyAgreement: 'k' },
    kmsKeyIds: { signing: 's', keyAgreement: 'k' },
    createdAt: '2026-10-03T00:00:00Z',
  }) as VtiPersona

afterEach(() => setCurrentAgentDid(undefined))

describe('identities kept per agent and community', () => {
  it('two agents each keep their own identity for the same community; each is read under its agent', async () => {
    const { agent } = fakeAgent()
    const store = new GenericRecordsIdentityStore(agent as never)
    await store.setPersona(persona(WORK, 'work-me'))
    await store.setPersona(persona(HOME, 'home-me'))
    expect((await store.getPersona(COMMUNITY, WORK))?.did).toBe('did:webvh:work-me')
    expect((await store.getPersona(COMMUNITY, HOME))?.did).toBe('did:webvh:home-me')
    expect((await store.listPersonas()).map((p) => p.did).sort()).toEqual(['did:webvh:home-me', 'did:webvh:work-me'])
  })

  it('without an agent named, it answers for the agent this phone acts with now', async () => {
    const { agent } = fakeAgent()
    const store = new GenericRecordsIdentityStore(agent as never)
    await store.setPersona(persona(WORK, 'work-me'))
    await store.setPersona(persona(HOME, 'home-me'))
    setCurrentAgentDid(HOME)
    expect((await store.getPersona(COMMUNITY))?.did).toBe('did:webvh:home-me')
    setCurrentAgentDid(WORK)
    expect((await store.getPersona(COMMUNITY))?.did).toBe('did:webvh:work-me')
  })

  it("forgetting one agent's identity leaves the other agent's", async () => {
    const { agent } = fakeAgent()
    const store = new GenericRecordsIdentityStore(agent as never)
    await store.setPersona(persona(WORK, 'work-me'))
    await store.setPersona(persona(HOME, 'home-me'))
    await store.forgetPersona(COMMUNITY, WORK)
    expect(await store.getPersona(COMMUNITY, WORK)).toBeUndefined()
    expect((await store.getPersona(COMMUNITY, HOME))?.did).toBe('did:webvh:home-me')
  })
})

describe('identities kept by community alone, from before', () => {
  const keptBefore = (records: Rec[], p: VtiPersona) =>
    records.push({
      id: `old-${p.did}`,
      content: { ...p },
      tags: { recordType: 'keyring/vti-identity', kind: 'persona', key: p.communityDid },
      createdAt: new Date(0),
    })

  it('are still read for their own agent, and only for it', async () => {
    const { agent, records } = fakeAgent()
    keptBefore(records, persona(WORK, 'old-me'))
    const store = new GenericRecordsIdentityStore(agent as never)
    expect((await store.getPersona(COMMUNITY, WORK))?.did).toBe('did:webvh:old-me')
    expect(await store.getPersona(COMMUNITY, HOME)).toBeUndefined()
    // No agent known (not linked): the one there is.
    expect((await store.getPersona(COMMUNITY))?.did).toBe('did:webvh:old-me')
  })

  it('move under their agent at the next write, and are not listed twice', async () => {
    const { agent, records } = fakeAgent()
    const old = persona(WORK, 'old-me')
    keptBefore(records, old)
    const store = new GenericRecordsIdentityStore(agent as never)
    await store.setPersona({ ...old, kmsKeyIds: { signing: 's2', keyAgreement: 'k2' } })
    expect(records.map((r) => r.tags.key)).toEqual([agentScoped(WORK, COMMUNITY)])
    expect(await store.listPersonas()).toHaveLength(1)
  })

  it("forgetting under one agent removes that agent's old record, never another agent's", async () => {
    const { agent, records } = fakeAgent()
    keptBefore(records, persona(WORK, 'old-me'))
    const store = new GenericRecordsIdentityStore(agent as never)
    await store.forgetPersona(COMMUNITY, HOME)
    expect(records).toHaveLength(1)
    await store.forgetPersona(COMMUNITY, WORK)
    expect(records).toHaveLength(0)
  })
})

describe('the mint key', () => {
  it('is kept under the agent the mint is asked of, and an old one is still read and cleared', async () => {
    const { agent, records } = fakeAgent()
    const store = new GenericRecordsIdentityStore(agent as never)
    records.push({
      id: 'old-mint',
      content: { key: 'k-old' },
      tags: { recordType: 'keyring/vti-identity', kind: 'mint-key', key: COMMUNITY },
      createdAt: new Date(0),
    })
    setCurrentAgentDid(WORK)
    expect(await store.getMintKey(COMMUNITY)).toBe('k-old')
    await store.setMintKey(COMMUNITY, 'k-new')
    expect(await store.getMintKey(COMMUNITY)).toBe('k-new')
    await store.clearMintKey(COMMUNITY)
    expect(await store.getMintKey(COMMUNITY)).toBeUndefined()
    expect(records.filter((r) => r.tags.kind === 'mint-key')).toHaveLength(0)
  })
})
