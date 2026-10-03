/**
 * Several agents, step 2: the phone keeps every linked agent, one current.
 * `get()` keeps meaning "the current link", so today's callers are unchanged,
 * and a phone from before (one record, no marker) reads as a list of one.
 */
import { GenericRecordsVtaLinkStore, type VtaLink } from '../module/VtaLinkStore'

type Rec = { id: string; content: Record<string, unknown>; tags: Record<string, string> }

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
          records.push({ id: `r${++n}`, content, tags })
        },
        update: async (r: Rec) => {
          records[records.findIndex((x) => x.id === r.id)] = r
        },
        delete: async (r: Rec) => {
          const i = records.findIndex((x) => x.id === r.id)
          if (i >= 0) records.splice(i, 1)
        },
      },
    },
  }
}

const link = (vtaDid: string, linkedAt: string): VtaLink => ({ vtaDid, label: vtaDid, linkedAt })
const HOME = 'did:webvh:home-vta'
const WORK = 'did:webvh:work-vta'

describe('the linked agents', () => {
  it('keeps every agent; the first is current, a later one waits until it is used', async () => {
    const { agent } = fakeAgent()
    const store = new GenericRecordsVtaLinkStore(agent as never)
    await store.set(link(HOME, '2026-10-01T00:00:00Z'))
    await store.set(link(WORK, '2026-10-02T00:00:00Z'))
    expect((await store.list()).map((l) => l.vtaDid)).toEqual([HOME, WORK])
    expect(await store.current()).toBe(HOME)
    expect((await store.get())?.vtaDid).toBe(HOME)
    await store.use(WORK)
    expect((await store.get())?.vtaDid).toBe(WORK)
  })

  it("a link kept again for the same agent updates it, never another agent's", async () => {
    const { agent } = fakeAgent()
    const store = new GenericRecordsVtaLinkStore(agent as never)
    await store.set(link(HOME, '2026-10-01T00:00:00Z'))
    await store.set(link(WORK, '2026-10-02T00:00:00Z'))
    await store.set({ ...link(HOME, '2026-10-01T00:00:00Z'), introSeenAt: '2026-10-03T00:00:00Z' })
    const all = await store.list()
    expect(all).toHaveLength(2)
    expect(all.find((l) => l.vtaDid === HOME)?.introSeenAt).toBe('2026-10-03T00:00:00Z')
    expect(all.find((l) => l.vtaDid === WORK)?.introSeenAt).toBeUndefined()
  })

  it('unlinking the current agent makes the oldest remaining one current; the last one leaves none', async () => {
    const { agent } = fakeAgent()
    const store = new GenericRecordsVtaLinkStore(agent as never)
    await store.set(link(HOME, '2026-10-01T00:00:00Z'))
    await store.set(link(WORK, '2026-10-02T00:00:00Z'))
    await store.use(WORK)
    await store.clear()
    expect((await store.get())?.vtaDid).toBe(HOME)
    await store.clear()
    expect(await store.get()).toBeUndefined()
    expect(await store.list()).toEqual([])
  })

  it('removing an agent that is not current leaves the current one', async () => {
    const { agent } = fakeAgent()
    const store = new GenericRecordsVtaLinkStore(agent as never)
    await store.set(link(HOME, '2026-10-01T00:00:00Z'))
    await store.set(link(WORK, '2026-10-02T00:00:00Z'))
    await store.remove(WORK)
    expect((await store.list()).map((l) => l.vtaDid)).toEqual([HOME])
    expect(await store.current()).toBe(HOME)
  })

  it('using an agent that is not linked is refused', async () => {
    const { agent } = fakeAgent()
    const store = new GenericRecordsVtaLinkStore(agent as never)
    await store.set(link(HOME, '2026-10-01T00:00:00Z'))
    await expect(store.use(WORK)).rejects.toThrow()
    expect(await store.current()).toBe(HOME)
  })

  it('a phone from before, one record and no marker, reads as a list of one, current', async () => {
    const { agent, records } = fakeAgent()
    records.push({
      id: 'old',
      content: { ...link(HOME, '2026-09-01T00:00:00Z') },
      tags: { recordType: 'keyring.vta-link' },
    })
    const store = new GenericRecordsVtaLinkStore(agent as never)
    expect((await store.get())?.vtaDid).toBe(HOME)
    expect(await store.list()).toHaveLength(1)
    await store.clear()
    expect(records).toHaveLength(0)
  })
})
