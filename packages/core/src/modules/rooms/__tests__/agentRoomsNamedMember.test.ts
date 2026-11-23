/**
 * A room the agent holds keys for as two of this phone's identities. On 11-17 Alberto left a community, joined it again
 * as a new identity and accepted a room he had held as the old one: from the Welcome on, every custody task for it was
 * refused `conflict` (vta-service `room_member.rs` `acting`: two personas the caller may act as hold the room), so the
 * room never read and his posts were not sent. Such a room's custody tasks now name its own identity in
 * `ext["org.openvtc.rooms"].member` (`acting_as`); every other room is asked exactly as before.
 */
import { AgentRoomsService, offerIdOf, type RoomsBackend, type RoomsCommunity } from '../real/agentRoomsService'
import { ROOMS_TASK } from '../real/wire'
import { logRef } from '../roomsLogWords'

const OLD = 'did:webvh:QmOld:dids.example:al-before'
const NEW = 'did:webvh:QmNew:dids.example:al-again'
const COMMUNITY: RoomsCommunity = { did: 'did:webvh:community:lab', personaDid: NEW }
const ROOM = 'did:webvh:room:file-test'
const OTHER = 'did:webvh:room:other'

const b64url = (s: string) => Buffer.from(s, 'utf8').toString('base64url')

interface Setup {
  /** The members the agent's key list names for each room. */
  held?: Record<string, string[]>
  /** The rooms the community lists for this identity. */
  rooms?: string[]
  offers?: Record<string, unknown>[]
}

function setup(o: Setup = {}) {
  const held = o.held ?? { [ROOM]: [OLD, NEW] }
  const agentTask = jest.fn(async (type: string, payload: Record<string, unknown>): Promise<unknown> => {
    if (type === ROOMS_TASK.keysList02)
      return {
        rooms: Object.entries(held).flatMap(([roomId, members]) =>
          members.map((member) => ({ roomId, epoch: 1, earliestReadableEpoch: 1, member }))
        ),
      }
    if (type.includes('/rooms/keys/browse/')) return { roomId: payload.roomId, records: [], complete: true }
    if (type === ROOMS_TASK.keysRead)
      return {
        key: payload.key,
        version: 1,
        status: 'active',
        author: NEW,
        updatedAt: '2026-11-17T04:00:00Z',
        plaintext: b64url(
          JSON.stringify({ roomId: payload.roomId, key: payload.key, version: 1, author: NEW, body: 'hi' })
        ),
      }
    if (type === ROOMS_TASK.vaultReceive) return { id: 'stored', types: [], status: 'valid' }
    if (type === ROOMS_TASK.keysKeyPackage)
      return { keyPackage: 'kp', expiresAt: '2026-12-01T00:00:00Z', alreadyMinted: false }
    if (type === ROOMS_TASK.keysWelcome) return { epoch: 2 }
    if (type === ROOMS_TASK.keysBackfill) return { roomId: payload.roomId, earliestReadableEpoch: 1 }
    if (type === ROOMS_TASK.keysProfileRead) return { roomId: payload.roomId, status: 'absent' }
    if (type === ROOMS_TASK.keysAct06) {
      const document = payload.document as Record<string, unknown>
      return { principal: NEW, document: { ...document, proof: { type: 'DataIntegrityProof' } } }
    }
    throw new Error(`unexpected agent task ${type}`)
  })
  const answer = (type: string): unknown => {
    if (type === ROOMS_TASK.membershipsList)
      return {
        items: (o.rooms ?? [ROOM, OTHER]).map((roomId) => ({
          roomId,
          host: COMMUNITY.did,
          visibility: 'attributed',
          actions: ['read', 'write'],
          state: 'admitted',
        })),
      }
    if (type.includes('/vtc/rooms/offers/list/')) return { items: o.offers ?? [], renewals: [] }
    if (type === ROOMS_TASK.offersAccept) return { roomId: ROOM, state: 'admitted', epoch: 1, welcome: 'welcome-bytes' }
    throw new Error(`unexpected community task ${type}`)
  }
  const b = {
    agentLinked: () => true,
    agentServedTypes: async () => [
      ROOMS_TASK.keysList02,
      ROOMS_TASK.keysRead,
      ROOMS_TASK.keysBrowse04,
      ROOMS_TASK.keysKeyPackage,
      ROOMS_TASK.keysWelcome,
      ROOMS_TASK.keysBackfill,
      ROOMS_TASK.vaultReceive,
      ROOMS_TASK.keysAct06,
      ROOMS_TASK.keysProfileRead,
      ROOMS_TASK.keysSeal02,
    ],
    agentTask,
    communities: async () => [COMMUNITY],
    communityTask: jest.fn(async (_did: string, type: string) => answer(type)),
    sendCompleted: jest.fn(async (_did: string, _to: string, document: Record<string, unknown>) =>
      answer(String(document.type))
    ),
    newId: () => 'id-1',
    leaveCommunity: jest.fn(async () => undefined),
    decodeBase64Url: (s: string) => Buffer.from(s, 'base64url').toString('utf8'),
    encodeBase64Url: (s: string) => Buffer.from(s, 'utf8').toString('base64url'),
    hiddenOffers: async () => [],
    hideOffer: jest.fn(async () => undefined),
    warn: jest.fn(),
  } as unknown as RoomsBackend
  const service = new AgentRoomsService(b, undefined, { now: () => 1_000_000, sleep: async () => undefined })
  /** The payloads the agent was sent for `roomId` at a type containing `part`. */
  const sent = (part: string, roomId = ROOM) =>
    agentTask.mock.calls.filter(([t, p]) => t.includes(part) && p.roomId === roomId).map(([, p]) => p)
  const warned = () => (b.warn as jest.Mock).mock.calls.map((c) => String(c[0]))
  /** The options each task of a type containing `part` was asked with, for `roomId` (undefined: none given). */
  const askedWith = (part: string, roomId = ROOM) =>
    agentTask.mock.calls
      .filter(([t, p]) => t.includes(part) && p.roomId === roomId)
      .map((call) => (call as unknown[])[2] as Record<string, unknown> | undefined)
  return { service, sent, warned, askedWith }
}

