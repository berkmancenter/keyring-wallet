/**
 * A room's listing at the agent's own version of `rooms/keys/browse`. Agents from vta-service 0.67's nightly (upstream
 * e6380bf1, 10-30) serve browse at 0.3 only, and a room on one listed nothing; agents before it serve 0.1. 0.3 asks
 * with the same members and answers with the same ones plus the room's `lastPrune` (trust-tasks-tf
 * `specs/rooms/keys/browse/0.3`; vta-service `room_group.rs` `browse_at`).
 */
import { AgentRoomsService, type RoomsBackend, type RoomsCommunity } from '../real/agentRoomsService'
import { ROOMS_TASK } from '../real/wire'
import { inReadLane } from '../../trust-tasks/module/vtaReadLane'

const COMMUNITY: RoomsCommunity = { did: 'did:webvh:community:a', name: 'Garden club', personaDid: 'did:key:persona-a' }
const ROOM = 'did:webvh:room:0123456789abcdef'
const HOST = 'did:webvh:community:a'

const b64url = (s: string) => Buffer.from(s, 'utf8').toString('base64url')
const sealedBody = (key: string, version: number, body: string) =>
  b64url(
    JSON.stringify({ roomId: ROOM, key, version, author: 'did:key:alice', body, proof: { type: 'DataIntegrityProof' } })
  )

const RECORDS = [
  { key: 'note/0bc5fcde18', version: 41 },
  { key: 'a6-276d-live-204829', version: 38 },
]

const PRUNE = { version: 12, prunedAt: '2026-10-29T08:00:00Z', removed: 3 }

/** A browse answer as the agent sends it: 0.1's members, and at 0.3 the room's `lastPrune` too. */
function browseAnswer(type: string, prune: { lastPrune?: unknown } = { lastPrune: PRUNE }) {
  return {
    roomId: ROOM,
    records: RECORDS.map(({ key, version }) => ({
      key,
      version,
      status: 'active',
      author: 'did:key:alice',
      updatedAt: '2026-10-30T09:00:00Z',
    })),
    complete: true,
    verification: { priorRoots: 'agrees', anchor: 'notOffered', count: 'agrees' },
    ...(type === ROOMS_TASK.keysBrowse03 && 'lastPrune' in prune ? { lastPrune: prune.lastPrune } : {}),
  }
}

/**
 * An agent that lists `browse` among what it serves and answers `answering` (by default the same), refusing any other
 * browse version as vta-service does. Older agents answer some versions their list leaves out.
 */
