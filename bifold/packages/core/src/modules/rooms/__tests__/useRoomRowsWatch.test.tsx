/**
 * Messages' rooms watched at their hosts (live delivery, L2): the most recently active, while Messages is in view; a
 * signal reads that row alone and arms it again; nothing changes where nothing can watch.
 *
 * (Harness as in useRoomRows.test.tsx.)
 * Rooms as Messages rows: each room the member holds, with its newest post (who and what), when, and the posts by
 * others after the newest one the member has seen. A room met for the first time starts seen; the member's own posts
 * never count; what the room screen shows is seen, and stays seen after a relaunch. The rooms are read by one poll,
 * gently: each room asked only for what is new, its newest post read only when it changed, every two minutes only
 * while Messages is in view, and at once when the agent is back or a skipped community can be read. Messages' badge
 * adds the rows' unread.
 */
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useFocusEffect } from '@react-navigation/native'
import { act, renderHook } from '@testing-library/react-native'
import { AppState } from 'react-native'

import { newEventId } from '../../chat/eventId'
import { toInertText } from '../inertText'
import { chatMessageBody } from '../roomPosts'
import type { Identity, Note, NoteList, NoteSummary, RoomsService, RoomSummary } from '../types'
import {
  ROOMS_HIDDEN_KEY,
  resetRoomRows,
  ROOMS_SEEN_KEY,
  ROWS_WATCHED_MAX,
  refreshRoomRows,
  useRoomRows,
  useRoomRowsPoll,
  useRoomsUnreadCount,
} from '../useRoomRows'

// The agent's session, without the agent: only what the poll is told.
let mockSession: { sessionOpenedAt?: number } = {}
const mockSessionListeners = new Set<() => void>()
jest.mock('../../trust-tasks/module/vtaAgent', () => ({
  vtaAgent: {
    subscribe: (listener: () => void) => {
      mockSessionListeners.add(listener)
      return () => mockSessionListeners.delete(listener)
    },
    getState: () => mockSession,
  },
}))

const ME = { did: 'did:key:z6MkMe' }
const SAM = { did: 'did:key:z6MkSaddle', identityWords: 'Sam' }
const LAB = 'did:webvh:QmLab:lab.example'

const room = (roomId: string, over: Partial<RoomSummary> = {}): RoomSummary => ({
  roomId,
  name: toInertText(roomId),
  nameFrom: 'community',
  source: 'community',
  communityDid: LAB,
  communityName: toInertText('Keyring Lab'),
  tier: 'open',
  standing: 'member',
  ...over,
})
const note = (key: string, version: number, author: Identity = SAM, over: Partial<NoteSummary> = {}): NoteSummary => ({
  key,
  version,
  author,
  updatedAt: new Date(Date.UTC(2026, 9, 30, 9, version)).toISOString(),
  status: 'active',
  pinned: false,
  ...over,
})
const chat = (text: string) => chatMessageBody(text, newEventId(), new Date())

/** A service whose rooms hold `notes`; listNotes honours sinceVersion, as the real one does. */
function serviceWith(rooms: RoomSummary[], notes: Record<string, NoteSummary[]>, bodies: Record<string, string> = {}) {
  const service = {
    isSample: false,
    listMyRooms: jest.fn(async () => rooms),
    getRoom: jest.fn(async (roomId: string) => ({ ...rooms.find((r) => r.roomId === roomId)!, actingAs: ME })),
    listNotes: jest.fn(
      async (roomId: string, options?: { sinceVersion?: number }): Promise<NoteList> => ({
        notes: (notes[roomId] ?? []).filter(
          (n) => options?.sinceVersion === undefined || n.version > options.sinceVersion
        ),
        complete: true,
        check: { verdict: 'consistent', detail: '' },
      })
    ),
    readNote: jest.fn(async (roomId: string, key: string): Promise<Note> => {
      const summary = (notes[roomId] ?? []).find((n) => n.key === key)!
      return {
        ...summary,
        body: toInertText(bodies[key] ?? chat(key)),
        flags: { containsLink: false, looksLikeInstruction: false },
        check: { verdict: 'consistent', detail: '' },
      }
    }),
  }
  return service as unknown as RoomsService & { [K in keyof typeof service]: (typeof service)[K] }
}

