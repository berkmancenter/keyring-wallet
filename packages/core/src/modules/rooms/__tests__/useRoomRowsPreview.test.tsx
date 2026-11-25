/**
 * A Messages row not read yet this run shows its room's newest post from the wallet's kept copy at once (Alberto, 11-25:
 * "Yes, show it at once"), instead of an empty line until the room is read: message words read at launch, only what
 * the copy holds and only under the copy's own checks. The room's read replaces it; an emptying takes it down.
 */
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useFocusEffect } from '@react-navigation/native'
import { act, renderHook } from '@testing-library/react-native'
import { AppState } from 'react-native'

import { newEventId } from '../../chat/eventId'
import { toInertText } from '../inertText'
import {
  bindMessageCache,
  type CachedPost,
  emptyMessageCache,
  keepRoomPosts,
  resetMessageCache,
  ROOMS_MESSAGE_CACHE,
  setMessageCacheBiometryGate,
} from '../messageCache'
import { chatMessageBody } from '../roomPosts'
import type { Note, NoteList, NoteSummary, RoomsService, RoomSummary } from '../types'
import {
  readRowPreviewsWith,
  resetRoomRows,
  ROOMS_HIDDEN_KEY,
  ROOMS_SEEN_KEY,
  type RowPreview,
  useRoomRows,
  useRoomRowsPoll,
} from '../useRoomRows'
import { cacheWallet } from './fixtures/cacheWallet'

jest.mock('../../trust-tasks/module/vtaAgent', () => ({
  vtaAgent: { subscribe: () => () => undefined, getState: () => ({}) },
}))

const ME = 'did:peer:2.me'
const SAM = 'did:key:z6MkSaddle'
const LAB = 'did:webvh:QmLab:lab.example'
const ROOM = 'did:webvh:QmRoom:planning'
const OTHER = 'did:webvh:QmRoom:garden'
const summary: RoomSummary = {
  roomId: ROOM,
  name: toInertText('planning'),
  nameFrom: 'community',
  source: 'community',
  communityDid: LAB,
  communityName: toInertText('Keyring Lab'),
  tier: 'open',
  standing: 'member',
}
const kept = (key: string, minutesAgo: number, author = SAM): CachedPost => ({
  key,
  version: 1,
  kind: 'chat',
  author,
  writtenAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
  body: `the words of ${key}`,
})
const live: NoteSummary = {
  key: 'fresh',
  version: 9,
  author: { did: SAM },
  updatedAt: new Date().toISOString(),
  status: 'active',
  pinned: false,
}

const other: RoomSummary = { ...summary, roomId: OTHER, name: toInertText('garden') }

/** A real wallet's kept copies, and rooms whose listings wait until the test answers them. */
function setup(communities = [{ did: LAB, personaDid: ME }], rooms = [summary]) {
  const wallet = cacheWallet()
  const answers = new Map<string, (notes: NoteSummary[]) => void>()
  const service = {
    isSample: false,
    runsOn: wallet,
    localCommunities: async () => communities,
    listMyRooms: jest.fn(async () => rooms),
    getRoom: jest.fn(async (roomId: string) => ({ ...rooms.find((r) => r.roomId === roomId), actingAs: { did: ME } })),
    listNotes: jest.fn(
      (roomId: string) =>
        new Promise<NoteList>((resolve) => {
          answers.set(roomId, (notes) =>
            resolve({ notes, complete: true, check: { verdict: 'consistent', detail: '' } })
          )
        })
    ),
    readNote: jest.fn(
      async (): Promise<Note> => ({
        ...live,
        body: toInertText(chatMessageBody('the fresh words', newEventId(), new Date())),
        flags: { containsLink: false, looksLikeInstruction: false },
        check: { verdict: 'consistent', detail: '' },
      })
    ),
  }
  return {
    wallet,
    service: service as unknown as RoomsService,
    keep: (posts: CachedPost[], roomId = ROOM) =>
      keepRoomPosts(wallet, { personaDid: ME, roomId, communityDid: LAB }, posts),
    bind: () =>
      bindMessageCache(wallet, async () => communities.map((c) => ({ communityDid: c.did, personaDid: c.personaDid }))),
    readRoom: (roomId = ROOM, notes = [live]) => act(async () => answers.get(roomId)?.(notes)),
  }
}

const flush = async () => {
  for (let i = 0; i < 8; i++) await act(async () => undefined)
}
const mount = async (service: RoomsService) => {
  renderHook(() => useRoomRowsPoll(service, true))
  const list = renderHook(() => useRoomRows())
  await flush()
  return (roomId = ROOM) => list.result.current.rows?.find((row) => row.roomId === roomId)
}

const preview = (text: string): RowPreview => ({
  post: { by: { did: SAM }, mine: false, text, kind: 'chat' },
  at: new Date(),
})
/** A reader of the copies whose reads the test answers, one room at a time, as the real one is asked. */
function heldReader() {
  const asked: string[] = []
  const answers = new Map<string, (p: RowPreview | undefined) => void>()
  readRowPreviewsWith(async () => async (roomId) => {
    asked.push(roomId)
    return new Promise<RowPreview | undefined>((resolve) => answers.set(roomId, resolve))
  })
  return { asked, answer: (roomId: string, p: RowPreview | undefined) => act(async () => answers.get(roomId)?.(p)) }
}

