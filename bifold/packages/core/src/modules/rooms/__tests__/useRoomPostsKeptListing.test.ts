/**
 * 11-17: every opening of a room waited for a full listing before it showed a post, the same room's of a moment before
 * included. A room opened again this run shows its last listing at once and reads behind it (keptListings).
 */
import { act, renderHook } from '@testing-library/react-native'
import { AppState, DeviceEventEmitter } from 'react-native'

import { WALLET_LOCKED_EVENT } from '../../../utils/walletLocked'
import { toInertText } from '../inertText'
import { ROOMS_KEPT_LISTINGS, resetKeptListings } from '../keptListings'
import type { Note, NoteList, NoteSummary, RoomsService } from '../types'
import { type RoomPosts, useRoomPosts } from '../useRoomPosts'

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('../../../../__mocks__/@react-navigation/native'),
  useIsFocused: () => true,
}))

const ROOM = 'did:webvh:r:one'
const ME = { did: 'did:peer:2.me' }
const CONSISTENT = { verdict: 'consistent' as const, detail: '' }

const note = (key: string, version: number): Note => ({
  key,
  version,
  status: 'active',
  pinned: false,
  updatedAt: `2026-11-17T09:${String(version).padStart(2, '0')}:00Z`,
  author: { did: 'did:peer:them' },
  body: toInertText(`post ${key} v${version}`),
  flags: { containsLink: false, looksLikeInstruction: false },
  check: CONSISTENT,
})
const summaryOf = ({ body: _b, flags: _f, check: _c, ...summary }: Note): NoteSummary => summary

/** A room whose full listings can be held (`hold`) until released, and whose records the test changes. */
const roomWith = (initial: Note[]) => {
  const records = new Map(initial.map((n) => [n.key, n]))
  const answer = (since: number): NoteList => ({
    notes: [...records.values()].filter((n) => n.version > since).map(summaryOf),
    complete: true,
    check: CONSISTENT,
  })
  let held: { release: () => void; fail: (e: Error) => void } | undefined
  let holding = false
  const listNotes = jest.fn(async (_roomId: string, options: { sinceVersion?: number } = {}): Promise<NoteList> => {
    if (options.sinceVersion === undefined && holding)
      return new Promise<NoteList>((resolve, reject) => {
        held = { release: () => resolve(answer(0)), fail: reject }
      })
    return answer(options.sinceVersion ?? 0)
  })
  const service = {
    listNotes,
    readNote: jest.fn(async (_roomId: string, key: string) => {
      const found = records.get(key)
      if (!found) throw new Error('no such post')
      return found
    }),
    note: jest.fn(),
  } as unknown as RoomsService & { listNotes: jest.Mock; note: jest.Mock }
  return {
    service,
    write: (n: Note) => records.set(n.key, n),
    /** Full listings asked from now wait for `release` or `fail`. */
    hold: () => {
      holding = true
    },
    release: async () => {
      await act(async () => held?.release())
      await flush()
    },
    fail: async (e: Error) => {
      await act(async () => held?.fail(e))
      await flush()
    },
  }
}

const flush = async () => {
  await act(async () => undefined)
  await act(async () => undefined)
}
const open = async (service: RoomsService) => {
  const hook = renderHook<RoomPosts, Record<string, never>>(() => useRoomPosts(service, ROOM, ME, true, true))
  await flush()
  return hook
}
const keys = (posts?: { key: string }[]) => posts?.map((p) => p.key)

beforeEach(() => {
  jest.useFakeTimers()
  jest.spyOn(AppState, 'addEventListener').mockImplementation((() => ({ remove: jest.fn() })) as never)
})
afterEach(() => {
  resetKeptListings()
  ROOMS_KEPT_LISTINGS.on = true
  ROOMS_KEPT_LISTINGS.remoteOff = false
  jest.useRealTimers()
  jest.restoreAllMocks()
})

