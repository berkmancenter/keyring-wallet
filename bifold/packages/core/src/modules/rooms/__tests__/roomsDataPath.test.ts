/**
 * The rooms data path, with no screen: the real rooms service and the real reader, against an agent and a community
 * that answer only what upstream's own schemas allow (vendored in `fixtures/rooms-schemas`, trust-tasks-tf 3ef8d4907).
 * Every task the service sends must be a payload the spec accepts, and every answer the fakes give must be one the
 * spec allows the agent to give, so the fakes cannot quietly take or give a shape the agent never would (the
 * `acl-schemas` README tells how that once went wrong).
 *
 * What it proves:
 * 1. the member's rooms are listed across two communities, each room under its own community, and a community whose
 *    session another identity's step is keeping is named as held back rather than as unreachable;
 * 2. a room's records read into what the room shows: a message, a reply to it, two reactions to it, an edited
 *    message and a withdrawn one.
 *
 * Communities and rooms are values here, as in the app: nothing below is any particular community.
 */
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative } from 'path'

import Ajv from 'ajv/dist/2020'

import { expectNoDrift, registryPath } from '../../trust-tasks/__tests__/fixtures/registryDrift'
import { AgentRoomsService, type RoomsBackend, type RoomsCommunity } from '../real/agentRoomsService'
import { ROOMS_TASK } from '../real/wire'
import { placeOf, postOf, type RoomPost, withRepliesToReactions } from '../roomPosts'
import { foldRoomRecords } from '../roomThread'
import type { Identity, Note } from '../types'

// The service forgets opened records when the wallet locks, which touches the file copies.
jest.mock('react-native-fs', () => ({
  __esModule: true,
  default: { CachesDirectoryPath: '/caches', unlink: jest.fn(async () => undefined) },
}))

// ---- Upstream's schemas, with their own layout, so every relative $ref resolves as it does in the registry. ----

const SCHEMA_DIR = join(__dirname, 'fixtures', 'rooms-schemas')
const SPECS = join(SCHEMA_DIR, 'specs')
const BASE = 'https://registry.test/'

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : name.endsWith('.json') ? [path] : []
  })

const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/
const ajv = new Ajv({ strict: false, allErrors: true, logger: false })
// Checked rather than ignored: an answer with a time that isn't one is not an answer the agent gives.
ajv.addFormat('date-time', (s: string) => RFC3339.test(s) && !Number.isNaN(Date.parse(s)))
ajv.addFormat('date', /^\d{4}-\d{2}-\d{2}$/)
ajv.addFormat('uri', /^[a-zA-Z][a-zA-Z0-9+.-]*:\S+$/)
const VENDORED = walk(SPECS).map((file) => relative(SCHEMA_DIR, file))
for (const path of VENDORED) {
  const schema = JSON.parse(readFileSync(join(SCHEMA_DIR, path), 'utf8')) as Record<string, unknown>
  // Its $id is not where its siblings' relative refs reach it; its path in the registry is.
  delete schema.$id
  ajv.addSchema(schema, BASE + path)
}

const compiled = new Map<string, ReturnType<typeof ajv.compile>>()
/** Whether `data` is what the schema at `path` (from the registry root) and `pointer` allows; the errors if not. */
function schemaErrors(path: string, pointer: string, data: unknown): string | undefined {
  const ref = `${BASE}${path}${pointer ? `#${pointer}` : ''}`
  let validate = compiled.get(ref)
  if (!validate) compiled.set(ref, (validate = ajv.compile({ $ref: ref })))
  return validate(data) ? undefined : ajv.errorsText(validate.errors)
}
function mustMatch(what: string, path: string, pointer: string, data: unknown): void {
  const errors = schemaErrors(path, pointer, data)
  if (errors) throw new Error(`${what} is not what upstream allows (${path}${pointer}): ${errors}`)
}

/** Each task the fakes answer: where its payload and its answer are defined. */
const TASK_SCHEMA: Record<string, string> = {
  [ROOMS_TASK.keysList02]: 'specs/rooms/keys/list/0.2/payload.schema.json',
  [ROOMS_TASK.keysBrowse03]: 'specs/rooms/keys/browse/0.3/payload.schema.json',
  [ROOMS_TASK.keysRead]: 'specs/rooms/keys/read/0.1/payload.schema.json',
  [ROOMS_TASK.membershipsList]: 'specs/vtc/rooms/memberships/list/0.1/payload.schema.json',
}
const SEALED_BODY = ['specs/rooms/_shared/0.2/room.schema.json', '/$defs/SealedRecordBody'] as const

// ---- Two communities and their rooms, as values. ----

