/**
 * The expiry sweep, with the clock moved: a due message goes with its reactions and media file and is remembered as
 * expired; one not yet due stays; a received message's clock starts at display or, as the backstop, at its seen
 * time; one never shown nor seen is never deleted by its timer.
 */
import { DidCommBasicMessageRepository } from '@credo-ts/didcomm'
import { act, renderHook } from '@testing-library/react-native'
import { AppState } from 'react-native'

import { expiredIds } from '../expired'
import { EXPIRY_SWEEP_INTERVAL_MS, sweepExpired, useChatExpirySweep } from '../expiry'
import { ChatEventRecord } from '../records/ChatEventRecord'
import { ChatEventRepository } from '../records/ChatEventRepository'

let mockFiles: Set<string>
jest.mock('react-native-fs', () => ({
  LibraryDirectoryPath: '/lib',
  DocumentDirectoryPath: '/files',
  exists: jest.fn(async (p: string) => [...mockFiles].some((f) => f === p || f.startsWith(`${p}/`))),
  readDir: jest.fn(async (dir: string) =>
    [...mockFiles].filter((f) => f.startsWith(`${dir}/`)).map((f) => ({ name: f.slice(dir.length + 1), path: f }))
  ),
  unlink: jest.fn(async (p: string) => {
    for (const f of [...mockFiles]) if (f === p || f.startsWith(`${p}/`)) mockFiles.delete(f)
  }),
}))
const mockStore = new Map<string, unknown>()
jest.mock('../../../services/storage', () => ({
  PersistentStorage: {
    fetchValueForKey: async (k: string) => mockStore.get(k),
    storeValueForKey: async (k: string, v: unknown) => void mockStore.set(k, v),
    removeValueForKey: async (k: string) => void mockStore.delete(k),
  },
}))

const T0 = new Date('2026-10-25T12:00:00.000Z').getTime()
const HOUR = 3600
const at = (ms: number) => new Date(T0 + ms)
const min = (n: number) => n * 60 * 1000

let events: ChatEventRecord[]
const logger = { info: jest.fn(), warn: jest.fn() }
const repository = {
  getAll: async () => [...events],
  findByConnection: async (_c: unknown, cid: string) => events.filter((e) => e.connectionId === cid),
  update: jest.fn(async () => undefined),
  delete: async (_c: unknown, record: ChatEventRecord) => {
    events = events.filter((e) => e !== record)
  },
}
const singletons = new Map<unknown, unknown>([
  [ChatEventRepository, repository],
  [DidCommBasicMessageRepository, { findByQuery: async () => [], delete: async () => undefined }],
])
const container = { isRegistered: (t: unknown) => singletons.has(t), resolve: (t: unknown) => singletons.get(t) }
const agent = { context: {}, config: { logger }, dependencyManager: { container, resolve: container.resolve } } as never

const message = (eventId: string, role: 'sent' | 'received', props: Partial<ChatEventRecord> = {}) =>
  Object.assign(
    new ChatEventRecord({
      connectionId: 'c1',
      role,
      eventId,
      eventType: 'message',
      content: { format: 'text/plain', text: eventId },
    }),
    props
  )
const reaction = (eventId: string, target: string) =>
  new ChatEventRecord({ connectionId: 'c1', role: 'received', eventId, eventType: 'reaction', target, emoji: '👍' })
const ids = () => events.map((e) => e.eventId)

beforeEach(() => {
  events = []
  mockStore.clear()
  mockFiles = new Set()
  jest.clearAllMocks()
  jest.useFakeTimers({ now: T0 })
})
afterEach(() => jest.useRealTimers())

