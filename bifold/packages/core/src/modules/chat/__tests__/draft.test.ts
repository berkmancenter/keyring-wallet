import {
  afterChatDrafts,
  clearChatDraft,
  clearDraft,
  flushChatDrafts,
  loadChatDraft,
  loadDraft,
  saveChatDraft,
  saveDraft,
} from '../draft'
import { createKeyLock } from '../../../utils/keyLock'

type Kept = { id: string; content: Record<string, unknown>; tags?: Record<string, unknown> }

// The agent's generic records, in memory. Saving an id that is already kept fails, as the store does.
function makeAgent() {
  const kept = new Map<string, Kept>()
  const genericRecords = {
    findById: jest.fn(async (id: string) => {
      await Promise.resolve()
      return kept.get(id) ?? null
    }),
    save: jest.fn(async (record: Kept) => {
      await Promise.resolve()
      if (kept.has(record.id)) throw new Error(`a record with id ${record.id} already exists`)
      kept.set(record.id, { ...record })
    }),
    update: jest.fn(async (record: Kept) => void kept.set(record.id, { ...record })),
    delete: jest.fn(async (record: Kept) => void kept.delete(record.id)),
  }
  return { agent: { genericRecords } as never, kept, genericRecords }
}

describe('a chat’s kept draft', () => {
  it('is read back as it was saved, per chat', async () => {
    const { agent, kept } = makeAgent()
    await saveChatDraft(agent, 'c1', 'see you at no')
    await saveChatDraft(agent, 'c2', 'other chat')

    await expect(loadChatDraft(agent, 'c1')).resolves.toBe('see you at no')
    await expect(loadChatDraft(agent, 'c2')).resolves.toBe('other chat')
    expect(kept.get('chat-draft:c1')?.tags).toEqual({ type: 'chat-draft', connectionId: 'c1' })
  })

  it('is updated in place as it changes', async () => {
    const { agent, kept, genericRecords } = makeAgent()
    await saveChatDraft(agent, 'c1', 'see')
    await saveChatDraft(agent, 'c1', 'see you')

    await expect(loadChatDraft(agent, 'c1')).resolves.toBe('see you')
    expect(kept.size).toBe(1)
    expect(genericRecords.update).toHaveBeenCalledTimes(1)
  })

  // Two saves at once would each find no record and each create one; the second would fail.
  it('takes saves made at once in turn, so the last one is kept', async () => {
    const { agent, kept } = makeAgent()
    await Promise.all([
      saveChatDraft(agent, 'c1', 'a'),
      saveChatDraft(agent, 'c1', 'ab'),
      saveChatDraft(agent, 'c1', 'abc'),
    ])

    await expect(loadChatDraft(agent, 'c1')).resolves.toBe('abc')
    expect(kept.size).toBe(1)
  })

  it('is cleared by an empty or blank composer, as the composer counts a draft', async () => {
    const { agent, kept } = makeAgent()
    await saveChatDraft(agent, 'c1', 'see you')
    await saveChatDraft(agent, 'c1', '  ')

    expect(kept.size).toBe(0)
    await expect(loadChatDraft(agent, 'c1')).resolves.toBeUndefined()
  })

  it('clears without fuss when there is none, and reads nothing it cannot use', async () => {
    const { agent, kept } = makeAgent()
    await expect(clearChatDraft(agent, 'c1')).resolves.toBeUndefined()

    kept.set('chat-draft:c1', { id: 'chat-draft:c1', content: { text: 42 } })
    await expect(loadChatDraft(agent, 'c1')).resolves.toBeUndefined()
  })
})

