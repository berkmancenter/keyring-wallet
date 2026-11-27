/**
 * Step 7.16, Delete memory, the logic (docs/plans/agent-connect-plan.md §3.15 "Deleting a memory"). Its acceptance
 * line, one describe each: a memory holding only items is never deleted without the confirmation (`force` is sent only
 * by `deleteMemory`, only when confirmed); the agents named are those whose `act` names the id; the count warning shows
 * above the configured count. And the record contract: after a confirmed delete, each bound record loses the id from
 * `memoryContexts` and `contexts` through `store.update`, every other member kept, no record removed.
 */
import { DeleteMemoryAclEntry, DeleteMemoryPorts, deleteMemory, previewDelete } from '../deleteMemory'
import { MEMORY_COUNT_WARNING, MEMORY_LIST_TASK } from '../memories'
import type { AgentConnection } from '../types'

const MEMORY = 'keyring-memory-educat1onx'
const OTHER_MEMORY = 'keyring-memory-hea1thcarx'
const K_A = 'did:key:z6MkAgentAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const K_A2 = 'did:key:z6MkAgentAfterSwapAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const K_B = 'did:key:z6MkAgentBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'
const K_C = 'did:key:z6MkAgentCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC'
const K_D = 'did:key:z6MkAgentDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD'

const record = (id: string, name: string, contexts: string[], agentDid = id): AgentConnection => ({
  id,
  name,
  handle: `${name.toLowerCase().replace(/\W+/g, '-')}`,
  agentDid,
  deviceId: `device-${id.slice(-4)}`,
  ownerPersonaDid: 'did:peer:owner',
  vtaDid: 'did:web:vta.example',
  contexts: [...contexts, 'keyring'],
  memoryContexts: contexts,
  pendingContexts: [],
  capabilities: ['memory-read', 'memory-write'],
  purposes: ['personalisation'],
  grantType: 'persistent',
  answersOthers: false,
  state: 'active',
  keyChanged: false,
  createdAt: '2026-11-25T12:00:00Z',
  chatDid: `did:peer:chat-${id.slice(-4)}`,
})

const items = (n: number, deleted = 0) => [
  ...Array.from({ length: n }, (_, i) => ({
    contextId: MEMORY,
    key: `fact/${i}`,
    version: 1,
    deleted: false,
    updatedAt: new Date(Date.parse('2026-11-20T00:00:00Z') + i * 1000).toISOString(),
    valueBytes: 10,
  })),
  ...Array.from({ length: deleted }, (_, i) => ({
    contextId: MEMORY,
    key: `gone/${i}`,
    version: 2,
    deleted: true,
    updatedAt: '2026-11-26T00:00:00Z',
    valueBytes: 0,
  })),
]

/** A VTA and a store, faked: entries, a paged item listing, the delete, and records with `update`'s semantics. */
function world(opts: {
  entries: DeleteMemoryAclEntry[]
  records?: AgentConnection[]
  items?: ReturnType<typeof items>
  listFails?: boolean
  countFails?: boolean
  deleteError?: Error
}) {
  const store = new Map((opts.records ?? []).map((r) => [r.id, r]))
  const deletes: { id: string; force: boolean }[] = []
  const updates: string[] = []
  const all = opts.items ?? []
  const ports: DeleteMemoryPorts = {
    listEntries: async () => {
      if (opts.listFails) throw new Error('timeout')
      return opts.entries
    },
    deleteContext: async (id, force) => {
      deletes.push({ id, force })
      if (opts.deleteError) throw opts.deleteError
    },
    isHeld: (error) => error instanceof HeldError,
    task: async (type, payload) => {
      if (opts.countFails) throw new Error('timeout')
      expect(type).toBe(MEMORY_LIST_TASK)
      expect(payload).toMatchObject({ contextId: MEMORY, includeValues: false })
      const start = payload.cursor === undefined ? 0 : Number(payload.cursor)
      const limit = payload.limit as number
      const next = start + limit
      return {
        items: all.slice(start, next),
        highWatermark: 1,
        ...(next < all.length ? { nextCursor: String(next) } : {}),
      }
    },
    store: {
      findByKey: async (did) => [...store.values()].find((r) => r.id === did || r.agentDid === did),
      update: async (id, change) => {
        const current = store.get(id)
        if (!current) return undefined
        const next = change(current)
        if (next === current) return current
        updates.push(id)
        store.set(id, next)
        return next
      },
    },
  }
  return { ports, store, deletes, updates }
}