function agentServing(
  browse: string[],
  answering: string[] = browse,
  prune: { lastPrune?: unknown } = { lastPrune: PRUNE }
) {
  const served = [ROOMS_TASK.keysList02, ROOMS_TASK.keysRead, ROOMS_TASK.keysAct06, ...browse]
  const agentTask = jest.fn(async (type: string, payload: Record<string, unknown>): Promise<unknown> => {
    if (type === ROOMS_TASK.keysList02)
      return { rooms: [{ roomId: ROOM, epoch: 3, earliestReadableEpoch: 1, member: 'did:key:persona-a' }] }
    if (type === ROOMS_TASK.keysRead) {
      const r = RECORDS.find((x) => x.key === payload.key)
      if (!r) throw new Error(`no such record ${String(payload.key)}`)
      return {
        key: r.key,
        version: r.version,
        status: 'active',
        author: 'did:key:alice',
        updatedAt: '2026-10-30T09:00:00Z',
        plaintext: sealedBody(r.key, r.version, `words of ${r.key}`),
      }
    }
    if (type.includes('/rooms/keys/browse/')) {
      if (!answering.includes(type))
        throw Object.assign(new Error(`${type} is not served`), { code: 'unsupportedType' })
      expect(Object.keys(payload).sort()).toEqual(expect.arrayContaining(['host', 'roomId']))
      return browseAnswer(type, prune)
    }
    throw new Error(`unexpected agent task ${type}`)
  })
  const b = {
    agentLinked: () => true,
    agentServedTypes: async () => served,
    agentTask,
    communities: async () => [COMMUNITY],
    communityTask: jest.fn(async () => ({
      items: [{ roomId: ROOM, host: HOST, visibility: 'attributed', actions: ['read'], state: 'admitted' }],
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
  const browses = () =>
    agentTask.mock.calls.map(([type]) => type).filter((type) => type.includes('/rooms/keys/browse/'))
  const reads = () => agentTask.mock.calls.filter(([type]) => type === ROOMS_TASK.keysRead).map(([, p]) => p.key)
  return { b, browses, reads }
}

describe("a room's listing at the agent's browse version", () => {
  it('an agent serving browse 0.3 only lists the room at 0.3', async () => {
    const { b, browses } = agentServing([ROOMS_TASK.keysBrowse03])
    const service = new AgentRoomsService(b)
    await service.listMyRooms()
    const list = await service.listNotes(ROOM)
    expect(browses()).toEqual([ROOMS_TASK.keysBrowse03])
    expect(list.notes.map((n) => [n.key, n.version])).toEqual([
      ['note/0bc5fcde18', 41],
      ['a6-276d-live-204829', 38],
    ])
    expect(list.complete).toBe(true)
  })

  it('an agent serving browse 0.1 only (older agents, the pinned lab) lists the room at 0.1', async () => {
    const { b, browses } = agentServing([ROOMS_TASK.keysBrowse])
    const service = new AgentRoomsService(b)
    await service.listMyRooms()
    const list = await service.listNotes(ROOM)
    expect(browses()).toEqual([ROOMS_TASK.keysBrowse])
    expect(list.notes).toHaveLength(2)
  })

  it('an agent serving both is asked at 0.3', async () => {
    const { b, browses } = agentServing([ROOMS_TASK.keysBrowse, ROOMS_TASK.keysBrowse03])
    const service = new AgentRoomsService(b)
    await service.listMyRooms()
    await service.listNotes(ROOM)
    expect(browses()).toEqual([ROOMS_TASK.keysBrowse03])
  })

  it("the files tab lists at the agent's version too", async () => {
    const { b, browses } = agentServing([ROOMS_TASK.keysBrowse03])
    const service = new AgentRoomsService(b)
    await service.listMyRooms()
    await service.listFiles(ROOM)
    expect(browses()).toEqual([ROOMS_TASK.keysBrowse03])
  })

  it("a sealed write predicts its version from a listing at the agent's version", async () => {
    // writeSealed's headVersion; the whole write is agentRoomsWrite.test.ts's.
    const { b, browses } = agentServing([ROOMS_TASK.keysBrowse03])
    const service = new AgentRoomsService(b)
    await service.listMyRooms()
    const inside = service as unknown as {
      rooms: Map<string, unknown>
      headVersion(room: unknown): Promise<number>
    }
    expect(await inside.headVersion(inside.rooms.get(ROOM))).toBe(41)
    expect(browses()).toEqual([ROOMS_TASK.keysBrowse03])
  })

  it('an agent that lists neither version is asked 0.1, as before 0.3', async () => {
    const { b, browses } = agentServing([], [ROOMS_TASK.keysBrowse])
    const service = new AgentRoomsService(b)
    await service.listMyRooms()
    await service.listFiles(ROOM)
    expect(browses()).toEqual([ROOMS_TASK.keysBrowse])
  })

  it('a post read once is reused on a reopen whichever version listed it', async () => {
    for (const version of [ROOMS_TASK.keysBrowse03, ROOMS_TASK.keysBrowse]) {
      const { b, reads } = agentServing([version])
      const service = new AgentRoomsService(b)
      await service.listMyRooms()
      await service.listNotes(ROOM)
      await service.readNote(ROOM, 'a6-276d-live-204829')
      await service.listNotes(ROOM) // the reopen
      await service.readNote(ROOM, 'a6-276d-live-204829')
      expect(reads()).toEqual(['a6-276d-live-204829'])
    }
  })

  it("a 0.3 listing carries the room's last prune, for the reader rule in useRoomPosts", async () => {
    const { b } = agentServing([ROOMS_TASK.keysBrowse03])
    const service = new AgentRoomsService(b)
    await service.listMyRooms()
    expect((await service.listNotes(ROOM)).lastPrune).toEqual(PRUNE)
  })

  it('a prune mark from a host still on rooms/_shared 0.1 (`at`, not `prunedAt`) is read too', async () => {
    const { b } = agentServing([ROOMS_TASK.keysBrowse03], undefined, {
      lastPrune: { version: 12, at: PRUNE.prunedAt, removed: 3 },
    })
    const service = new AgentRoomsService(b)
    await service.listMyRooms()
    expect((await service.listNotes(ROOM)).lastPrune).toEqual(PRUNE)
  })

  it('a mark without a whole version is left out, and a room never pruned has none', async () => {
    for (const prune of [
      { lastPrune: { version: '12', prunedAt: PRUNE.prunedAt, removed: 3 } },
      { lastPrune: { removed: 3 } },
      { lastPrune: 'pruned' },
      { lastPrune: null },
      {},
    ]) {
      const { b } = agentServing([ROOMS_TASK.keysBrowse03], undefined, prune)
      const service = new AgentRoomsService(b)
      await service.listMyRooms()
      const list = await service.listNotes(ROOM)
      expect(list).not.toHaveProperty('lastPrune')
      expect(list.notes).toHaveLength(2)
    }
  })

  it('a 0.1 listing has no prune mark', async () => {
    const { b } = agentServing([ROOMS_TASK.keysBrowse])
    const service = new AgentRoomsService(b)
    await service.listMyRooms()
    expect(await service.listNotes(ROOM)).not.toHaveProperty('lastPrune')
  })

  it('every browse and read version Keyring sends shares the read lane', () => {
    expect(inReadLane(ROOMS_TASK.keysBrowse03)).toBe(true)
    expect(inReadLane(ROOMS_TASK.keysBrowse)).toBe(true)
    expect(inReadLane(ROOMS_TASK.keysRead)).toBe(true)
  })
})