// Locking unmounts the chat, whose last save starts then, in the same moment it shuts the agent down.
// A room's composer keeps its unsent post in the same store (rooms/useRoomDraft.ts).
describe('a room’s kept draft', () => {
  it('is kept per room, apart from a chat whose id is the same', async () => {
    const { agent, kept } = makeAgent()
    await saveDraft(agent, 'room', 'r1', 'see you thursday')
    await saveChatDraft(agent, 'r1', 'chat words')

    await expect(loadDraft(agent, 'room', 'r1')).resolves.toBe('see you thursday')
    await expect(loadChatDraft(agent, 'r1')).resolves.toBe('chat words')
    expect(kept.get('room-draft:r1')?.tags).toEqual({ type: 'room-draft', roomId: 'r1' })
  })

  it('is cleared by a blank composer, or by clearing it, and the chat’s is left alone', async () => {
    const { agent, kept } = makeAgent()
    await saveDraft(agent, 'room', 'r1', 'see you')
    await saveChatDraft(agent, 'r1', 'chat words')
    await saveDraft(agent, 'room', 'r1', ' ')
    expect(kept.has('room-draft:r1')).toBe(false)
    await saveDraft(agent, 'room', 'r1', 'again')
    await clearDraft(agent, 'room', 'r1')
    await expect(loadDraft(agent, 'room', 'r1')).resolves.toBeUndefined()
    await expect(loadChatDraft(agent, 'r1')).resolves.toBe('chat words')
  })
})

describe('locking waits for a draft still being written', () => {
  // An agent whose next save waits until `land()`.
  const heldSave = () => {
    const made = makeAgent()
    let land: () => void = () => undefined
    made.genericRecords.save.mockImplementationOnce(
      (record: Kept) =>
        new Promise<void>((resolve) => {
          land = () => {
            made.kept.set(record.id, record)
            resolve()
          }
        })
    )
    return { ...made, land: () => land() }
  }
  const settled = async (promise: Promise<unknown>) => {
    let done = false
    void promise.then(() => (done = true))
    for (let i = 0; i < 10; i++) await Promise.resolve()
    return done
  }

  it('waits for nothing when nothing is being written', async () => {
    await expect(settled(flushChatDrafts())).resolves.toBe(true)
  })

  // Drafts' own writes only: a petname or a directory name, written from a sheet on its own lock, has no race with the
  // shutdown, so locking doesn't wait for it. Hoisting the drafts' in-flight set onto the shared lock would widen this.
  it('does not wait for work on another lock', async () => {
    const other = createKeyLock()
    let release: () => void = () => undefined
    const held = other('k', () => new Promise<void>((resolve) => (release = resolve)))
    const shutdown = jest.fn()

    expect(await settled(afterChatDrafts(shutdown))).toBe(true)
    expect(shutdown).toHaveBeenCalledTimes(1)
    release()
    await held
  })

  it('waits for a room’s draft too', async () => {
    const { agent, kept, land } = heldSave()
    void saveDraft(agent, 'room', 'r1', 'last words')
    const shutdown = jest.fn()

    const locking = afterChatDrafts(shutdown)
    expect(await settled(locking)).toBe(false)
    expect(shutdown).not.toHaveBeenCalled()

    land()
    await locking
    expect(shutdown).toHaveBeenCalledTimes(1)
    expect(kept.get('room-draft:r1')?.content.text).toBe('last words')
  })

  it('shuts down only once the last save has landed, and the draft is there', async () => {
    const { agent, kept, land } = heldSave()
    void saveChatDraft(agent, 'c1', 'last words')
    const shutdown = jest.fn()

    const locking = afterChatDrafts(shutdown)
    expect(await settled(locking)).toBe(false)
    expect(shutdown).not.toHaveBeenCalled()

    land()
    await locking
    expect(shutdown).toHaveBeenCalledTimes(1)
    expect(kept.get('chat-draft:c1')?.content.text).toBe('last words')
  })

  it('gives a stuck write its time and no more, and shuts down anyway', async () => {
    const { agent, land } = heldSave()
    void saveChatDraft(agent, 'c1', 'never lands')
    const shutdown = jest.fn()

    // Resolving at all, with the write still stuck, is the timeout working (jest's Date.now is pinned, so no timing).
    await expect(flushChatDrafts(30)).resolves.toBeUndefined()

    const locking = afterChatDrafts(shutdown)
    land() // let it go, so nothing stays in flight for the next test
    await locking
    expect(shutdown).toHaveBeenCalledTimes(1)
  })
})
