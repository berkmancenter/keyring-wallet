/**
 * A window of a room's records (`listNotes`'s `head`, rooms/newestFirstSwitch), as the real service asks it. Where the
 * agent serves browse 0.6 (or 0.5, for a head), it is asked newest first, one host page: `order: newestFirst`,
 * `limit`, `maxPages: 1`, and 0.6's `beforeVersion` for a window below. The agent's `complete: false` is the bound asked
 * for, said as `older`. Where the agent or the room's host cannot (`unsupportedType` from a host without records/list
 * 0.7/0.8, `unsupportedVersion`, or an agent serving neither, as the Farm's 887370a3b), the whole room is listed as
 * before and the window cut from it, and a refusal is not asked again for a while. Off, the whole-room ladder starts at
 * 0.4 again, as before the switch.
 */
import {
  AgentRoomsService,
  UNSERVED_LISTING_MS,
  type RoomsBackend,
  type RoomsCommunity,
} from '../real/agentRoomsService'
import { ROOMS_TASK } from '../real/wire'
import { ROOMS_NEWEST_FIRST } from '../newestFirstSwitch'

const COMMUNITY: RoomsCommunity = { did: 'did:webvh:community:a', personaDid: 'did:key:persona-a' }
const ROOM = 'did:webvh:room:a'
const BASE = [ROOMS_TASK.keysList02, ROOMS_TASK.keysRead]

/** A refusal as both legs throw it (`VtiRefusal`), the task's own code in `details`. */
const refusal = (code: string, hostCode?: string) =>
  Object.assign(new Error(`refused: ${code}`), {
    name: 'VtiRefusal',
    code: 'taskFailed',
    details: hostCode ? { code: hostCode, reason: 'the host does not serve it' } : { code },
  })

/** The room's records r1…r`count`, as the agent lists them: rows in the order asked, bounded as asked. */
const rows = (count: number) =>
  Array.from({ length: count }, (_, i) => ({ key: `r${i + 1}`, version: i + 1, status: 'active' }))

function setup(served: string[], count = 100) {
  let clock = 1_000_000
  /** What the agent answers a newest-first browse with, instead of a listing (a refusal). */
  let newestFirst: (() => unknown) | undefined
  const agentTask = jest.fn(async (type: string, p: Record<string, unknown>): Promise<unknown> => {
    if (type === ROOMS_TASK.keysList02) return { rooms: [] }
    if (!type.includes('/rooms/keys/browse/')) throw new Error(`unexpected agent task ${type}`)
    if (p.order === 'newestFirst') {
      if (newestFirst) return newestFirst()
      const below = rows(count)
        .filter((r) => p.beforeVersion === undefined || r.version < Number(p.beforeVersion))
        .reverse()
      const page = below.slice(0, Number(p.limit))
      return {
        roomId: ROOM,
        records: page,
        complete: page.length === below.length,
        verification: { count: 'notComparable' },
      }
    }
    return { roomId: ROOM, records: rows(count), complete: true, verification: { count: 'agrees' } }
  })
  const b = {
    agentLinked: () => true,
    agentServedTypes: async () => [...BASE, ...served],
    agentTask,
    communities: async () => [COMMUNITY],
    communityTask: jest.fn(async () => ({
      items: [{ roomId: ROOM, host: COMMUNITY.did, visibility: 'open', actions: ['read'], state: 'admitted' }],
    })),
    sendCompleted: jest.fn(async () => ({})),
    newId: () => 'id-1',
    leaveCommunity: jest.fn(async () => undefined),
    decodeBase64Url: (s: string) => Buffer.from(s, 'base64url').toString('utf8'),
    encodeBase64Url: (s: string) => Buffer.from(s, 'utf8').toString('base64url'),
    hiddenOffers: async () => [],
    hideOffer: jest.fn(async () => undefined),
    warn: jest.fn(),
  } as unknown as RoomsBackend
  const service = new AgentRoomsService(b, undefined, { now: () => clock, sleep: async () => undefined })
  /** Each browse sent: its type's version and its payload beyond the room and host. */
  const browses = () =>
    agentTask.mock.calls
      .filter(([type]) => type.includes('/rooms/keys/browse/'))
      .map(([type, { roomId: _r, host: _h, ...rest }]) => [type.slice(type.lastIndexOf('/') + 1), rest])
  return {
    service,
    browses,
    advance: (ms: number) => (clock += ms),
    refuseNewestFirst: (answer: () => unknown) => (newestFirst = answer),
  }
}

