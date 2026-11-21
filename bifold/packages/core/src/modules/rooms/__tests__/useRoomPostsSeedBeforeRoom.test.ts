/**
 * A room's chat opens on the wallet's kept copy before the room is known (useRoomPosts `seedBeforeRoom`,
 * rooms/messageCache `readRoomPostsBeforeRoom`): at a cold start the screen learns which identity acts in a room only
 * from the first rooms listing (6 s on 279.3), and the copy waited for it. The copy is drawn by the identity the phone
 * itself says acts in its community, only when exactly one copy matches, and comes down at once when the room, once
 * known, says otherwise or cannot be read. A room the whole listing does not hold loses its copy.
 */
import { act, renderHook } from '@testing-library/react-native'
import { AppState } from 'react-native'

import { toInertText } from '../inertText'
import {
  keepRoomPosts,
  readRoomPosts,
  resetMessageCache,
  ROOMS_MESSAGE_CACHE,
  setMessageCacheBiometryGate,
} from '../messageCache'
import { resetKeptListings } from '../keptListings'
import { AgentRoomsService, type RoomsBackend } from '../real/agentRoomsService'
import { ROOMS_TASK } from '../real/wire'
import type { Identity, Note, NoteList, NoteSummary, RoomsService } from '../types'
import { type RoomPosts, useRoomPosts } from '../useRoomPosts'
import { cacheWallet } from './fixtures/cacheWallet'

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('../../../../__mocks__/@react-navigation/native'),
  useIsFocused: () => true,
}))
jest.mock('../useRoomRows', () => ({ onRoomsListed: jest.fn() }))

const ROOM = 'did:webvh:r:attributed'
const LAB = 'did:webvh:lab'
const CHOIR = 'did:webvh:choir'
const ME = 'did:peer:2.me'
const OTHER = 'did:peer:2.other'
const CONSISTENT = { verdict: 'consistent' as const, detail: '' }
const NOW = Date.now()

const note = (key: string, version: number, author = 'did:peer:them'): Note => ({
  key,
  version,
  status: 'active',
  pinned: false,
  updatedAt: new Date(NOW - (10 - version) * 60_000).toISOString(),
  writtenAt: new Date(NOW - (10 - version) * 60_000).toISOString(),
  author: { did: author },
  body: toInertText(`the words of ${key}`),
  flags: { containsLink: false, looksLikeInstruction: false },
  check: CONSISTENT,
})
const summaryOf = ({ body: _b, flags: _f, check: _c, ...summary }: Note): NoteSummary => summary

/** A room whose listings are held until answered, on an agent with a wallet and `communities` as the phone says. */
function roomWith(initial: Note[], communities: { did: string; personaDid: string }[]) {
  const records = new Map(initial.map((n) => [n.key, n]))
  const wallet = cacheWallet()
  let held: (() => void) | undefined
  const answer = (): NoteList => ({ notes: [...records.values()].map(summaryOf), complete: true, check: CONSISTENT })
  const service = {
    runsOn: wallet,
    localCommunities: jest.fn(async () => communities),
    listNotes: jest.fn(
      () =>
        new Promise<NoteList>((resolve) => {
          held = () => resolve(answer())
        })
    ),
    readNote: jest.fn(async (_roomId: string, key: string) => records.get(key)!),
  } as unknown as RoomsService & { listNotes: jest.Mock; readNote: jest.Mock; localCommunities: jest.Mock }
  return {
    service,
    wallet,
    answer: async () => {
      await act(async () => held?.())
      await flush()
    },
  }
}

