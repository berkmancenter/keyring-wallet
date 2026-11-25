/**
 * A read of every room reads up to ROWS_READ_TOGETHER rooms at once, the agent's read lane's size, rather than one after
 * another: on 281.2 four rooms took 26 s and every row read until its turn came (IN-724). The room open on screen is
 * read first, then the most recently active. Each row stops reading the moment its own room's read ends, whether the
 * listing that asked it was partial or whole.
 */
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useFocusEffect } from '@react-navigation/native'
import { act, renderHook } from '@testing-library/react-native'
import { AppState } from 'react-native'

import { newEventId } from '../../chat/eventId'
import { toInertText } from '../inertText'
import { ROOMS_PARTIAL_LISTING } from '../partialListingSwitch'
import { chatMessageBody } from '../roomPosts'
import { ROOMS_ROWS_TOGETHER, ROWS_READ_TOGETHER } from '../rowsTogetherSwitch'
import type { Note, NoteList, NoteSummary, RoomsService, RoomSummary } from '../types'
import {
  refreshRoomRows,
  resetRoomRows,
  ROOMS_HIDDEN_KEY,
  ROOMS_SEEN_KEY,
  useRoomRows,
  useRoomRowsPoll,
} from '../useRoomRows'

jest.mock('../../trust-tasks/module/vtaAgent', () => ({
  vtaAgent: { subscribe: () => () => undefined, getState: () => ({}) },
}))

const ME = { did: 'did:key:z6MkMe' }
const SAM = { did: 'did:key:z6MkSaddle', identityWords: 'Sam' }
const LAB = 'did:webvh:QmLab:lab.example'
const room = (roomId: string): RoomSummary => ({
  roomId,
  name: toInertText(roomId),
  nameFrom: 'community',
  source: 'community',
  communityDid: LAB,
  communityName: toInertText('Keyring Lab'),
  tier: 'open',
  standing: 'member',
})
/** A room's one post, `minute` minutes into the day: what orders the rows by activity. */
const note = (roomId: string, minute: number): NoteSummary => ({
  key: `${roomId}-1`,
  version: 1,
  author: SAM,
  updatedAt: new Date(Date.UTC(2026, 10, 25, 9, minute)).toISOString(),
  status: 'active',
  pinned: false,
})

/**
 * Rooms whose listings each wait until the test answers them (`answer(roomId)`), in the order asked (`asked()`). The
 * rooms listing ends at once, or, with `partial`, says its first rooms early and ends when the test says (`end`).
 */
function rooms(ids: string[], options: { minutes?: Record<string, number>; partial?: string[] } = {}) {
  const held = new Map<string, () => void>()
  let end: (() => void) | undefined
  const inView = new Set<string>()
  const answerOf = (roomId: string): NoteList => ({
    notes: [note(roomId, options.minutes?.[roomId] ?? 0)],
    complete: true,
    check: { verdict: 'consistent', detail: '' },
  })
  const service = {
    isSample: false,
    listMyRooms: jest.fn(
      (o: { onPartial?: (rooms: RoomSummary[], answered: readonly string[]) => void } = {}) =>
        new Promise<RoomSummary[]>((resolve) => {
          if (!options.partial) return resolve(ids.map(room))
          o.onPartial?.(options.partial.map(room), [LAB])
          end = () => resolve(ids.map(room))
        })
    ),
    getRoom: jest.fn(async (roomId: string) => ({ ...room(roomId), actingAs: ME })),
    listNotes: jest.fn(
      (roomId: string) => new Promise<NoteList>((resolve) => held.set(roomId, () => resolve(answerOf(roomId))))
    ),
    readNote: jest.fn(
      async (roomId: string): Promise<Note> => ({
        ...note(roomId, options.minutes?.[roomId] ?? 0),
        body: toInertText(chatMessageBody(`${roomId} words`, newEventId(), new Date())),
        flags: { containsLink: false, looksLikeInstruction: false },
        check: { verdict: 'consistent', detail: '' },
      })
    ),
    isRoomInView: (roomId: string) => inView.has(roomId),
  }
  return {
    service: service as unknown as RoomsService,
    asked: () => service.listNotes.mock.calls.map(([roomId]) => roomId as string),
    answer: (roomId: string) => act(async () => held.get(roomId)?.()),
    answerAll: async () => {
      for (const roomId of ids) await act(async () => held.get(roomId)?.())
    },
    end: () => act(async () => end?.()),
    open: (roomId: string) => inView.add(roomId),
  }
}

const flush = async () => {
  for (let i = 0; i < 6; i++) await act(async () => undefined)
}
const mount = async (service: RoomsService) => {
  renderHook(() => useRoomRowsPoll(service, true))
  const list = renderHook(() => useRoomRows())
  await flush()
  return (roomId: string) => list.result.current.rows?.find((r) => r.roomId === roomId)
}

