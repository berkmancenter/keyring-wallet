import type { Agent } from '@credo-ts/core'

import { NAME_TTL_MS, confirmDirectoryNames, dropDirectoryNames, keepDirectoryName, loadDirectoryNames } from '../names'

const COMMUNITY = 'did:webvh:community:a'
const OTHER = 'did:webvh:community:b'
const ANA = 'did:key:ana'
const BO = 'did:key:bo'

/** The agent's generic records, as far as the cache uses them. It has no delete: the cache never deletes. */
function fakeAgent() {
  const records = new Map<string, { id: string; content: Record<string, unknown>; tags: Record<string, unknown> }>()
  const genericRecords = {
    findById: jest.fn(async (id: string) => records.get(id) ?? null),
    save: jest.fn(async (r: { id: string; content: Record<string, unknown>; tags: Record<string, unknown> }) => {
      records.set(r.id, { ...r })
    }),
    update: jest.fn(async (r: { id: string; content: Record<string, unknown>; tags: Record<string, unknown> }) => {
      records.set(r.id, { ...r })
    }),
  }
  return { agent: { genericRecords } as unknown as Agent, records, genericRecords }
}

describe('the names shown for room authors', () => {
  it('keeps a name per community, one record each, and loads it back', async () => {
    const { agent, records } = fakeAgent()
    await keepDirectoryName(agent, COMMUNITY, ANA, 'Ana', 1000)
    await keepDirectoryName(agent, COMMUNITY, BO, 'Bo', 1000)
    await keepDirectoryName(agent, OTHER, ANA, 'Ana elsewhere', 1000)
    expect([...(await loadDirectoryNames(agent, COMMUNITY, 2000))]).toEqual([
      [ANA, 'Ana'],
      [BO, 'Bo'],
    ])
    expect([...(await loadDirectoryNames(agent, OTHER, 2000))]).toEqual([[ANA, 'Ana elsewhere']])
    expect(records.size).toBe(2)
  })

  it('stops showing a name once it is a week old, and leaves it out of the record on the next write', async () => {
    const { agent, records } = fakeAgent()
    await keepDirectoryName(agent, COMMUNITY, ANA, 'Ana', 0)
    expect((await loadDirectoryNames(agent, COMMUNITY, NAME_TTL_MS - 1)).get(ANA)).toBe('Ana')
    expect((await loadDirectoryNames(agent, COMMUNITY, NAME_TTL_MS)).has(ANA)).toBe(false)
    await keepDirectoryName(agent, COMMUNITY, BO, 'Bo', NAME_TTL_MS)
    expect(Object.keys((records.get(`directory-names:${COMMUNITY}`)!.content.names as object) ?? {})).toEqual([BO])
  })

  it('drops a name the community no longer shows, and every name of a community the phone left, by rewriting', async () => {
    const { agent, records } = fakeAgent()
    await keepDirectoryName(agent, COMMUNITY, ANA, 'Ana', 1000)
    await keepDirectoryName(agent, COMMUNITY, BO, 'Bo', 1000)
    await keepDirectoryName(agent, COMMUNITY, ANA, undefined, 1500)
    expect([...(await loadDirectoryNames(agent, COMMUNITY, 2000)).keys()]).toEqual([BO])

    await dropDirectoryNames(agent, COMMUNITY)
    expect((await loadDirectoryNames(agent, COMMUNITY, 2000)).size).toBe(0)
    // Nothing is left that says who was looked up.
    expect(JSON.stringify([...records.values()])).not.toContain(BO)
  })

  it('writes nothing for a member with no name when nothing is kept yet', async () => {
    const { agent, genericRecords } = fakeAgent()
    await keepDirectoryName(agent, COMMUNITY, ANA, undefined, 1000)
    await dropDirectoryNames(agent, COMMUNITY)
    expect(genericRecords.save).not.toHaveBeenCalled()
    expect(genericRecords.update).not.toHaveBeenCalled()
  })

  it('keeps both of two names kept at once', async () => {
    const { agent } = fakeAgent()
    await Promise.all([
      keepDirectoryName(agent, COMMUNITY, ANA, 'Ana', 1000),
      keepDirectoryName(agent, COMMUNITY, BO, 'Bo', 1000),
    ])
    expect((await loadDirectoryNames(agent, COMMUNITY, 2000)).size).toBe(2)
  })

  it('a name the community confirms is kept another week: written again only past half its week, in one write', async () => {
    const { agent, genericRecords } = fakeAgent()
    await keepDirectoryName(agent, COMMUNITY, ANA, 'Ana', 0)
    await keepDirectoryName(agent, COMMUNITY, BO, 'Bo', 0)
    genericRecords.update.mockClear()

    // Confirmed early in its week: nothing written.
    await confirmDirectoryNames(agent, COMMUNITY, [ANA, BO], NAME_TTL_MS / 2 - 1)
    expect(genericRecords.update).not.toHaveBeenCalled()

    // Past half its week: both written again, once.
    await confirmDirectoryNames(agent, COMMUNITY, [ANA, BO], NAME_TTL_MS / 2)
    expect(genericRecords.update).toHaveBeenCalledTimes(1)

    // A week after they were first kept, both still show; unconfirmed, they would not (the test above).
    expect([...(await loadDirectoryNames(agent, COMMUNITY, NAME_TTL_MS + 1))]).toEqual([
      [ANA, 'Ana'],
      [BO, 'Bo'],
    ])
  })

  it('confirming names never kept writes nothing and keeps nothing', async () => {
    const { agent, genericRecords, records } = fakeAgent()
    await confirmDirectoryNames(agent, COMMUNITY, [ANA], 1000)
    expect(genericRecords.save).not.toHaveBeenCalled()
    expect(genericRecords.update).not.toHaveBeenCalled()
    expect(records.size).toBe(0)
  })
})
