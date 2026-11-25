/**
 * A message in a room that takes records goes as a sealed record, and each was five trips to the agent in a row
 * (IN-776, 282.1, First Room): the key list (for the room's epoch), a listing of the whole room (for its newest
 * version), the seal, the act and the put. The first two are now answered from what the service already holds where
 * that is safe: a key list read in the last few minutes, and the room's newest version as a recent listing found it
 * while the room is watched. A wrong guess of the newest version is a version race, which the write already survives.
 */
import {
  AgentRoomsService,
  HEAD_FRESH_MS,
  HELD_FRESH_MS,
  type RoomsBackend,
  type RoomsCommunity,
} from '../real/agentRoomsService'
import { RecordMembersNotPermitted } from '../real/recordWrites'
import { ROOMS_TASK } from '../real/wire'

const COMMUNITY: RoomsCommunity = { did: 'did:webvh:community:a', name: 'Garden club', personaDid: 'did:key:persona-a' }
const HOST = COMMUNITY.did
const ROOM = 'did:webvh:room:attributed1'
const ME = COMMUNITY.personaDid
const T0 = 1_800_000_000_000

const b64url = (s: string) => Buffer.from(s, 'utf8').toString('base64url')
const unb64 = (s: string) => Buffer.from(s, 'base64url').toString('utf8')

const SERVED = [
  ROOMS_TASK.keysList02,
  ROOMS_TASK.keysBrowse,
  ROOMS_TASK.keysRead,
  ROOMS_TASK.keysAct06,
  ROOMS_TASK.keysSeal02,
  ROOMS_TASK.keysSeal03,
  ROOMS_TASK.keysProfileRead,
  ROOMS_TASK.keysWatch01,
]

/** A host that keeps the room's newest version and gives a new record the next one, as a real host does. */
function setup({ head = 4 }: { head?: number } = {}) {
  const clock = { now: T0 }
  const host = { head }
  const agentTask = jest.fn(async (type: string, payload: Record<string, unknown>): Promise<unknown> => {
    switch (type) {
      case ROOMS_TASK.keysList02:
        return { rooms: [{ roomId: ROOM, epoch: 3, earliestReadableEpoch: 0, member: ME }] }
      case ROOMS_TASK.keysBrowse:
        return {
          records: host.head ? [{ key: 'older', version: host.head, status: 'active' }] : [],
          complete: true,
        }
      case ROOMS_TASK.keysProfileRead:
        return { roomId: ROOM, status: 'found', profile: { name: 'Room', recordMembers: ['kind'] } }
      case ROOMS_TASK.keysSeal02:
      case ROOMS_TASK.keysSeal03:
        return { sealed: { ciphertext: `sealed:${String(payload.plaintext)}`, nonce: 'nonce', epoch: 3 } }
      case ROOMS_TASK.keysWatch01: {
        const rooms = payload.rooms as { roomId: string }[]
        return {
          member: payload.member,
          host: payload.host,
          watches: rooms.map(({ roomId }) => ({
            roomId,
            armed: true,
            expiresAt: new Date(clock.now + 7 * 24 * 3600_000).toISOString(),
          })),
        }
      }
      case ROOMS_TASK.keysAct06: {
        const document = payload.document as Record<string, unknown>
        return {
          principal: ME,
          document: {
            ...document,
            issuer: ME,
            payload: { ...(document.payload as Record<string, unknown>), presentation: { type: 'presentation' } },
            proof: { type: 'DataIntegrityProof' },
          },
        }
      }
      default:
        throw new Error(`unexpected agent task ${type}`)
    }
  })
  // The put, as the host answers it: stored at the room's next version, whatever version it was sealed for.
  const sendCompleted = jest.fn(async (_did: string, _to: string, document: Record<string, unknown>) => {
    const p = document.payload as { key: string }
    host.head += 1
    return { key: p.key, version: host.head, epoch: 3 }
  })
  const b = {
    agentLinked: () => true,
    agentServedTypes: async () => SERVED,
    agentTask,
    communities: async () => [COMMUNITY],
    communityTask: jest.fn(async () => ({
      items: [{ roomId: ROOM, host: HOST, visibility: 'attributed', actions: ['read', 'write'], state: 'admitted' }],
    })),
    sendCompleted,
    newId: () => 'opaque-1',
    leaveCommunity: jest.fn(async () => undefined),
    decodeBase64Url: unb64,
    encodeBase64Url: b64url,
    hiddenOffers: async () => [],
    hideOffer: jest.fn(async () => undefined),
    warn: jest.fn(),
    recordSending: true,
    liveDelivery: true,
  } as unknown as RoomsBackend
  const service = new AgentRoomsService(b, undefined, { now: () => clock.now })
  const count = (type: string) => agentTask.mock.calls.filter(([t]) => t === type).length
  const sealedVersions = () =>
    agentTask.mock.calls
      .filter(([t]) => t === ROOMS_TASK.keysSeal02 || t === ROOMS_TASK.keysSeal03)
      .map(([, p]) => p.version as number)
  const settle = async () => {
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0))
  }
  /** The room screen: the room listed, and watched from its newest version. */
  const openWatched = async () => {
    await service.listMyRooms()
    await service.listNotes(ROOM)
    // What the room's screen asks as it opens (useRecordSending): the record members its profile lists.
    await service.recordFeaturesIn(ROOM)
    service.watchRoom(ROOM, host.head)
    await settle()
    expect(service.roomWatched(ROOM)).toBe(true)
  }
  const send = (body = 'hello', idempotencyKey = `post-${Math.random()}`) =>
    service.sendRecord(ROOM, { type: 'message', body, idempotencyKey })
  return { service, agentTask, sendCompleted, host, clock, count, sealedVersions, openWatched, send, settle }
}

