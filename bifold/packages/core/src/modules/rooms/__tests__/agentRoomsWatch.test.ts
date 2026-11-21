/**
 * The rooms service and its watches: a room is armed as its member at its host, the agent's signal reaches whoever
 * listens only for a room armed here, signals are heard only while someone listens, a left room's watch is cancelled,
 * and a lock forgets them all.
 */
import { AgentRoomsService, type RoomsBackend, type RoomsCommunity } from '../real/agentRoomsService'
import { ROOMS_TASK } from '../real/wire'

const COMMUNITY: RoomsCommunity = { did: 'did:webvh:community:a', name: 'Garden club', personaDid: 'did:key:persona-a' }
const ROOM = 'did:webvh:room:0123456789abcdef'
const HOST = 'did:webvh:community:a'
const LATER = new Date(Date.now() + 7 * 24 * 3600_000).toISOString()
const b64url = (s: string) => Buffer.from(s, 'utf8').toString('base64url')
const decode = (s: string) => Buffer.from(s, 'base64url').toString('utf8')

function setUp({
  served = [ROOMS_TASK.keysWatch01],
  liveDelivery = true,
}: { served?: string[]; /** null: the backend does not say. */ liveDelivery?: boolean | null } = {}) {
  const signals = new Set<(payload: Record<string, unknown>) => void>()
  const agentTask = jest.fn(async (type: string, payload: Record<string, unknown>) => {
    switch (type) {
      case ROOMS_TASK.keysList02:
        return { rooms: [{ roomId: ROOM, epoch: 3, earliestReadableEpoch: 1, member: COMMUNITY.personaDid }] }
      case ROOMS_TASK.keysBrowse:
        return { records: [], complete: true, verification: { priorRoots: 'noneHeld', anchor: 'none' } }
      case ROOMS_TASK.keysWatch01: {
        const rooms = payload.rooms as { roomId: string }[]
        return {
          member: payload.member,
          host: payload.host,
          watches: rooms.map(({ roomId }) => ({
            roomId,
            armed: !payload.cancel,
            ...(payload.cancel ? {} : { expiresAt: LATER }),
          })),
        }
      }
      default:
        throw new Error(`unexpected agent task ${type}`)
    }
  })
  const b: RoomsBackend = {
    agentLinked: () => true,
    agentServedTypes: async () => [ROOMS_TASK.keysList02, ROOMS_TASK.keysBrowse, ROOMS_TASK.keysRead, ...served],
    agentTask,
    communities: async () => [COMMUNITY],
    communityTask: jest.fn(async () => ({
      items: [
        {
          roomId: ROOM,
          host: HOST,
          label: 'Seed swap',
          visibility: 'attributed',
          actions: ['read', 'write'],
          state: 'admitted',
        },
      ],
    })),
    sendCompleted: jest.fn(async () => ({})),
    newId: () => 'id-1',
    leaveCommunity: jest.fn(async () => undefined),
    decodeBase64Url: decode,
    encodeBase64Url: b64url,
    hiddenOffers: async () => [],
    hideOffer: jest.fn(async () => undefined),
    warn: jest.fn(),
    ...(liveDelivery === null ? {} : { liveDelivery }),
    onRoomSignal: (listener) => {
      signals.add(listener)
      return () => void signals.delete(listener)
    },
  }
  const service = new AgentRoomsService(b)
  const watchesSent = () =>
    agentTask.mock.calls.filter(([t]) => t === ROOMS_TASK.keysWatch01).map(([, p]) => p as Record<string, unknown>)
  const push = (payload: Record<string, unknown>) => {
    for (const l of [...signals]) l(payload)
  }
  /** Let the watch's request go out and be answered. */
  const settle = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve()
  }
  return { service, agentTask, watchesSent, push, signals, settle }
}

const changed = (over: Record<string, unknown> = {}) => ({
  roomId: ROOM,
  member: COMMUNITY.personaDid,
  host: HOST,
  latestVersion: 5,
  ...over,
})

/** As a screen comes to it: the room listed first, so its member, its host and what the agent serves are known. */
const listed = async (s: ReturnType<typeof setUp>) => {
  await s.service.listNotes(ROOM)
  return s
}

test('a room is armed as its member, at its host, from the version given', async () => {
  const s = await listed(setUp())
  s.service.watchRoom(ROOM, 4)
  await s.settle()
  expect(s.watchesSent()).toEqual([
    expect.objectContaining({ member: COMMUNITY.personaDid, host: HOST, rooms: [{ roomId: ROOM, sinceVersion: 4 }] }),
  ])
  expect(s.service.roomWatched(ROOM)).toBe(true)
})

test('a room not listed yet is not armed: its member and host are not known', async () => {
  const s = setUp()
  s.service.watchRoom(ROOM, 4)
  await s.settle()
  expect(s.watchesSent()).toEqual([])
})

test("the agent's signal for that room reaches a listener, once; one naming another member reaches none", async () => {
  const s = await listed(setUp())
  s.service.watchRoom(ROOM, 4)
  await s.settle()
  // Spent before anyone hears it: the room's tick then reads at once, never held by the watched room's 120 s wait.
  const watchedWhenHeard: boolean[] = []
  const heard = jest.fn((roomId: string) => void watchedWhenHeard.push(s.service.roomWatched(roomId)))
  const stop = s.service.onRoomChanged(heard)
  s.push(changed({ member: 'did:key:someone-else' }))
  expect(heard).not.toHaveBeenCalled()
  s.push(changed())
  s.push(changed())
  expect(heard.mock.calls).toEqual([[ROOM]])
  expect(watchedWhenHeard).toEqual([false])
  stop()
})

test('signals are heard only while someone listens', async () => {
  const s = await listed(setUp())
  expect(s.signals.size).toBe(0)
  const stopA = s.service.onRoomChanged(jest.fn())
  const stopB = s.service.onRoomChanged(jest.fn())
  expect(s.signals.size).toBe(1)
  stopA()
  expect(s.signals.size).toBe(1)
  stopB()
  expect(s.signals.size).toBe(0)
})

test("leaving the room's community cancels its watch at the agent", async () => {
  const s = await listed(setUp())
  s.service.watchRoom(ROOM, 4)
  await s.settle()
  s.service.leftCommunity(COMMUNITY.did)
  await s.settle()
  expect(s.watchesSent()[1]).toEqual({
    member: COMMUNITY.personaDid,
    host: HOST,
    rooms: [{ roomId: ROOM }],
    cancel: true,
  })
  expect(s.service.roomWatched(ROOM)).toBe(false)
})

test('a lock forgets every watch: a signal after it reaches no one', async () => {
  const s = await listed(setUp())
  s.service.watchRoom(ROOM, 4)
  await s.settle()
  const heard = jest.fn()
  s.service.onRoomChanged(heard)
  s.service.dropOpenedRecords()
  expect(s.service.roomWatched(ROOM)).toBe(false)
  s.push(changed())
  expect(heard).not.toHaveBeenCalled()
})

test('an agent that does not serve the watch: nothing is sent and the room is not watched (control)', async () => {
  const s = await listed(setUp({ served: [] }))
  s.service.watchRoom(ROOM, 4)
  await s.settle()
  expect(s.watchesSent()).toEqual([])
  expect(s.service.roomWatched(ROOM)).toBe(false)
})

test('a backend that does not say live delivery is on: nothing is armed (fails closed)', async () => {
  const s = await listed(setUp({ liveDelivery: null }))
  s.service.watchRoom(ROOM, 4)
  await s.settle()
  expect(s.watchesSent()).toEqual([])
})
