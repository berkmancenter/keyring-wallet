import { DidCommBasicMessageRepository } from '@credo-ts/didcomm'
import { Platform } from 'react-native'

import { chatMediaFolder, deleteChatMessages } from '../history'
import { ChatEventRepository } from '../records/ChatEventRepository'

let mockFiles: Set<string>
jest.mock('react-native-fs', () => ({
  LibraryDirectoryPath: '/lib',
  DocumentDirectoryPath: '/files',
  exists: jest.fn(async (p: string) => [...mockFiles].some((f) => f === p || f.startsWith(`${p}/`))),
  readDir: jest.fn(async (dir: string) =>
    [...mockFiles]
      .filter((f) => f.startsWith(`${dir}/`) && !f.slice(dir.length + 1).includes('/'))
      .map((f) => ({ name: f.slice(dir.length + 1), path: f }))
  ),
  unlink: jest.fn(async (p: string) => {
    for (const f of [...mockFiles]) if (f === p || f.startsWith(`${p}/`)) mockFiles.delete(f)
  }),
}))

type Ev = {
  id: string
  connectionId: string
  role: 'sent' | 'received'
  eventId: string
  eventType: string
  target?: string
}
type Basic = { id: string; connectionId: string }

const notFound = () => Object.assign(new Error('gone'), { name: 'RecordNotFoundError' })

function makeAgent(events: Ev[], basic: Basic[], { failOn, drafts = [] }: { failOn?: string; drafts?: string[] } = {}) {
  const store = { events: [...events], basic: [...basic] }
  // Unsent drafts (chat/draft.ts), by the generic record id the store gives each chat's draft.
  const draftRecords = new Map(
    drafts.map((connectionId) => [
      `chat-draft:${connectionId}`,
      { id: `chat-draft:${connectionId}`, content: { text: 'unsent' } },
    ])
  )
  const deletedEvents: { connectionId: string }[] = []
  const remove = <T extends { id: string }>(list: T[], id: string) => {
    if (id === failOn) throw new Error('the store could not be written')
    const i = list.findIndex((r) => r.id === id)
    if (i < 0) throw notFound()
    list.splice(i, 1)
  }
  const singletons = new Map<unknown, unknown>([
    [
      ChatEventRepository,
      {
        findByConnection: async (_ctx: unknown, connectionId: string) =>
          store.events.filter((e) => e.connectionId === connectionId),
        delete: async (_ctx: unknown, record: Ev) => {
          remove(store.events, record.id)
          deletedEvents.push(record)
        },
      },
    ],
    [
      DidCommBasicMessageRepository,
      {
        findByQuery: async (_ctx: unknown, q: { connectionId: string }) =>
          store.basic.filter((b) => b.connectionId === q.connectionId),
        delete: async (_ctx: unknown, record: Basic) => {
          remove(store.basic, record.id)
          deletedEvents.push(record)
        },
      },
    ],
  ])
  const container = { isRegistered: (t: unknown) => singletons.has(t), resolve: (t: unknown) => singletons.get(t) }
  const genericRecords = {
    findById: async (id: string) => draftRecords.get(id) ?? null,
    delete: async (record: { id: string }) => void draftRecords.delete(record.id),
  }
  const agent = { context: {}, dependencyManager: { container, resolve: container.resolve }, genericRecords }
  return { agent: agent as never, store, deletedEvents, draftRecords }
}

const ev = (
  connectionId: string,
  eventId: string,
  eventType: string,
  target?: string,
  role: Ev['role'] = 'received'
): Ev => ({
  id: `rec-${role}-${eventId}`,
  connectionId,
  role,
  eventId,
  eventType,
  ...(target ? { target } : {}),
})

// One chat with two messages, each with a reaction; the first reaction was later removed (a redaction of it).
const chat = [
  ev('conn-1', 'M1', 'message'),
  ev('conn-1', 'R1', 'reaction', 'M1'),
  ev('conn-1', 'X1', 'redaction', 'R1'),
  ev('conn-1', 'M2', 'message'),
  ev('conn-1', 'R2', 'reaction', 'M2'),
  ev('conn-2', 'N1', 'message'),
]
const basics = [
  { id: 'b1', connectionId: 'conn-1' },
  { id: 'b2', connectionId: 'conn-1' },
  { id: 'b3', connectionId: 'conn-2' },
]

