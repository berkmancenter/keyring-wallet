import type { Agent } from '@credo-ts/core'

import { memoryGenericRecords } from '../../../../__tests__/modules/vrc/fixtures/memoryGenericRecords'
import { PairingLockout } from '../lockout'
import { AgentConnectionStore, KeyedLockoutStore, KeyedSpentRequestStore } from '../store'
import { agentRecord, FIXTURE_NOW } from '../testing/fixtures'

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
