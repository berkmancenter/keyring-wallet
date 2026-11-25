/**
 * Your names for a community's members (rooms/petnames): kept per community and member in the agent's encrypted
 * store, tidied to one short line, never saved blank, removed only when asked, and shown at once on every screen
 * reading that community.
 */
import { useAgent } from '@bifold/react-hooks'
import { act, renderHook, waitFor } from '@testing-library/react-native'

import { loadPetname, loadPetnames, PETNAME_MAX, removePetname, savePetname, tidyPetname } from '../petnames'
import { usePetname, usePetnames } from '../usePetname'

type Kept = { id: string; content: Record<string, unknown>; tags: Record<string, string> }

// The agent's generic records, in memory. Saving an id that is already kept fails, as the store does.
function makeAgent() {
  const kept = new Map<string, Kept>()
  const asRecord = (k: Kept) => ({ ...k, getTags: () => k.tags })
  const genericRecords = {
    findById: jest.fn(async (id: string) => {
      await Promise.resolve()
      const k = kept.get(id)
      return k ? asRecord(k) : null
    }),
    findAllByQuery: jest.fn(async (query: Record<string, string>) =>
      [...kept.values()]
        .filter((k) => Object.entries(query).every(([tag, value]) => k.tags[tag] === value))
        .map(asRecord)
    ),
    save: jest.fn(async (record: Kept) => {
      await Promise.resolve()
      if (kept.has(record.id)) throw new Error(`a record with id ${record.id} already exists`)
      kept.set(record.id, { ...record })
    }),
    update: jest.fn(async (record: Kept) => void kept.set(record.id, { ...record })),
    delete: jest.fn(async (record: Kept) => void kept.delete(record.id)),
  }
  return { agent: { genericRecords, config: { logger: { warn: jest.fn() } } } as never, kept, genericRecords }
}

const A = 'did:webvh:community-a'
const B = 'did:webvh:community-b'
const SADDLE = 'did:webvh:almost-saddle'
const EXPOSE = 'did:webvh:river-expose'