const flush = async () => {
  for (let i = 0; i < 6; i++) await act(async () => undefined)
}
type Props = {
  actingAs?: Identity
  enabled: boolean
  options: Parameters<typeof useRoomPosts>[6]
}
const BEFORE: Props = { enabled: false, options: { seedBeforeRoom: true } }
const KNOWN = (did = ME, options: Parameters<typeof useRoomPosts>[6] = {}): Props => ({
  actingAs: { did },
  enabled: true,
  options: { messageCache: { communityDid: LAB }, seedBeforeRoom: true, ...options },
})
const open = async (service: RoomsService, initial: Props = BEFORE) => {
  const hook = renderHook<RoomPosts, Props>(
    ({ actingAs, enabled, options }) => useRoomPosts(service, ROOM, actingAs, enabled, true, undefined, options),
    { initialProps: initial }
  )
  await flush()
  return hook
}
const keys = (posts?: { key: string }[]) => posts?.map((p) => p.key)
const keep = (w: ReturnType<typeof cacheWallet>, personaDid: string, communityDid = LAB, author = 'did:peer:them') =>
  keepRoomPosts(
    w,
    { personaDid, roomId: ROOM, communityDid },
    [
      { key: 'a', version: 1, author, writtenAt: new Date(NOW - 120_000).toISOString(), body: 'kept a' },
      { key: 'b', version: 2, author, writtenAt: new Date(NOW - 60_000).toISOString(), body: 'kept b' },
    ],
    NOW
  )

/** What the build ships (off on main, on in a cut that carries #1140): these rows run it on, and put it back. */
const SHIPPED = { ...ROOMS_MESSAGE_CACHE }
let biometry = true
beforeEach(() => {
  jest.useFakeTimers({ now: NOW })
  jest.spyOn(AppState, 'addEventListener').mockImplementation((() => ({ remove: jest.fn() })) as never)
  biometry = true
  setMessageCacheBiometryGate(async () => biometry)
  resetMessageCache()
  resetKeptListings()
  Object.assign(ROOMS_MESSAGE_CACHE, { on: true, remoteOff: false })
})
afterEach(() => {
  Object.assign(ROOMS_MESSAGE_CACHE, SHIPPED)
  jest.useRealTimers()
  jest.restoreAllMocks()
})

describe('before the room is known', () => {
  it("draws the identity's kept copy at once, unconfirmed, and asks no listing for it", async () => {
    const r = roomWith([note('a', 1), note('b', 2), note('c', 3)], [{ did: LAB, personaDid: ME }])
    await keep(r.wallet, ME)
    const hook = await open(r.service)
    expect(keys(hook.result.current.posts)).toEqual(['b', 'a'])
    expect(hook.result.current.posts?.[0].text).toBe('kept b')
    expect(hook.result.current.unconfirmed).toBe(true)
    expect(r.service.listNotes).not.toHaveBeenCalled()
    expect(r.service.readNote).not.toHaveBeenCalled()
  })

  it('the room arriving as that identity keeps it, and its first listing replaces it', async () => {
    const r = roomWith([note('a', 1), note('b', 2), note('c', 3)], [{ did: LAB, personaDid: ME }])
    await keep(r.wallet, ME)
    const hook = await open(r.service)
    hook.rerender(KNOWN())
    await flush()
    expect(keys(hook.result.current.posts)).toEqual(['b', 'a'])
    await r.answer()
    expect(keys(hook.result.current.posts)).toEqual(['c', 'b', 'a'])
    expect(hook.result.current.unconfirmed).toBe(false)
  })

  it("draws the member's own posts on their side from the start", async () => {
    const r = roomWith([note('a', 1, ME)], [{ did: LAB, personaDid: ME }])
    await keep(r.wallet, ME, LAB, ME)
    const hook = await open(r.service)
    expect(hook.result.current.posts?.map((p) => p.mine)).toEqual([true, true])
  })

  it.each([
    ['the room acts as another identity', KNOWN(OTHER)],
    ['the room is not kept (a private room: no messageCache)', KNOWN(ME, { messageCache: undefined })],
    ['the room is in another community', KNOWN(ME, { messageCache: { communityDid: CHOIR } })],
    ['the room cannot be listed (left, or not listable)', { ...KNOWN(), enabled: false }],
    ['the room cannot be read', { ...BEFORE, options: { seedBeforeRoom: true, roomNotRead: true } }],
  ])('comes down at once when %s', async (_name, props) => {
    const r = roomWith([note('a', 1)], [{ did: LAB, personaDid: ME }])
    await keep(r.wallet, ME)
    const hook = await open(r.service)
    expect(keys(hook.result.current.posts)).toEqual(['b', 'a'])
    hook.rerender(props)
    await flush()
    expect(hook.result.current.posts).toBeUndefined()
  })

  it('control: another identity on the phone draws nothing of a copy that is not its own', async () => {
    const r = roomWith([note('a', 1)], [{ did: LAB, personaDid: ME }])
    await keep(r.wallet, OTHER)
    const hook = await open(r.service)
    expect(hook.result.current.posts).toBeUndefined()
  })

  it('control: a community the phone acts in as two identities draws nothing (never a guess)', async () => {
    const r = roomWith(
      [note('a', 1)],
      [
        { did: LAB, personaDid: ME },
        { did: LAB, personaDid: OTHER },
      ]
    )
    await keep(r.wallet, ME)
    const hook = await open(r.service)
    expect(hook.result.current.posts).toBeUndefined()
  })

  it('control: a community the phone is no longer in draws nothing', async () => {
    const r = roomWith([note('a', 1)], [{ did: CHOIR, personaDid: ME }])
    await keep(r.wallet, ME)
    const hook = await open(r.service)
    expect(hook.result.current.posts).toBeUndefined()
  })

  it.each([
    ['switched off by the release', () => Object.assign(ROOMS_MESSAGE_CACHE, { remoteOff: true })],
    ['without biometric unlock', () => (biometry = false)],
  ])('control: %s, nothing is drawn', async (_name, off) => {
    const r = roomWith([note('a', 1)], [{ did: LAB, personaDid: ME }])
    await keep(r.wallet, ME)
    off()
    const hook = await open(r.service)
    expect(hook.result.current.posts).toBeUndefined()
  })

  it('control: a screen that does not ask for it (the Notes part) draws nothing before the room', async () => {
    const r = roomWith([note('a', 1)], [{ did: LAB, personaDid: ME }])
    await keep(r.wallet, ME)
    const hook = await open(r.service, { enabled: false, options: {} })
    expect(hook.result.current.posts).toBeUndefined()
    expect(r.service.localCommunities).not.toHaveBeenCalled()
  })
})