let focus: (() => (() => void) | void) | undefined
beforeEach(async () => {
  jest.useFakeTimers()
  resetRoomRows()
  await AsyncStorage.setItem(ROOMS_SEEN_KEY, '{}')
  await AsyncStorage.setItem(ROOMS_HIDDEN_KEY, '{}')
  focus = undefined
  mockSession = {}
  mockSessionListeners.clear()
  ;(useFocusEffect as jest.Mock).mockImplementation((effect: () => (() => void) | void) => {
    focus = effect
  })
  Object.defineProperty(AppState, 'currentState', { value: 'active', writable: true, configurable: true })
  jest.spyOn(AppState, 'addEventListener').mockImplementation((() => ({ remove: jest.fn() })) as never)
})
afterEach(() => {
  jest.useRealTimers()
  jest.restoreAllMocks()
})

const flush = () => act(async () => undefined)
const mount = (service: RoomsService) => {
  const poll = renderHook(() => useRoomRowsPoll(service, true))
  const list = renderHook(() => ({ rows: useRoomRows(), unread: useRoomsUnreadCount() }))
  return { poll, list }
}

/** The service, able to watch: armed rooms recorded, and the agent's signal told to whoever listens. */
function watching(s: ReturnType<typeof serviceWith>) {
  const listeners = new Set<(roomId: string) => void>()
  const watchRoom = jest.fn((_roomId: string, _since: number) => undefined)
  Object.assign(s, {
    watchRoom,
    roomWatched: () => false,
    onRoomChanged: (listener: (roomId: string) => void) => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
  })
  const signal = (roomId: string) =>
    act(async () => {
      for (const l of [...listeners]) l(roomId)
    })
  return { watchRoom, listeners, signal }
}

const inView = () => act(async () => void focus?.())
const armed = (watchRoom: jest.Mock) => watchRoom.mock.calls.map(([roomId, since]) => [roomId, since])

