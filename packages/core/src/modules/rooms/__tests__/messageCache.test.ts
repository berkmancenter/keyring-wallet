/**
 * The rooms' kept posts (rooms/messageCache, docs/plans/rooms-local-message-cache-plan.md): kept within the caps, read
 * strictly, never shown past a room's end or for another identity, and emptied on every way access goes, journal
 * first, so one cut short is finished at the next start. Off, and emptied, without biometric unlock and on the kill.
 */
import { DeviceEventEmitter } from 'react-native'

import { VTA_UNLINKING_EVENT } from '../../trust-tasks/module/unlinkEvent'
import { VTI_REMOVED_EVENT } from '../../trust-tasks/module/vtiCommunityNotices'
import {
  bindMessageCache,
  type CachedPost,
  type CachedRoom,
  emptyGoneRooms,
  emptyMessageCache,
  hashOf,
  isMessageCacheOn,
  keepRoomPosts,
  MSG_CACHE_BODY_MAX,
  MSG_CACHE_BYTES,
  MSG_CACHE_DAYS,
  MSG_CACHE_POSTS,
  MSG_CACHE_ROOMS,
  noteBiometricUnlock,
  readRoomPosts,
  resetMessageCache,
  ROOMS_MESSAGE_CACHE,
  setMessageCacheBiometryGate,
  standingMemberships,
  sweepMessageCache,
} from '../messageCache'
import { cacheWallet } from './fixtures/cacheWallet'

jest.mock('../useRoomRows', () => ({ onRoomsListed: jest.fn() }))

const NOW = Date.parse('2026-11-18T12:00:00Z')
const DAY = 24 * 3600 * 1000
const ME = 'did:webvh:me'
const OTHER_ME = 'did:webvh:me-again'
const LAB = 'did:webvh:lab'
const CHOIR = 'did:webvh:choir'
const ROOM = 'did:webvh:room:planning'
const ROOM2 = 'did:webvh:room:garden'

const room = (over: Partial<CachedRoom> = {}): CachedRoom => ({
  personaDid: ME,
  roomId: ROOM,
  communityDid: LAB,
  ...over,
})
const post = (key: string, agoMs = 60_000, over: Partial<CachedPost> = {}): CachedPost => ({
  key,
  version: 1,
  kind: 'chat',
  author: 'did:peer:sam',
  writtenAt: new Date(NOW - agoMs).toISOString(),
  body: `the words of ${key}`,
  ...over,
})

const wallet = cacheWallet

let biometry = true
beforeEach(() => {
  biometry = true
  setMessageCacheBiometryGate(async () => biometry)
  resetMessageCache()
  // These rows are about the cache at work: switched on, as main ships it.
  ROOMS_MESSAGE_CACHE.on = true
})
afterEach(() => {
  // As main ships it: on (rooms/messageCache).
  ROOMS_MESSAGE_CACHE.on = true
  ROOMS_MESSAGE_CACHE.remoteOff = false
})

