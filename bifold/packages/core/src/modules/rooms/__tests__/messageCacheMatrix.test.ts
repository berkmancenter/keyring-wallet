/**
 * Every way a member's access goes, one row each, through the hook the app really calls, never the emptying alone
 * (docs/plans/rooms-local-message-cache-plan.md, Phase 2). Each row keeps copies for more than one community and
 * identity, so it shows the emptying reached what it should and nothing else. messageCache.test.ts has the module's
 * own rows; these are the triggers: leave (both paths), a removal taken at the next start, an identity let go, an
 * agent unlinked (this phone's or another) or no longer accepting this phone, a card the community revoked, the room
 * listed as gone, a community refusing the member's listing as no member, biometric unlock off, the kill, and a failure
 * finished by the next start.
 */
import { DeviceEventEmitter } from 'react-native'

import { VTA_UNLINKING_EVENT } from '../../trust-tasks/module/unlinkEvent'
import { VTI_REMOVED_EVENT } from '../../trust-tasks/module/vtiCommunityNotices'
import {
  bindMessageCache,
  type CachedPost,
  type CachedRoom,
  emptyMessageCache,
  keepRoomPosts,
  MSG_CACHE_JOURNAL_ID,
  readRoomPosts,
  resetMessageCache,
  ROOMS_MESSAGE_CACHE,
  setMessageCacheBiometryGate,
  sweepMessageCache,
} from '../messageCache'
import { afterLeavingCommunity } from '../roomsLeave'
import { createAgentRoomsBackend } from '../real/agentRoomsBackend'
import { AgentRoomsService, type RoomsBackend } from '../real/agentRoomsService'
import { ROOMS_TASK } from '../real/wire'
import type { RoomSummary } from '../types'

import { cacheWallet } from './fixtures/cacheWallet'

// The listing the rooms poll hands on (useRoomRows): caught here, so a row can hand it one.
const mockListed: ((service: unknown, rooms: RoomSummary[]) => void)[] = []
jest.mock('../useRoomRows', () => ({
  onRoomsListed: (listener: (service: unknown, rooms: RoomSummary[]) => void) => {
    mockListed.push(listener)
    return () => undefined
  },
  refreshRoomRows: () => undefined,
}))
jest.mock('../../directory/names', () => ({ dropDirectoryNames: async () => undefined }))
jest.mock('../../directory/myPhoto', () => ({ keepSentPhoto: async () => undefined }))
jest.mock('../../trust-tasks/module/vtiWalletCards', () => ({ isCommunityCard: () => false }))

// The phone's identities and memberships, as the rooms backend reads them at its start.
let mockPersonas: { did: string; communityDid: string }[] = []
let mockMemberships: { communityDid: string; personaDid: string; vmc: { id: string }; removal?: unknown }[] = []
const membership = (communityDid: string, personaDid: string, over: { removal?: unknown } = {}) => ({
  communityDid,
  personaDid,
  vmc: { id: `urn:uuid:card:${communityDid}:${personaDid}` },
  ...over,
})
/** The cards a status-list read found revoked, by id. */
const mockRevoked = new Set<string>()
/** This phone's link to its agent, as the backend's start reads it. */
let mockLinkKind = 'linked'
jest.mock('../../trust-tasks/module/VtiIdentityStore', () => ({
  GenericRecordsIdentityStore: class {
    async getPersona(communityDid: string) {
      return mockPersonas.find((p) => p.communityDid === communityDid)
    }
    async listPersonas() {
      return mockPersonas
    }
    async setPersona() {
      return undefined
    }
  },
}))
jest.mock('../../trust-tasks/module/VtiCommunityStore', () => ({
  ...jest.requireActual('../../trust-tasks/module/VtiCommunityStore'),
  GenericRecordsCommunityStore: class {
    async listMemberships() {
      return mockMemberships
    }
  },
}))
jest.mock('../../trust-tasks/module/vtiJoin', () => ({ leaveCommunity: async () => undefined }))
jest.mock('../../trust-tasks/module/vtiVetting', () => ({ GenericRecordsVettingStore: class {} }))
jest.mock('../../trust-tasks/module/vtiAgent', () => ({
  ...jest.requireActual('../../trust-tasks/module/vtiAgent'),
  vtiAgent: {},
}))
jest.mock('../../trust-tasks/module/vtaAgent', () => ({
  vtaAgent: { getState: () => ({ link: { kind: mockLinkKind } }) },
}))
jest.mock('../../trust-tasks/module/vtiCardStanding', () => ({
  ...jest.requireActual('../../trust-tasks/module/vtiCardStanding'),
  cardStandingOf: (card: { id?: string }) => ({ state: card.id && mockRevoked.has(card.id) ? 'revoked' : 'held' }),
}))
jest.mock('../../trust-tasks/module/vtiTsp', () => ({ GenericRecordsTspPeerRevisionStore: class {} }))