describe('your names for members', () => {
  it('are read back per community and member, and kept in the encrypted store with their tags', async () => {
    const { agent, kept } = makeAgent()
    await savePetname(agent, A, SADDLE, 'River')
    await savePetname(agent, B, SADDLE, 'Work River')
    await savePetname(agent, A, EXPOSE, 'Sam')

    await expect(loadPetname(agent, A, SADDLE)).resolves.toBe('River')
    await expect(loadPetname(agent, B, SADDLE)).resolves.toBe('Work River')
    await expect(loadPetname(agent, A, 'did:webvh:nobody')).resolves.toBeUndefined()
    expect([...(await loadPetnames(agent, A)).entries()]).toEqual([
      [SADDLE, 'River'],
      [EXPOSE, 'Sam'],
    ])
    expect([...kept.values()].map((k) => k.tags)).toContainEqual({
      type: 'rooms-petname',
      communityDid: A,
      memberDid: SADDLE,
    })
  })

  it('are changed in place; a blank name changes nothing and removes nothing', async () => {
    const { agent, kept, genericRecords } = makeAgent()
    await savePetname(agent, A, SADDLE, 'River')
    await savePetname(agent, A, SADDLE, 'Riv')
    expect(genericRecords.update).toHaveBeenCalledTimes(1)
    await expect(loadPetname(agent, A, SADDLE)).resolves.toBe('Riv')

    await savePetname(agent, A, SADDLE, '   ')
    await savePetname(agent, A, EXPOSE, '')
    await expect(loadPetname(agent, A, SADDLE)).resolves.toBe('Riv')
    expect(kept.size).toBe(1)
    expect(genericRecords.delete).not.toHaveBeenCalled()
  })

  // Two saves at once would each find no record and each create one; the second would fail.
  it('are removed when asked, for that member only; none to remove is not a failure', async () => {
    const { agent, kept } = makeAgent()
    await savePetname(agent, A, SADDLE, 'River')
    await savePetname(agent, A, EXPOSE, 'Sam')
    await savePetname(agent, B, SADDLE, 'Work River')
    await removePetname(agent, A, SADDLE)
    await expect(loadPetname(agent, A, SADDLE)).resolves.toBeUndefined()
    await expect(loadPetname(agent, A, EXPOSE)).resolves.toBe('Sam')
    await expect(loadPetname(agent, B, SADDLE)).resolves.toBe('Work River')
    expect(kept.size).toBe(2)
    await expect(removePetname(agent, A, SADDLE)).resolves.toBeUndefined()
  })

  it('takes saves made at once in turn, so the last one is kept', async () => {
    const { agent, kept } = makeAgent()
    await Promise.all([
      savePetname(agent, A, SADDLE, 'R'),
      savePetname(agent, A, SADDLE, 'Ri'),
      savePetname(agent, A, SADDLE, 'River'),
    ])
    await expect(loadPetname(agent, A, SADDLE)).resolves.toBe('River')
    expect(kept.size).toBe(1)
  })

  // Out of turn, a remove reading before a save writes would delete nothing, or delete what that save just wrote.
  it('takes a remove made at once with a save in turn, so the one asked last wins', async () => {
    const { agent, kept } = makeAgent()
    await Promise.all([savePetname(agent, A, SADDLE, 'River'), removePetname(agent, A, SADDLE)])
    await expect(loadPetname(agent, A, SADDLE)).resolves.toBeUndefined()
    expect(kept.size).toBe(0)

    await savePetname(agent, A, SADDLE, 'Old')
    await Promise.all([removePetname(agent, A, SADDLE), savePetname(agent, A, SADDLE, 'New')])
    await expect(loadPetname(agent, A, SADDLE)).resolves.toBe('New')
  })

  it('are kept on one line, trimmed and at most PETNAME_MAX characters', () => {
    expect(tidyPetname('  River\n  Stone ')).toBe('River Stone')
    expect(tidyPetname('\n \t')).toBeUndefined()
    expect(tidyPetname(undefined)).toBeUndefined()
    const long = '🌊'.repeat(PETNAME_MAX + 5)
    expect(Array.from(tidyPetname(long) ?? '')).toHaveLength(PETNAME_MAX)
  })
})

describe('the screens’ names', () => {
  const useAgentMock = useAgent as jest.Mock
  afterEach(() => useAgentMock.mockReset())

  it('a name given on one screen shows at once on another reading that community, and nowhere else', async () => {
    const { agent } = makeAgent()
    useAgentMock.mockReturnValue({ agent })
    const sheet = renderHook(() => usePetname(A, SADDLE))
    const chat = renderHook(() => usePetnames(A))
    const other = renderHook(() => usePetnames(B))
    await waitFor(() => expect(sheet.result.current.loaded).toBe(true))
    expect(sheet.result.current.name).toBeUndefined()

    await act(async () => {
      await sheet.result.current.set(' River ')
    })
    await waitFor(() => expect(chat.result.current.get(SADDLE)).toBe('River'))
    expect(sheet.result.current.name).toBe('River')
    expect(other.result.current.size).toBe(0)

    await act(async () => {
      await sheet.result.current.set('Riv')
    })
    await waitFor(() => expect(chat.result.current.get(SADDLE)).toBe('Riv'))
    expect(sheet.result.current.name).toBe('Riv')

    await act(async () => {
      await sheet.result.current.remove()
    })
    await waitFor(() => expect(chat.result.current.size).toBe(0))
    expect(sheet.result.current.name).toBeUndefined()
  })

  it('without an agent, nothing is read or kept', async () => {
    useAgentMock.mockReturnValue({ agent: undefined })
    const sheet = renderHook(() => usePetname(A, SADDLE))
    await act(async () => {
      await sheet.result.current.set('River')
    })
    expect(sheet.result.current.name).toBeUndefined()
    expect(sheet.result.current.loaded).toBe(false)
  })
})