const A: RoomsCommunity = {
  did: 'did:webvh:QmCommunityA:a.example',
  name: 'Community A',
  personaDid: 'did:key:z6MkMeA',
}
const B: RoomsCommunity = {
  did: 'did:webvh:QmCommunityB:b.example',
  name: 'Community B',
  personaDid: 'did:key:z6MkMeB',
}
const SAM = 'did:key:z6MkSam'
const PAT = 'did:key:z6MkPat'
const AT = (minute: number) => new Date(Date.UTC(2026, 10, 8, 9, minute)).toISOString()

interface HostRecord {
  key: string
  version: number
  author: string
  updatedAt: string
  status?: 'active' | 'retracted'
  /** The sealed body's members other than the ones every body has (roomId, key, version, author, proof). */
  members: Record<string, unknown>
}

interface FakeRoom {
  roomId: string
  community: RoomsCommunity
  label: string
  records: HostRecord[]
}

const b64url = (s: string) => Buffer.from(s, 'utf8').toString('base64url')
const VERIFIED = { priorRoots: 'agree', trace: 'verified', count: 'agrees' }

/** The member's agent and the communities, answering only in upstream's shapes, and checking what they are sent. */
function world(rooms: FakeRoom[], options: { held?: string[] } = {}) {
  const sent: { type: string; payload: unknown }[] = []
  const room = (roomId: unknown) => {
    const r = rooms.find((x) => x.roomId === roomId)
    if (!r) throw new Error(`no such room ${String(roomId)}`)
    return r
  }
  const answer = (type: string, payload: Record<string, unknown>, body: unknown) => {
    mustMatch(`the answer to ${type}`, TASK_SCHEMA[type], '/$defs/Response', body)
    return body
  }
  const take = (type: string, payload: Record<string, unknown>) => {
    const schema = TASK_SCHEMA[type]
    if (!schema) throw new Error(`unexpected task ${type}`)
    mustMatch(`the payload of ${type}`, schema, '', payload)
    sent.push({ type, payload })
  }

  const agentTask = jest.fn(async (type: string, payload: Record<string, unknown>): Promise<unknown> => {
    take(type, payload)
    switch (type) {
      case ROOMS_TASK.keysList02:
        return answer(type, payload, {
          rooms: rooms.map((r) => ({
            roomId: r.roomId,
            member: r.community.personaDid,
            epoch: 2,
            earliestReadableEpoch: 1,
          })),
        })
      case ROOMS_TASK.keysBrowse03: {
        const r = room(payload.roomId)
        const since = typeof payload.sinceVersion === 'number' ? payload.sinceVersion : 0
        return answer(type, payload, {
          roomId: r.roomId,
          records: r.records
            .filter((x) => x.version > since)
            .map((x) => ({
              key: x.key,
              version: x.version,
              status: x.status ?? 'active',
              updatedAt: x.updatedAt,
              author: x.author,
            })),
          complete: true,
          verification: VERIFIED,
        })
      }
      case ROOMS_TASK.keysRead: {
        const r = room(payload.roomId)
        const x = r.records.find((y) => y.key === payload.key)
        if (!x) throw new Error(`no such record ${String(payload.key)}`)
        const sealed = {
          roomId: r.roomId,
          key: x.key,
          version: x.version,
          author: x.author,
          ...x.members,
          proof: { type: 'DataIntegrityProof', cryptosuite: 'eddsa-jcs-2022', proofValue: 'z-not-checked-here' },
        }
        mustMatch(`the sealed body of ${x.key}`, SEALED_BODY[0], SEALED_BODY[1], sealed)
        return answer(type, payload, {
          roomId: r.roomId,
          key: x.key,
          version: x.version,
          status: x.status ?? 'active',
          updatedAt: x.updatedAt,
          author: x.author,
          ...(x.status === 'retracted' ? {} : { plaintext: b64url(JSON.stringify(sealed)) }),
          verification: VERIFIED,
        })
      }
      default:
        throw new Error(`unexpected agent task ${type}`)
    }
  })

  const communityTask = jest.fn(async (communityDid: string, type: string, payload: Record<string, unknown>) => {
    take(type, payload)
    if (type !== ROOMS_TASK.membershipsList) throw new Error(`unexpected community task ${type}`)
    if (options.held?.includes(communityDid)) {
      // vtiAgent's refusal while a step keeps the session as another of this phone's identities.
      throw Object.assign(new Error('the session is kept for a step'), { name: 'VtiSessionHeld' })
    }
    return answer(type, payload, {
      items: rooms
        .filter((r) => r.community.did === communityDid)
        .map((r) => ({
          roomId: r.roomId,
          host: communityDid,
          label: r.label,
          visibility: 'attributed',
          actions: ['read', 'write'],
          validUntil: '2027-01-01T00:00:00Z',
          state: 'admitted',
          offeredAt: '2026-11-01T00:00:00Z',
          admittedAt: '2026-11-01T00:05:00Z',
        })),
    })
  })

  const backend: RoomsBackend = {
    agentLinked: () => true,
    agentServedTypes: async () => [ROOMS_TASK.keysList02, ROOMS_TASK.keysBrowse03, ROOMS_TASK.keysRead],
    agentTask,
    communities: async () => [A, B],
    communityTask,
    sendCompleted: jest.fn(async () => {
      throw new Error('nothing is written on this path')
    }),
    newId: () => 'id-1',
    leaveCommunity: jest.fn(async () => undefined),
    decodeBase64Url: (s) => Buffer.from(s, 'base64url').toString('utf8'),
    encodeBase64Url: (s) => Buffer.from(s, 'utf8').toString('base64url'),
    hiddenOffers: async () => [],
    hideOffer: jest.fn(async () => undefined),
    warn: jest.fn(),
    sessionKept: (e) => e instanceof Error && e.name === 'VtiSessionHeld',
    // Free only when the test says: nothing here waits on it.
    sessionFree: () => new Promise<void>(() => undefined),
  } as RoomsBackend
  return { backend, sent, agentTask, communityTask }
}