const versions = (list: { notes: { version: number }[] }) => list.notes.map((n) => n.version)
const newestDown = (from: number, n: number) => Array.from({ length: n }, (_, i) => from - i)

afterEach(() => {
  ROOMS_NEWEST_FIRST.on = true
  ROOMS_NEWEST_FIRST.remoteOff = false
})

describe('an agent serving browse 0.6', () => {
  const served = [ROOMS_TASK.keysBrowse06, ROOMS_TASK.keysBrowse05, ROOMS_TASK.keysBrowse04]

  test('asks a head newest first, one host page, and says the rest as older, not as incomplete', async () => {
    const s = setup(served)
    await s.service.listMyRooms()
    const head = await s.service.listNotes(ROOM, { head: 60 })
    expect(s.browses()).toEqual([['0.6', { order: 'newestFirst', limit: 60, maxPages: 1 }]])
    expect(versions(head)).toEqual(newestDown(100, 60))
    expect(head).toMatchObject({ complete: true, older: true })
  })

  test('asks the window below with beforeVersion, and says nothing older once it reaches the first record', async () => {
    const s = setup(served)
    await s.service.listMyRooms()
    const below = await s.service.listNotes(ROOM, { head: 60, beforeVersion: 41 })
    expect(s.browses()).toEqual([['0.6', { order: 'newestFirst', limit: 60, maxPages: 1, beforeVersion: 41 }]])
    expect(versions(below)).toEqual(newestDown(40, 40))
    expect(below.older).toBe(false)
  })

  test('lists the whole room at 0.6 with none of its own members, as 0.4 would', async () => {
    const s = setup(served)
    await s.service.listMyRooms()
    const whole = await s.service.listNotes(ROOM)
    expect(s.browses()).toEqual([['0.6', {}]])
    expect(whole.notes).toHaveLength(100)
    expect(whole.older).toBeUndefined()
  })

  test('falls back to the whole room when the host has no newest-first listing, and does not ask again for a while', async () => {
    const s = setup(served)
    s.refuseNewestFirst(() => Promise.reject(refusal('rooms/keys/browse:hostRefused', 'unsupportedType')))
    await s.service.listMyRooms()
    const head = await s.service.listNotes(ROOM, { head: 60 })
    expect(s.browses()).toEqual([
      ['0.6', { order: 'newestFirst', limit: 60, maxPages: 1 }],
      ['0.6', {}],
    ])
    // The same window either way: the newest 60, more below, nothing withheld.
    expect(versions(head)).toEqual(newestDown(100, 60))
    expect(head).toMatchObject({ complete: true, older: true })

    s.advance(UNSERVED_LISTING_MS - 1)
    await s.service.listNotes(ROOM, { head: 60 })
    expect(s.browses().filter(([, p]) => (p as { order?: string }).order === 'newestFirst')).toHaveLength(1)
    s.advance(1)
    await s.service.listNotes(ROOM, { head: 60 })
    expect(s.browses().filter(([, p]) => (p as { order?: string }).order === 'newestFirst')).toHaveLength(2)
  })

  test('a host without the window below still answers heads newest first', async () => {
    const s = setup(served)
    s.refuseNewestFirst(() => Promise.reject(refusal('rooms/keys/browse:hostRefused', 'unsupportedType')))
    await s.service.listMyRooms()
    await s.service.listNotes(ROOM, { head: 60, beforeVersion: 41 })
    s.refuseNewestFirst(undefined as never)
    await s.service.listNotes(ROOM, { head: 60 })
    expect(s.browses().at(-1)).toEqual(['0.6', { order: 'newestFirst', limit: 60, maxPages: 1 }])
  })

  test.each([
    ['another refusal', () => Promise.reject(refusal('rooms/keys/browse:notAMember'))],
    ['no answer', () => Promise.reject(Object.assign(new Error('timed out'), { name: 'VtiSentNoAnswer' }))],
  ])('control: %s is passed on, not answered from the whole room', async (_name, answer) => {
    const s = setup(served)
    s.refuseNewestFirst(answer)
    await s.service.listMyRooms()
    await expect(s.service.listNotes(ROOM, { head: 60 })).rejects.toBeDefined()
    expect(s.browses()).toHaveLength(1)
  })

  test('keeps a window to what was asked, whatever came back', async () => {
    const s = setup(served)
    s.refuseNewestFirst(() => ({ roomId: ROOM, records: rows(50), complete: false }))
    await s.service.listMyRooms()
    const below = await s.service.listNotes(ROOM, { head: 10, beforeVersion: 30 })
    expect(versions(below)).toEqual(newestDown(29, 10))
    expect(s.browses()).toEqual([['0.6', { order: 'newestFirst', limit: 10, maxPages: 1, beforeVersion: 30 }]])
    expect(below.older).toBe(true)
  })
})