describe('keeping and reading', () => {
  it("keeps an identity's open room and reads it back", async () => {
    const w = wallet()
    expect(await keepRoomPosts(w, room(), [post('a'), post('b', 120_000)], NOW)).toBe(true)
    const read = await readRoomPosts(w, ME, ROOM, NOW)
    expect(read?.posts.map((p) => p.key)).toEqual(['a', 'b'])
    expect(read?.room).toEqual(room())
  })

  it('names no room, community or identity in its id or tags', async () => {
    const w = wallet()
    await keepRoomPosts(w, room(), [post('a')], NOW)
    const [record] = [...w.records.values()]
    const outside = JSON.stringify({ id: record.id, tags: record.tags })
    for (const name of [ME, ROOM, LAB]) expect(outside).not.toContain(name)
    expect(record.tags).toMatchObject({ community: hashOf(LAB), persona: hashOf(ME), room: hashOf(ROOM) })
  })

  it('control: another identity on the phone never reads it', async () => {
    const w = wallet()
    await keepRoomPosts(w, room(), [post('a')], NOW)
    expect(await readRoomPosts(w, OTHER_ME, ROOM, NOW)).toBeUndefined()
  })

  it(`keeps at most ${MSG_CACHE_POSTS} posts, newest first, none past ${MSG_CACHE_DAYS} days`, async () => {
    const w = wallet()
    const many = Array.from({ length: 80 }, (_, i) => post(`p${i}`, (i + 1) * 60_000))
    await keepRoomPosts(w, room(), [...many, post('old', (MSG_CACHE_DAYS + 1) * DAY)], NOW)
    const read = await readRoomPosts(w, ME, ROOM, NOW)
    expect(read?.posts).toHaveLength(MSG_CACHE_POSTS)
    expect(read?.posts[0].key).toBe('p0')
    expect(read?.posts.map((p) => p.key)).not.toContain('old')
  })

  it(`keeps a room within ${MSG_CACHE_BYTES} bytes, and cuts a post past its own limit`, async () => {
    const w = wallet()
    const big = Array.from({ length: 40 }, (_, i) => post(`p${i}`, (i + 1) * 60_000, { body: 'x'.repeat(4000) }))
    await keepRoomPosts(w, room(), [post('huge', 30_000, { body: 'y'.repeat(MSG_CACHE_BODY_MAX * 2) }), ...big], NOW)
    const kept = [...w.records.values()][0].content.posts as CachedPost[]
    expect(Buffer.byteLength(JSON.stringify(kept))).toBeLessThanOrEqual(MSG_CACHE_BYTES)
    expect(kept[0]).toMatchObject({ key: 'huge', cut: true })
    expect(kept[0].body).toHaveLength(MSG_CACHE_BODY_MAX)
  })

  it(`keeps at most ${MSG_CACHE_ROOMS} rooms: the one kept longest ago is emptied`, async () => {
    const w = wallet()
    for (let i = 0; i <= MSG_CACHE_ROOMS; i++)
      await keepRoomPosts(w, room({ roomId: `did:webvh:room:${i}` }), [post('a')], NOW + i)
    expect(await readRoomPosts(w, ME, 'did:webvh:room:0', NOW + 100)).toBeUndefined()
    expect(await readRoomPosts(w, ME, `did:webvh:room:${MSG_CACHE_ROOMS}`, NOW + 100)).toBeDefined()
    expect(w.copies().filter((c) => c.emptied !== true)).toHaveLength(MSG_CACHE_ROOMS)
  })

  it("a copy past its room's end is emptied, not shown", async () => {
    const w = wallet()
    await keepRoomPosts(w, room({ validUntil: new Date(NOW + DAY).toISOString() }), [post('a')], NOW)
    expect(await readRoomPosts(w, ME, ROOM, NOW + 2 * DAY)).toBeUndefined()
    expect(w.copies()).toEqual([{ v: 1, emptied: true }])
  })

  it('control: a copy in a shape this build does not read is neither shown nor emptied', async () => {
    const w = wallet()
    await keepRoomPosts(w, room(), [post('a')], NOW)
    const [record] = [...w.records.values()]
    record.content = { ...record.content, v: 2 }
    expect(await readRoomPosts(w, ME, ROOM, NOW)).toBeUndefined()
    await sweepMessageCache(w, [{ communityDid: LAB, personaDid: ME }], NOW)
    expect(record.content.v).toBe(2)
  })

  it('control: a malformed post is left out, the rest read', async () => {
    const w = wallet()
    await keepRoomPosts(w, room(), [post('a'), post('b')], NOW)
    const [record] = [...w.records.values()]
    ;(record.content.posts as unknown[]).push({ key: 'bad', version: -1 }, 'nonsense')
    expect((await readRoomPosts(w, ME, ROOM, NOW))?.posts.map((p) => p.key)).toEqual(['a', 'b'])
  })
})

// A later bundle that ships it off again (`on: false`): what an earlier bundle kept goes at its first start.
describe('a bundle that ships it off again', () => {
  it('is off: nothing kept, nothing shown, and a start empties any copy an earlier bundle kept', async () => {
    const w = wallet()
    await keepRoomPosts(w, room(), [post('a')], NOW)
    ROOMS_MESSAGE_CACHE.on = false
    expect(isMessageCacheOn()).toBe(false)
    expect(await keepRoomPosts(w, room({ roomId: ROOM2 }), [post('b')], NOW)).toBe(false)
    expect(await readRoomPosts(w, ME, ROOM, NOW)).toBeUndefined()
    await sweepMessageCache(w, [{ communityDid: LAB, personaDid: ME }], NOW)
    expect(w.copies()).toEqual([{ v: 1, emptied: true }])
  })
})

