/**
 * What the member just asked of a room's records, laid over the posts until the room's list carries it
 * (`pendingRecordWrites`): read through the same fold and placement the chat uses.
 */
import { act, renderHook } from '@testing-library/react-native'

import { toInertText } from '../inertText'
import {
  isPendingRecordKey,
  landed,
  PENDING_WRITE_MAX_MS,
  type PendingWrite,
  type PendingWriteAsked,
  usePendingWrites,
  withPendingWrites,
} from '../pendingRecordWrites'
import { placeOf, reactionValueOfBody, type RoomPost } from '../roomPosts'
import { foldRoomRecords } from '../roomThread'

const ME = { did: 'did:peer:me' }
const NOOR = { did: 'did:peer:noor' }

const post = (key: string, text: string, over: Partial<RoomPost> = {}): RoomPost => ({
  key,
  version: 1,
  author: NOOR,
  byAgent: false,
  mine: false,
  text: toInertText(text),
  isChatMessage: true,
  retracted: false,
  pinned: false,
  unread: false,
  files: [],
  kind: 'message',
  ...over,
})
const myReaction = (key: string, on: string, value: string) =>
  post(key, value, { kind: 'reaction', inReplyTo: { key: on }, author: ME, mine: true, isChatMessage: false })

const M1 = post('m1', 'Hi all', { version: 4 })
let ids = 0
const write = (w: PendingWriteAsked & { id?: number; written?: PendingWrite['written'] }): PendingWrite => ({
  ...w,
  id: w.id ?? ++ids,
})

const mineOn = (posts: RoomPost[], on: string) =>
  foldRoomRecords(posts)
    .mine.get(on)
    ?.map((r) => r.value)

describe('what is on its way, laid over the posts', () => {
  test('a reaction counts at once as yours, on its target, and is drawn nowhere', () => {
    const laid = withPendingWrites(
      [M1],
      [write({ type: 'reaction', target: { key: 'm1', version: 4 }, value: '👍', author: ME })]
    )
    expect(mineOn(laid, 'm1')).toEqual(['👍'])
    const thread = foldRoomRecords(laid)
    expect(thread.reactions.get('m1')?.map((t) => [t.value, t.count, t.mine])).toEqual([['👍', 1, true]])
    expect(laid.filter((p) => isPendingRecordKey(p.key)).map(placeOf)).toEqual(['nowhere'])
  })

  test('a changed reaction counts with its new value', () => {
    const laid = withPendingWrites(
      [myReaction('r1', 'm1', '👍'), M1],
      [write({ type: 'changeReaction', key: 'r1', value: '❤️' })]
    )
    // In the normal form values are compared in (reactionValueOfBody), as a stored one is.
    expect(mineOn(laid, 'm1')).toEqual([reactionValueOfBody('❤️')])
  })

  test('a reaction taken back counts for nothing', () => {
    const laid = withPendingWrites([myReaction('r1', 'm1', '👍'), M1], [write({ type: 'withdraw', key: 'r1' })])
    expect(mineOn(laid, 'm1')).toBeUndefined()
    expect(foldRoomRecords(laid).reactions.get('m1')).toBeUndefined()
  })

  test('a withdrawn message shows nowhere', () => {
    const mine = post('m2', 'We meet at 5', { author: ME, mine: true })
    const [laid] = withPendingWrites([mine], [write({ type: 'withdraw', key: 'm2' })])
    expect(placeOf(laid)).toBe('nowhere')
  })

  test('a withdrawn message that carried a file shows nowhere either: a withdrawal carries none', () => {
    const file = {
      id: 'f1',
      name: 'agenda.pdf',
      size: 10,
      mime: 'application/pdf',
    } as unknown as RoomPost['files'][number]
    const mine = post('m3', 'The agenda', { author: ME, mine: true, files: [file] })
    expect(placeOf(mine)).toBe('chat')
    const [laid] = withPendingWrites([mine], [write({ type: 'withdraw', key: 'm3' })])
    expect([placeOf(laid), laid.files]).toEqual(['nowhere', []])
  })

  test('an edit shows its new words, as edited', () => {
    const at = '2026-11-11T00:00:00.000Z'
    const [laid] = withPendingWrites(
      [post('m2', 'We meet at 5', { author: ME, mine: true })],
      [write({ type: 'edit', key: 'm2', body: 'We meet at 6', at })]
    )
    expect([String(laid.text), laid.editedAt, placeOf(laid)]).toEqual(['We meet at 6', at, 'chat'])
  })

  test('two reactions on their way: the newer first, as the posts are', () => {
    const laid = withPendingWrites(
      [M1],
      [
        write({ type: 'reaction', target: { key: 'm1', version: 4 }, value: '👍', author: ME, id: 101 }),
        write({ type: 'reaction', target: { key: 'm1', version: 4 }, value: '❤️', author: ME, id: 102 }),
      ]
    )
    expect(laid.map((p) => p.key)).toEqual(['pending-reaction:102', 'pending-reaction:101', 'm1'])
  })

  test('a write on a record the page does not hold changes nothing (control)', () => {
    const posts = [M1]
    expect(withPendingWrites(posts, [write({ type: 'edit', key: 'elsewhere', body: 'x', at: 'now' })])).toEqual(posts)
    expect(withPendingWrites(posts, [])).toBe(posts)
  })
})

