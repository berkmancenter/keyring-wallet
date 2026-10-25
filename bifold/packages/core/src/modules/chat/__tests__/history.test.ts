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

type Ev = { id: string; connectionId: string; eventId: string; eventType: string; target?: string }
type Basic = { id: string; connectionId: string }

const notFound = () => Object.assign(new Error('gone'), { name: 'RecordNotFoundError' })

function makeAgent(events: Ev[], basic: Basic[], { failOn }: { failOn?: string } = {}) {
  const store = { events: [...events], basic: [...basic] }
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
  const agent = { context: {}, dependencyManager: { container, resolve: container.resolve } }
  return { agent: agent as never, store, deletedEvents }
}

const ev = (connectionId: string, eventId: string, eventType: string, target?: string): Ev => ({
  id: `rec-${eventId}`,
  connectionId,
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
    await deleteChatMessages(agent, 'conn-1', { eventIds: ['M1'] })
    expect(store.events.map((e) => e.eventId)).toEqual(['M2', 'R2', 'N1'])
    expect(store.basic).toHaveLength(3)
    expect([...mockFiles].sort()).toEqual([
      '/lib/Application Support/chat-media/conn-1/M2.gif',
      '/lib/Application Support/chat-media/conn-2/N1.jpg',
    ])
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
    await deleteChatMessages(agent, 'conn-1', { eventIds: ['N1'], basicMessageIds: ['b3'] })
    expect(store.events).toHaveLength(chat.length)
    expect(store.basic).toHaveLength(3)
    expect(mockFiles.size).toBe(3)
  })

  test('a record already gone is not a failure, and a chat with no media folder clears cleanly', async () => {
    const { agent, store } = makeAgent(chat, basics)
    const repository = (
      agent as never as { dependencyManager: { resolve: (t: unknown) => any } }
    ).dependencyManager.resolve(ChatEventRepository)
    const original = repository.delete
    repository.delete = async (ctx: unknown, record: Ev) => {
      if (record.id === 'rec-R1') throw notFound()
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
    const { agent } = makeAgent(chat, basics, { failOn: 'rec-M2' })
    await expect(deleteChatMessages(agent, 'conn-1')).rejects.toThrow('the store could not be written')
  })
})