describe("Messages' rooms watched at their hosts", () => {
  test('in view: each room read is armed from the newest version read', async () => {
    const s = serviceWith([room('a'), room('b')], { a: [note('a1', 1), note('a2', 4)], b: [note('b1', 2)] })
    const w = watching(s)
    mount(s)
    await inView()
    await flush()
    expect(armed(w.watchRoom)).toEqual(
      expect.arrayContaining([
        ['a', 4],
        ['b', 2],
      ])
    )
  })

  test('out of view: nothing is armed (control)', async () => {
    const s = serviceWith([room('a')], { a: [note('a1', 1)] })
    const w = watching(s)
    mount(s)
    await flush()
    expect(w.watchRoom).not.toHaveBeenCalled()
  })

  test(`more rooms than ${ROWS_WATCHED_MAX}: only the most recently active are armed`, async () => {
    const count = ROWS_WATCHED_MAX + 5
    const rooms = Array.from({ length: count }, (_, i) => room(`r${i}`))
    // Room r<i>'s only post is at minute i: the higher i, the more recently active.
    const notes = Object.fromEntries(rooms.map((r, i) => [r.roomId, [note(`${r.roomId}n`, i + 1)]]))
    const s = serviceWith(rooms, notes)
    const w = watching(s)
    mount(s)
    await inView()
    await flush()
    const ids = new Set(w.watchRoom.mock.calls.map(([roomId]) => roomId))
    expect(ids.size).toBe(ROWS_WATCHED_MAX)
    for (let i = count - ROWS_WATCHED_MAX; i < count; i++) expect(ids.has(`r${i}`)).toBe(true)
    for (let i = 0; i < count - ROWS_WATCHED_MAX; i++) expect(ids.has(`r${i}`)).toBe(false)
  })

  test('a signal reads that room alone, shows the new post in its row, and arms it again from it', async () => {
    const notes: Record<string, NoteSummary[]> = { a: [note('a1', 1)], b: [note('b1', 2)] }
    const s = serviceWith([room('a'), room('b')], notes, { a2: chat('New in a') })
    const w = watching(s)
    const { list } = mount(s)
    await inView()
    await flush()
    s.listNotes.mockClear()
    notes.a = [...notes.a, note('a2', 3)]
    await w.signal('a')
    await flush()
    expect(s.listNotes.mock.calls.map(([roomId]) => roomId)).toEqual(['a'])
    expect(list.result.current.rows.rows.find((r) => r.roomId === 'a')?.lastPost?.text).toBe('New in a')
    expect(w.watchRoom).toHaveBeenLastCalledWith('a', 3)
  })

  test("a signal while that room's own read is out: read again once it ends", async () => {
    const notes: Record<string, NoteSummary[]> = { a: [note('a1', 1)] }
    const s = serviceWith([room('a')], notes, { a3: chat('Second change') })
    const w = watching(s)
    const { list } = mount(s)
    await inView()
    await flush()
    // The read the first signal starts is held; a second change and its signal land meanwhile.
    let releaseA: () => void = () => undefined
    const real = s.listNotes.getMockImplementation()!
    // It answers with what the room held when it was asked (version 2), as a real read would: the second change is
    // not in it, so only reading the room again can show it.
    s.listNotes.mockImplementationOnce(async (roomId: string, options?: { sinceVersion?: number }) => {
      const asked = real(roomId, options)
      await new Promise<void>((r) => (releaseA = r))
      return asked
    })
    notes.a = [...notes.a, note('a2', 2)]
    await w.signal('a')
    notes.a = [...notes.a, note('a3', 3)]
    await w.signal('a')
    s.listNotes.mockClear()
    await act(async () => releaseA())
    await flush()
    await flush()
    expect(list.result.current.rows.rows.find((r) => r.roomId === 'a')?.lastPost?.text).toBe('Second change')
    expect(w.watchRoom).toHaveBeenLastCalledWith('a', 3)
  })

  test('a signal for a room Messages does not show reads nothing', async () => {
    const s = serviceWith([room('a')], { a: [note('a1', 1)] })
    const w = watching(s)
    mount(s)
    await inView()
    await flush()
    s.listNotes.mockClear()
    await w.signal('did:webvh:room:elsewhere')
    await flush()
    expect(s.listNotes).not.toHaveBeenCalled()
  })

  test('a signal while every room is still being listed: the pass reads it, and it is read alone again once the pass ends', async () => {
    let release: () => void = () => undefined
    const s = serviceWith([room('a')], { a: [note('a1', 1)] })
    const w = watching(s)
    mount(s)
    await inView()
    await flush()
    s.listMyRooms.mockImplementationOnce(() => new Promise((r) => (release = () => r([room('a')]))))
    act(() => refreshRoomRows())
    s.listNotes.mockClear()
    await w.signal('a')
    expect(s.listNotes).not.toHaveBeenCalled()
    await act(async () => release())
    await flush()
    // The pass reads 'a'; the signal kept meanwhile reads it once more after: a read too many, never one too few.
    expect(s.listNotes.mock.calls.map(([roomId]) => roomId)).toEqual(['a', 'a'])
  })

  test('a signal for a room the pass has already read, while it reads the next: the change is read once the pass ends', async () => {
    const notes: Record<string, NoteSummary[]> = { a: [note('a1', 1)], b: [note('b1', 2)] }
    const s = serviceWith([room('a'), room('b')], notes, { a2: chat('New in a') })
    const w = watching(s)
    const { list } = mount(s)
    await inView()
    await flush()
    // The next pass: 'a' is read, then the read of 'b' is held, so the pass is still out.
    let releaseB: () => void = () => undefined
    const real = s.listNotes.getMockImplementation()!
    s.listNotes.mockImplementation(async (roomId: string, options?: { sinceVersion?: number }) => {
      if (roomId === 'b') await new Promise<void>((r) => (releaseB = r))
      return real(roomId, options)
    })
    act(() => refreshRoomRows())
    await flush()
    // 'a' was read at version 1; now it changes, and its signal lands while the pass waits on 'b'.
    notes.a = [...notes.a, note('a2', 3)]
    await w.signal('a')
    await act(async () => releaseB())
    await flush()
    await flush()
    expect(list.result.current.rows.rows.find((r) => r.roomId === 'a')?.lastPost?.text).toBe('New in a')
    expect(w.watchRoom).toHaveBeenLastCalledWith('a', 3)
  })

  test('a service that cannot watch: rows read as before, and no signal is listened for (control)', async () => {
    const s = serviceWith([room('a')], { a: [note('a1', 1)] })
    const { list } = mount(s)
    await inView()
    await flush()
    expect(list.result.current.rows.rows.map((r) => r.roomId)).toEqual(['a'])
  })
})