describe('once the room carries it, the list alone says it', () => {
  const edit = (written?: { key: string; version: number }) =>
    write({ type: 'edit', key: 'm1', body: 'Hello all', at: 'now', ...(written ? { written } : {}) })

  test('landed at the version written or newer, not before', () => {
    expect(landed([M1], edit())).toBe(false)
    expect(landed([M1], edit({ key: 'm1', version: 5 }))).toBe(false)
    expect(landed([{ ...M1, version: 5 }], edit({ key: 'm1', version: 5 }))).toBe(true)
    expect(landed([{ ...M1, version: 6 }], edit({ key: 'm1', version: 5 }))).toBe(true)
  })

  test('a landed write is not laid over the list (the room’s words win)', () => {
    const now = [{ ...M1, version: 5, text: toInertText('Hello all, from the room') }]
    expect(withPendingWrites(now, [edit({ key: 'm1', version: 5 })])).toBe(now)
  })
})

describe('usePendingWrites', () => {
  afterEach(() => jest.useRealTimers())

  test('lays a write while it is written, keeps it once written, and lets go when the list carries it', async () => {
    let finish!: (w: { key: string; version: number }) => void
    const { result, rerender } = renderHook((props: { posts: RoomPost[] }) => usePendingWrites(props.posts), {
      initialProps: { posts: [M1] },
    })
    let done!: Promise<void>
    act(() => {
      done = result.current.track(
        { type: 'edit', key: 'm1', body: 'Hello all', at: 'now' },
        () => new Promise((resolve) => (finish = resolve))
      )
    })
    expect(result.current.writes).toHaveLength(1)
    await act(async () => {
      finish({ key: 'm1', version: 5 })
      await done
    })
    expect(result.current.writes[0].written).toEqual({ key: 'm1', version: 5 })
    rerender({ posts: [{ ...M1, version: 5 }] })
    expect(result.current.writes).toHaveLength(0)
  })

  test('a write that fails is taken off at once, and its failure passed on', async () => {
    const { result } = renderHook(() => usePendingWrites([M1]))
    let caught: unknown
    await act(async () => {
      await result.current
        .track({ type: 'withdraw', key: 'm1' }, () => Promise.reject(new Error('not reached')))
        .catch((e: unknown) => (caught = e))
    })
    expect((caught as Error).message).toBe('not reached')
    expect(result.current.writes).toHaveLength(0)
  })

  test(`one the list never shows is let go ${PENDING_WRITE_MAX_MS / 1000} s after it was written`, async () => {
    jest.useFakeTimers()
    const { result } = renderHook(() => usePendingWrites([M1]))
    await act(async () => {
      await result.current.track({ type: 'withdraw', key: 'm1' }, async () => ({ key: 'm1', version: 9 }))
    })
    act(() => jest.advanceTimersByTime(PENDING_WRITE_MAX_MS - 1))
    expect(result.current.writes).toHaveLength(1)
    act(() => jest.advanceTimersByTime(1))
    expect(result.current.writes).toHaveLength(0)
  })
})