describe('an agent serving browse 0.5 only', () => {
  const served = [ROOMS_TASK.keysBrowse05, ROOMS_TASK.keysBrowse04]

  test('asks a head newest first at 0.5, and cuts the window below from the whole room', async () => {
    const s = setup(served)
    await s.service.listMyRooms()
    await s.service.listNotes(ROOM, { head: 60 })
    const below = await s.service.listNotes(ROOM, { head: 60, beforeVersion: 41 })
    expect(s.browses()).toEqual([
      ['0.5', { order: 'newestFirst', limit: 60, maxPages: 1 }],
      ['0.5', {}],
    ])
    expect(versions(below)).toEqual(newestDown(40, 40))
    expect(below.older).toBe(false)
  })
})

describe("an agent serving neither (the Farm's 887370a3b serves browse up to 0.4)", () => {
  const served = [ROOMS_TASK.keysBrowse04, ROOMS_TASK.keysBrowse03]

  test('lists the whole room at 0.4, as before, and cuts the window from it', async () => {
    const s = setup(served)
    await s.service.listMyRooms()
    const head = await s.service.listNotes(ROOM, { head: 60 })
    expect(s.browses()).toEqual([['0.4', {}]])
    expect(versions(head)).toEqual(newestDown(100, 60))
    expect(head).toMatchObject({ complete: true, older: true })
  })

  test('one whole listing serves a head and a whole listing asked together', async () => {
    const s = setup(served)
    await s.service.listMyRooms()
    await Promise.all([s.service.listNotes(ROOM, { head: 60 }), s.service.listNotes(ROOM)])
    expect(s.browses()).toEqual([['0.4', {}]])
  })
})

describe('switched off', () => {
  const served = [ROOMS_TASK.keysBrowse06, ROOMS_TASK.keysBrowse05, ROOMS_TASK.keysBrowse04]

  test('lists the whole room at 0.4 even where 0.6 is served, and asks nothing newest first', async () => {
    ROOMS_NEWEST_FIRST.on = false
    const s = setup(served)
    await s.service.listMyRooms()
    await s.service.listNotes(ROOM)
    const head = await s.service.listNotes(ROOM, { head: 60 })
    expect(s.browses()).toEqual([
      ['0.4', {}],
      ['0.4', {}],
    ])
    expect(versions(head)).toEqual(newestDown(100, 60))
  })

  test('the remote kill does the same, whatever on says', async () => {
    ROOMS_NEWEST_FIRST.remoteOff = true
    const s = setup(served)
    await s.service.listMyRooms()
    await s.service.listNotes(ROOM, { head: 60 })
    expect(s.browses()).toEqual([['0.4', {}]])
  })
})