describe('off', () => {
  it.each([
    ['switched off', { on: false, remoteOff: false }],
    ['turned off remotely', { on: true, remoteOff: true }],
    ['not a boolean (fails closed)', { on: 'true' as unknown as boolean, remoteOff: false }],
  ])('%s: nothing is kept or shown, and a start empties what was kept', async (_name, values) => {
    const w = wallet()
    await keepRoomPosts(w, room(), [post('a')], NOW)
    Object.assign(ROOMS_MESSAGE_CACHE, values)
    expect(await keepRoomPosts(w, room({ roomId: ROOM2 }), [post('b')], NOW)).toBe(false)
    expect(await readRoomPosts(w, ME, ROOM, NOW)).toBeUndefined()
    await sweepMessageCache(w, [{ communityDid: LAB, personaDid: ME }], NOW)
    expect(w.copies()).toEqual([{ v: 1, emptied: true }])
  })

  it('without biometric unlock (decision 6): nothing is kept or shown, and a start empties what was kept', async () => {
    const w = wallet()
    await keepRoomPosts(w, room(), [post('a')], NOW)
    biometry = false
    expect(await keepRoomPosts(w, room({ roomId: ROOM2 }), [post('b')], NOW)).toBe(false)
    expect(await readRoomPosts(w, ME, ROOM, NOW)).toBeUndefined()
    await sweepMessageCache(w, [{ communityDid: LAB, personaDid: ME }], NOW)
    expect(w.copies()).toEqual([{ v: 1, emptied: true }])
  })

  it('control: a biometry preference that cannot be read reads as off', async () => {
    const w = wallet()
    setMessageCacheBiometryGate(async () => {
      throw new Error('no preferences')
    })
    expect(await keepRoomPosts(w, room(), [post('a')], NOW)).toBe(false)
  })
})

// The coordinator's ask on #1130 (decision 6): turned off mid-run, the copies go at once, not at the next start.
describe('biometric unlock turned off while the app runs', () => {
  it('empties every copy at once, and nothing is kept after, even before the saved preference says so', async () => {
    const w = wallet()
    await bindMessageCache(w, async () => [{ communityDid: LAB, personaDid: ME }])
    await keepRoomPosts(w, room(), [post('a')], NOW)
    // The saved preference still reads on (it is written a moment later).
    await noteBiometricUnlock(false)
    expect(w.copies()).toEqual([{ v: 1, emptied: true }])
    expect(await keepRoomPosts(w, room(), [post('b')], NOW)).toBe(false)
    expect(await readRoomPosts(w, ME, ROOM, NOW)).toBeUndefined()
  })

  it('control: turned on, or on again, empties nothing', async () => {
    const w = wallet()
    await bindMessageCache(w, async () => [{ communityDid: LAB, personaDid: ME }])
    await noteBiometricUnlock(true)
    await keepRoomPosts(w, room(), [post('a')], NOW)
    await noteBiometricUnlock(true)
    expect(await readRoomPosts(w, ME, ROOM, NOW)).toBeDefined()
  })
})

