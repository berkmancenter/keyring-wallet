/**
 * An open room's chat opens on the wallet's kept posts and keeps what its own listing drew (useRoomPosts with
 * `messageCache`, rooms/messageCache; docs/plans/rooms-local-message-cache-plan.md). The kept posts are shown until the
 * first listing answers, never after it fails; only what a confirmed listing drew is kept, and never once its scope was
 * emptied this run (ac: the writer PR's rows are the ones that fail when a keep follows a removal).
 */
import { act, renderHook } from '@testing-library/react-native'
import { AppState } from 'react-native'

import { toInertText } from '../inertText'
import {
  emptyMessageCache,
  keepRoomPosts,
  resetMessageCache,
  ROOMS_MESSAGE_CACHE,
  setMessageCacheBiometryGate,
} from '../messageCache'
import { resetKeptListings } from '../keptListings'
import { RoomsRefused, type Note, type NoteList, type NoteSummary, type RoomsService } from '../types'
import { MESSAGE_KEEP_DELAY_MS, type RoomPosts, useRoomPosts } from '../useRoomPosts'
import { cacheWallet } from './fixtures/cacheWallet'

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('../../../../__mocks__/@react-navigation/native'),
  useIsFocused: () => true,
}))
jest.mock('../useRoomRows', () => ({ onRoomsListed: jest.fn() }))

const ROOM = 'did:webvh:r:open'
const LAB = 'did:webvh:lab'
const ME = { did: 'did:peer:2.me' }
const CONSISTENT = { verdict: 'consistent' as const, detail: '' }
const NOW = Date.now()

const note = (key: string, version: number): Note => ({
  key,
  version,
  status: 'active',
  pinned: false,
  updatedAt: new Date(NOW - (10 - version) * 60_000).toISOString(),
  writtenAt: new Date(NOW - (10 - version) * 60_000).toISOString(),
  author: { did: 'did:peer:them' },
  body: toInertText(`the words of ${key}`),
  flags: { containsLink: false, looksLikeInstruction: false },
  check: CONSISTENT,
})
const summaryOf = ({ body: _b, flags: _f, check: _c, ...summary }: Note): NoteSummary => summary

/** A room whose full listings can be held until answered or refused, on an agent with a wallet. */
function roomWith(initial: Note[]) {
  const records = new Map(initial.map((n) => [n.key, n]))
  const wallet = cacheWallet()
  let held: { answer: () => void; fail: (e: Error) => void } | undefined
  let holding = false
  const answer = (): NoteList => ({ notes: [...records.values()].map(summaryOf), complete: true, check: CONSISTENT })
  const service = {
    runsOn: wallet,
    listNotes: jest.fn(async (_roomId: string, options: { sinceVersion?: number } = {}) => {
      if (options.sinceVersion === undefined && holding)
        return new Promise<NoteList>((resolve, reject) => {
          held = { answer: () => resolve(answer()), fail: reject }
        })
      return answer()
    }),
    readNote: jest.fn(async (_roomId: string, key: string) => records.get(key)!),
  } as unknown as RoomsService & { listNotes: jest.Mock; readNote: jest.Mock }
  return {
    service,
    wallet,
    write: (n: Note) => records.set(n.key, n),
    hold: () => {
      holding = true
    },
    answer: async () => {
      await act(async () => held?.answer())
      await flush()
    },
    fail: async (e: Error) => {
      await act(async () => held?.fail(e))
      await flush()
    },
  }
}

const flush = async () => {
  for (let i = 0; i < 4; i++) await act(async () => undefined)
}
const CACHE = { messageCache: { communityDid: LAB } }
const open = async (service: RoomsService, options: Parameters<typeof useRoomPosts>[6] = CACHE, actingAs = ME) => {
  const hook = renderHook<RoomPosts, Record<string, never>>(() =>
    useRoomPosts(service, ROOM, actingAs, true, true, undefined, options)
  )
  await flush()
  return hook
}
const keys = (posts?: { key: string }[]) => posts?.map((p) => p.key)
const keptWords = (w: ReturnType<typeof cacheWallet>) => JSON.stringify(w.copies())
/** Lets the writer's settle delay pass. */
const settle = async () => {
  await act(async () => jest.advanceTimersByTime(MESSAGE_KEEP_DELAY_MS))
  await flush()
}

beforeEach(() => {
  jest.useFakeTimers({ now: NOW })
  jest.spyOn(AppState, 'addEventListener').mockImplementation((() => ({ remove: jest.fn() })) as never)
  setMessageCacheBiometryGate(async () => true)
  resetMessageCache()
  resetKeptListings()
})
afterEach(() => {
  ROOMS_MESSAGE_CACHE.on = true
  ROOMS_MESSAGE_CACHE.remoteOff = false
  jest.useRealTimers()
  jest.restoreAllMocks()
})