const named = (member: string) => ({ ext: { 'org.openvtc.rooms': { member } } })

describe("a room held as two of this phone's identities", () => {
  it("names the room's own identity on its listing and reads", async () => {
    const s = setup()
    await s.service.listMyRooms()
    await s.service.listNotes(ROOM)
    await s.service.readNote(ROOM, 'note/1').catch(() => undefined)
    expect(s.sent('/rooms/keys/browse/')).toEqual([{ roomId: ROOM, host: COMMUNITY.did, ...named(NEW) }])
    expect(s.sent('/rooms/keys/read/')[0]).toMatchObject(named(NEW))
  })

  it('names it on the profile read (rooms/keys/profile/read), which 278.24 also had refused', async () => {
    const s = setup()
    await s.service.listMyRooms()
    await s.service.recordFeaturesIn(ROOM)
    expect(s.sent('/rooms/keys/profile/read/')).toEqual([{ roomId: ROOM, host: COMMUNITY.did, ...named(NEW) }])
  })

  it('says so once, by short ref, never naming an identity', async () => {
    const s = setup()
    await s.service.listMyRooms()
    await s.service.listNotes(ROOM)
    await s.service.listNotes(ROOM, { sinceVersion: 1 })
    const lines = s.warned().filter((w) => w.includes("of this phone's identities"))
    expect(lines).toEqual([`rooms: ${logRef(ROOM)} is held as 2 of this phone's identities: its tasks name the room's`])
    expect(lines[0]).not.toContain(OLD.slice(12))
    expect(lines[0]).not.toContain(NEW.slice(12))
  })

  it('control: a room held as one identity is asked exactly as before, beside it', async () => {
    const s = setup({ held: { [ROOM]: [OLD, NEW], [OTHER]: [NEW] } })
    await s.service.listMyRooms()
    await s.service.listNotes(OTHER)
    expect(s.sent('/rooms/keys/browse/', OTHER)).toEqual([{ roomId: OTHER, host: COMMUNITY.did }])
  })

  it("control: the room's identity not among those holding it names nobody", async () => {
    const s = setup({ held: { [ROOM]: [OLD, 'did:webvh:QmThird:dids.example:other'] } })
    await s.service.listMyRooms()
    await s.service.listNotes(ROOM)
    expect(s.sent('/rooms/keys/browse/')).toEqual([{ roomId: ROOM, host: COMMUNITY.did }])
  })
})

