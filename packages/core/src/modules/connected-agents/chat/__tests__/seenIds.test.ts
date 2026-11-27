/**
 * The seen ids (backlog 2, fb-C2): one record per (receiver, id), claimed in one step, kept across a restart, and
 * dropped once past the 7-day window; and the last applied state of a type, which never moves back.
 */
import type { Agent } from '@credo-ts/core'

import { memoryGenericRecords } from '../../../../../__tests__/modules/vrc/fixtures/memoryGenericRecords'
import { ENVELOPE_MAX_AGE_MS, KeyedSeenIdStore, MemorySeenIdStore, insideWindow } from '../seenIds'

const K_C = 'did:key:z6MkmYfXi4nM8PKsWHzYSta1cwf4pXwXwFWjc8SpqEoRC8XA'
const K_A = 'did:key:z6MkmuVtF44v2X8h53qdjng8hRgRVsnFH4m14z5uwE4NuPe6'
const ID = 'urn:uuid:00000000-0000-4000-8000-000000000001'
const NOW = new Date('2026-11-20T12:00:00Z')
const ISSUED = '2026-11-20T11:59:00Z'
const later = (ms: number) => new Date(NOW.getTime() + ms)

function fakeAgent() {
  const genericRecords = memoryGenericRecords()
  return { agent: { genericRecords } as unknown as Agent, genericRecords }
}

describe.each([
  ['KeyedSeenIdStore', () => new KeyedSeenIdStore(fakeAgent().agent)],
  ['MemorySeenIdStore', () => new MemorySeenIdStore()],
])('%s', (_name, make) => {
  it('claims an id once: the first claim records it, the second finds it seen', async () => {
    const store = make()
    expect(await store.seen(K_C, ID, NOW)).toBe(false)
    expect(await store.claim(K_C, ID, ISSUED, NOW)).toBe(true)
    expect(await store.seen(K_C, ID, NOW)).toBe(true)
    expect(await store.claim(K_C, ID, ISSUED, NOW)).toBe(false)
  })

  it("keeps each receiver's ids apart", async () => {
    const store = make()
    expect(await store.claim(K_C, ID, ISSUED, NOW)).toBe(true)
    expect(await store.claim(K_A, ID, ISSUED, NOW)).toBe(true)
  })

  it('counts an id past the window as unseen, pruned or not', async () => {
    const store = make()
    await store.claim(K_C, ID, ISSUED, NOW)
    const past = later(ENVELOPE_MAX_AGE_MS + 60_001)
    expect(await store.seen(K_C, ID, past)).toBe(false)
    expect(await store.claim(K_C, ID, ISSUED, past)).toBe(true)
  })

  it('prune drops only the ids past the window', async () => {
    const store = make()
    await store.claim(K_C, ID, ISSUED, NOW)
    const newer = 'urn:uuid:00000000-0000-4000-8000-000000000002'
    await store.claim(K_C, newer, '2026-11-24T12:00:00Z', NOW)
    const at = new Date('2026-11-27T12:00:00Z')
    expect(await store.prune(at)).toBe(1)
    expect(await store.seen(K_C, newer, at)).toBe(true)
    expect(await store.seen(K_C, ID, NOW)).toBe(false)
  })

  it('the last applied state only moves forward', async () => {
    const store = make()
    const type = 'keyring/agent/settings'
    expect(await store.lastApplied(K_A, type)).toBeUndefined()
    await store.markApplied(K_A, type, '2026-11-20T11:59:00Z')
    await store.markApplied(K_A, type, '2026-11-20T11:30:00Z')
    expect(await store.lastApplied(K_A, type)).toBe('2026-11-20T11:59:00Z')
    await store.markApplied(K_A, type, '2026-11-20T12:01:00Z')
    expect(await store.lastApplied(K_A, type)).toBe('2026-11-20T12:01:00Z')
    expect(await store.lastApplied(K_C, type)).toBeUndefined()
  })
})

describe('KeyedSeenIdStore in the app storage', () => {
  it('keeps the ids across a restart: a new store over the same records still finds them', async () => {
    const { agent } = fakeAgent()
    await new KeyedSeenIdStore(agent).claim(K_C, ID, ISSUED, NOW)
    expect(await new KeyedSeenIdStore(agent).claim(K_C, ID, ISSUED, NOW)).toBe(false)
  })

  it('two deliveries of one id at once: exactly one claim wins, and one record is kept', async () => {
    const { agent, genericRecords } = fakeAgent()
    const store = new KeyedSeenIdStore(agent)
    const results = await Promise.all([1, 2, 3].map(() => store.claim(K_C, ID, ISSUED, NOW)))
    expect(results.filter(Boolean)).toHaveLength(1)
    expect(genericRecords.records.filter((r) => r.tags.kind === 'seen-id')).toHaveLength(1)
  })

  it('a claim past the hour prunes the expired ids on its own', async () => {
    const { agent, genericRecords } = fakeAgent()
    const store = new KeyedSeenIdStore(agent)
    await store.claim(K_C, ID, ISSUED, NOW)
    const past = later(ENVELOPE_MAX_AGE_MS + 3_600_000)
    await store.claim(K_C, 'urn:uuid:00000000-0000-4000-8000-000000000009', past.toISOString(), past)
    expect(genericRecords.records.map((r) => r.content.id)).toEqual(['urn:uuid:00000000-0000-4000-8000-000000000009'])
  })

  it('control: without a claim, nothing is recorded', async () => {
    const { agent, genericRecords } = fakeAgent()
    const store = new KeyedSeenIdStore(agent)
    expect(await store.seen(K_C, ID, NOW)).toBe(false)
    expect(genericRecords.records).toHaveLength(0)
  })
})

describe('insideWindow', () => {
  it('is the 7 days behind the clock, inclusive, and false for a non-date', () => {
    expect(insideWindow(new Date(NOW.getTime() - ENVELOPE_MAX_AGE_MS).toISOString(), NOW)).toBe(true)
    expect(insideWindow(new Date(NOW.getTime() - ENVELOPE_MAX_AGE_MS - 1).toISOString(), NOW)).toBe(false)
    expect(insideWindow('not a date', NOW)).toBe(false)
  })
})
