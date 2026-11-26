/**
 * A room opens at its newest records (rooms/newestFirstSwitch): one window of ROOM_HEAD_WINDOW records, newest
 * version first, instead of the whole room; "load older" reads on within it, and past it asks the next window below
 * the lowest version held. A window's `older` is not the host stopping early: nothing says the room is incomplete.
 * Off, every listing is the whole room, asked exactly as before. The service here answers a window as the real one
 * does (`windowOf`), over a room of numbered records whose time follows their version.
 */
import { act, renderHook } from '@testing-library/react-native'
import { AppState } from 'react-native'

import { toInertText } from '../inertText'
import { windowOf } from '../listingWindow'
import { ROOM_HEAD_WINDOW, ROOMS_NEWEST_FIRST } from '../newestFirstSwitch'
import { isChatPost } from '../roomPosts'
import type { ListNotesOptions, Note, NoteList, NoteSummary, RoomsService } from '../types'
import { POSTS_PAGE, ROOM_POLL_MS, useRoomPosts } from '../useRoomPosts'

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('../../../../__mocks__/@react-navigation/native'),
  useIsFocused: () => true,
}))

const ROOM = 'did:webvh:r:one'
const ME = { did: 'did:peer:2.me' }
const CONSISTENT = { verdict: 'consistent' as const, detail: '' }
const BASE = Date.parse('2026-11-20T09:00:00Z')

const note = (version: number, over: Partial<Note> = {}): Note => ({
  key: `n${version}`,
  version,
  status: 'active',
  pinned: false,
  updatedAt: new Date(BASE + version * 60_000).toISOString(),
  author: { did: 'did:peer:them' },
  body: toInertText(`post n${version}`),
  flags: { containsLink: false, looksLikeInstruction: false },
  check: CONSISTENT,
  ...over,
})
const summaryOf = ({ body: _b, flags: _f, check: _c, ...summary }: Note): NoteSummary => summary

/** A room of records n1…n`count` (n1 oldest), listed as the real service lists it: whole, from a version, or a window. */
function roomOf(count: number, options: { titled?: (version: number) => boolean } = {}) {
  const records = new Map<string, Note>()
  const write = (n: Note) => records.set(n.key, n)
  for (let v = 1; v <= count; v++) write(note(v, options.titled?.(v) ? { title: toInertText(`note n${v}`) } : {}))
  const service = {
    listNotes: jest.fn(async (_roomId: string, o: ListNotesOptions = {}): Promise<NoteList> => {
      const all = { notes: [...records.values()].map(summaryOf), complete: true, check: CONSISTENT }
      if (o.head !== undefined) return windowOf(all, o.head, o.beforeVersion)
      return { ...all, notes: all.notes.filter((n) => n.version > (o.sinceVersion ?? 0)) }
    }),
    readNote: jest.fn(async (_roomId: string, key: string) => {
      const found = records.get(key)
      if (!found) throw new Error('no such post')
      return found
    }),
  }
  return { service: service as unknown as RoomsService & { listNotes: jest.Mock; readNote: jest.Mock }, write }
}

/** Every listing asked, as its options (undefined: asked with the room alone). */
const asked = (service: { listNotes: jest.Mock }) => service.listNotes.mock.calls.map((call) => call[1])

const flush = () => act(async () => undefined)
const settle = async () => {
  for (let i = 0; i < 8; i++) await flush()
}

const open = async (service: RoomsService, counts?: Parameters<typeof useRoomPosts>[5], live = false) => {
  const hook = renderHook(() => useRoomPosts(service, ROOM, ME, true, live, counts))
  await settle()
  return hook
}
const loadOlder = async (result: { current: { loadOlder: () => void } }) => {
  await act(async () => result.current.loadOlder())
  await settle()
}

beforeEach(() => {
  jest.useFakeTimers()
  jest.spyOn(AppState, 'addEventListener').mockImplementation((() => ({ remove: jest.fn() })) as never)
})
afterEach(() => {
  ROOMS_NEWEST_FIRST.on = true
  ROOMS_NEWEST_FIRST.remoteOff = false
  jest.useRealTimers()
  jest.restoreAllMocks()
})