const ME = 'did:webvh:me'
const ME_AGAIN = 'did:webvh:me-again'
const LAB = 'did:webvh:lab'
const CHOIR = 'did:webvh:choir'
const PLANNING = 'did:webvh:room:planning'
const GARDEN = 'did:webvh:room:garden'
const SONGS = 'did:webvh:room:songs'

const post = (key: string): CachedPost => ({
  key,
  version: 1,
  kind: 'chat',
  author: 'did:peer:sam',
  // The clock the cache reads (jest's), at the moment the post is made.
  writtenAt: new Date(Date.now() - 60_000).toISOString(),
  body: `the words of ${key}`,
})

/**
 * The shared fake of the agent's generic records (fixtures/cacheWallet), with what the leave and the backend also read:
 * the Wallet's credentials and a logger. `failNext` makes the next update of a kept copy throw, as a write that fails
 * on the phone; the journal's own writes go through.
 */
function wallet() {
  const w = cacheWallet()
  const logger = { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() }
  const failNext = () =>
    w.genericRecords.update.mockImplementationOnce(async () => {
      throw new Error('disk')
    })
  return { ...w, w3cCredentials: { getAll: async () => [] }, config: { logger }, failNext }
}
type Wallet = ReturnType<typeof wallet>

/** What each identity's room reads as now: its posts' keys, or none. */
const reads = async (w: Wallet, rooms: [string, string][]) =>
  Promise.all(
    rooms.map(async ([persona, roomId]) => (await readRoomPosts(w, persona, roomId))?.posts.map((p) => p.key))
  )

/**
 * Four copies: two identities in the lab's planning room, the first in the lab's garden room too, and the first in the
 * choir's songs room (another community, the control for every community-wide row).
 */
async function fourCopies(w: Wallet) {
  const keep = (over: Partial<CachedRoom>, key: string) =>
    keepRoomPosts(w, { personaDid: ME, roomId: PLANNING, communityDid: LAB, ...over }, [post(key)])
  await keep({}, 'me-planning')
  await keep({ personaDid: ME_AGAIN }, 'again-planning')
  await keep({ roomId: GARDEN }, 'me-garden')
  await keep({ roomId: SONGS, communityDid: CHOIR }, 'me-songs')
}
const ALL: [string, string][] = [
  [ME, PLANNING],
  [ME_AGAIN, PLANNING],
  [ME, GARDEN],
  [ME, SONGS],
]

/** Lets what a hook started run: its listener, its sweep behind `current()`. */
const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}

/** What the release ships (off until the device proof, #1138): these rows run with the cache on, and put it back. */
const SHIPPED = { ...ROOMS_MESSAGE_CACHE }
let biometry = true
beforeEach(() => {
  Object.assign(ROOMS_MESSAGE_CACHE, { on: true, remoteOff: false })
  biometry = true
  setMessageCacheBiometryGate(async () => biometry)
  resetMessageCache()
  mockPersonas = [
    { did: ME, communityDid: LAB },
    { did: ME, communityDid: CHOIR },
  ]
  mockMemberships = [membership(LAB, ME), membership(CHOIR, ME)]
  mockRevoked.clear()
  mockLinkKind = 'linked'
})
afterEach(() => {
  Object.assign(ROOMS_MESSAGE_CACHE, SHIPPED)
})

describe('leaving a community', () => {
  it("from the community's screen: every identity's copies of its rooms, the other community's kept", async () => {
    const w = wallet()
    await fourCopies(w)
    await afterLeavingCommunity(w as never, LAB)
    expect(await reads(w, ALL)).toEqual([undefined, undefined, undefined, ['me-songs']])
  })

  it("through the rooms backend's leave: the lab's copies go at the leave, not before", async () => {
    const w = wallet()
    await fourCopies(w)
    const backend = createAgentRoomsBackend(w as never)
    await settle()
    // Its start kept the lab's copies of the identity the lab is acted as (ME_AGAIN's went: see the start rows).
    expect(await reads(w, ALL)).toEqual([['me-planning'], undefined, ['me-garden'], ['me-songs']])
    await backend.leaveCommunity(LAB)
    expect(await reads(w, ALL)).toEqual([undefined, undefined, undefined, ['me-songs']])
  })
})