let biometry = true
beforeEach(async () => {
  jest.useFakeTimers()
  biometry = true
  setMessageCacheBiometryGate(async () => biometry)
  resetMessageCache()
  resetRoomRows()
  ROOMS_MESSAGE_CACHE.on = true
  await AsyncStorage.setItem(ROOMS_SEEN_KEY, '{}')
  await AsyncStorage.setItem(ROOMS_HIDDEN_KEY, '{}')
  ;(useFocusEffect as jest.Mock).mockImplementation(() => undefined)
  Object.defineProperty(AppState, 'currentState', { value: 'active', writable: true, configurable: true })
  jest.spyOn(AppState, 'addEventListener').mockImplementation((() => ({ remove: jest.fn() })) as never)
})
afterEach(() => {
  ROOMS_MESSAGE_CACHE.on = true
  ROOMS_MESSAGE_CACHE.remoteOff = false
  jest.useRealTimers()
  jest.restoreAllMocks()
})

describe("a row's newest post from the saved copy", () => {
  test('is shown at once while the room reads, then replaced by the read', async () => {
    const s = setup()
    await s.keep([kept('newest', 5), kept('older', 60)])
    await s.bind()
    const row = await mount(s.service)
    expect(row()?.reading).toBe(true)
    expect(row()?.lastPost).toMatchObject({ text: 'the words of newest', mine: false, kind: 'chat', by: { did: SAM } })
    expect(row()?.lastActivityAt?.getTime()).toBe(Date.parse(kept('newest', 5).writtenAt))
    await s.readRoom()
    await flush()
    expect(row()?.reading).toBeUndefined()
    expect(row()?.lastPost?.text).toContain('the fresh words')
  })

  test('the cache bound after Messages first read still draws it', async () => {
    const s = setup()
    await s.keep([kept('newest', 5)])
    const row = await mount(s.service)
    expect(row()?.lastPost).toBeUndefined()
    await act(async () => s.bind())
    await flush()
    expect(row()?.lastPost?.text).toBe('the words of newest')
  })

  test("the member's own post is said as theirs", async () => {
    const s = setup()
    await s.keep([kept('mine', 1, ME)])
    await s.bind()
    const row = await mount(s.service)
    expect(row()?.lastPost).toMatchObject({ text: 'the words of mine', mine: true })
  })

  test('an emptying takes it down at once', async () => {
    const s = setup()
    await s.keep([kept('newest', 5)])
    await s.bind()
    const row = await mount(s.service)
    expect(row()?.lastPost).toBeDefined()
    await act(async () => {
      await emptyMessageCache(s.wallet, { community: LAB }, 'removed')
    })
    expect(row()?.lastPost).toBeUndefined()
    expect(row()?.reading).toBe(true)
  })

  test('an emptying while the copy is still being read draws nothing from it', async () => {
    const s = setup()
    await s.keep([kept('newest', 5)])
    const held = heldReader()
    const row = await mount(s.service)
    expect(held.asked).toEqual([ROOM])
    await act(async () => {
      await emptyMessageCache(s.wallet, { room: ROOM }, 'removed')
    })
    await held.answer(ROOM, preview('the words read before the emptying'))
    await flush()
    expect(row()?.reading).toBe(true)
    expect(row()?.lastPost).toBeUndefined()
  })

  test("control: another room's copy emptied meanwhile does not keep this one from being drawn", async () => {
    const s = setup()
    await s.keep([kept('newest', 5)], OTHER)
    const held = heldReader()
    const row = await mount(s.service)
    await act(async () => {
      await emptyMessageCache(s.wallet, { room: OTHER }, 'removed')
    })
    await held.answer(ROOM, preview('the words of this room'))
    await flush()
    expect(row()?.lastPost?.text).toBe('the words of this room')
  })

  test('each row is drawn as its own copy is read, one copy read at a time', async () => {
    const s = setup(undefined, [summary, other])
    const held = heldReader()
    const rowOf = await mount(s.service)
    const first = () => rowOf(ROOM)
    const second = () => rowOf(OTHER)
    expect(held.asked).toHaveLength(1)
    const [readFirst] = held.asked
    await held.answer(readFirst, preview('first in'))
    await flush()
    const drawnFirst = readFirst === ROOM ? first : second
    const notYet = readFirst === ROOM ? second : first
    expect(drawnFirst()?.lastPost?.text).toBe('first in')
    expect(notYet()?.lastPost).toBeUndefined()
    expect(held.asked).toHaveLength(2)
    await held.answer(held.asked[1], preview('second in'))
    await flush()
    expect(notYet()?.lastPost?.text).toBe('second in')
  })

  test('a room that reads as empty takes its preview down', async () => {
    const s = setup()
    await s.keep([kept('newest', 5)])
    await s.bind()
    const row = await mount(s.service)
    expect(row()?.lastPost?.text).toBe('the words of newest')
    await s.readRoom(ROOM, [])
    await flush()
    expect(row()?.reading).toBeUndefined()
    expect(row()?.lastPost).toBeUndefined()
  })

  test('control: without biometric unlock, nothing is drawn', async () => {
    const s = setup()
    await s.keep([kept('newest', 5)])
    biometry = false
    await s.bind()
    const row = await mount(s.service)
    expect(row()?.lastPost).toBeUndefined()
  })

  test('control: a community this phone acts in as two identities draws nothing (never a guess between them)', async () => {
    const s = setup([
      { did: LAB, personaDid: ME },
      { did: LAB, personaDid: 'did:peer:2.me-again' },
    ])
    await s.keep([kept('newest', 5)])
    await s.bind()
    const row = await mount(s.service)
    expect(row()?.lastPost).toBeUndefined()
  })

  test('control: with no copy kept, the row reads as before', async () => {
    const s = setup()
    await s.bind()
    const row = await mount(s.service)
    expect(row()?.reading).toBe(true)
    expect(row()?.lastPost).toBeUndefined()
  })
})