describe('accepting a room this phone holds as another identity', () => {
  const offer = {
    roomId: ROOM,
    host: COMMUNITY.did,
    label: 'File test room',
    visibility: 'attributed',
    actions: ['read', 'write'],
    validUntil: '2026-12-01T00:00:00Z',
    offeredAt: '2026-11-17T00:00:00Z',
    state: 'open',
    credentials: {
      invitation: '{"id":"urn:inv:1"}',
      membership: `{"id":"urn:vmc:1","credentialSubject":{"id":"${NEW}"}}`,
      authority: `{"id":"urn:vac:1","credentialSubject":{"id":"${NEW}"}}`,
    },
  }

  it('names the new identity on the backfill after the Welcome, and not on the join itself', async () => {
    const s = setup({ held: { [ROOM]: [OLD] }, rooms: [OTHER], offers: [offer] })
    await s.service.listMyRooms()
    const preview = await s.service.previewOffer(offerIdOf(COMMUNITY.did, ROOM))
    await s.service.acceptOffer(preview.token)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(s.sent('/rooms/keys/backfill/')).toEqual([{ roomId: ROOM, host: COMMUNITY.did, ...named(NEW) }])
    expect(s.sent('/rooms/keys/key-package/')[0]).not.toHaveProperty('ext')
    expect(s.sent('/rooms/keys/welcome/')[0]).not.toHaveProperty('ext')
  })

  it('control: held as two already, the join itself (key package, Welcome) still names nobody', async () => {
    const s = setup({ held: { [ROOM]: [OLD, NEW] }, offers: [offer] })
    await s.service.listMyRooms()
    const preview = await s.service.previewOffer(offerIdOf(COMMUNITY.did, ROOM))
    await s.service.acceptOffer(preview.token)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(s.sent('/rooms/keys/key-package/')).toHaveLength(1)
    expect(s.sent('/rooms/keys/key-package/')[0]).not.toHaveProperty('ext')
    expect(s.sent('/rooms/keys/welcome/')[0]).not.toHaveProperty('ext')
    expect(s.sent('/rooms/keys/backfill/')[0]).toMatchObject(named(NEW))
  })

  it('control: a room held as nobody before is backfilled exactly as before', async () => {
    const s = setup({ held: {}, rooms: [OTHER], offers: [offer] })
    await s.service.listMyRooms()
    const preview = await s.service.previewOffer(offerIdOf(COMMUNITY.did, ROOM))
    await s.service.acceptOffer(preview.token)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(s.sent('/rooms/keys/backfill/')).toEqual([{ roomId: ROOM, host: COMMUNITY.did }])
  })
})

// 11-17: a room's browse waited behind Messages' queued watches and key list (K2QJ-Z9G9). The open room's own reads say
// so, and may go ahead of the agent's queue (vtaReadLane VTA_ROOM_IN_VIEW_FIRST).
describe('the room open on a screen', () => {
  it('its listing and reads are asked as in view, while it is', async () => {
    const s = setup({ held: { [OTHER]: [NEW] } })
    await s.service.listMyRooms()
    s.service.roomInView(OTHER, true)
    await s.service.listNotes(OTHER)
    await s.service.readNote(OTHER, 'note/1').catch(() => undefined)
    expect(s.askedWith('/rooms/keys/browse/', OTHER)).toEqual([{ inView: true }])
    expect(s.askedWith('/rooms/keys/read/', OTHER)[0]).toMatchObject({ inView: true })
  })

  it('control: out of view, and another room, are asked exactly as before', async () => {
    const s = setup({ held: { [OTHER]: [NEW], [ROOM]: [NEW] } })
    await s.service.listMyRooms()
    s.service.roomInView(ROOM, true)
    await s.service.listNotes(OTHER)
    expect(s.askedWith('/rooms/keys/browse/', OTHER)).toEqual([undefined])
    s.service.roomInView(ROOM, false)
    await s.service.listNotes(ROOM)
    expect(s.askedWith('/rooms/keys/browse/', ROOM)).toEqual([undefined])
  })

  it('stays in view until every screen of it has gone', async () => {
    const s = setup({ held: { [OTHER]: [NEW] } })
    await s.service.listMyRooms()
    s.service.roomInView(OTHER, true)
    s.service.roomInView(OTHER, true)
    s.service.roomInView(OTHER, false)
    await s.service.listNotes(OTHER)
    s.service.roomInView(OTHER, false)
    await s.service.listNotes(OTHER, { sinceVersion: 1 })
    expect(s.askedWith('/rooms/keys/browse/', OTHER)).toEqual([{ inView: true }, undefined])
  })

  it('control: a task that is not a read of the room is never asked as in view', async () => {
    const s = setup()
    await s.service.listMyRooms()
    s.service.roomInView(ROOM, true)
    await s.service.recordFeaturesIn(ROOM)
    expect(s.askedWith('/rooms/keys/profile/read/')).toEqual([undefined])
  })
})