describe('at the rooms backend’s start', () => {
  it('control: each membership standing, the identity each community is acted as keeps its copies', async () => {
    const w = wallet()
    await fourCopies(w)
    createAgentRoomsBackend(w as never)
    await settle()
    // ME_AGAIN holds no membership the lab is acted as, so its copy of the lab's room goes at the start.
    expect(await reads(w, ALL)).toEqual([['me-planning'], undefined, ['me-garden'], ['me-songs']])
  })

  it("a removal taken while the app was closed: that community's copies, at the first start after it", async () => {
    const w = wallet()
    await fourCopies(w)
    mockMemberships = [membership(LAB, ME, { removal: { reason: 'removed' } }), mockMemberships[1]]
    createAgentRoomsBackend(w as never)
    await settle()
    expect(await reads(w, ALL)).toEqual([undefined, undefined, undefined, ['me-songs']])
  })

  it("an identity let go: its copies only, the other identity's kept", async () => {
    const w = wallet()
    await fourCopies(w)
    // The lab is held as ME_AGAIN now; ME is no longer this phone's identity there, though its old membership record
    // is still on the phone (a re-join as a new identity, #1101).
    mockPersonas = [
      { did: ME_AGAIN, communityDid: LAB },
      { did: ME, communityDid: CHOIR },
    ]
    mockMemberships = [...mockMemberships, membership(LAB, ME_AGAIN)]
    createAgentRoomsBackend(w as never)
    await settle()
    expect(await reads(w, ALL)).toEqual([undefined, ['again-planning'], undefined, ['me-songs']])
  })

  it("a card the community revoked, as its status list was last read: that community's copies", async () => {
    const w = wallet()
    await fourCopies(w)
    mockRevoked.add(membership(LAB, ME).vmc.id)
    createAgentRoomsBackend(w as never)
    await settle()
    expect(await reads(w, ALL)).toEqual([undefined, undefined, undefined, ['me-songs']])
  })

  it('an agent that no longer accepts this phone (the link revoked): every copy', async () => {
    const w = wallet()
    await fourCopies(w)
    mockLinkKind = 'revoked'
    createAgentRoomsBackend(w as never)
    await settle()
    expect(await reads(w, ALL)).toEqual([undefined, undefined, undefined, undefined])
  })

  it('biometric unlock turned off: every copy', async () => {
    const w = wallet()
    await fourCopies(w)
    biometry = false
    createAgentRoomsBackend(w as never)
    await settle()
    biometry = true
    expect(await reads(w, ALL)).toEqual([undefined, undefined, undefined, undefined])
  })

  it('the kill: every copy, and nothing is kept again while it holds', async () => {
    const w = wallet()
    await fourCopies(w)
    ROOMS_MESSAGE_CACHE.remoteOff = true
    createAgentRoomsBackend(w as never)
    await settle()
    expect(await keepRoomPosts(w, { personaDid: ME, roomId: SONGS, communityDid: CHOIR }, [post('after')])).toBe(false)
    Object.assign(ROOMS_MESSAGE_CACHE, { on: true, remoteOff: false })
    expect(await reads(w, ALL)).toEqual([undefined, undefined, undefined, undefined])
  })
})

describe('with the app running', () => {
  it("a community's removal notice: its copies, every identity's; the other community's kept", async () => {
    const w = wallet()
    await fourCopies(w)
    await bindMessageCache(w, async () => [
      { communityDid: LAB, personaDid: ME },
      { communityDid: LAB, personaDid: ME_AGAIN },
      { communityDid: CHOIR, personaDid: ME },
    ])
    DeviceEventEmitter.emit(VTI_REMOVED_EVENT, { communityDid: LAB, reason: 'removed' })
    await settle()
    expect(await reads(w, ALL)).toEqual([undefined, undefined, undefined, ['me-songs']])
  })

  it('a listing that says a room is gone: that room, every identity’s copy; a room listed as a member keeps its own', async () => {
    const w = wallet()
    await fourCopies(w)
    await bindMessageCache(w, async () => [
      { communityDid: LAB, personaDid: ME },
      { communityDid: LAB, personaDid: ME_AGAIN },
      { communityDid: CHOIR, personaDid: ME },
    ])
    const listed = (roomId: string, over: Partial<RoomSummary>) =>
      ({ roomId, source: 'community', standing: 'member', ...over }) as RoomSummary
    for (const listener of mockListed)
      listener({}, [listed(PLANNING, { standing: 'lapsed' }), listed(GARDEN, {}), listed(SONGS, {})])
    await settle()
    expect(await reads(w, ALL)).toEqual([undefined, undefined, ['me-garden'], ['me-songs']])
  })

  it.each([
    ['removed', { standing: 'removed' as const }],
    ['past its end', () => ({ validUntil: new Date(Date.now() - 1000).toISOString() })],
  ])('a listing that says a room is %s: that room', async (_name, made) => {
    const over = typeof made === 'function' ? made() : made
    const w = wallet()
    await fourCopies(w)
    await bindMessageCache(w, async () => [
      { communityDid: LAB, personaDid: ME },
      { communityDid: LAB, personaDid: ME_AGAIN },
      { communityDid: CHOIR, personaDid: ME },
    ])
    for (const listener of mockListed)
      listener({}, [{ roomId: GARDEN, source: 'community', standing: 'member', ...over } as RoomSummary])
    await settle()
    expect(await reads(w, ALL)).toEqual([['me-planning'], ['again-planning'], undefined, ['me-songs']])
  })

  it.each([
    ["this phone's own agent", 'did:webvh:agent:home'],
    [
      'another linked agent (every copy: the cache does not know which identities that agent holds)',
      'did:webvh:agent:work',
    ],
  ])('an unlink of %s: every copy', async (_name, vtaDid) => {
    const w = wallet()
    await fourCopies(w)
    await bindMessageCache(w, async () => [
      { communityDid: LAB, personaDid: ME },
      { communityDid: LAB, personaDid: ME_AGAIN },
      { communityDid: CHOIR, personaDid: ME },
    ])
    DeviceEventEmitter.emit(VTA_UNLINKING_EVENT, { vtaDid })
    await settle()
    expect(await reads(w, ALL)).toEqual([undefined, undefined, undefined, undefined])
  })
})

