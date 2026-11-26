/**
 * A Messages row's first read of a room is a window of its newest ROOM_HEAD_WINDOW records (rooms/newestFirstSwitch),
 * not the whole room. Its unread count is then at most what the window holds: while the member has not seen down to
 * the window's lowest record, records below it after the newest seen were never counted, and the row says "N+"
 * (`unreadMore`). Seeing down to it, or hiding the room, ends that; Undo brings it back. Tested at the window's edge.
 * Off, the first read is the whole room, asked exactly as before, and every count is exact.
 */
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useFocusEffect } from '@react-navigation/native'
import { act, renderHook } from '@testing-library/react-native'
import { AppState } from 'react-native'

import { newEventId } from '../../chat/eventId'
import { toInertText } from '../inertText'
import { windowOf } from '../listingWindow'
import { ROOM_HEAD_WINDOW, ROOMS_NEWEST_FIRST } from '../newestFirstSwitch'
import { chatMessageBody } from '../roomPosts'
import type { Identity, ListNotesOptions, Note, NoteList, NoteSummary, RoomsService, RoomSummary } from '../types'
import {
  hideRoom,
  markRoomSeen,
  resetRoomRows,
  ROOMS_HIDDEN_KEY,
  ROOMS_SEEN_KEY,
  refreshRoomRows,
  useRoomRows,
  useRoomRowsPoll,
  useRoomsUnreadCount,
} from '../useRoomRows'

jest.mock('../../trust-tasks/module/vtaAgent', () => ({
  vtaAgent: { subscribe: () => () => undefined, getState: () => ({}) },
}))

const ME = { did: 'did:key:z6MkMe' }
const SAM = { did: 'did:key:z6MkSaddle', identityWords: 'Sam' }
const LAB = 'did:webvh:QmLab:lab.example'
const ROOM: RoomSummary = {
  roomId: 'planning',
  name: toInertText('planning'),
  nameFrom: 'community',
  source: 'community',
  communityDid: LAB,
  communityName: toInertText('Keyring Lab'),
  tier: 'open',
  standing: 'member',
}
const note = (version: number, author: Identity = SAM): NoteSummary => ({
  key: `n${version}`,
  version,
  author,
  updatedAt: new Date(Date.UTC(2026, 10, 20, 9, 0, version)).toISOString(),
  status: 'active',
  pinned: false,
})

/** The room's records, listed as the real service lists them: from a version, whole, or a window. */
function serviceWith(records: NoteSummary[]) {
  const service = {
    isSample: false,
    listMyRooms: jest.fn(async () => [ROOM]),
    getRoom: jest.fn(async () => ({ ...ROOM, actingAs: ME })),
    listNotes: jest.fn(async (_roomId: string, o?: ListNotesOptions): Promise<NoteList> => {
      const all = { notes: [...records], complete: true, check: { verdict: 'consistent' as const, detail: '' } }
      if (o?.head !== undefined) return windowOf(all, o.head, o.beforeVersion)
      return { ...all, notes: all.notes.filter((n) => o?.sinceVersion === undefined || n.version > o.sinceVersion) }
    }),
    readNote: jest.fn(
      async (_roomId: string, key: string): Promise<Note> => ({
        ...records.find((n) => n.key === key)!,
        body: toInertText(chatMessageBody(key, newEventId(), new Date())),
        flags: { containsLink: false, looksLikeInstruction: false },
        check: { verdict: 'consistent', detail: '' },
      })
    ),
  }
  return service as unknown as RoomsService & { listNotes: jest.Mock }
}

const flush = () => act(async () => undefined)
const mount = (service: RoomsService) => {
  const poll = renderHook(() => useRoomRowsPoll(service, true))
  const list = renderHook(() => ({ rows: useRoomRows(), unread: useRoomsUnreadCount() }))
  return { poll, list }
}

/**
 * The room as Messages meets it after a relaunch: the member saw it up to n1 before, and `fresh` posts by others came
 * since. The kept seen is read back, so only those count.
 */
async function reopenedWith(fresh: number) {
  const records = [note(1)]
  const s = serviceWith(records)
  const first = mount(s)
  await flush()
  first.poll.unmount()
  first.list.unmount()
  resetRoomRows()
  for (let v = 2; v <= fresh + 1; v++) records.push(note(v))
  s.listNotes.mockClear()
  const again = mount(s)
  await flush()
  return { s, list: again.list, row: () => again.list.result.current.rows.rows[0] }
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
  ROOMS_NEWEST_FIRST.on = true
  ROOMS_NEWEST_FIRST.remoteOff = false
  jest.useRealTimers()
  jest.restoreAllMocks()
})

describe("a Messages row's first read, newest first", () => {
  // The window's edge. 59 new: all in the window. 60 new: the window holds them all, and only n1, seen, lies below.
  // 61 new: one below the window may be unread, so the count is a floor.
  test.each([
    [ROOM_HEAD_WINDOW - 1, ROOM_HEAD_WINDOW - 1, false],
    [ROOM_HEAD_WINDOW, ROOM_HEAD_WINDOW, false],
    [ROOM_HEAD_WINDOW + 1, ROOM_HEAD_WINDOW, true],
  ])('%i new posts read as %i unread, "more" %s', async (fresh, unread, more) => {
    const { s, row, list } = await reopenedWith(fresh)
    expect(s.listNotes.mock.calls[0]).toEqual(['planning', { head: ROOM_HEAD_WINDOW }])
    expect(row().unread).toBe(unread)
    expect(!!row().unreadMore).toBe(more)
    expect(list.result.current.unread).toBe(unread)
  })

  test('control: switched off, the first read is the whole room, asked with the room alone, and every post counts', async () => {
    ROOMS_NEWEST_FIRST.on = false
    const { s, row } = await reopenedWith(ROOM_HEAD_WINDOW + 1)
    expect(s.listNotes.mock.calls[0]).toEqual(['planning'])
    expect(row().unread).toBe(ROOM_HEAD_WINDOW + 1)
    expect(row().unreadMore).toBeUndefined()
  })

  test('seeing down to the window’s lowest record ends "more"; seeing less does not', async () => {
    const { s, row } = await reopenedWith(ROOM_HEAD_WINDOW + 5)
    // The window holds n7…n66; n2…n6 below it were never counted.
    expect(row()).toMatchObject({ unread: ROOM_HEAD_WINDOW, unreadMore: true })
    act(() => markRoomSeen(s, 'planning', 5))
    expect(row()).toMatchObject({ unread: ROOM_HEAD_WINDOW, unreadMore: true })
    act(() => markRoomSeen(s, 'planning', 6))
    expect(row().unread).toBe(ROOM_HEAD_WINDOW)
    expect(row().unreadMore).toBeUndefined()
  })

  test('a later read asks only what is new, and keeps the floor said until it is seen', async () => {
    const { s, row } = await reopenedWith(ROOM_HEAD_WINDOW + 1)
    s.listNotes.mockClear()
    await act(async () => refreshRoomRows())
    expect(s.listNotes.mock.calls).toEqual([['planning', { sinceVersion: ROOM_HEAD_WINDOW + 2 }]])
    expect(row()).toMatchObject({ unread: ROOM_HEAD_WINDOW, unreadMore: true })
  })

  test('hiding puts it away as read, "more" included; Undo brings back exactly what was there', async () => {
    const { row } = await reopenedWith(ROOM_HEAD_WINDOW + 1)
    let undo: (() => void) | undefined
    act(() => {
      undo = hideRoom('planning')
    })
    act(() => undo?.())
    expect(row()).toMatchObject({ unread: ROOM_HEAD_WINDOW, unreadMore: true })
  })
})