describe('emptying', () => {
  const kept = async (w: ReturnType<typeof wallet>) => {
    await keepRoomPosts(w, room(), [post('a')], NOW)
    await keepRoomPosts(w, room({ roomId: ROOM2 }), [post('b')], NOW)
    await keepRoomPosts(w, room({ communityDid: CHOIR, roomId: 'did:webvh:room:choir' }), [post('c')], NOW)
    await keepRoomPosts(w, room({ personaDid: OTHER_ME, roomId: 'did:webvh:room:mine' }), [post('d')], NOW)
  }
  const shown = async (w: ReturnType<typeof wallet>) => {
    const out: string[] = []
    for (const [persona, roomId] of [
      [ME, ROOM],
      [ME, ROOM2],
      [ME, 'did:webvh:room:choir'],
      [OTHER_ME, 'did:webvh:room:mine'],
    ] as const)
      if (await readRoomPosts(w, persona, roomId, NOW)) out.push(roomId.split(':').pop() as string)
    return out
  }

  it("a community's: its rooms only, every other copy kept", async () => {
    const w = wallet()
    await kept(w)
    expect(await emptyMessageCache(w, { community: LAB }, 'left')).toBe(3)
    expect(await shown(w)).toEqual(['choir'])
  })

  it("an identity's: its rooms only", async () => {
    const w = wallet()
    await kept(w)
    await emptyMessageCache(w, { persona: OTHER_ME }, 'let go')
    expect(await shown(w)).toEqual(['planning', 'garden', 'choir'])
  })

  it("a room's: every identity's copy of it", async () => {
    const w = wallet()
    await kept(w)
    await keepRoomPosts(w, room({ personaDid: OTHER_ME }), [post('e')], NOW)
    await emptyMessageCache(w, { room: ROOM }, 'access gone')
    expect(await readRoomPosts(w, OTHER_ME, ROOM, NOW)).toBeUndefined()
    expect(await shown(w)).toEqual(['garden', 'choir', 'mine'])
  })

  it('every copy, and nothing of a post stays in the wallet', async () => {
    const w = wallet()
    await kept(w)
    await emptyMessageCache(w, { all: true }, 'unlinked')
    expect(await shown(w)).toEqual([])
    expect(JSON.stringify([...w.records.values()])).not.toContain('the words of')
  })

  it('a room listed as removed, lapsed or past its end: its copies; a member room keeps its own', async () => {
    const w = wallet()
    await kept(w)
    await emptyGoneRooms(
      w,
      [
        { roomId: ROOM, standing: 'removed' },
        { roomId: ROOM2, standing: 'member' },
        { roomId: 'did:webvh:room:choir', standing: 'member', validUntil: new Date(NOW - 1).toISOString() },
        { roomId: 'did:webvh:room:mine', standing: 'lapsed' },
      ],
      NOW
    )
    expect(await shown(w)).toEqual(['garden'])
  })

  it('an emptying cut short is finished at the next start, and nothing it names is shown meanwhile', async () => {
    const w = wallet()
    await kept(w)
    // The journal is written, then the first emptying write fails (a crash, a full disk).
    w.genericRecords.update.mockImplementationOnce(async (r) => {
      w.records.get(r.id ?? '')!.content = r.content
    })
    w.genericRecords.update.mockRejectedValueOnce(new Error('disk'))
    await expect(emptyMessageCache(w, { community: LAB }, 'left')).rejects.toThrow('disk')
    expect(await shown(w)).toEqual(['choir'])

    await sweepMessageCache(
      w,
      [
        { communityDid: LAB, personaDid: ME },
        { communityDid: CHOIR, personaDid: ME },
      ],
      NOW
    )
    expect(w.copies().filter((c) => c.emptied === true)).toHaveLength(3)
    expect(w.journal()).toHaveLength(0)
  })

  it('control: nothing is kept for a room the journal still means to empty', async () => {
    const w = wallet()
    await keepRoomPosts(w, room(), [post('a')], NOW)
    w.genericRecords.update.mockImplementationOnce(async (r) => {
      w.records.get(r.id ?? '')!.content = r.content
    })
    w.genericRecords.update.mockRejectedValueOnce(new Error('disk'))
    await expect(emptyMessageCache(w, { room: ROOM }, 'access gone')).rejects.toThrow()
    expect(await keepRoomPosts(w, room(), [post('b')], NOW)).toBe(false)
  })
})

describe('at each start', () => {
  it('empties each copy whose membership no longer stands: a removal or an identity let go with the app closed', async () => {
    const w = wallet()
    await keepRoomPosts(w, room(), [post('a')], NOW)
    await keepRoomPosts(w, room({ communityDid: CHOIR, roomId: ROOM2 }), [post('b')], NOW)
    expect(await sweepMessageCache(w, [{ communityDid: CHOIR, personaDid: ME }], NOW)).toBe(1)
    expect(await readRoomPosts(w, ME, ROOM, NOW)).toBeUndefined()
    expect(await readRoomPosts(w, ME, ROOM2, NOW)).toBeDefined()
  })

  it('empties a copy whose room has ended, or whose posts are all past the days kept', async () => {
    const w = wallet()
    await keepRoomPosts(w, room({ validUntil: new Date(NOW + DAY).toISOString() }), [post('a')], NOW)
    await keepRoomPosts(w, room({ roomId: ROOM2 }), [post('b')], NOW)
    const later = NOW + (MSG_CACHE_DAYS + 1) * DAY
    expect(await sweepMessageCache(w, [{ communityDid: LAB, personaDid: ME }], later)).toBe(2)
  })

  it('control: a copy whose membership stands, in its room and its days, is kept', async () => {
    const w = wallet()
    await keepRoomPosts(w, room(), [post('a')], NOW)
    expect(await sweepMessageCache(w, [{ communityDid: LAB, personaDid: ME }], NOW)).toBe(0)
    expect(await readRoomPosts(w, ME, ROOM, NOW)).toBeDefined()
  })
})

