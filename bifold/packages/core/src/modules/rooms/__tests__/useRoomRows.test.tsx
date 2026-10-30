/**
 * Rooms as Messages rows: each room the member holds, with its newest post (who and what), when, and the posts by
 * others after the newest one the member has seen. A room met for the first time starts seen; the member's own posts
 * never count; what the room screen shows is seen, and stays seen after a relaunch. The rooms are read by one poll,
 * gently: each room asked only for what is new, its newest post read only when it changed, every two minutes only
 * while Messages is in view. Messages' badge adds the rows' unread.
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
  hideRoom,
  markRoomSeen,
  ROOMS_HIDDEN_KEY,
  resetRoomRows,
  ROOMS_SEEN_KEY,
  ROWS_POLL_MS,
  ROWS_RETURN_FLOOR_MS,
  refreshRoomRows,
  useRoomRows,
  useRoomRowsPoll,
  useRoomsUnreadCount,
} from '../useRoomRows'

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
let onAppState: ((s: string) => void) | undefined
beforeEach(async () => {
  jest.useFakeTimers()
  resetRoomRows()
  await AsyncStorage.setItem(ROOMS_SEEN_KEY, '{}')
  await AsyncStorage.setItem(ROOMS_HIDDEN_KEY, '{}')
  focus = undefined
  ;(useFocusEffect as jest.Mock).mockImplementation((effect: () => (() => void) | void) => {
    focus = effect
  })
  Object.defineProperty(AppState, 'currentState', { value: 'active', writable: true, configurable: true })
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, listener: (s: string) => void) => {
    onAppState = listener
    return { remove: jest.fn() }
  }) as never)
})
afterEach(() => {
  jest.useRealTimers()
  jest.restoreAllMocks()
})

const flush = () => act(async () => undefined)
const step = (ms: number) => act(async () => void (await jest.advanceTimersByTimeAsync(ms)))

const mount = (service: RoomsService) => {
  const poll = renderHook(() => useRoomRowsPoll(service, true))
  const list = renderHook(() => ({ rows: useRoomRows(), unread: useRoomsUnreadCount() }))
  return { poll, list }
}

describe('rooms as Messages rows', () => {
  test('each room the member holds, with its newest post and who wrote it; a room met first starts seen', async () => {
    const s = serviceWith(
      [
        room('planning'),
        room('custody', { source: 'custody', communityDid: undefined }),
        room('gone', { standing: 'lapsed' }),
      ],
      { planning: [note('n1', 1), note('n2', 2)] },
      { n2: chat('The agenda is in Notes') }
    )
    const { list } = mount(s)
    await flush()
    expect(list.result.current.rows.rows.map((r) => r.roomId)).toEqual(['planning'])
    const row = list.result.current.rows.rows[0]
    expect(row).toMatchObject({
      key: 'planning',
      communityDid: LAB,
      unread: 0,
      lastPost: { by: SAM, mine: false, text: 'The agenda is in Notes', kind: 'chat' },
    })
    expect(row.lastActivityAt?.toISOString()).toBe(note('n2', 2).updatedAt)
    // Only the newest post is read in full.
    expect(s.readNote).toHaveBeenCalledTimes(1)
  })

  test("posts by others after the newest seen count; the member's own don't; the room screen showing them clears them", async () => {
    const notes: Record<string, NoteSummary[]> = { planning: [note('n1', 1)] }
    const s = serviceWith([room('planning')], notes)
    const { list } = mount(s)
    await flush()
    notes.planning.push(note('n2', 2), note('mine', 3, ME), note('n4', 4))
    await act(async () => refreshRoomRows())
    expect(list.result.current.rows.rows[0].unread).toBe(2)
    expect(list.result.current.unread).toBe(2)
    // Asked only for what came after the newest post already read.
    expect(s.listNotes).toHaveBeenLastCalledWith('planning', { sinceVersion: 1 })
    act(() => markRoomSeen(s, 'planning', 4))
    expect(list.result.current.rows.rows[0].unread).toBe(0)
    expect(list.result.current.unread).toBe(0)
  })

  test('seen stays seen after a relaunch: only what came after it counts', async () => {
    const notes: Record<string, NoteSummary[]> = { planning: [note('n1', 1), note('n2', 2)] }
    const s = serviceWith([room('planning')], notes)
    const first = mount(s)
    await flush()
    // Past what first sight kept: the room screen shows a newer post.
    notes.planning.push(note('n3', 3))
    await act(async () => refreshRoomRows())
    act(() => markRoomSeen(s, 'planning', 3))
    first.poll.unmount()
    first.list.unmount()
    // A relaunch: memory gone, the kept versions read back; two posts arrived meanwhile.
    resetRoomRows()
    notes.planning.push(note('n4', 4), note('n5', 5))
    const again = mount(s)
    await flush()
    expect(again.list.result.current.rows.rows[0].unread).toBe(2)
    // Kept as a short hash of the room's ID, never the ID.
    const kept = (await AsyncStorage.getItem(ROOMS_SEEN_KEY)) as string
    expect(kept).not.toContain('planning')
    expect(Object.keys(JSON.parse(kept))).toEqual([expect.stringMatching(/^[0-9a-f]{16}$/)])
  })

  test('nothing new reads nothing; an edit to an older post never takes the row back', async () => {
    const notes: Record<string, NoteSummary[]> = { planning: [note('n1', 1), note('n2', 2)] }
    const s = serviceWith([room('planning')], notes, { n2: chat('Newest') })
    const { list } = mount(s)
    await flush()
    await act(async () => refreshRoomRows())
    expect(s.listNotes).toHaveBeenCalledTimes(2)
    expect(s.readNote).toHaveBeenCalledTimes(1)
    // n1 edited: a higher version, its own (earlier) time.
    notes.planning[0] = note('n1', 3, SAM, { updatedAt: note('n1', 1).updatedAt })
    await act(async () => refreshRoomRows())
    expect(s.readNote).toHaveBeenCalledTimes(1)
    expect(list.result.current.rows.rows[0].lastPost?.text).toBe('Newest')
    expect(list.result.current.rows.rows[0].lastActivityAt?.toISOString()).toBe(note('n2', 2).updatedAt)
  })

  test('every two minutes only while Messages is in view; on coming back to the app, not within a minute', async () => {
    const s = serviceWith([room('planning')], { planning: [note('n1', 1)] })
    mount(s)
    await flush()
    expect(s.listMyRooms).toHaveBeenCalledTimes(1)
    await step(ROWS_POLL_MS)
    expect(s.listMyRooms).toHaveBeenCalledTimes(1)
    // Messages comes into view: it reads (past the focus floor) and the poll runs.
    let leave: (() => void) | void
    await act(async () => {
      leave = focus?.()
    })
    expect(s.listMyRooms).toHaveBeenCalledTimes(2)
    await step(ROWS_POLL_MS)
    expect(s.listMyRooms).toHaveBeenCalledTimes(3)
    // Back to the app within a minute of the last read: nothing; after it: a read.
    await act(async () => onAppState?.('active'))
    expect(s.listMyRooms).toHaveBeenCalledTimes(3)
    await step(ROWS_RETURN_FLOOR_MS)
    await act(async () => onAppState?.('active'))
    expect(s.listMyRooms).toHaveBeenCalledTimes(4)
    // Messages out of view: the two-minute tick reads nothing.
    act(() => leave?.())
    await step(ROWS_POLL_MS)
    expect(s.listMyRooms).toHaveBeenCalledTimes(4)
  })

  test('Hide takes a room off Messages and the badge until someone posts; Undo puts back exactly what was there', async () => {
    const notes: Record<string, NoteSummary[]> = { planning: [note('n1', 1)], desk: [note('d1', 1)] }
    const s = serviceWith([room('planning'), room('desk')], notes)
    const first = mount(s)
    await flush()
    notes.planning.push(note('n2', 2))
    await act(async () => refreshRoomRows())
    expect(first.list.result.current.unread).toBe(1)

    let undo: (() => void) | undefined
    act(() => {
      undo = hideRoom('planning')
    })
    expect(first.list.result.current.rows.rows.map((r) => r.roomId)).toEqual(['desk'])
    expect(first.list.result.current.unread).toBe(0)
    act(() => undo?.())
    expect(first.list.result.current.rows.rows.map((r) => r.roomId)).toEqual(['planning', 'desk'])
    expect(first.list.result.current.unread).toBe(1)

    // Hidden again, and still hidden after a relaunch.
    act(() => void hideRoom('planning'))
    first.poll.unmount()
    first.list.unmount()
    resetRoomRows()
    const again = mount(s)
    await flush()
    expect(again.list.result.current.rows.rows.map((r) => r.roomId)).toEqual(['desk'])
    const kept = (await AsyncStorage.getItem(ROOMS_HIDDEN_KEY)) as string
    expect(kept).not.toContain('planning')

    // Someone posts: it's back, and only what came after the hide counts (n2 was put away as read).
    notes.planning.push(note('n3', 3))
    await act(async () => refreshRoomRows())
    expect(again.list.result.current.rows.rows.map((r) => r.roomId)).toEqual(['planning', 'desk'])
    expect(again.list.result.current.unread).toBe(1)
  })

  test('a read that fails says so and keeps the rows; no agent linked, no rows and nothing asked', async () => {
    const s = serviceWith([room('planning')], { planning: [note('n1', 1)] })
    const { list } = mount(s)
    await flush()
    s.listMyRooms.mockRejectedValueOnce(new Error('agent unreachable'))
    await act(async () => refreshRoomRows())
    expect(list.result.current.rows.failed).toBe(true)
    expect(list.result.current.rows.rows).toHaveLength(1)

    resetRoomRows()
    const unlinked = serviceWith([room('planning')], {})
    renderHook(() => useRoomRowsPoll(unlinked, false))
    await flush()
    expect(unlinked.listMyRooms).not.toHaveBeenCalled()
  })
})