class HeldError extends Error {}

const contextsEntry = (subject: string, contexts: string[], label?: string): DeleteMemoryAclEntry => ({
  subject,
  ...(label !== undefined ? { label } : {}),
  act: { stated: 'contexts', contexts },
})

describe('previewDelete: the items are counted here, since the VTA preview does not count them', () => {
  it('counts live items over every page and skips tombstones', async () => {
    const { ports, deletes } = world({ entries: [], items: items(1203, 7) })
    const preview = await previewDelete(ports, MEMORY)
    expect(preview).toMatchObject({ ok: true, count: { ok: true, count: 1203, complete: true }, agents: [] })
    expect(deletes).toEqual([])
  })

  it('is unreachable when the entries or the count cannot be read', async () => {
    expect(await previewDelete(world({ entries: [], listFails: true }).ports, MEMORY)).toEqual({
      ok: false,
      code: 'unreachable',
    })
    expect(await previewDelete(world({ entries: [], countFails: true }).ports, MEMORY)).toEqual({
      ok: false,
      code: 'unreachable',
    })
  })
})

describe('the count warning shows above the configured count, not at it', () => {
  it(`at exactly ${MEMORY_COUNT_WARNING} items there is no warning`, async () => {
    const preview = await previewDelete(world({ entries: [], items: items(MEMORY_COUNT_WARNING) }).ports, MEMORY)
    expect(preview).toMatchObject({ ok: true, count: { count: MEMORY_COUNT_WARNING }, overWarning: false })
  })

  it('one item above it warns', async () => {
    const preview = await previewDelete(world({ entries: [], items: items(MEMORY_COUNT_WARNING + 1) }).ports, MEMORY)
    expect(preview).toMatchObject({ ok: true, count: { count: MEMORY_COUNT_WARNING + 1 }, overWarning: true })
  })

  it('tombstones do not push a count over it', async () => {
    const preview = await previewDelete(world({ entries: [], items: items(MEMORY_COUNT_WARNING, 5) }).ports, MEMORY)
    expect(preview).toMatchObject({ ok: true, overWarning: false })
  })
})

describe('the agents named are those whose act names the id', () => {
  const entries: DeleteMemoryAclEntry[] = [
    contextsEntry(K_A2, [MEMORY, 'keyring'], 'Label A'),
    { subject: K_B, label: 'Old agent', act: { stated: 'byShape', contexts: [MEMORY] } },
    contextsEntry(K_C, [OTHER_MEMORY], `Uses ${MEMORY}`),
    { subject: K_D, label: 'Everything', act: { stated: 'all' } },
    { subject: 'did:key:z6MkNone', label: 'Nothing', act: { stated: 'none', contexts: [MEMORY] } },
    { subject: 'did:key:z6MkNoAct', label: 'No act' },
    contextsEntry('did:key:z6MkParent', ['keyring-memory'], 'Parent only'),
    contextsEntry('did:key:z6MkUnlabelled', [MEMORY]),
  ]
  // K_C's record still lists the memory (drift), but its entry does not name it: the entry decides.
  const records = [record(K_A, 'Notes helper', [MEMORY], K_A2), record(K_C, 'Clinic helper', [MEMORY])]

  it('names contexts and byShape entries that include the exact id, and nothing else', async () => {
    const preview = await previewDelete(world({ entries, records, items: items(3) }).ports, MEMORY)
    expect(preview).toEqual({
      ok: true,
      count: expect.objectContaining({ ok: true, count: 3 }),
      overWarning: false,
      agents: [
        { subject: K_A2, name: 'Notes helper' },
        { subject: K_B, name: 'Old agent' },
        { subject: 'did:key:z6MkUnlabelled', name: '' },
      ],
    })
  })

  it("a name is the record's, else the entry's label, else empty", async () => {
    const preview = await previewDelete(
      world({ entries: [contextsEntry(K_A, [MEMORY], 'Label A'), contextsEntry(K_B, [MEMORY], 'Label B')], records })
        .ports,
      MEMORY
    )
    expect(preview).toMatchObject({
      agents: [
        { subject: K_A, name: 'Notes helper' },
        { subject: K_B, name: 'Label B' },
      ],
    })
  })
})

