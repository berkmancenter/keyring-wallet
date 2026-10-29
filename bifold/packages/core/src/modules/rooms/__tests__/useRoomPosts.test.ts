/**
 * New posts appear while a room is open: every ten seconds while it is in view and the app is in the foreground,
 * the room is listed from the newest version held, and only what is new or changed is read. A poll never queues
 * behind a listing still being asked, a failed one waits two ticks, and one that finds nothing redraws nothing.
 * Timers are stepped one interval at a time, and each test counts the asks.
 */
import { act, renderHook } from '@testing-library/react-native'
import { AppState } from 'react-native'

import { toInertText } from '../inertText'
import type { Note, NoteList, NoteSummary, RoomsService } from '../types'
import { useInViewAndActive } from '../useInViewAndActive'
import {
  mergeNewer,
  newestVersion,
  POLL_SKIPS_AFTER_FAILURE,
  POSTS_PAGE,
  ROOM_POLL_MS,
  type RoomPosts,
  useRoomPosts,
} from '../useRoomPosts'

let mockFocused = true
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('../../../../__mocks__/@react-navigation/native'),
  useIsFocused: () => mockFocused,
}))

const ROOM = 'did:webvh:r:one'
const ME = { did: 'did:peer:2.me' }
const CONSISTENT = { verdict: 'consistent' as const, detail: '' }

const note = (key: string, version: number, over: Partial<Note> = {}): Note => ({
  key,
  version,
  status: 'active',
  pinned: false,
  updatedAt: `2026-10-29T09:${String(version).padStart(2, '0')}:00Z`,
  author: { did: 'did:peer:them' },
  body: toInertText(`post ${key} v${version}`),
  flags: { containsLink: false, looksLikeInstruction: false },
  check: CONSISTENT,
  ...over,
})
const summaryOf = ({ body: _b, flags: _f, check: _c, ...summary }: Note): NoteSummary => summary

/** A room whose records the test changes; listing honours `sinceVersion` as the host does. */
const roomWith = (initial: Note[]) => {
  const records = new Map(initial.map((n) => [n.key, n]))
  const service = {
    listNotes: jest.fn(async (_roomId: string, options: { sinceVersion?: number } = {}): Promise<NoteList> => {
      const since = options.sinceVersion ?? 0
      return {
        notes: [...records.values()].filter((n) => n.version > since).map(summaryOf),
        complete: true,
        check: CONSISTENT,
      }
    }),
    readNote: jest.fn(async (_roomId: string, key: string) => {
      const found = records.get(key)
      if (!found) throw new Error('no such post')
      return found
    }),
  }
  return {
    service: service as unknown as RoomsService & { listNotes: jest.Mock; readNote: jest.Mock },
    write: (n: Note) => records.set(n.key, n),
  }
}

/** The polls only: the listings asked with a version to start from. */
const polls = (service: { listNotes: jest.Mock }) =>
  service.listNotes.mock.calls.filter(([, options]) => options?.sinceVersion !== undefined)

let onAppState: ((state: string) => void) | undefined
beforeEach(() => {
  jest.useFakeTimers()
  mockFocused = true
  onAppState = undefined
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_type: string, listener: (s: string) => void) => {
    onAppState = listener
    return { remove: jest.fn() }
  }) as never)
})
afterEach(() => {
  jest.useRealTimers()
  jest.restoreAllMocks()
})

const flush = () => act(async () => undefined)
/** One poll interval, then the promises it started. */
const tick = async () => {
  await act(async () => jest.advanceTimersByTime(ROOM_POLL_MS))
  await flush()
}

const open = async (service: RoomsService, live = true) => {
  const hook = renderHook<RoomPosts, { inView: boolean }>(
    ({ inView }) => useRoomPosts(service, ROOM, ME, true, inView),
    {
      initialProps: { inView: live },
    }
  )
  await flush()
  await flush()
  return hook
}

