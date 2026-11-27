import type { Agent } from '@credo-ts/core'

import { memoryGenericRecords } from '../../../../__tests__/modules/vrc/fixtures/memoryGenericRecords'
import { PairingLockout } from '../lockout'
import { AgentConnectionStore, KeyedLockoutStore, KeyedSpentRequestStore } from '../store'
import { agentRecord, FIXTURE_NOW } from '../testing/fixtures'
import type { AgentConnection } from '../types'

function fakeAgent() {
  const genericRecords = memoryGenericRecords()
  return { agent: { genericRecords } as unknown as Agent, genericRecords }
}

describe('AgentConnectionStore (§3.11)', () => {
  it('keeps one record per agent: a second put replaces the first', async () => {
    const { agent, genericRecords } = fakeAgent()
    const store = new AgentConnectionStore(agent)
    await store.put(agentRecord())
    await store.put(agentRecord({ name: 'Renamed' }))
    expect(genericRecords.records).toHaveLength(1)
    expect((await store.get(agentRecord().id))?.name).toBe('Renamed')
    expect((await store.list()).map((r) => r.name)).toEqual(['Renamed'])
  })

  it('remove deletes the record, and removing an absent one does nothing', async () => {
    const { agent } = fakeAgent()
    const store = new AgentConnectionStore(agent)
    await store.put(agentRecord())
    await store.put(agentRecord({ id: 'did:key:z6MkOther', name: 'Other' }))
    await store.remove(agentRecord().id)
    await store.remove('did:key:z6MkNeverThere')
    expect((await store.list()).map((r) => r.id)).toEqual(['did:key:z6MkOther'])
    expect(await store.get(agentRecord().id)).toBeUndefined()
  })
})

describe('AgentConnectionStore.update: one read-modify-write at a time per record', () => {
  it("two concurrent updates of one record keep both changes (the driver's grant and 7.10's keyChanged)", async () => {
    const { agent } = fakeAgent()
    const store = new AgentConnectionStore(agent)
    await store.put(agentRecord({ state: 'pairing' }))
    const id = agentRecord().id
    await Promise.all([
      store.update(id, (r) => ({ ...r, state: 'active', vdcGrant: { issuer: 'p' } })),
      store.update(id, (r) => ({ ...r, keyChanged: true, agentDid: 'did:key:z6MkRotated' })),
    ])
    expect(await store.get(id)).toMatchObject({
      state: 'active',
      vdcGrant: { issuer: 'p' },
      keyChanged: true,
      agentDid: 'did:key:z6MkRotated',
    })
  })

  it('control: two read-then-put writers without update lose one change', async () => {
    const { agent } = fakeAgent()
    const store = new AgentConnectionStore(agent)
    await store.put(agentRecord({ state: 'pairing' }))
    const id = agentRecord().id
    const [a, b] = await Promise.all([store.get(id), store.get(id)])
    await store.put({ ...(a as AgentConnection), state: 'active' })
    await store.put({ ...(b as AgentConnection), keyChanged: true })
    expect((await store.get(id))?.state).toBe('pairing')
  })

  it('cannot change a record id, and an absent record is undefined', async () => {
    const { agent } = fakeAgent()
    const store = new AgentConnectionStore(agent)
    await store.put(agentRecord())
    await expect(store.update(agentRecord().id, (r) => ({ ...r, id: 'other' }))).rejects.toThrow(/cannot change/)
    expect(await store.update('did:key:z6MkAbsent', (r) => r)).toBeUndefined()
  })

  it('findByKey finds a record by its first key or its current one', async () => {
    const { agent } = fakeAgent()
    const store = new AgentConnectionStore(agent)
    await store.put(agentRecord({ agentDid: 'did:key:z6MkRotated' }))
    expect((await store.findByKey(agentRecord().id))?.id).toBe(agentRecord().id)
    expect((await store.findByKey('did:key:z6MkRotated'))?.id).toBe(agentRecord().id)
    expect(await store.findByKey('did:key:z6MkNobody')).toBeUndefined()
  })
})