describe('a memory is never deleted without the confirmation', () => {
  it('previewDelete sends no delete', async () => {
    const w = world({ entries: [contextsEntry(K_A, [MEMORY])], records: [record(K_A, 'A', [MEMORY])] })
    await previewDelete(w.ports, MEMORY)
    expect(w.deletes).toEqual([])
    expect(w.updates).toEqual([])
  })

  it('an unconfirmed call throws before anything is sent', async () => {
    const w = world({ entries: [contextsEntry(K_A, [MEMORY])], records: [record(K_A, 'A', [MEMORY])] })
    for (const unconfirmed of [false, undefined, 'true', 1]) {
      await expect(deleteMemory(w.ports, MEMORY, unconfirmed as unknown as true)).rejects.toThrow()
    }
    expect(w.deletes).toEqual([])
    expect(w.updates).toEqual([])
  })

  it('a confirmed call sends force: true, once, for the memory', async () => {
    const w = world({ entries: [], items: items(2) })
    expect(await deleteMemory(w.ports, MEMORY, true)).toEqual({ ok: true })
    expect(w.deletes).toEqual([{ id: MEMORY, force: true }])
  })
})

describe('a held or failed delete', () => {
  it('held by an approval rule is heldForApproval, asked once and never waited on', async () => {
    const w = world({
      entries: [contextsEntry(K_A, [MEMORY])],
      records: [record(K_A, 'A', [MEMORY])],
      deleteError: new HeldError('consentPending'),
    })
    expect(await deleteMemory(w.ports, MEMORY, true)).toEqual({ ok: false, code: 'heldForApproval' })
    expect(w.deletes).toHaveLength(1)
    expect(w.updates).toEqual([])
    expect(w.store.get(K_A)?.memoryContexts).toEqual([MEMORY])
  })

  it('any other failure is unreachable and writes nothing', async () => {
    const w = world({
      entries: [contextsEntry(K_A, [MEMORY])],
      records: [record(K_A, 'A', [MEMORY])],
      deleteError: new Error('refused'),
    })
    expect(await deleteMemory(w.ports, MEMORY, true)).toEqual({ ok: false, code: 'unreachable' })
    expect(w.updates).toEqual([])
  })

  it('entries that cannot be listed send no delete', async () => {
    const w = world({ entries: [], listFails: true })
    expect(await deleteMemory(w.ports, MEMORY, true)).toEqual({ ok: false, code: 'unreachable' })
    expect(w.deletes).toEqual([])
  })
})

describe('after a confirmed delete, the bound records', () => {
  const entries = [
    contextsEntry(K_A2, [MEMORY, OTHER_MEMORY, 'keyring']),
    { subject: K_B, act: { stated: 'byShape', contexts: [MEMORY] } },
    contextsEntry(K_C, [OTHER_MEMORY]),
  ]
  const records = () => [
    record(K_A, 'A', [MEMORY, OTHER_MEMORY], K_A2),
    record(K_B, 'B', [MEMORY]),
    record(K_C, 'C', [OTHER_MEMORY]),
  ]

  it('lose the id from memoryContexts and contexts, every other member kept', async () => {
    const w = world({ entries, records: records() })
    const before = new Map([...w.store].map(([k, v]) => [k, { ...v }]))
    expect(await deleteMemory(w.ports, MEMORY, true)).toEqual({ ok: true })
    expect(w.updates.sort()).toEqual([K_A, K_B].sort())
    expect(w.store.get(K_A)).toEqual({
      ...before.get(K_A),
      memoryContexts: [OTHER_MEMORY],
      contexts: [OTHER_MEMORY, 'keyring'],
    })
    // B's only memory: the record stays (7.10's reconcile decides what follows), with no memory.
    expect(w.store.get(K_B)).toEqual({ ...before.get(K_B), memoryContexts: [], contexts: ['keyring'] })
    expect(w.store.get(K_C)).toEqual(before.get(K_C))
    expect(w.store.size).toBe(3)
  })

  it('a record that cannot be written leaves the answer ok: the memory is gone', async () => {
    const w = world({ entries, records: records() })
    w.ports.store.update = async () => {
      throw new Error('storage')
    }
    expect(await deleteMemory(w.ports, MEMORY, true)).toEqual({ ok: true })
  })
})
