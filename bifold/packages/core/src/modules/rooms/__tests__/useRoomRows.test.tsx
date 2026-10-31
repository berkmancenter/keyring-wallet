/**
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
  canHideRoom,
  hideRoom,
  markRoomSeen,
  ROOMS_HIDDEN_KEY,
  resetRoomRows,
  ROOMS_SEEN_KEY,
  ROWS_POLL_MS,
  ROWS_RETRY_MS,
  ROWS_RETURN_FLOOR_MS,
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
let onAppState: ((s: string) => void) | undefined
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

const sessionOpens = (at: number) =>
  act(async () => {
    mockSession = { sessionOpenedAt: at }
    mockSessionListeners.forEach((listener) => listener())
  })

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

  test("a room's details offer Hide only for a room Messages has as a row (control: one it hasn't read)", async () => {
    expect(canHideRoom('planning')).toBe(false)
    mount(serviceWith([room('planning')], { planning: [note('n1', 1)] }))
    await flush()
    expect(canHideRoom('planning')).toBe(true)
    expect(canHideRoom('elsewhere')).toBe(false)
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

// On a cold launch the agent may not be ready, and a room's first read fails (276.9, once).
describe('a room not read yet', () => {
  const rowOf = (list: { result: { current: { rows: { rows: readonly unknown[] } } } }) =>
    list.result.current.rows.rows[0] as { reading?: boolean; lastPost?: { text: string } }

  test('is reading, not empty, and is read again soon without waiting for a return or Messages', async () => {
    const s = serviceWith([room('planning')], { planning: [note('n1', 1)] })
    s.listNotes.mockRejectedValueOnce(new Error('agent not ready'))
    const { list } = mount(s)
    await flush()
    expect(rowOf(list)).toMatchObject({ reading: true })
    expect(rowOf(list).lastPost).toBeUndefined()

    await step(ROWS_RETRY_MS[0])
    expect(s.listMyRooms).toHaveBeenCalledTimes(2)
    expect(rowOf(list).reading).toBeUndefined()
    expect(rowOf(list).lastPost?.text).toBe('n1')
    // Every room read: no more reads until the usual moments.
    await step(ROWS_RETRY_MS[2] * 2)
    expect(s.listMyRooms).toHaveBeenCalledTimes(2)
  })

  test('a first listing that stopped early with nothing in it is still reading; a complete empty one has no posts', async () => {
    const s = serviceWith([room('planning'), room('quiet')], { planning: [note('n1', 1)] })
    s.listNotes.mockImplementationOnce(async () => ({
      notes: [],
      complete: false,
      check: { verdict: 'consistent', detail: '' },
    }))
    const { list } = mount(s)
    await flush()
    const { rows } = list.result.current.rows
    expect(rows.find((r) => r.roomId === 'planning')?.reading).toBe(true)
    expect(rows.find((r) => r.roomId === 'quiet')?.reading).toBeUndefined()
  })

  test('tries again three times, sooner then later, then waits for the usual moments; a read that fails entirely too', async () => {
    const s = serviceWith([room('planning')], { planning: [note('n1', 1)] })
    s.listNotes.mockRejectedValue(new Error('agent not ready'))
    mount(s)
    await flush()
    expect(s.listMyRooms).toHaveBeenCalledTimes(1)
    for (const [i, ms] of ROWS_RETRY_MS.entries()) {
      await step(ms - 1)
      expect(s.listMyRooms).toHaveBeenCalledTimes(i + 1)
      await step(1)
      expect(s.listMyRooms).toHaveBeenCalledTimes(i + 2)
    }
    await step(ROWS_RETRY_MS[2] * 3)
    expect(s.listMyRooms).toHaveBeenCalledTimes(ROWS_RETRY_MS.length + 1)

    resetRoomRows()
    const down = serviceWith([room('planning')], { planning: [note('n1', 1)] })
    down.listMyRooms.mockRejectedValueOnce(new Error('agent unreachable'))
    const { list } = mount(down)
    await flush()
    expect(list.result.current.rows.failed).toBe(true)
    await step(ROWS_RETRY_MS[0])
    expect(down.listMyRooms).toHaveBeenCalledTimes(2)
    expect(list.result.current.rows.failed).toBe(false)
  })

  test('away from the app, a retry due reads nothing and keeps no timer; coming back reads at once and counts it', async () => {
    const s = serviceWith([room('planning')], { planning: [note('n1', 1)] })
    s.listNotes.mockRejectedValue(new Error('agent not ready'))
    mount(s)
    await flush()
    Object.defineProperty(AppState, 'currentState', { value: 'background', writable: true, configurable: true })
    await step(ROWS_RETRY_MS[0])
    // Nothing read, and no retry armed again: nothing wakes the app while it is away.
    expect(s.listMyRooms).toHaveBeenCalledTimes(1)
    const armed = jest.spyOn(global, 'setTimeout')
    await step(ROWS_RETRY_MS[2] * 10)
    expect(armed.mock.calls.filter(([, ms]) => (ROWS_RETRY_MS as readonly unknown[]).includes(ms))).toHaveLength(0)
    armed.mockRestore()
    expect(s.listMyRooms).toHaveBeenCalledTimes(1)
    // Back within the return floor: it reads at once all the same, and the rest of the retries follow.
    Object.defineProperty(AppState, 'currentState', { value: 'active', writable: true, configurable: true })
    await act(async () => onAppState?.('active'))
    expect(s.listMyRooms).toHaveBeenCalledTimes(2)
    await step(ROWS_RETRY_MS[1] + ROWS_RETRY_MS[2])
    expect(s.listMyRooms).toHaveBeenCalledTimes(ROWS_RETRY_MS.length + 1)
    await step(ROWS_RETRY_MS[2] * 3)
    expect(s.listMyRooms).toHaveBeenCalledTimes(ROWS_RETRY_MS.length + 1)
  })

  test('a retry armed when the poll unmounts never runs, and leaves no timer', async () => {
    const s = serviceWith([room('planning')], { planning: [note('n1', 1)] })
    s.listNotes.mockRejectedValue(new Error('agent not ready'))
    const { poll, list } = mount(s)
    await flush()
    expect(s.listMyRooms).toHaveBeenCalledTimes(1)
    const armed = jest.spyOn(global, 'setTimeout')
    list.unmount()
    poll.unmount()
    await step(ROWS_RETRY_MS[2] * 3)
    expect(s.listMyRooms).toHaveBeenCalledTimes(1)
    expect(armed.mock.calls.filter(([, ms]) => (ROWS_RETRY_MS as readonly unknown[]).includes(ms))).toHaveLength(0)
    armed.mockRestore()
    expect(jest.getTimerCount()).toBe(0)
  })
})

describe('a slow agent (X5JN-PEWP: the posts came 30 s after the listing)', () => {
  /** A promise this test settles: a room's posts the agent hasn't answered yet. */
  const held = () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => (release = resolve))
    return { gate, release: () => release() }
  }

  test('the rows show as soon as the rooms are listed, reading, and each fills in as its room is read', async () => {
    const s = serviceWith([room('planning'), room('notes')], { planning: [note('n1', 1)], notes: [note('m1', 1)] })
    const first = held()
    const second = held()
    const real = s.listNotes.getMockImplementation()!
    s.listNotes.mockImplementation(async (roomId: string, options?: { sinceVersion?: number }) => {
      await (roomId === 'planning' ? first.gate : second.gate)
      return real(roomId, options)
    })
    const { list } = mount(s)
    await flush()
    const rows = () => list.result.current.rows.rows.map((r) => [r.roomId, !!r.reading, r.lastPost?.text])
    expect(rows()).toEqual([
      ['planning', true, undefined],
      ['notes', true, undefined],
    ])

    first.release()
    await flush()
    expect(rows()).toEqual([
      ['planning', false, 'n1'],
      ['notes', true, undefined],
    ])

    second.release()
    await flush()
    expect(rows()).toEqual([
      ['planning', false, 'n1'],
      ['notes', false, 'm1'],
    ])
  })

  test('a read asked for while one is out runs once it ends, once (control: none asked, none run)', async () => {
    const s = serviceWith([room('planning')], { planning: [note('n1', 1)] })
    const slow = held()
    const real = s.listNotes.getMockImplementation()!
    s.listNotes.mockImplementationOnce(async (roomId: string, options?: { sinceVersion?: number }) => {
      await slow.gate
      return real(roomId, options)
    })
    mount(s)
    await flush()
    expect(s.listMyRooms).toHaveBeenCalledTimes(1)

    // Pull to refresh twice while the first read waits on the agent: one more read, after it, not two and not none.
    refreshRoomRows()
    refreshRoomRows()
    await flush()
    expect(s.listMyRooms).toHaveBeenCalledTimes(1)
    slow.release()
    await flush()
    expect(s.listMyRooms).toHaveBeenCalledTimes(2)
    await step(ROWS_RETRY_MS[2])
    expect(s.listMyRooms).toHaveBeenCalledTimes(2)

    // Control: nothing asked while a read is out, nothing more after it.
    const t = serviceWith([room('planning')], { planning: [note('n1', 1)] })
    resetRoomRows()
    const calm = held()
    const tReal = t.listNotes.getMockImplementation()!
    t.listNotes.mockImplementationOnce(async (roomId: string, options?: { sinceVersion?: number }) => {
      await calm.gate
      return tReal(roomId, options)
    })
    mount(t)
    await flush()
    calm.release()
    await flush()
    expect(t.listMyRooms).toHaveBeenCalledTimes(1)
  })

  test('a retry due while a read is out reads nothing more: that read arms the next retry (control: none out, it reads)', async () => {
    const s = serviceWith([room('planning')], { planning: [note('n1', 1)] })
    s.listNotes.mockRejectedValueOnce(new Error('agent not ready'))
    mount(s)
    await flush()
    expect(s.listMyRooms).toHaveBeenCalledTimes(1)

    // Pull to refresh just before the retry is due, and the agent holds that read past it.
    const slow = held()
    const real = s.listNotes.getMockImplementation()!
    s.listNotes.mockImplementationOnce(async (roomId: string, options?: { sinceVersion?: number }) => {
      await slow.gate
      return real(roomId, options)
    })
    await step(ROWS_RETRY_MS[0] - 1)
    refreshRoomRows()
    await flush()
    expect(s.listMyRooms).toHaveBeenCalledTimes(2)
    await step(1)
    slow.release()
    await flush()
    await step(ROWS_RETRY_MS[2] * 2)
    // The refresh read every room: no retry, and nothing queued behind it.
    expect(s.listMyRooms).toHaveBeenCalledTimes(2)

    // Control: the same retry with no read out reads.
    const t = serviceWith([room('planning')], { planning: [note('n1', 1)] })
    resetRoomRows()
    t.listNotes.mockRejectedValueOnce(new Error('agent not ready'))
    mount(t)
    await flush()
    await step(ROWS_RETRY_MS[0])
    expect(t.listMyRooms).toHaveBeenCalledTimes(2)
  })

  test('a community that can be read again shows its rooms at once in view; out of view, away or stopped, nothing', async () => {
    const s = serviceWith([room('planning')], { planning: [note('n1', 1)] })
    // The first listing skipped the community: a step kept its session.
    s.listMyRooms.mockResolvedValueOnce([])
    const stop = jest.fn()
    let readable: (() => void) | undefined
    Object.assign(s, {
      onReadable: jest.fn((listener: () => void) => {
        readable = listener
        return stop
      }),
    })
    const { poll, list } = mount(s)
    await flush()
    expect(list.result.current.rows.rows).toEqual([])

    // Control: Messages not in view, so nothing is read, as the two-minute poll reads nothing then.
    await act(async () => readable?.())
    expect(s.listMyRooms).toHaveBeenCalledTimes(1)

    act(() => void focus?.())
    await flush()
    expect(s.listMyRooms).toHaveBeenCalledTimes(1)
    await act(async () => readable?.())
    expect(s.listMyRooms).toHaveBeenCalledTimes(2)
    expect(list.result.current.rows.rows.map((r) => r.roomId)).toEqual(['planning'])

    Object.defineProperty(AppState, 'currentState', { value: 'background', writable: true, configurable: true })
    await act(async () => readable?.())
    expect(s.listMyRooms).toHaveBeenCalledTimes(2)

    expect(stop).not.toHaveBeenCalled()
    poll.unmount()
    expect(stop).toHaveBeenCalledTimes(1)
  })

  test('the agent back reads a failed read at once, not at its retry (control: rows all read ask nothing)', async () => {
    const s = serviceWith([room('planning')], { planning: [note('n1', 1)] })
    s.listMyRooms.mockRejectedValueOnce(new Error('agent not back yet'))
    const { list } = mount(s)
    await flush()
    expect(list.result.current.rows.failed).toBe(true)
    expect(s.listMyRooms).toHaveBeenCalledTimes(1)

    await sessionOpens(1_000)
    expect(s.listMyRooms).toHaveBeenCalledTimes(2)
    expect(list.result.current.rows.failed).toBe(false)
    expect(list.result.current.rows.rows.map((r) => r.roomId)).toEqual(['planning'])

    await sessionOpens(2_000)
    expect(s.listMyRooms).toHaveBeenCalledTimes(2)
  })

  test('the agent back reads a room left unread; away it reads nothing and the retry stays', async () => {
    const s = serviceWith([room('planning')], { planning: [note('n1', 1)] })
    s.listNotes.mockRejectedValueOnce(new Error('agent not back yet'))
    s.listNotes.mockRejectedValueOnce(new Error('agent not back yet'))
    const { list } = mount(s)
    await flush()
    expect(list.result.current.rows.rows[0]).toMatchObject({ reading: true })

    Object.defineProperty(AppState, 'currentState', { value: 'background', writable: true, configurable: true })
    await sessionOpens(1_000)
    expect(s.listMyRooms).toHaveBeenCalledTimes(1)

    Object.defineProperty(AppState, 'currentState', { value: 'active', writable: true, configurable: true })
    await sessionOpens(2_000)
    expect(s.listMyRooms).toHaveBeenCalledTimes(2)
    expect(list.result.current.rows.rows[0]).toMatchObject({ reading: true })
    await sessionOpens(3_000)
    expect(s.listMyRooms).toHaveBeenCalledTimes(3)
    expect(list.result.current.rows.rows[0].reading).toBeUndefined()
  })

  test('the agent back while a read is out reads once more when it ends, once', async () => {
    const s = serviceWith([room('planning')], { planning: [note('n1', 1)] })
    const slow = held()
    const real = s.listNotes.getMockImplementation()!
    s.listNotes.mockImplementationOnce(async (roomId: string, options?: { sinceVersion?: number }) => {
      await slow.gate
      return real(roomId, options)
    })
    mount(s)
    await flush()
    expect(s.listMyRooms).toHaveBeenCalledTimes(1)

    await sessionOpens(1_000)
    expect(s.listMyRooms).toHaveBeenCalledTimes(1)

    await act(async () => slow.release())
    expect(s.listMyRooms).toHaveBeenCalledTimes(2)
    await flush()
    expect(s.listMyRooms).toHaveBeenCalledTimes(2)
  })

  test('a read that changes no row publishes no new rows: Messages and the badge do not re-render (control: a new post does)', async () => {
    const notes = { planning: [note('n1', 1)], board: [note('b1', 1)] }
    const s = serviceWith([room('planning'), room('board')], notes)
    const { list } = mount(s)
    await flush()
    const before = list.result.current.rows.rows
    expect(before.map((r) => r.lastPost?.text)).toEqual(['n1', 'b1'])

    refreshRoomRows()
    await flush()
    expect(list.result.current.rows.rows).toBe(before)

    notes.board.push(note('b2', 2))
    refreshRoomRows()
    await flush()
    expect(list.result.current.rows.rows).not.toBe(before)
    expect(list.result.current.rows.rows.map((r) => r.lastPost?.text)).toEqual(['n1', 'b2'])
  })

  test('a room whose community changes publishes, even with every other field the same (both communities unnamed)', async () => {
    const OTHER = 'did:webvh:QmOther:other.example'
    const rooms = [room('planning', { communityName: undefined })]
    const s = serviceWith(rooms, { planning: [note('n1', 1)] })
    const { list } = mount(s)
    await flush()
    const before = list.result.current.rows.rows
    expect(before[0].communityDid).toBe(LAB)

    rooms[0] = room('planning', { communityName: undefined, communityDid: OTHER })
    refreshRoomRows()
    await flush()
    expect(list.result.current.rows.rows).not.toBe(before)
    expect(list.result.current.rows.rows[0].communityDid).toBe(OTHER)
  })

  test("each read says in the app's log how many rooms it listed, how many aren't read yet, and how long it took", async () => {
    const s = serviceWith([room('planning')], { planning: [note('n1', 1)] })
    s.listNotes.mockRejectedValueOnce(new Error('agent not ready'))
    const lines: string[] = []
    renderHook(() => useRoomRowsPoll(s, true, (line) => lines.push(line)))
    await flush()
    expect(lines).toEqual([expect.stringMatching(/^\[Rooms:rows\] 1 rooms listed, 1 not read yet, in \d+ ms$/)])

    s.listMyRooms.mockRejectedValueOnce(new Error('community unreachable'))
    await step(ROWS_RETRY_MS[0])
    expect(lines[1]).toMatch(/^\[Rooms:rows\] the rooms were not listed \(\d+ ms\); the rows read before stay$/)
    // The cause is the service's own line; this one never repeats the error's words.
    expect(lines[1]).not.toContain('unreachable')
  })
})