// b0's findings on #1130, verified by ac.
describe('a membership read that fails, and a keep after an emptying', () => {
  const failing = async (): Promise<{ communityDid: string; personaDid: string }[]> => {
    throw new Error('store unreadable')
  }

  it('a failed membership read still lets the journal finish and the kill empty every copy', async () => {
    const w = wallet()
    await keepRoomPosts(w, room(), [post('a')], NOW)
    await keepRoomPosts(w, room({ roomId: ROOM2, communityDid: CHOIR }), [post('b')], NOW)
    // A journal entry left by an emptying cut short.
    w.genericRecords.update.mockImplementationOnce(async (r) => {
      w.records.get(r.id ?? '')!.content = r.content
    })
    w.genericRecords.update.mockRejectedValueOnce(new Error('disk'))
    await expect(emptyMessageCache(w, { community: CHOIR }, 'left')).rejects.toThrow()
    expect(w.journal()).toHaveLength(1)

    ROOMS_MESSAGE_CACHE.remoteOff = true
    await sweepMessageCache(w, failing, NOW)
    expect(w.journal()).toHaveLength(0)
    expect(w.copies().every((c) => c.emptied === true)).toBe(true)
  })

  it('control: a failed membership read, with the cache on, only skips the standing check', async () => {
    const w = wallet()
    await keepRoomPosts(w, room(), [post('a')], NOW)
    expect(await sweepMessageCache(w, failing, NOW)).toBe(0)
    expect(await readRoomPosts(w, ME, ROOM, NOW)).toBeDefined()
  })

  it('a keep on its way after its community was emptied does not put the posts back', async () => {
    const w = wallet()
    await keepRoomPosts(w, room(), [post('a')], NOW)
    await emptyMessageCache(w, { community: LAB }, 'removed')
    expect(w.journal()).toHaveLength(0)
    expect(await keepRoomPosts(w, room(), [post('a'), post('b')], NOW)).toBe(false)
    expect(JSON.stringify(w.copies())).not.toContain('the words of')
  })

  it('control: a keep of another community after one was emptied is kept', async () => {
    const w = wallet()
    await emptyMessageCache(w, { community: LAB }, 'removed')
    expect(await keepRoomPosts(w, room({ communityDid: CHOIR, roomId: ROOM2 }), [post('b')], NOW)).toBe(true)
  })

  it('a copy in a shape this build does not read is emptied by its tags once its membership is gone', async () => {
    const w = wallet()
    await keepRoomPosts(w, room(), [post('a')], NOW)
    const [record] = [...w.records.values()]
    record.content = { ...record.content, v: 2 }
    await sweepMessageCache(w, [{ communityDid: CHOIR, personaDid: ME }], NOW)
    expect(record.content).toEqual({ v: 1, emptied: true })
  })
})

describe('a phone its agent no longer accepts (revoked: a lost phone)', () => {
  const members = [{ communityDid: LAB, personaDid: ME }]
  it('has no membership standing, so a start empties every copy', async () => {
    const w = wallet()
    await keepRoomPosts(w, room(), [post('a')], NOW)
    await sweepMessageCache(w, standingMemberships('revoked', members), NOW)
    expect(await readRoomPosts(w, ME, ROOM, NOW)).toBeUndefined()
  })

  it('control: a linked phone keeps its copies', async () => {
    const w = wallet()
    await keepRoomPosts(w, room(), [post('a')], NOW)
    expect(standingMemberships('linked', members)).toEqual(members)
    await sweepMessageCache(w, standingMemberships('linked', members), NOW)
    expect(await readRoomPosts(w, ME, ROOM, NOW)).toBeDefined()
  })
})

describe('what ends access with no room in view', () => {
  it("a community's removal notice empties its rooms' copies", async () => {
    const w = wallet()
    await keepRoomPosts(w, room(), [post('a')], NOW)
    await bindMessageCache(w, async () => [{ communityDid: LAB, personaDid: ME }])
    DeviceEventEmitter.emit(VTI_REMOVED_EVENT, { communityDid: LAB, reason: 'removed' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    await emptyMessageCache(w, { community: 'did:webvh:none' }, 'settle')
    expect(await readRoomPosts(w, ME, ROOM, NOW)).toBeUndefined()
  })

  it('an agent being unlinked empties every copy', async () => {
    const w = wallet()
    await keepRoomPosts(w, room(), [post('a')], NOW)
    await keepRoomPosts(w, room({ communityDid: CHOIR, roomId: ROOM2 }), [post('b')], NOW)
    await bindMessageCache(w, async () => [
      { communityDid: LAB, personaDid: ME },
      { communityDid: CHOIR, personaDid: ME },
    ])
    DeviceEventEmitter.emit(VTA_UNLINKING_EVENT, { vtaDid: 'did:webvh:agent' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    await emptyMessageCache(w, { community: 'did:webvh:none' }, 'settle')
    expect(w.copies().every((c) => c.emptied === true)).toBe(true)
  })
})

// Read from the module as it ships, not as a test left it: main ships the cache on (Alberto, 11-18).
describe('the shipped default', () => {
  it('is on: true, remoteOff: false', () => {
    jest.isolateModules(() => {
      const { ROOMS_MESSAGE_CACHE: shipped, isMessageCacheOn: on } = jest.requireActual('../messageCache')
      expect(shipped).toEqual({ on: true, remoteOff: false })
      expect(on()).toBe(true)
    })
  })
})