describe('the key list a write asked for its room epoch', () => {
  test('is not asked again while one read in the last few minutes holds the room', async () => {
    const s = setup()
    await s.openWatched()
    const before = s.count(ROOMS_TASK.keysList02)
    await s.send('one')
    await s.send('two')
    expect(s.count(ROOMS_TASK.keysList02)).toBe(before)
  })

  test('is asked again once the last one is older than that (control)', async () => {
    const s = setup()
    await s.openWatched()
    const before = s.count(ROOMS_TASK.keysList02)
    s.clock.now += HELD_FRESH_MS
    await s.send()
    expect(s.count(ROOMS_TASK.keysList02)).toBe(before + 1)
  })
})

describe("the room's newest version a sealed write is sealed for", () => {
  test('watched, with a recent listing: taken from that listing, with no listing of the whole room', async () => {
    const s = setup({ head: 4 })
    await s.openWatched()
    const browsed = s.count(ROOMS_TASK.keysBrowse)
    const written = await s.send()
    expect(s.count(ROOMS_TASK.keysBrowse)).toBe(browsed)
    expect(s.sealedVersions()).toEqual([5])
    expect(written.version).toBe(5)
    // The service's own write moved the head it holds: the next message is sealed for the version after.
    await s.send()
    expect(s.count(ROOMS_TASK.keysBrowse)).toBe(browsed)
    expect(s.sealedVersions()).toEqual([5, 6])
  })

  test('another member wrote since that listing: a version race, sealed and put again, with still no listing', async () => {
    const s = setup({ head: 4 })
    await s.openWatched()
    const browsed = s.count(ROOMS_TASK.keysBrowse)
    // Someone else's post the phone has not listed yet.
    s.host.head = 5
    const written = await s.send()
    // Sealed for 5, stored at 6, so sealed again for 7 and put at 6 to give 7.
    expect(s.sealedVersions()).toEqual([5, 7])
    expect(s.sendCompleted).toHaveBeenCalledTimes(2)
    expect(written.version).toBe(7)
    expect(s.count(ROOMS_TASK.keysBrowse)).toBe(browsed)
  })

  test.each([
    [
      'not watched',
      async (s: ReturnType<typeof setup>) => {
        await s.service.listMyRooms()
        await s.service.listNotes(ROOM)
      },
    ],
    [
      'watched, but the listing is older than the watched poll',
      async (s: ReturnType<typeof setup>) => {
        await s.openWatched()
        s.clock.now += HEAD_FRESH_MS
      },
    ],
    [
      'watched, but never listed (control: the sending screen listed nothing)',
      async (s: ReturnType<typeof setup>) => {
        await s.service.listMyRooms()
        s.service.watchRoom(ROOM, 0)
        await s.settle()
      },
    ],
  ])('%s: the whole room is listed for it, as before (control)', async (_, arrange) => {
    const s = setup({ head: 4 })
    await arrange(s)
    const browsed = s.count(ROOMS_TASK.keysBrowse)
    await s.send()
    expect(s.count(ROOMS_TASK.keysBrowse)).toBe(browsed + 1)
    expect(s.sealedVersions()).toEqual([5])
  })

  test('a lock forgets the head and the key list: the next write lists both again', async () => {
    const s = setup({ head: 4 })
    await s.openWatched()
    s.service.dropOpenedRecords()
    await s.service.listMyRooms()
    const [lists, browsed] = [s.count(ROOMS_TASK.keysList02), s.count(ROOMS_TASK.keysBrowse)]
    await s.send()
    expect(s.count(ROOMS_TASK.keysBrowse)).toBe(browsed + 1)
    expect(s.count(ROOMS_TASK.keysList02)).toBeGreaterThanOrEqual(lists)
  })
})