beforeEach(async () => {
  jest.useFakeTimers()
  resetRoomRows()
  await AsyncStorage.setItem(ROOMS_SEEN_KEY, '{}')
  await AsyncStorage.setItem(ROOMS_HIDDEN_KEY, '{}')
  ;(useFocusEffect as jest.Mock).mockImplementation(() => undefined)
  Object.defineProperty(AppState, 'currentState', { value: 'active', writable: true, configurable: true })
  jest.spyOn(AppState, 'addEventListener').mockImplementation((() => ({ remove: jest.fn() })) as never)
})
afterEach(() => {
  ROOMS_ROWS_TOGETHER.on = true
  ROOMS_ROWS_TOGETHER.remoteOff = false
  ROOMS_PARTIAL_LISTING.on = true
  ROOMS_PARTIAL_LISTING.remoteOff = false
  jest.useRealTimers()
  jest.restoreAllMocks()
})

describe('a read of every room', () => {
  test('reads as many rooms at once as the read lane runs, and the next as soon as one ends', async () => {
    expect(ROWS_READ_TOGETHER).toBe(3)
    const r = rooms(['a', 'b', 'c', 'd'])
    const row = await mount(r.service)
    expect(r.asked()).toEqual(['a', 'b', 'c'])
    await r.answer('b')
    await flush()
    expect(r.asked()).toEqual(['a', 'b', 'c', 'd'])
    // Each row stops reading when its own room is read, the others still reading.
    expect(row('b')?.reading).toBeUndefined()
    expect(row('b')?.lastPost?.text).toContain('b words')
    expect(row('a')?.reading).toBe(true)
    expect(row('c')?.reading).toBe(true)
    expect(row('d')?.reading).toBe(true)
  })

  test('reads the room open on screen first', async () => {
    const r = rooms(['a', 'b', 'c', 'd'])
    r.open('d')
    await mount(r.service)
    expect(r.asked()[0]).toBe('d')
  })

  test('then the most recently active, so the top rows stop reading first', async () => {
    const r = rooms(['a', 'b', 'c', 'd'], { minutes: { a: 1, b: 40, c: 20, d: 30 } })
    await mount(r.service)
    await r.answerAll()
    await flush()
    expect(r.asked()).toHaveLength(4)
    await act(async () => refreshRoomRows())
    await flush()
    // The second read, by each room's newest post: b (9:40), d (9:30), c (9:20); a (9:01) once one ends.
    expect(r.asked().slice(4)).toEqual(['b', 'd', 'c'])
  })

  test('rooms nobody is looking at and nothing known of are read as listed', async () => {
    const r = rooms(['a', 'b', 'c', 'd'])
    await mount(r.service)
    expect(r.asked()).toEqual(['a', 'b', 'c'])
  })
})

describe('rooms read together, each met for the first time', () => {
  test("keep every room's seen mark, whatever order the storage finishes its writes in", async () => {
    const real = AsyncStorage.setItem.bind(AsyncStorage)
    let release: (() => void) | undefined
    let seenWrites = 0
    jest.spyOn(AsyncStorage, 'setItem').mockImplementation(async (key: string, value: string) => {
      if (key === ROOMS_SEEN_KEY && ++seenWrites === 1) await new Promise<void>((go) => (release = go))
      return real(key, value)
    })
    const r = rooms(['a', 'b', 'c'])
    await mount(r.service)
    expect(r.asked()).toEqual(['a', 'b', 'c'])
    // a's mark is being written, slowly; b's and c's are asked meanwhile.
    await r.answer('a')
    await flush()
    await r.answer('b')
    await flush()
    await r.answer('c')
    await flush()
    await act(async () => release?.())
    await flush()
    const kept = JSON.parse((await AsyncStorage.getItem(ROOMS_SEEN_KEY)) ?? '{}')
    expect(Object.keys(kept)).toHaveLength(3)
  })
})

describe('switched off (rooms/rowsTogetherSwitch), every room is read one after another as listed, as before', () => {
  test.each([
    ['remoteOff, whatever on says', { on: true, remoteOff: true }],
    ['on false', { on: false, remoteOff: false }],
  ])('%s', async (_name, value) => {
    Object.assign(ROOMS_ROWS_TOGETHER, value)
    const r = rooms(['a', 'b', 'c', 'd'])
    r.open('d')
    const row = await mount(r.service)
    // The room on screen is not put first, and the next room waits for the last.
    expect(r.asked()).toEqual(['a'])
    await r.answer('a')
    await flush()
    expect(row('a')?.reading).toBeUndefined()
    expect(r.asked()).toEqual(['a', 'b'])
    await r.answer('b')
    await flush()
    expect(r.asked()).toEqual(['a', 'b', 'c'])
  })

  test('a partial listing too', async () => {
    ROOMS_ROWS_TOGETHER.remoteOff = true
    const r = rooms(['a', 'b', 'c'], { partial: ['a', 'b'] })
    await mount(r.service)
    expect(r.asked()).toEqual(['a'])
  })
})

describe('a partial listing', () => {
  test("a room read for a partial answer is drawn as soon as it ends after the listing did, the others' reads in flight", async () => {
    const r = rooms(['a', 'b', 'c'], { partial: ['a', 'b'] })
    const row = await mount(r.service)
    expect(r.asked()).toEqual(['a', 'b'])
    await r.end()
    await flush()
    await r.answer('a')
    await flush()
    expect(row('a')?.reading).toBeUndefined()
    expect(row('b')?.reading).toBe(true)
    // c waits for the partial reads to end: never two reads of one room.
    expect(r.asked()).toEqual(['a', 'b'])
    await r.answer('b')
    await flush()
    expect(r.asked()).toEqual(['a', 'b', 'c'])
  })
})