describe('chat history on this phone', () => {
  const ios = Platform.OS
  beforeEach(() => {
    Platform.OS = 'ios'
    mockFiles = new Set([
      '/lib/Application Support/chat-media/conn-1/M1.jpg',
      '/lib/Application Support/chat-media/conn-1/M2.gif',
      '/lib/Application Support/chat-media/conn-2/N1.jpg',
    ])
  })
  afterAll(() => {
    Platform.OS = ios
  })

  test('the media folder is app-private: Application Support on iOS, the files directory on Android', () => {
    expect(chatMediaFolder('conn-1')).toBe('/lib/Application Support/chat-media/conn-1')
    Platform.OS = 'android'
    expect(chatMediaFolder('conn-1')).toBe('/files/chat-media/conn-1')
  })

  test('Clear chat removes every message, event and media file of that chat, and nothing of another', async () => {
    const { agent, store, deletedEvents } = makeAgent(chat, basics)
    await deleteChatMessages(agent, 'conn-1')
    // Each delete went through the repository with the whole record, so whoever follows RecordDeleted knows the chat.
    expect(deletedEvents.map((r) => r.connectionId)).toEqual(Array(7).fill('conn-1'))
    expect(store.events.map((e) => e.eventId)).toEqual(['N1'])
    expect(store.basic.map((b) => b.id)).toEqual(['b3'])
    expect([...mockFiles]).toEqual(['/lib/Application Support/chat-media/conn-2/N1.jpg'])
  })

  test('Delete for me removes the message, its reactions, their redactions and its media file, and nothing else', async () => {
    const { agent, store } = makeAgent(chat, basics)
    await deleteChatMessages(agent, 'conn-1', { events: [{ role: 'received', eventId: 'M1' }] })
    expect(store.events.map((e) => e.eventId)).toEqual(['M2', 'R2', 'N1'])
    expect(store.basic).toHaveLength(3)
    expect([...mockFiles].sort()).toEqual([
      '/lib/Application Support/chat-media/conn-1/M2.gif',
      '/lib/Application Support/chat-media/conn-2/N1.jpg',
    ])
  })

  test("a received event reusing a sent eventId is deleted alone: the peer's copy never takes this phone's", async () => {
    // Inbound refuses such a pair now (#582), but a phone may already hold one. Each side has a reaction from the
    // other phone, and the shared name has one media file.
    const collided = [
      ev('conn-1', 'M1', 'message', undefined, 'sent'),
      ev('conn-1', 'R9', 'reaction', 'M1', 'received'),
      ev('conn-1', 'M1', 'message', undefined, 'received'),
    ]
    const { agent, store } = makeAgent(collided, [])
    await deleteChatMessages(agent, 'conn-1', { events: [{ role: 'received', eventId: 'M1' }] })
    // This phone's own message stays, with its media file. Following targets stays role-blind (a peer's reaction
    // targets a message this phone sent), so the reaction naming M1 goes with the deleted one.
    expect(store.events.map((e) => `${e.role} ${e.eventId}`)).toEqual(['sent M1'])
    expect(mockFiles.has('/lib/Application Support/chat-media/conn-1/M1.jpg')).toBe(true)
  })

  test("a peer's reaction to this phone's message goes with it: targets are followed whoever sent them", async () => {
    const { agent, store } = makeAgent(
      [ev('conn-1', 'M1', 'message', undefined, 'sent'), ev('conn-1', 'R1', 'reaction', 'M1', 'received')],
      []
    )
    await deleteChatMessages(agent, 'conn-1', { events: [{ role: 'sent', eventId: 'M1' }] })
    expect(store.events).toEqual([])
    expect(mockFiles.has('/lib/Application Support/chat-media/conn-1/M1.jpg')).toBe(false)
  })

  test('Delete for me on a plain BasicMessage removes only that record', async () => {
    const { agent, store } = makeAgent(chat, basics)
    await deleteChatMessages(agent, 'conn-1', { basicMessageIds: ['b2'] })
    expect(store.basic.map((b) => b.id)).toEqual(['b1', 'b3'])
    expect(store.events).toHaveLength(chat.length)
    expect(mockFiles.size).toBe(3)
  })

  test('ids that belong to another chat are ignored: a deletion never reaches past its own connection', async () => {
    const { agent, store } = makeAgent(chat, basics)
    await deleteChatMessages(agent, 'conn-1', {
      events: [{ role: 'received', eventId: 'N1' }],
      basicMessageIds: ['b3'],
    })
    expect(store.events).toHaveLength(chat.length)
    expect(store.basic).toHaveLength(3)
    expect(mockFiles.size).toBe(3)
  })

  test('Clear chat forgets the chat’s unsent draft too, and not another chat’s', async () => {
    const { agent, draftRecords } = makeAgent([], [], { drafts: ['c1', 'c2'] })

    await deleteChatMessages(agent, 'c1')

    expect([...draftRecords.keys()]).toEqual(['chat-draft:c2'])
  })

  // A draft has not been sent, so no timer runs on it: the expiry sweep deletes through this same path (expiry.ts),
  // and a draft in a disappearing-messages chat stays until it is sent, emptied or the whole chat is cleared.
  test('a draft that cannot be removed fails Clear chat before any message is gone', async () => {
    const { agent, store } = makeAgent([ev('c1', 'E1', 'message')], [{ id: 'b1', connectionId: 'c1' }], {
      drafts: ['c1'],
    })
    const warn = jest.fn()
    const faked = agent as unknown as { genericRecords: { delete: () => Promise<void> }; config: unknown }
    faked.genericRecords.delete = async () => {
      throw new Error('the store could not be written')
    }
    faked.config = { logger: { warn } }

    await expect(deleteChatMessages(agent, 'c1')).rejects.toThrow('the store could not be written')
    // The person sees only that the clear failed; the log says why.
    expect(warn).toHaveBeenCalledWith(
      '[Chat:draft] the draft for c1 could not be removed, so nothing was cleared',
      expect.anything()
    )

    expect(store.events).toHaveLength(1)
    expect(store.basic).toHaveLength(1)
  })

  test('Delete for me, and so the timer’s expiry sweep, leaves the draft alone', async () => {
    const { agent, draftRecords } = makeAgent([ev('c1', 'E1', 'message')], [], { drafts: ['c1'] })

    await deleteChatMessages(agent, 'c1', { events: [{ role: 'received', eventId: 'E1' }] })

    expect([...draftRecords.keys()]).toEqual(['chat-draft:c1'])
  })

  test('a record already gone is not a failure, and a chat with no media folder clears cleanly', async () => {
    const { agent, store } = makeAgent(chat, basics)
    const repository = (
      agent as never as { dependencyManager: { resolve: (t: unknown) => any } }
    ).dependencyManager.resolve(ChatEventRepository)
    const original = repository.delete
    repository.delete = async (ctx: unknown, record: Ev) => {
      if (record.id === 'rec-received-R1') throw notFound()
      return original(ctx, record)
    }
    mockFiles = new Set()
    await expect(deleteChatMessages(agent, 'conn-1')).resolves.toBeUndefined()
    expect(store.events.map((e) => e.eventId)).toEqual(['R1', 'N1'])
  })

  test("a clear completes when forgetting the chat's expired ids fails: that is housekeeping, not the deletion", async () => {
    const { PersistentStorage } = jest.requireActual('../../../services/storage')
    jest.spyOn(PersistentStorage, 'removeValueForKey').mockRejectedValueOnce(new Error('storage unavailable'))
    const { agent, store } = makeAgent(chat, basics)
    await expect(deleteChatMessages(agent, 'conn-1')).resolves.toBeUndefined()
    expect(store.events.map((e) => e.eventId)).toEqual(['N1'])
    expect([...mockFiles]).toEqual(['/lib/Application Support/chat-media/conn-2/N1.jpg'])
    expect(PersistentStorage.removeValueForKey).toHaveBeenCalledWith('chat/expired/conn-1')
  })

  test('a store that cannot be written is a failure, so the caller does not report success', async () => {
    const { agent } = makeAgent(chat, basics, { failOn: 'rec-received-M2' })
    await expect(deleteChatMessages(agent, 'conn-1')).rejects.toThrow('the store could not be written')
  })
})