/** A refusal as the community's leg throws it (`VtiRefusal`), the task's own code in `details`. */
const refusal = (code: string) =>
  Object.assign(new Error(`refused: ${code}`), { name: 'VtiRefusal', code: 'taskFailed', details: { code } })

/** A rooms service whose community listing of the lab is refused with `labRefusal`; the choir lists no rooms. */
function service(w: Wallet, labRefusal: Error) {
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
      if (communityDid === LAB) throw labRefusal
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

describe("the member's rooms listing", () => {
  it("refused as no member: that community's copies, every identity's; the other community's kept", async () => {
    const w = wallet()
    await fourCopies(w)
    await service(w, refusal('vtc/rooms/memberships/list:notAMember'))
      .listMyRooms()
      .catch(() => undefined)
    await settle()
    expect(await reads(w, ALL)).toEqual([undefined, undefined, undefined, ['me-songs']])
  })

  it('control: refused for any other reason (the community unreachable), every copy is kept', async () => {
    const w = wallet()
    await fourCopies(w)
    await service(w, refusal('vtc/rooms/memberships/list:hostUnreachable'))
      .listMyRooms()
      .catch(() => undefined)
    await settle()
    expect(await reads(w, ALL)).toEqual([['me-planning'], ['again-planning'], ['me-garden'], ['me-songs']])
  })
})

describe('an emptying that fails', () => {
  it('leaves its journal entry, shows nothing it names, and the next start finishes it', async () => {
    const w = wallet()
    await fourCopies(w)
    w.failNext()
    await expect(emptyMessageCache(w, { community: LAB }, 'left')).rejects.toThrow('disk')
    expect(w.journal()).toHaveLength(1)
    // Nothing of the lab is shown while the entry stands, emptied or not; the choir's copy is.
    expect(await reads(w, ALL)).toEqual([undefined, undefined, undefined, ['me-songs']])
    // A copy the failed write left whole is still in the wallet until the next start.
    const whole = [...w.records.values()].filter((r) => r.id !== MSG_CACHE_JOURNAL_ID && r.content.emptied !== true)
    expect(whole).toHaveLength(4)
    await sweepMessageCache(w, [
      { communityDid: LAB, personaDid: ME },
      { communityDid: LAB, personaDid: ME_AGAIN },
      { communityDid: CHOIR, personaDid: ME },
    ])
    expect(w.journal()).toEqual([])
    const lab = [...w.records.values()].filter((r) => r.id !== MSG_CACHE_JOURNAL_ID && r.content.communityDid === LAB)
    expect(lab).toEqual([])
    expect(await reads(w, ALL)).toEqual([undefined, undefined, undefined, ['me-songs']])
  })

  it('control: a sweep with nothing journaled and every membership standing empties nothing', async () => {
    const w = wallet()
    await fourCopies(w)
    await sweepMessageCache(w, [
      { communityDid: LAB, personaDid: ME },
      { communityDid: LAB, personaDid: ME_AGAIN },
      { communityDid: CHOIR, personaDid: ME },
    ])
    expect(w.journal()).toEqual([])
    expect(await reads(w, ALL)).toEqual([['me-planning'], ['again-planning'], ['me-garden'], ['me-songs']])
  })
})