// ---- The records of one room, as #1027 writes them. ----

const ROOM_A = 'did:webvh:QmRoomA1:a.example'
const ROOM_B = 'did:webvh:QmRoomB1:b.example'

const message = (key: string, author: string, minute: number, body: string, more: Record<string, unknown> = {}) => ({
  key,
  version: 1,
  author,
  updatedAt: AT(minute),
  members: { kind: 'message', body, writtenAt: AT(minute), ...more },
})

const conversation = (): HostRecord[] => [
  message('m-hello', SAM, 1, 'Hello, everyone'),
  message('m-reply', A.personaDid, 2, 'Hello Sam', { inReplyTo: { key: 'm-hello', version: 1 } }),
  message('r-mine', A.personaDid, 3, '👍', { kind: 'reaction', inReplyTo: { key: 'm-hello' } }),
  message('r-pat', PAT, 4, '👍', { kind: 'reaction', inReplyTo: { key: 'm-hello' } }),
  // Edited: its second version, with the instant of the edit.
  { ...message('m-typo', PAT, 5, 'Meeting at noon', { editedAt: AT(6) }), version: 2, updatedAt: AT(6) },
  // Withdrawn: its author's new version has no words and no file.
  { ...message('m-gone', SAM, 7, '', { editedAt: AT(8) }), version: 2, updatedAt: AT(8) },
]

const twoCommunities = (): FakeRoom[] => [
  { roomId: ROOM_A, community: A, label: 'Planning', records: conversation() },
  { roomId: ROOM_B, community: B, label: 'Choir', records: [message('b-1', SAM, 1, 'Rehearsal moved')] },
]

/** What the room shows, read as the room screen reads it: list, read each, fold. */
async function readRoom(service: AgentRoomsService, roomId: string, actingAs: Identity) {
  const listing = await service.listNotes(roomId)
  const read: Note[] = []
  for (const summary of listing.notes) read.push(await service.readNote(roomId, summary.key))
  const posts = withRepliesToReactions(read.map((note) => postOf(note, actingAs)))
  return { posts, byKey: new Map<string, RoomPost>(posts.map((p) => [p.key, p])), thread: foldRoomRecords(posts) }
}