// Review of #1029: before, a stale key list or head would be trusted by every write until it aged out. Now a failed write
// forgets both, so a stale one costs one failed write.
describe('a write that fails forgets what it took on trust', () => {
  test('the next write asks the key list and lists the room again, and goes through', async () => {
    const s = setup({ head: 4 })
    await s.openWatched()
    // The put is refused once: as a write that met a moved epoch would be.
    s.sendCompleted.mockRejectedValueOnce(Object.assign(new Error('refused'), { name: 'VtiRefusal', code: 'conflict' }))
    await expect(s.send('first')).rejects.toBeDefined()
    const [lists, browsed] = [s.count(ROOMS_TASK.keysList02), s.count(ROOMS_TASK.keysBrowse)]
    const written = await s.send('second')
    expect(s.count(ROOMS_TASK.keysList02)).toBe(lists + 1)
    expect(s.count(ROOMS_TASK.keysBrowse)).toBe(browsed + 1)
    expect(written.version).toBe(5)
  })

  // The other door: a reply is refused on the phone, before anything is sealed, when the epoch's profile does not list
  // inReplyTo. With a key list held across an epoch move that was every reply for five minutes.
  test('a reply refused on the phone for its members forgets the key list too: the next write asks a fresh one', async () => {
    const s = setup({ head: 4 })
    await s.openWatched()
    await expect(
      s.service.sendRecord(ROOM, {
        type: 'message',
        body: 'yes',
        inReplyTo: { key: 'older', version: 4 },
        idempotencyKey: 'r1',
      })
    ).rejects.toBeInstanceOf(RecordMembersNotPermitted)
    expect(s.sendCompleted).not.toHaveBeenCalled()
    const lists = s.count(ROOMS_TASK.keysList02)
    await s.send('then a message')
    expect(s.count(ROOMS_TASK.keysList02)).toBe(lists + 1)
  })

  test('a write that goes through keeps both: the next one asks neither (control)', async () => {
    const s = setup({ head: 4 })
    await s.openWatched()
    await s.send('first')
    const [lists, browsed] = [s.count(ROOMS_TASK.keysList02), s.count(ROOMS_TASK.keysBrowse)]
    await s.send('second')
    expect([s.count(ROOMS_TASK.keysList02), s.count(ROOMS_TASK.keysBrowse)]).toEqual([lists, browsed])
  })
})

describe('the trips a message costs, end to end', () => {
  test('watched and recently listed: seal, act and put only', async () => {
    const s = setup({ head: 4 })
    await s.openWatched()
    s.agentTask.mockClear()
    s.sendCompleted.mockClear()
    await s.send()
    // A message carries `kind`, a member a profile governs, so it is sealed at 0.3.
    expect(s.agentTask.mock.calls.map(([t]) => t)).toEqual([ROOMS_TASK.keysSeal03, ROOMS_TASK.keysAct06])
    expect(s.sendCompleted).toHaveBeenCalledTimes(1)
  })
})

describe('the line a post leaves in the log', () => {
  test('says the room by its short form, how it went and how long, and nothing it said', () => {
    const s = setup()
    const warn = (s.service as unknown as { backend: { warn: jest.Mock } }).backend.warn
    const LONG = 'did:webvh:QmRoomScidThatIsLong0123456789:first.example:room-dids:9381cab61f82'
    s.service.notePostSent(LONG, 2150, { failed: false, asRecord: true, file: false })
    s.service.notePostSent(LONG, 30000, { failed: true, asRecord: false, file: true })
    const lines = warn.mock.calls.map(([line]) => String(line)).filter((line) => line.includes('after Send'))
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatch(/^rooms: \S+ a post as a record was written 2150 ms after Send$/)
    expect(lines[1]).toMatch(/^rooms: \S+ a post as a file failed 30000 ms after Send$/)
    expect(lines.join('\n')).not.toContain(LONG)
  })
})