describe('the expiry sweep', () => {
  test('a message goes when its time comes, with its reaction and media file, and not a moment before', async () => {
    events = [
      message('DUE', 'sent', { expiresIn: HOUR, expiresAt: at(min(60)) }),
      reaction('R-DUE', 'DUE'),
      message('LATER', 'sent', { expiresIn: 2 * HOUR, expiresAt: at(min(120)) }),
    ]
    mockFiles.add('/lib/Application Support/chat-media/c1/DUE.jpg')
    mockFiles.add('/lib/Application Support/chat-media/c1/LATER.jpg')

    expect(await sweepExpired(agent, at(min(59)))).toBe(0)
    expect(ids()).toEqual(['DUE', 'R-DUE', 'LATER'])

    expect(await sweepExpired(agent, at(min(61)))).toBe(1)
    expect(ids()).toEqual(['LATER']) // the control, not yet due, stays
    expect([...mockFiles]).toEqual(['/lib/Application Support/chat-media/c1/LATER.jpg'])
    expect(await expiredIds(agent, 'c1')).toEqual(new Set(['DUE']))
  })

  test('backstop: a received message never reported shown but marked seen starts its clock at the seen time', async () => {
    const m = message('SEEN', 'received', { expiresIn: HOUR })
    m.metadata.set('_keyring/chatSeen', { at: at(0).toISOString() })
    events = [m]

    expect(await sweepExpired(agent, at(min(30)))).toBe(0)
    expect(m.expiresAt).toEqual(at(min(60)))
    expect(repository.update).toHaveBeenCalledWith(expect.anything(), m)

    expect(await sweepExpired(agent, at(min(61)))).toBe(1)
    expect(ids()).toEqual([])
  })

  test('a record the other sweep deleted meanwhile is not a failure: this sweep goes on and deletes what is due', async () => {
    const gone = message('GONE', 'received', { expiresIn: HOUR })
    gone.metadata.set('_keyring/chatSeen', { at: at(0).toISOString() })
    events = [gone, message('DUE', 'sent', { expiresIn: HOUR, expiresAt: at(min(10)) })]
    repository.update.mockRejectedValueOnce(Object.assign(new Error('gone'), { name: 'RecordNotFoundError' }))
    await expect(sweepExpired(agent, at(min(20)))).resolves.toBe(1)
    expect(ids()).toEqual(['GONE'])
  })

  test('a store that cannot be written still fails the sweep, so it is logged and retried', async () => {
    const m = message('SEEN', 'received', { expiresIn: HOUR })
    m.metadata.set('_keyring/chatSeen', { at: at(0).toISOString() })
    events = [m]
    repository.update.mockRejectedValueOnce(new Error('the store could not be written'))
    await expect(sweepExpired(agent, at(min(20)))).rejects.toThrow('could not be written')
  })

  test('a received timed message neither shown nor seen is never deleted by its timer, however old', async () => {
    events = [message('UNREAD', 'received', { expiresIn: HOUR })]
    expect(await sweepExpired(agent, at(min(60 * 24 * 7 * 10)))).toBe(0)
    expect(ids()).toEqual(['UNREAD'])
    expect(repository.update).not.toHaveBeenCalled()
  })

  test('a message with no timer is never deleted', async () => {
    const plain = message('PLAIN', 'received')
    plain.metadata.set('_keyring/chatSeen', { at: at(0).toISOString() })
    events = [plain, message('MINE', 'sent')]
    expect(await sweepExpired(agent, at(min(60 * 24 * 365)))).toBe(0)
    expect(ids()).toEqual(['PLAIN', 'MINE'])
  })
})

describe('the sweep, as the app runs it', () => {
  let onChange: ((state: string) => void) | undefined
  beforeEach(() => {
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((_t: string, h: (s: string) => void) => {
      onChange = h
      return { remove: jest.fn() }
    }) as never)
  })
  afterEach(() => jest.restoreAllMocks())

  test('runs once unlocked, every interval in the foreground, not in the background, and again on return', async () => {
    events = [message('A', 'sent', { expiresIn: HOUR, expiresAt: at(min(1)) })]
    renderHook(() => useChatExpirySweep(agent))
    await act(async () => {})
    expect(ids()).toEqual(['A']) // not due yet at T0

    await act(async () => {
      jest.advanceTimersByTime(EXPIRY_SWEEP_INTERVAL_MS + 1000) // T0 + 61 s: due, swept by the interval
    })
    expect(ids()).toEqual([])

    events = [message('B', 'sent', { expiresIn: HOUR, expiresAt: at(min(3)) })]
    await act(async () => {
      onChange?.('background')
      jest.advanceTimersByTime(min(5)) // due while in the background: no sweep runs
    })
    expect(ids()).toEqual(['B'])
    await act(async () => {
      onChange?.('active')
    })
    expect(ids()).toEqual([])
  })

  test('a failing sweep is logged, not thrown into the app', async () => {
    jest.spyOn(repository, 'getAll').mockRejectedValueOnce(new Error('the store could not be read'))
    renderHook(() => useChatExpirySweep(agent))
    await act(async () => {})
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('the store could not be read'))
  })
})