describe('keeping what the room drew', () => {
  it("keeps what the room's own listing drew, once it settles", async () => {
    const r = roomWith([note('a', 1), note('b', 2)])
    await open(r.service)
    expect(keptWords(r.wallet)).not.toContain('the words of')
    await settle()
    expect(keptWords(r.wallet)).toContain('the words of a')
    expect(keptWords(r.wallet)).toContain('the words of b')
  })

  it('control: a screen not given messageCache (a sealed room, or not the chat) keeps and reads nothing', async () => {
    const r = roomWith([note('a', 1)])
    await open(r.service, {})
    await settle()
    expect(r.wallet.genericRecords.save).not.toHaveBeenCalled()
    expect(r.wallet.genericRecords.findById).not.toHaveBeenCalled()
  })

  it('a keep after its community was emptied puts nothing back (ac: the row the writer PR owes)', async () => {
    const r = roomWith([note('a', 1)])
    await open(r.service)
    // A removal lands while the drawn posts are still settling.
    await act(async () => void (await emptyMessageCache(r.wallet, { community: LAB }, 'removed')))
    await settle()
    expect(keptWords(r.wallet)).not.toContain('the words of')
  })
})

describe('opening on the kept posts', () => {
  const keptBefore = async (r: ReturnType<typeof roomWith>) =>
    keepRoomPosts(
      r.wallet,
      { personaDid: ME.did, roomId: ROOM, communityDid: LAB },
      [
        {
          key: 'a',
          version: 1,
          author: 'did:peer:them',
          writtenAt: new Date(NOW - 120_000).toISOString(),
          body: 'kept a',
        },
        {
          key: 'b',
          version: 2,
          author: 'did:peer:them',
          writtenAt: new Date(NOW - 60_000).toISOString(),
          body: 'kept b',
        },
      ],
      NOW
    )

  it('draws them at once, unconfirmed, and the first listing replaces them', async () => {
    const r = roomWith([note('a', 1), note('b', 2), note('c', 3)])
    await keptBefore(r)
    r.hold()
    const hook = await open(r.service)
    expect(keys(hook.result.current.posts)).toEqual(['b', 'a'])
    expect(hook.result.current.posts?.[0].text).toBe('kept b')
    expect(hook.result.current.unconfirmed).toBe(true)
    // Nothing is read for them: their words came with them.
    expect(r.service.readNote).not.toHaveBeenCalled()

    await r.answer()
    expect(keys(hook.result.current.posts)).toEqual(['c', 'b', 'a'])
    expect(hook.result.current.unconfirmed).toBe(false)
  })

  it('a refused first listing takes them down and empties the copy', async () => {
    const r = roomWith([note('a', 1)])
    await keptBefore(r)
    r.hold()
    const hook = await open(r.service)
    expect(keys(hook.result.current.posts)).toEqual(['b', 'a'])
    await r.fail(new RoomsRefused('listNotes', 'notAMember', false, 'not a member'))
    expect(hook.result.current.posts).toBeUndefined()
    expect(hook.result.current.failed).toBe(true)
    expect(keptWords(r.wallet)).not.toContain('kept')
  })

  it('control: any other failure takes them down too, and leaves the copy for the triggers', async () => {
    const r = roomWith([note('a', 1)])
    await keptBefore(r)
    r.hold()
    const hook = await open(r.service)
    await r.fail(new Error('offline'))
    expect(hook.result.current.posts).toBeUndefined()
    expect(hook.result.current.unconfirmed).toBe(false)
    expect(keptWords(r.wallet)).toContain('kept b')
  })

  it('control: another identity on the phone opens on nothing', async () => {
    const r = roomWith([note('a', 1)])
    await keptBefore(r)
    r.hold()
    const hook = await open(r.service, CACHE, { did: 'did:peer:2.someone-else' })
    expect(hook.result.current.posts).toBeUndefined()
  })

  it('control: switched off, it opens on nothing and keeps nothing', async () => {
    const r = roomWith([note('a', 1)])
    await keptBefore(r)
    ROOMS_MESSAGE_CACHE.remoteOff = true
    r.hold()
    const hook = await open(r.service)
    expect(hook.result.current.posts).toBeUndefined()
  })

  it('never keeps what the kept copy drew: only a confirmed listing writes', async () => {
    const r = roomWith([note('a', 1)])
    await keptBefore(r)
    r.hold()
    await open(r.service)
    r.wallet.genericRecords.update.mockClear()
    r.wallet.genericRecords.save.mockClear()
    await settle()
    expect(r.wallet.genericRecords.save).not.toHaveBeenCalled()
    expect(r.wallet.genericRecords.update).not.toHaveBeenCalled()
  })
})