describe('a room opened newest first', () => {
  test('asks one window of its newest records, not the whole room, and draws the newest page', async () => {
    const { service } = roomOf(100)
    const { result } = await open(service)
    expect(asked(service)).toEqual([{ head: ROOM_HEAD_WINDOW }])
    expect(result.current.posts?.map((p) => p.key)).toEqual(Array.from({ length: POSTS_PAGE }, (_, i) => `n${100 - i}`))
    expect(service.readNote).toHaveBeenCalledTimes(POSTS_PAGE)
    expect(result.current.hasOlder).toBe(true)
    // A window with more below is not a host that stopped early.
    expect(result.current.incomplete).toBe(false)
  })

  test('control: switched off, the room is listed whole, asked with the room alone, as before', async () => {
    ROOMS_NEWEST_FIRST.on = false
    const { service } = roomOf(100)
    const { result } = await open(service)
    expect(service.listNotes.mock.calls).toEqual([[ROOM]])
    expect(result.current.posts).toHaveLength(POSTS_PAGE)
    expect(result.current.hasOlder).toBe(true)
  })

  test('control: the remote kill wins over on', async () => {
    ROOMS_NEWEST_FIRST.remoteOff = true
    const { service } = roomOf(100)
    await open(service)
    expect(service.listNotes.mock.calls).toEqual([[ROOM]])
  })

  test('"load older" within the window reads on without listing again', async () => {
    const { service } = roomOf(100)
    const { result } = await open(service)
    await loadOlder(result)
    expect(asked(service)).toEqual([{ head: ROOM_HEAD_WINDOW }])
    expect(result.current.posts).toHaveLength(2 * POSTS_PAGE)
  })

  test('past the window, asks the next one below the lowest version held, once, and draws on', async () => {
    const { service } = roomOf(100)
    const { result } = await open(service)
    const pages = ROOM_HEAD_WINDOW / POSTS_PAGE
    for (let i = 0; i < pages; i++) await loadOlder(result)
    // n41 is the lowest of the newest 60.
    expect(asked(service)).toEqual([{ head: ROOM_HEAD_WINDOW }, { head: ROOM_HEAD_WINDOW, beforeVersion: 41 }])
    expect(result.current.posts).toHaveLength((pages + 1) * POSTS_PAGE)
    expect(result.current.posts?.at(-1)?.key).toBe(`n${100 - (pages + 1) * POSTS_PAGE + 1}`)
    // Each post read once: nothing held was read again for the join.
    const keys = service.readNote.mock.calls.map(([, key]) => key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(result.current.hasOlder).toBe(true)
    expect(result.current.loadingOlder).toBe(false)
  })

  test('the window that reaches the room’s first record says there is nothing older', async () => {
    const { service } = roomOf(100)
    const { result } = await open(service)
    for (let i = 0; i < 10; i++) await loadOlder(result)
    expect(result.current.posts).toHaveLength(100)
    expect(result.current.posts?.at(-1)?.key).toBe('n1')
    expect(result.current.hasOlder).toBe(false)
    expect(asked(service)).toEqual([{ head: ROOM_HEAD_WINDOW }, { head: ROOM_HEAD_WINDOW, beforeVersion: 41 }])
  })

  // The window's edge: a room of exactly a window has nothing older; one record more has.
  test.each([
    [ROOM_HEAD_WINDOW - 1, false],
    [ROOM_HEAD_WINDOW, false],
    [ROOM_HEAD_WINDOW + 1, true],
  ])('a room of %i records: once the window is drawn, older is %s', async (count, older) => {
    const { service } = roomOf(count)
    const { result } = await open(service)
    for (let i = 0; i < Math.ceil(ROOM_HEAD_WINDOW / POSTS_PAGE) - 1; i++) await loadOlder(result)
    expect(asked(service)).toEqual([{ head: ROOM_HEAD_WINDOW }])
    expect(result.current.posts).toHaveLength(Math.min(count, ROOM_HEAD_WINDOW))
    expect(result.current.hasOlder).toBe(older)
  })

  test('a chat whose window is mostly notes asks the window below to fill its page', async () => {
    // Of the newest 60, only n100…n96 are chat posts; below them every record is.
    const { service } = roomOf(100, { titled: (v) => v <= 95 && v > 40 })
    const { result } = await open(service, isChatPost)
    expect(asked(service)).toEqual([{ head: ROOM_HEAD_WINDOW }, { head: ROOM_HEAD_WINDOW, beforeVersion: 41 }])
    expect((result.current.posts ?? []).filter(isChatPost)).toHaveLength(POSTS_PAGE)
    expect(result.current.loadingOlder).toBe(false)
  })

  test('a window that fails ends the load, and the next "load older" asks it again', async () => {
    const { service } = roomOf(100)
    const { result } = await open(service)
    for (let i = 0; i < 5; i++) await loadOlder(result)
    const answer = service.listNotes.getMockImplementation()!
    service.listNotes.mockImplementationOnce(async () => {
      throw new Error('the agent did not answer')
    })
    await loadOlder(result)
    expect(result.current.loadingOlder).toBe(false)
    expect(result.current.posts).toHaveLength(ROOM_HEAD_WINDOW)
    service.listNotes.mockImplementation(answer)
    await loadOlder(result)
    expect(asked(service).filter((o) => o?.beforeVersion === 41)).toHaveLength(2)
    expect(result.current.posts).toHaveLength(ROOM_HEAD_WINDOW + 2 * POSTS_PAGE)
  })

  test('a poll merges what is new and keeps the room’s older records said', async () => {
    const { service, write } = roomOf(100)
    const { result } = await open(service, undefined, true)
    write(note(101))
    await act(async () => jest.advanceTimersByTime(ROOM_POLL_MS))
    await settle()
    expect(asked(service)).toEqual([{ head: ROOM_HEAD_WINDOW }, { sinceVersion: 100 }])
    expect(result.current.posts?.[0]?.key).toBe('n101')
    expect(result.current.hasOlder).toBe(true)
    expect(result.current.incomplete).toBe(false)
  })

  test('control: a host that stopped early still says the room is incomplete', async () => {
    const { service } = roomOf(100)
    const answer = service.listNotes.getMockImplementation()!
    service.listNotes.mockImplementation(async (roomId: string, o?: ListNotesOptions) => ({
      ...(await answer(roomId, o)),
      complete: false,
    }))
    const { result } = await open(service)
    expect(result.current.incomplete).toBe(true)
  })
})