describe('a room in view', () => {
  test('asks every ten seconds from the newest version held, and a new post appears on top, the only one read', async () => {
    const { service, write } = roomWith([note('a', 1), note('b', 2)])
    const { result } = await open(service)
    expect(result.current.posts?.map((p) => p.key)).toEqual(['b', 'a'])
    expect(service.readNote).toHaveBeenCalledTimes(2)

    await tick()
    expect(polls(service)).toHaveLength(1)
    expect(polls(service)[0][1]).toEqual({ sinceVersion: 2 })

    write(note('c', 3))
    await tick()
    expect(polls(service)).toHaveLength(2)
    expect(result.current.posts?.map((p) => p.key)).toEqual(['c', 'b', 'a'])
    expect(service.readNote).toHaveBeenCalledTimes(3)
    expect(service.readNote).toHaveBeenLastCalledWith(ROOM, 'c')

    await tick()
    expect(polls(service)).toHaveLength(3)
    expect(polls(service)[2][1]).toEqual({ sinceVersion: 3 })
  })

  test('a poll that finds nothing new reads nothing and redraws nothing', async () => {
    const { service } = roomWith([note('a', 1)])
    const { result } = await open(service)
    const before = result.current.posts
    await tick()
    await tick()
    expect(polls(service)).toHaveLength(2)
    expect(service.readNote).toHaveBeenCalledTimes(1)
    expect(result.current.posts).toBe(before)
  })

  test('a retract arrives as a newer version of the same post, which shows removed and is not read', async () => {
    const { service, write } = roomWith([note('a', 1), note('b', 2)])
    const { result } = await open(service)
    write(note('a', 3, { status: 'retracted', body: toInertText('') }))
    await tick()
    expect(result.current.posts?.map((p) => [p.key, p.retracted])).toEqual([
      ['a', true],
      ['b', false],
    ])
    expect(service.readNote).toHaveBeenCalledTimes(2)
  })

  test('a poll is skipped while one is still being asked: one ask in flight, however many ticks pass', async () => {
    const { service, write } = roomWith([note('a', 1)])
    await open(service)
    let answer: () => void = () => undefined
    service.listNotes.mockImplementationOnce(
      () =>
        new Promise<NoteList>((resolve) => {
          answer = () => resolve({ notes: [], complete: true, check: CONSISTENT })
        })
    )
    await tick()
    await tick()
    await tick()
    expect(polls(service)).toHaveLength(1)

    await act(async () => answer())
    write(note('b', 2))
    await tick()
    expect(polls(service)).toHaveLength(2)
  })

  test('a poll is skipped while the first listing or a refresh is still being asked', async () => {
    const { service } = roomWith([note('a', 1)])
    const { result } = await open(service)
    service.listNotes.mockImplementationOnce(() => new Promise<NoteList>(() => undefined))
    await act(async () => result.current.refresh())
    await tick()
    await tick()
    expect(service.listNotes).toHaveBeenCalledTimes(2) // the first listing and the refresh
    expect(polls(service)).toHaveLength(0)
  })

  test('a failed poll changes nothing on screen and waits two ticks before the next', async () => {
    const { service, write } = roomWith([note('a', 1)])
    const { result } = await open(service)
    const before = result.current.posts
    service.listNotes.mockRejectedValueOnce(new Error('the agent did not answer'))
    await tick()
    expect(polls(service)).toHaveLength(1)
    expect(result.current.failed).toBe(false)
    expect(result.current.posts).toBe(before)

    for (let i = 0; i < POLL_SKIPS_AFTER_FAILURE; i++) await tick()
    expect(polls(service)).toHaveLength(1)
    write(note('b', 2))
    await tick()
    expect(polls(service)).toHaveLength(2)
    expect(result.current.posts?.map((p) => p.key)).toEqual(['b', 'a'])
  })

  test('a refresh lists the whole room again but reads only what changed', async () => {
    const { service, write } = roomWith([note('a', 1), note('b', 2)])
    const { result } = await open(service, false)
    write(note('c', 3))
    await act(async () => result.current.refresh())
    await flush()
    expect(result.current.posts?.map((p) => p.key)).toEqual(['c', 'b', 'a'])
    expect(service.readNote.mock.calls.map(([, key]) => key)).toEqual(['b', 'a', 'c'])
  })
})