describe('AgentConnectionStore: put, update and upsert share one lock per record', () => {
  it('a direct put sent while an update is in progress waits for it, and is not lost', async () => {
    const { agent } = fakeAgent()
    const store = new AgentConnectionStore(agent)
    await store.put(agentRecord({ state: 'pairing' }))
    const id = agentRecord().id
    const updating = store.update(id, (r) => ({ ...r, state: 'active', vdcGrant: { issuer: 'p' } }))
    const putting = store.put(agentRecord({ state: 'notFinished', name: 'Leftover shell' }))
    await Promise.all([updating, putting])
    expect(await store.get(id)).toMatchObject({ state: 'notFinished', name: 'Leftover shell' })
  })

  it('upsert decides from the record as it is under the lock: a grant written just before is seen, and kept', async () => {
    const { agent, genericRecords } = fakeAgent()
    const store = new AgentConnectionStore(agent)
    await store.put(agentRecord({ state: 'pairing' }))
    const id = agentRecord().id
    const granting = store.update(id, (r) => ({ ...r, state: 'active', vdcGrant: { issuer: 'p' } }))
    const leftover = store.upsert(id, (current) =>
      current && current.state !== 'pairing' ? current : agentRecord({ state: 'notFinished' })
    )
    await Promise.all([granting, leftover])
    expect(await leftover).toMatchObject({ state: 'active', vdcGrant: { issuer: 'p' } })
    expect(await store.get(id)).toMatchObject({ state: 'active', vdcGrant: { issuer: 'p' } })
    const writes = genericRecords.save.mock.calls.length + genericRecords.update.mock.calls.length
    await store.upsert(id, (current) => current)
    expect(genericRecords.save.mock.calls.length + genericRecords.update.mock.calls.length).toBe(writes)
  })

  it('the no-write rule is by reference: the same object writes nothing, a copy with nothing changed writes', async () => {
    const { agent, genericRecords } = fakeAgent()
    const store = new AgentConnectionStore(agent)
    await store.put(agentRecord())
    const id = agentRecord().id
    const writes = () => genericRecords.save.mock.calls.length + genericRecords.update.mock.calls.length
    const before = writes()
    await store.update(id, (r) => r)
    expect(writes()).toBe(before)
    await store.update(id, (r) => ({ ...r }))
    expect(writes()).toBe(before + 1)
  })

  it('upsert creates a record that is absent, and refuses one under another id', async () => {
    const { agent } = fakeAgent()
    const store = new AgentConnectionStore(agent)
    const id = agentRecord().id
    expect(await store.upsert(id, (current) => current ?? agentRecord({ state: 'notFinished' }))).toMatchObject({
      id,
      state: 'notFinished',
    })
    expect(await store.upsert('did:key:z6MkAbsent', () => undefined)).toBeUndefined()
    await expect(store.upsert('did:key:z6MkAbsent', () => agentRecord())).rejects.toThrow(/cannot change/)
  })
})

describe('KeyedLockoutStore (§3.2 step 5): the lock survives a restart', () => {
  it('a new lockout over the same storage reads the same lock', async () => {
    const { agent } = fakeAgent()
    let now = FIXTURE_NOW
    const first = new PairingLockout(new KeyedLockoutStore(agent), () => now)
    await first.recordWrongNumber()
    now += 1000
    await first.recordWrongNumber()
    now += 1000
    await first.recordWrongNumber()
    // "Restart": a fresh store and lockout over the same generic records.
    const second = new PairingLockout(new KeyedLockoutStore(agent), () => now)
    expect(await second.state()).toMatchObject({ locked: true, minutesLeft: 15 })
  })

  it('control: nothing stored reads as no times', async () => {
    const { agent } = fakeAgent()
    expect(await new KeyedLockoutStore(agent).load()).toEqual([])
  })
})

describe('KeyedSpentRequestStore (§7.2: never claim a request id twice)', () => {
  it('an added id is spent, another is not, and the answer survives a new store', async () => {
    const { agent } = fakeAgent()
    await new KeyedSpentRequestStore(agent, () => FIXTURE_NOW).add('req-1', FIXTURE_NOW + 120_000)
    const fresh = new KeyedSpentRequestStore(agent, () => FIXTURE_NOW)
    expect(await fresh.has('req-1')).toBe(true)
    expect(await fresh.has('req-2')).toBe(false)
  })

  it('ids a day past their until are dropped on the next add; recent ones are kept', async () => {
    const { agent, genericRecords } = fakeAgent()
    const day = KeyedSpentRequestStore.KEEP_AFTER_MS
    await new KeyedSpentRequestStore(agent, () => FIXTURE_NOW).add('old', FIXTURE_NOW)
    await new KeyedSpentRequestStore(agent, () => FIXTURE_NOW).add('recent', FIXTURE_NOW + day)
    const later = new KeyedSpentRequestStore(agent, () => FIXTURE_NOW + day + 1)
    await later.add('new', FIXTURE_NOW + day + 120_000)
    expect(await later.has('old')).toBe(false)
    expect(await later.has('recent')).toBe(true)
    expect(await later.has('new')).toBe(true)
    expect(genericRecords.records).toHaveLength(2)
  })
})
