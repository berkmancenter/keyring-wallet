/**
 * New posts appear while a room is open: every ten seconds while it is in view and the app is in the foreground,
 * the room is listed from the newest version held, and only what is new or changed is read. A poll never queues
 * behind a listing still being asked, a failed one waits two ticks, and one that finds nothing redraws nothing.
 * Timers are stepped one interval at a time, and each test counts the asks.
 */
import { act, renderHook } from '@testing-library/react-native'
import { AppState } from 'react-native'

import { toInertText } from '../inertText'
import { isChatPost, type RoomPost } from '../roomPosts'
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
  // The room's last prune, as browse 0.3 passes it on: every answer carries it, the full listing and a poll alike.
  let lastPrune: NoteList['lastPrune']
  const service = {
    listNotes: jest.fn(async (_roomId: string, options: { sinceVersion?: number } = {}): Promise<NoteList> => {
      const since = options.sinceVersion ?? 0
      return {
        notes: [...records.values()].filter((n) => n.version > since).map(summaryOf),
        complete: true,
        check: CONSISTENT,
        ...(lastPrune ? { lastPrune } : {}),
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
    /** The host removes these records outright, tombstones included, at room version `version`. */
    prune: (keys: string[], version: number) => {
      for (const key of keys) records.delete(key)
      lastPrune = { version, prunedAt: '2026-10-30T12:00:00Z', removed: keys.length }
    },
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

  test('a failed poll keeps the posts shown and waits two ticks before the next', async () => {
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

  test('a failed poll is said once: more failures redraw nothing, and the next success clears it with one redraw', async () => {
    const { service } = roomWith([note('a', 1)])
    let renders = 0
    const { result } = renderHook(() => {
      renders++
      return useRoomPosts(service, ROOM, ME, true, true)
    })
    await flush()
    await flush()
    expect(result.current.pollFailed).toBe(false)
    service.listNotes.mockRejectedValueOnce(new Error('the agent did not answer'))
    await tick()
    expect(result.current.pollFailed).toBe(true)
    const afterFirst = renders

    // The skipped ticks, then a second failure: still failed, and nothing redrawn.
    for (let i = 0; i < POLL_SKIPS_AFTER_FAILURE; i++) await tick()
    service.listNotes.mockRejectedValueOnce(new Error('still not answering'))
    await tick()
    expect(polls(service)).toHaveLength(2)
    expect(result.current.pollFailed).toBe(true)
    expect(renders).toBe(afterFirst)

    // A success with nothing new clears it: one redraw, for the flip alone.
    for (let i = 0; i < POLL_SKIPS_AFTER_FAILURE; i++) await tick()
    await tick()
    expect(polls(service)).toHaveLength(3)
    expect(result.current.pollFailed).toBe(false)
    expect(renders).toBe(afterFirst + 1)

    // And a success while none is said redraws nothing.
    await tick()
    expect(polls(service)).toHaveLength(4)
    expect(renders).toBe(afterFirst + 1)
  })

  test('pollNow asks at once, without waiting out the skipped ticks; a success clears the failure', async () => {
    const { service, write } = roomWith([note('a', 1)])
    const { result } = await open(service)
    service.listNotes.mockRejectedValueOnce(new Error('the agent did not answer'))
    await tick()
    expect(result.current.pollFailed).toBe(true)
    write(note('b', 2))
    await act(async () => result.current.pollNow())
    await flush()
    expect(polls(service)).toHaveLength(2)
    expect(polls(service)[1][1]).toEqual({ sinceVersion: 1 })
    expect(result.current.pollFailed).toBe(false)
    await flush()
    expect(result.current.posts?.map((p) => p.key)).toEqual(['b', 'a'])
  })

  test('pollNow keeps one ask in flight: taps while it is asked send nothing more, and a tap after it fails asks once', async () => {
    const { service } = roomWith([note('a', 1)])
    const { result } = await open(service)
    service.listNotes.mockRejectedValueOnce(new Error('the agent did not answer'))
    await tick()
    expect(result.current.pollFailed).toBe(true)
    let fail: (e: Error) => void = () => undefined
    service.listNotes.mockImplementationOnce(() => new Promise((_resolve, reject) => (fail = reject)))
    await act(async () => {
      for (let i = 0; i < 10; i++) result.current.pollNow()
    })
    expect(polls(service)).toHaveLength(2)
    await act(async () => fail(new Error('still not answering')))
    await flush()
    expect(result.current.pollFailed).toBe(true)
    await act(async () => result.current.pollNow())
    await flush()
    expect(polls(service)).toHaveLength(3)
  })

  test('pollNow asks nothing while the room is not polled', async () => {
    const { service } = roomWith([note('a', 1)])
    const { result } = await open(service, false)
    await act(async () => result.current.pollNow())
    await flush()
    expect(polls(service)).toHaveLength(0)
  })

  test('a standing conflict shows once, then redraws nothing tick after tick', async () => {
    const { service } = roomWith([note('a', 1)])
    const { result } = await open(service)
    const conflict = { verdict: 'conflict' as const, detail: 'the host contradicts what it served before' }
    // Each answer a fresh object, as each parse of the agent's answer is.
    service.listNotes.mockImplementation(async () => ({ notes: [], complete: true, check: { ...conflict } }))
    await tick()
    expect(result.current.check?.verdict).toBe('conflict')
    const shown = result.current.posts
    await tick()
    await tick()
    expect(polls(service)).toHaveLength(3)
    expect(result.current.posts).toBe(shown)
  })

  test('a first listing that throws before it returns a promise says so, and polling works after a refresh', async () => {
    const { service, write } = roomWith([note('a', 1)])
    service.listNotes.mockImplementationOnce(() => {
      throw new Error('no agent client')
    })
    const { result } = await open(service)
    expect(result.current.failed).toBe(true)
    await act(async () => result.current.refresh())
    await flush()
    expect(result.current.posts?.map((p) => p.key)).toEqual(['a'])
    write(note('b', 2))
    await tick()
    expect(polls(service)).toHaveLength(1)
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

// rooms/keys/browse 0.3 passes on the room's `lastPrune`. A prune removes records outright, so a poll from the newest
// version held never mentions them: a `lastPrune.version` above what this phone has synced means rebuild from a full
// listing and drop what it no longer holds (browse 0.3 spec, "a caller that keeps its own copy of the room").
describe('a room pruned while it is open', () => {
  const keys = (posts?: { key: string }[]) => posts?.map((p) => p.key)

  test('a prune past what the phone holds is caught up from a full listing: the pruned posts go', async () => {
    const room = roomWith([note('a', 1), note('b', 2), note('c', 3)])
    const { result } = await open(room.service)
    expect(keys(result.current.posts)).toEqual(['c', 'b', 'a'])
    room.prune(['b'], 4)
    await tick()
    await flush()
    expect(keys(result.current.posts)).toEqual(['c', 'a'])
    // One poll, then one full listing to rebuild from.
    expect(room.service.listNotes.mock.calls.map(([, o]) => o?.sinceVersion)).toEqual([undefined, 3, undefined])
  })

  test('a prune that took the newest post: rebuilt once, not again on every poll after', async () => {
    const room = roomWith([note('a', 1), note('b', 2), note('c', 3)])
    const { result } = await open(room.service)
    room.prune(['c'], 4)
    await tick()
    await flush()
    expect(keys(result.current.posts)).toEqual(['b', 'a'])
    // The newest version held is now 2, below the prune's 4: the prune already applied is what stops a rebuild loop.
    await tick()
    await tick()
    await flush()
    const full = room.service.listNotes.mock.calls.filter(([, o]) => o?.sinceVersion === undefined)
    expect(full).toHaveLength(2)
  })

  test('a prune the first listing already reflects changes nothing', async () => {
    const room = roomWith([note('a', 1), note('b', 2), note('c', 3)])
    room.prune(['b'], 2)
    const { result } = await open(room.service)
    expect(keys(result.current.posts)).toEqual(['c', 'a'])
    await tick()
    await flush()
    expect(room.service.listNotes.mock.calls.map(([, o]) => o?.sinceVersion)).toEqual([undefined, 3])
  })

  test('a new post and a prune in the same poll: the full listing has both', async () => {
    const room = roomWith([note('a', 1), note('b', 2)])
    const { result } = await open(room.service)
    room.write(note('d', 4))
    room.prune(['a'], 5)
    await tick()
    await flush()
    expect(keys(result.current.posts)).toEqual(['d', 'b'])
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

  test("a failed poll's waiting ticks are kept across leaving and coming back: no catch-up while they are owed", async () => {
    const { service } = roomWith([note('a', 1)])
    const hook = await open(service)
    service.listNotes.mockRejectedValueOnce(new Error('the agent did not answer'))
    await tick()
    expect(polls(service)).toHaveLength(1)

    hook.rerender({ inView: false })
    hook.rerender({ inView: true })
    await flush()
    expect(polls(service)).toHaveLength(1)
    for (let i = 0; i < POLL_SKIPS_AFTER_FAILURE; i++) await tick()
    expect(polls(service)).toHaveLength(1)
    await tick()
    expect(polls(service)).toHaveLength(2)
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
describe('drawing posts as their reads land', () => {
  /** A room of three posts whose reads answer when the test says: c is newest, a oldest. */
  const heldRoom = () => {
    const { service } = roomWith([note('a', 1), note('b', 2), note('c', 3)])
    const answers = new Map<string, { ok: () => void; fail: () => void }>()
    service.readNote.mockImplementation(
      (_roomId: string, key: string) =>
        new Promise<Note>((resolve, reject) =>
          answers.set(key, {
            ok: () => resolve(note(key, { a: 1, b: 2, c: 3 }[key] ?? 1)),
            fail: () => reject(new Error(`could not read ${key}`)),
          })
        )
    )
    const answer = async (key: string, how: 'ok' | 'fail' = 'ok') => {
      await act(async () => answers.get(key)?.[how]())
      await flush()
    }
    return { service, answer }
  }
  const keys = (posts?: { key: string }[]) => posts?.map((p) => p.key)

  test('newest first, each as it lands: the list grows only at its oldest end', async () => {
    const { service, answer } = heldRoom()
    const { result } = await open(service)
    expect(result.current.posts).toBeUndefined()
    await answer('c')
    expect(keys(result.current.posts)).toEqual(['c'])
    // An older post that lands before a newer one waits for it: nothing is drawn out of order.
    await answer('a')
    expect(keys(result.current.posts)).toEqual(['c'])
    await answer('b')
    expect(keys(result.current.posts)).toEqual(['c', 'b', 'a'])
  })

  test('a read that fails holds the older ones until every read has answered; then it shows as unread', async () => {
    const { service, answer } = heldRoom()
    const { result } = await open(service)
    await answer('c')
    await answer('b', 'fail')
    await answer('a')
    expect(keys(result.current.posts)).toEqual(['c', 'b', 'a'])
    expect(result.current.posts?.[1].unread).toBe(true)
  })
})

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

// 276.9: a reopened room drew 8 of its posts and stopped, with no read slow or failed. Its newest ten records held
// notes, which the chat leaves out, so the page drew fewer than ten and filled the screen; the rest came only with a
// scroll up. A chat's page counts chat posts.
describe('a page counted in chat posts', () => {
  /** A room of `count` records, n1 oldest; the ones in `notes` have a title (notes, which the chat leaves out). */
  const roomOf = (count: number, notes: string[]) =>
    roomWith(
      Array.from({ length: count }, (_, i) =>
        note(`n${i + 1}`, i + 1, notes.includes(`n${i + 1}`) ? { title: toInertText(`note n${i + 1}`) } : {})
      )
    )
  const openCounting = async (service: RoomsService) => {
    const hook = renderHook(() => useRoomPosts(service, ROOM, ME, true, false, isChatPost))
    for (let i = 0; i < 6; i++) await flush()
    return hook
  }
  const chat = (posts?: RoomPost[]) => (posts ?? []).filter(isChatPost)

  test('notes among the newest records are read too, and the page holds ten chat posts', async () => {
    const { service } = roomOf(14, ['n13', 'n11'])
    const { result } = await openCounting(service)
    expect(chat(result.current.posts)).toHaveLength(10)
    expect(result.current.posts).toHaveLength(12)
    expect(service.readNote).toHaveBeenCalledTimes(12)
    expect(result.current.hasOlder).toBe(true)
  })

  test("a private room's note, known as one only once read, does not count either", async () => {
    const { service } = roomOf(14, ['n13', 'n11'])
    const list = service.listNotes.getMockImplementation()!
    // Sealed: the listing does not carry the title, only the read record does.
    service.listNotes.mockImplementation(async (...args: [string, { sinceVersion?: number }?]) => {
      const listed = await list(...args)
      return { ...listed, notes: listed.notes.map(({ title: _t, ...summary }: NoteSummary) => summary) }
    })
    const { result } = await openCounting(service)
    expect(chat(result.current.posts)).toHaveLength(10)
    expect(service.readNote).toHaveBeenCalledTimes(12)
  })

  test('"Load older" reads on to the next ten chat posts', async () => {
    const { service } = roomOf(31, ['n30', 'n25', 'n18'])
    const { result } = await openCounting(service)
    expect(chat(result.current.posts)).toHaveLength(10)
    await act(async () => result.current.loadOlder())
    for (let i = 0; i < 6; i++) await flush()
    expect(chat(result.current.posts)).toHaveLength(20)
    expect(result.current.posts).toHaveLength(23)
    expect(result.current.loadingOlder).toBe(false)
  })

  test('a room with fewer chat posts than a page reads every record once and stops', async () => {
    const { service } = roomOf(5, ['n4', 'n2'])
    const { result } = await openCounting(service)
    expect(chat(result.current.posts)).toHaveLength(3)
    expect(service.readNote).toHaveBeenCalledTimes(5)
    expect(result.current.hasOlder).toBe(false)
  })
})
