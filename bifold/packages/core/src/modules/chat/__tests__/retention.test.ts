import { DidCommBasicMessageRepository } from '@credo-ts/didcomm'
import { act, renderHook } from '@testing-library/react-native'
import { AppState } from 'react-native'

import { defaultState } from '../../../contexts/store'
import { ChatEventRepository } from '../records/ChatEventRepository'
import {
  KEEP_MESSAGES_DEFAULT,
  KEEP_MESSAGES_OPTIONS,
  keepCutoff,
  sweepOldMessages,
  useChatRetentionSweep,
} from '../retention'

jest.mock('react-native-fs', () => ({
  LibraryDirectoryPath: '/lib',
  DocumentDirectoryPath: '/files',
  exists: jest.fn(async () => false),
  readDir: jest.fn(async () => []),
  unlink: jest.fn(async () => undefined),
}))

const NOW = new Date('2026-10-25T12:00:00Z')
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000)

type Ev = { id: string; connectionId: string; eventId: string; eventType: string; target?: string; createdAt: Date }
type Basic = { id: string; connectionId: string; createdAt: Date }

function makeAgent(events: Ev[], basic: Basic[]) {
  const store = { events: [...events], basic: [...basic] }
  const remove = <T extends { id: string }>(list: T[], id: string) =>
    list.splice(
      list.findIndex((r) => r.id === id),
      1
    )
  const singletons = new Map<unknown, unknown>([
    [
      ChatEventRepository,
      {
        getAll: async () => [...store.events],
        findByConnection: async (_c: unknown, connectionId: string) =>
          store.events.filter((e) => e.connectionId === connectionId),
        delete: async (_c: unknown, record: Ev) => remove(store.events, record.id),
      },
    ],
    [
      DidCommBasicMessageRepository,
      {
        getAll: async () => [...store.basic],
        findByQuery: async (_c: unknown, q: { connectionId: string }) =>
          store.basic.filter((b) => b.connectionId === q.connectionId),
        delete: async (_c: unknown, record: Basic) => remove(store.basic, record.id),
      },
    ],
  ])
  const container = { isRegistered: (t: unknown) => singletons.has(t), resolve: (t: unknown) => singletons.get(t) }
  const logger = { info: jest.fn(), warn: jest.fn() }
  const agent = { context: {}, config: { logger }, dependencyManager: { container, resolve: container.resolve } }
  return { agent: agent as never, store, logger }
}

const ev = (connectionId: string, eventId: string, eventType: string, createdAt: Date, target?: string): Ev => ({
  id: `rec-${eventId}`,
  connectionId,
  eventId,
  eventType,
  createdAt,
  ...(target ? { target } : {}),
})

const events = [
  ev('conn-1', 'OLD1', 'message', daysAgo(40)),
  ev('conn-1', 'R-OLD1', 'reaction', daysAgo(2), 'OLD1'), // a recent reaction on an old message goes with it
  ev('conn-1', 'NEW1', 'message', daysAgo(5)),
  ev('conn-1', 'T1', 'timer', daysAgo(90)), // a chat's timer is its state, not its history: it stays
  ev('conn-2', 'OLD2', 'message', daysAgo(31)),
  ev('conn-2', 'NEW2', 'message', daysAgo(29)),
]
const basics = [
  { id: 'b-old', connectionId: 'conn-1', createdAt: daysAgo(400) },
  { id: 'b-new', connectionId: 'conn-2', createdAt: daysAgo(1) },
]

describe('Keep messages', () => {
  test('the default is Forever, in the store and in the module, so nothing is deleted unless a shorter period is chosen', () => {
    expect(KEEP_MESSAGES_DEFAULT).toBe('forever')
    expect(defaultState.preferences.keepMessages).toBe('forever')
    expect(KEEP_MESSAGES_OPTIONS).toEqual(['forever', '1y', '6m', '30d'])
  })

  test('the cutoff for each choice; Forever, unset and an unknown stored value delete nothing', () => {
    expect(keepCutoff('30d', NOW)).toEqual(daysAgo(30))
    expect(keepCutoff('6m', NOW)).toEqual(daysAgo(183))
    expect(keepCutoff('1y', NOW)).toEqual(daysAgo(365))
    expect(keepCutoff('forever', NOW)).toBeNull()
    expect(keepCutoff(undefined, NOW)).toBeNull()
    expect(keepCutoff('2w' as never, NOW)).toBeNull()
  })

  test('Forever deletes nothing at all', async () => {
    const { agent, store } = makeAgent(events, basics)
    expect(await sweepOldMessages(agent, 'forever', NOW)).toBe(0)
    expect(store.events).toHaveLength(events.length)
    expect(store.basic).toHaveLength(basics.length)
  })

  test('30 days deletes the older messages of every chat with what hangs off them, and keeps the rest and the timers', async () => {
    const { agent, store } = makeAgent(events, basics)
    expect(await sweepOldMessages(agent, '30d', NOW)).toBe(3)
    expect(store.events.map((e) => e.eventId)).toEqual(['NEW1', 'T1', 'NEW2'])
    expect(store.basic.map((b) => b.id)).toEqual(['b-new'])
  })

  describe('the sweep, as the app runs it', () => {
    let onChange: ((state: string) => void) | undefined
    beforeEach(() => {
      jest.spyOn(AppState, 'addEventListener').mockImplementation(((_type: string, handler: (s: string) => void) => {
        onChange = handler
        return { remove: jest.fn() }
      }) as never)
    })
    afterEach(() => jest.restoreAllMocks())

    test('runs once unlocked and again on each return to the foreground', async () => {
      const { agent, store } = makeAgent(events, basics)
      renderHook(() => useChatRetentionSweep(agent, '30d'))
      await act(async () => {})
      expect(store.events.map((e) => e.eventId)).toEqual(['NEW1', 'T1', 'NEW2'])

      store.events.push(ev('conn-1', 'AGED', 'message', daysAgo(45)))
      await act(async () => {
        onChange?.('background')
      })
      expect(store.events.map((e) => e.eventId)).toContain('AGED')
      await act(async () => {
        onChange?.('active')
      })
      expect(store.events.map((e) => e.eventId)).not.toContain('AGED')
    })

    test('with Forever it never touches the store', async () => {
      const { agent, store } = makeAgent(events, basics)
      renderHook(() => useChatRetentionSweep(agent, 'forever'))
      await act(async () => {
        onChange?.('active')
      })
      expect(store.events).toHaveLength(events.length)
      expect(store.basic).toHaveLength(basics.length)
    })

    test('a failing sweep is logged, not thrown into the app', async () => {
      const { agent, logger } = makeAgent(events, basics)
      ;(agent as never as { dependencyManager: { resolve: (t: unknown) => any } }).dependencyManager.resolve(
        DidCommBasicMessageRepository
      ).getAll = async () => {
        throw new Error('the store could not be read')
      }
      renderHook(() => useChatRetentionSweep(agent, '30d'))
      await act(async () => {})
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('the store could not be read'))
    })
  })
})