describe('a room the rooms listing does not hold', () => {
  /** A rooms service whose communities list no rooms; `unreachable` names one that does not answer. */
  function serviceOn(w: ReturnType<typeof cacheWallet>, unreachable?: string) {
    const backend = {
      runsOn: w,
      agentLinked: () => true,
      agentServedTypes: async () => [ROOMS_TASK.keysList02, ROOMS_TASK.keysRead, ROOMS_TASK.keysBrowse04],
      agentTask: jest.fn(async () => ({ rooms: [] })),
      communities: async () => [
        { did: LAB, personaDid: ME },
        { did: CHOIR, personaDid: ME },
      ],
      communityTask: jest.fn(async (communityDid: string) => {
        if (communityDid === unreachable) throw new Error('network down')
        return { items: [] }
      }),
      sendCompleted: jest.fn(async () => ({})),
      newId: () => 'id-1',
      leaveCommunity: jest.fn(async () => undefined),
      decodeBase64Url: (v: string) => Buffer.from(v, 'base64url').toString('utf8'),
      encodeBase64Url: (v: string) => Buffer.from(v, 'utf8').toString('base64url'),
      hiddenOffers: async () => [],
      hideOffer: jest.fn(async () => undefined),
      warn: jest.fn(),
    } as unknown as RoomsBackend
    return new AgentRoomsService(backend, undefined, { sleep: async () => undefined })
  }

  it('heard from every community: its copy goes', async () => {
    jest.useRealTimers()
    const w = cacheWallet()
    await keep(w, ME)
    await expect(serviceOn(w).getRoom(ROOM)).rejects.toThrow('among this member')
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0))
    expect(await readRoomPosts(w, ME, ROOM)).toBeUndefined()
  })

  it('control: a community that did not answer leaves the copy (the room may be among its rooms)', async () => {
    jest.useRealTimers()
    const w = cacheWallet()
    await keep(w, ME)
    await expect(serviceOn(w, CHOIR).getRoom(ROOM)).rejects.toThrow('among this member')
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0))
    expect((await readRoomPosts(w, ME, ROOM))?.posts.map((p) => p.key)).toEqual(['b', 'a'])
  })

  it('the room service says which communities and identities the phone holds, from the backend alone', async () => {
    const w = cacheWallet()
    expect(await serviceOn(w).localCommunities()).toEqual([
      { did: LAB, personaDid: ME },
      { did: CHOIR, personaDid: ME },
    ])
  })
})