describe('a room opened again this run', () => {
  it('shows its last listing at once, and what is new once its listing answers', async () => {
    const r = roomWith([note('a', 1), note('b', 2)])
    const first = await open(r.service)
    expect(keys(first.result.current.posts)).toEqual(['b', 'a'])
    first.unmount()

    r.hold()
    r.write(note('c', 3))
    const again = await open(r.service)
    // Before its listing answers: the posts read before.
    expect(keys(again.result.current.posts)).toEqual(['b', 'a'])
    expect(again.result.current.failed).toBe(false)
    act(() => again.result.current.painted())
    const lines = r.service.note.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith('[Room] '))
    expect(lines[lines.length - 1]).toMatch(/opened: \d+ posts shown in \d+ ms \(kept listing\)$/)

    await r.release()
    expect(keys(again.result.current.posts)).toEqual(['c', 'b', 'a'])
  })

  it('control: a room opened for the first time waits for its listing, as before', async () => {
    const r = roomWith([note('a', 1)])
    r.hold()
    const hook = await open(r.service)
    expect(hook.result.current.posts).toBeUndefined()
    await r.release()
    expect(keys(hook.result.current.posts)).toEqual(['a'])
  })

  it.each([
    ['switched off', { on: false, remoteOff: false }],
    ['turned off remotely', { on: true, remoteOff: true }],
    ['not a boolean (fails closed)', { on: 'true' as unknown as boolean, remoteOff: false }],
  ])('control: %s, a room opened again waits for its listing, as before', async (_name, values) => {
    const r = roomWith([note('a', 1)])
    ;(await open(r.service)).unmount()
    Object.assign(ROOMS_KEPT_LISTINGS, values)

    r.hold()
    const again = await open(r.service)
    expect(again.result.current.posts).toBeUndefined()
  })

  it('a room whose listing now fails (left since) shows nothing kept, and keeps nothing for the next opening', async () => {
    const r = roomWith([note('a', 1)])
    ;(await open(r.service)).unmount()

    r.hold()
    const again = await open(r.service)
    expect(keys(again.result.current.posts)).toEqual(['a'])
    await r.fail(new Error('not in the room'))
    expect(again.result.current.posts).toBeUndefined()
    expect(again.result.current.failed).toBe(true)
    again.unmount()

    const third = await open(r.service)
    expect(third.result.current.posts).toBeUndefined()
  })

  it('control: a listing that fails after one answered keeps what was shown, as before', async () => {
    const r = roomWith([note('a', 1)])
    const hook = await open(r.service)
    expect(keys(hook.result.current.posts)).toEqual(['a'])
    r.hold()
    act(() => hook.result.current.refresh())
    await flush()
    await r.fail(new Error('agent not ready'))
    expect(keys(hook.result.current.posts)).toEqual(['a'])
    expect(hook.result.current.failed).toBe(true)
  })

  // ac (11-17): the seed was the first room's for the life of the screen, so no other room under it was seeded.
  it('a second room opened under the same screen shows its own kept listing too', async () => {
    const TWO = 'did:webvh:r:two'
    const byRoom: Record<string, Note[]> = { [ROOM]: [note('a', 1)], [TWO]: [note('x', 1), note('y', 2)] }
    let holding = false
    let release: () => void = () => undefined
    const answer = (roomId: string): NoteList => ({
      notes: byRoom[roomId].map(summaryOf),
      complete: true,
      check: CONSISTENT,
    })
    const service = {
      listNotes: jest.fn(async (roomId: string, options: { sinceVersion?: number } = {}) => {
        if (options.sinceVersion === undefined && holding)
          return new Promise<NoteList>((resolve) => {
            release = () => resolve(answer(roomId))
          })
        return answer(roomId)
      }),
      readNote: jest.fn(async (roomId: string, key: string) => byRoom[roomId].find((n) => n.key === key)!),
      note: jest.fn(),
    } as unknown as RoomsService
    const screen = (roomId: string) =>
      renderHook<RoomPosts, { roomId: string }>((p) => useRoomPosts(service, p.roomId, ME, true, true), {
        initialProps: { roomId },
      })
    // Both rooms listed once this run.
    const first = screen(ROOM)
    await flush()
    first.rerender({ roomId: TWO })
    await flush()
    expect(keys(first.result.current.posts)).toEqual(['y', 'x'])
    first.unmount()

    holding = true
    const again = screen(ROOM)
    await flush()
    expect(keys(again.result.current.posts)).toEqual(['a'])
    again.rerender({ roomId: TWO })
    await flush()
    // Before the second room's listing answers: its own kept posts, not the first room's.
    expect(keys(again.result.current.posts)).toEqual(['y', 'x'])
    await act(async () => release())
    await flush()
    expect(keys(again.result.current.posts)).toEqual(['y', 'x'])
  })

  it('keeps nothing across a lock, nor for another service', async () => {
    const r = roomWith([note('a', 1)])
    ;(await open(r.service)).unmount()
    const other = roomWith([note('a', 1)])
    other.hold()
    expect((await open(other.service)).result.current.posts).toBeUndefined()

    DeviceEventEmitter.emit(WALLET_LOCKED_EVENT)
    r.hold()
    expect((await open(r.service)).result.current.posts).toBeUndefined()
  })
})