describe('the rooms data path, against upstream schemas', () => {
  test('the schemas are live: each refuses what upstream would not send (control for every check below)', () => {
    // Present first: a well-formed read answer passes, so a refusal below is the schema's, not a missing schema.
    const ok = { roomId: ROOM_A, key: 'k', version: 1, verification: VERIFIED }
    expect(schemaErrors(TASK_SCHEMA[ROOMS_TASK.keysRead], '/$defs/Response', ok)).toBeUndefined()
    // An agent must say what it checked.
    const { verification: _v, ...unverified } = ok
    expect(schemaErrors(TASK_SCHEMA[ROOMS_TASK.keysRead], '/$defs/Response', unverified)).toMatch(/verification/)
    // A sealed body takes only the members the spec names.
    const body = { roomId: ROOM_A, key: 'k', version: 1, author: SAM, proof: {} }
    expect(schemaErrors(...SEALED_BODY, body)).toBeUndefined()
    expect(schemaErrors(...SEALED_BODY, { ...body, reactsTo: 'k2' })).toMatch(/additional/)
    // A time that isn't one is refused, not ignored.
    expect(schemaErrors(...SEALED_BODY, { ...body, writtenAt: '2026-11-08 09:00' })).toBeDefined()
    // A membership the community lists says when it was offered.
    const membership = {
      roomId: ROOM_A,
      host: A.did,
      label: 'Planning',
      visibility: 'attributed',
      actions: ['read'],
      validUntil: '2027-01-01T00:00:00Z',
      state: 'admitted',
    }
    const memberships = TASK_SCHEMA[ROOMS_TASK.membershipsList]
    expect(schemaErrors(memberships, '/$defs/Response', { items: [membership] })).toMatch(/offeredAt/)
  })

  test('lists the member’s rooms across two communities, each under its own', async () => {
    const { backend, sent } = world(twoCommunities())
    const service = new AgentRoomsService(backend)
    const rooms = await service.listMyRooms()

    const shown = rooms.filter((r) => r.source === 'community')
    expect(shown.map((r) => [r.roomId, r.communityDid, String(r.communityName), String(r.name)]).sort()).toEqual([
      [ROOM_A, A.did, 'Community A', 'Planning'],
      [ROOM_B, B.did, 'Community B', 'Choir'],
    ])
    expect(shown.every((r) => r.standing === 'member')).toBe(true)
    expect(service.heldBack()).toEqual([])
    // Asked of both communities and of the agent, each in a shape the spec accepts (mustMatch threw otherwise).
    expect(sent.filter((s) => s.type === ROOMS_TASK.membershipsList)).toHaveLength(2)
    expect(sent.some((s) => s.type === ROOMS_TASK.keysList02)).toBe(true)
  })

  test('a community whose session a step is keeping is held back, not unreachable; the other still lists', async () => {
    const { backend } = world(twoCommunities(), { held: [B.did] })
    const service = new AgentRoomsService(backend)
    const rooms = await service.listMyRooms()

    expect(rooms.filter((r) => r.source === 'community').map((r) => r.roomId)).toEqual([ROOM_A])
    expect(service.heldBack().map((c) => c.communityDid)).toEqual([B.did])
    // Its room is still known from the agent's keys, so nothing it holds is lost meanwhile.
    expect(rooms.find((r) => r.roomId === ROOM_B)?.source).toBe('custody')
  })

  test('control: the same refusal where the session cannot be kept is not held back', async () => {
    const { backend } = world(twoCommunities(), { held: [B.did] })
    const service = new AgentRoomsService({ ...backend, sessionKept: () => false })
    await service.listMyRooms()
    expect(service.heldBack()).toEqual([])
  })

  test('reads a room’s records into what the room shows: message, reply, reactions, an edit, a withdrawal', async () => {
    const { backend, sent } = world(twoCommunities())
    const service = new AgentRoomsService(backend)
    await service.listMyRooms()
    const me: Identity = (await service.getRoom(ROOM_A)).actingAs
    expect(me.did).toBe(A.personaDid)

    const { byKey, thread } = await readRoom(service, ROOM_A, me)
    const where = (key: string) => placeOf(byKey.get(key)!)

    // The message and the reply to it are in the chat, the reply naming what it answers.
    expect(where('m-hello')).toBe('chat')
    expect(String(byKey.get('m-hello')!.text)).toBe('Hello, everyone')
    expect(where('m-reply')).toBe('chat')
    expect(byKey.get('m-reply')!.inReplyTo).toEqual({ key: 'm-hello', version: 1 })
    expect(byKey.get('m-reply')!.mine).toBe(true)

    // The reactions show nowhere themselves: they are counted on what they respond to, mine among them.
    expect(where('r-mine')).toBe('nowhere')
    expect(where('r-pat')).toBe('nowhere')
    expect(thread.reactions.get('m-hello')).toEqual([
      expect.objectContaining({ value: '👍', count: 2, mine: true, others: [{ did: PAT }] }),
    ])

    // The edit shows its current words and says it was edited; the withdrawn message shows nowhere.
    expect(where('m-typo')).toBe('chat')
    expect(String(byKey.get('m-typo')!.text)).toBe('Meeting at noon')
    expect(byKey.get('m-typo')!.editedAt).toBe(AT(6))
    expect(where('m-gone')).toBe('nowhere')
    expect(thread.refused.size).toBe(0)

    // Every record was asked for once, each payload in the spec's shape.
    const reads = sent.filter((s) => s.type === ROOMS_TASK.keysRead).map((s) => (s.payload as { key: string }).key)
    expect(reads.sort()).toEqual(['m-gone', 'm-hello', 'm-reply', 'm-typo', 'r-mine', 'r-pat'])
    expect(sent.some((s) => s.type === ROOMS_TASK.keysBrowse03)).toBe(true)
  })

  const maybe = registryPath() ? test : test.skip
  maybe('the vendored schemas are byte-identical to the registry at their provenance commit', () => {
    expectNoDrift(SCHEMA_DIR, Object.fromEntries(VENDORED.map((path) => [path, path])))
  })
})