describe('a room out of view', () => {
  test('not in view: no poll, tick after tick', async () => {
    const { service } = roomWith([note('a', 1)])
    await open(service, false)
    await tick()
    await tick()
    await tick()
    expect(service.listNotes).toHaveBeenCalledTimes(1)
  })

  test('leaving stops the poll; coming back catches up at once, then every ten seconds', async () => {
    const { service, write } = roomWith([note('a', 1)])
    const hook = await open(service)
    await tick()
    expect(polls(service)).toHaveLength(1)

    hook.rerender({ inView: false })
    await tick()
    await tick()
    expect(polls(service)).toHaveLength(1)

    write(note('b', 2))
    hook.rerender({ inView: true })
    await flush()
    expect(polls(service)).toHaveLength(2)
    expect(hook.result.current.posts?.map((p) => p.key)).toEqual(['b', 'a'])
    await tick()
    expect(polls(service)).toHaveLength(3)
  })

  test('a poll answered after the room left view is not shown', async () => {
    const { service } = roomWith([note('a', 1)])
    const hook = await open(service)
    let answer: () => void = () => undefined
    service.listNotes.mockImplementationOnce(
      () =>
        new Promise<NoteList>((resolve) => {
          answer = () => resolve({ notes: [summaryOf(note('b', 2))], complete: true, check: CONSISTENT })
        })
    )
    await tick()
    hook.rerender({ inView: false })
    await act(async () => answer())
    expect(hook.result.current.posts?.map((p) => p.key)).toEqual(['a'])
  })
})

describe('in view and in the foreground', () => {
  test('false in the background or while inactive, true again when active', async () => {
    const { result } = renderHook(() => useInViewAndActive())
    expect(result.current).toBe(true)
    await act(async () => onAppState?.('background'))
    expect(result.current).toBe(false)
    await act(async () => onAppState?.('active'))
    expect(result.current).toBe(true)
    await act(async () => onAppState?.('inactive'))
    expect(result.current).toBe(false)
  })

  test('false while another screen is on top', () => {
    mockFocused = false
    const { result } = renderHook(() => useInViewAndActive())
    expect(result.current).toBe(false)
  })
})

describe('merging what a poll found', () => {
  const listing = { notes: [summaryOf(note('a', 1))], check: CONSISTENT, complete: true }

  test('nothing newer: no change', () => {
    expect(mergeNewer(listing, { notes: [summaryOf(note('a', 1))], complete: true, check: CONSISTENT })).toBe(undefined)
  })

  test('a conflict the agent found shows, even with no new record; an unverified partial listing does not clear one', () => {
    const conflict = { verdict: 'conflict' as const, detail: 'the host contradicts what it served before' }
    const merged = mergeNewer(listing, { notes: [], complete: true, check: conflict })
    expect(merged?.listing.check).toBe(conflict)
    const after = mergeNewer(merged!.listing, {
      notes: [summaryOf(note('b', 2))],
      complete: true,
      check: { verdict: 'unverified', detail: '' },
    })
    expect(after?.listing.check).toBe(conflict)
    expect(after?.added).toBe(1)
  })

  test('the newest version held, 0 for an empty room', () => {
    expect(newestVersion([])).toBe(0)
    expect(newestVersion([summaryOf(note('a', 4)), summaryOf(note('b', 2))])).toBe(4)
  })
})

// Each read is one task for the person's agent, sent one at a time: a post written just after opening a room waits
// behind every read of the first page (S0.7, 10-29: 40 s from tap to sent on a first page of 30).
describe('the first page', () => {
  const many = () => roomWith(Array.from({ length: 31 }, (_, i) => note(`n${i}`, i + 1)))

  test('opening a room of 31 records reads ten, so a post made at once waits behind ten reads, not thirty', async () => {
    const { service } = many()
    const { result } = await open(service, false)
    expect(POSTS_PAGE).toBe(10)
    expect(service.readNote).toHaveBeenCalledTimes(10)
    expect(result.current.posts).toHaveLength(10)
    expect(result.current.hasOlder).toBe(true)
  })

  test('"Load older" reads the next ten, and only those', async () => {
    const { service } = many()
    const { result } = await open(service, false)
    await act(async () => result.current.loadOlder())
    await flush()
    expect(service.readNote).toHaveBeenCalledTimes(20)
    expect(result.current.posts).toHaveLength(20)
  })
})
