/**
 * A sealed record binds the version it is sealed for, and the host gives it the room's next version, so a wrong
 * guess of the room's newest version stores the post under a seal for another version: it does not open until the
 * phone seals it again and puts it over what landed. Since a message skips the whole-room listing while the room is
 * watched (IN-776), a post that lands unseen is enough for that guess to be wrong. If the second seal or put then
 * fails, the post reads "Not sent", and a retry used to find its record there and either take it as sent or be
 * refused for good: the record stayed one nobody could open ("couldn't be read").
 */
import { AgentRoomsService, type RoomsBackend, type RoomsCommunity } from '../real/agentRoomsService'
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

const refusal = (code: string) =>
  Object.assign(new Error(code), { name: 'VtiRefusal', code, details: { code } }) as Error & { code: string }

interface Stored {
  version: number
  /** The version its seal names: it opens only there. */
  sealedFor: number
  plaintext: string
}

/**
 * A host that gives every stored record the room's next version, whatever it was sealed for, and keeps each record's
 * seal, so a read opens a record only at the version it was sealed for. `expectedVersion` is checked as the host does:
 * 0 is create-only.
 */
function setup() {
  const clock = { now: T0 }
  const host = { head: 4, records: new Map<string, Stored>() }
  /** Seals and puts to fail, by their number from the first (1-based), as an agent or a network that drops one. */
  const fail = { seals: new Set<number>(), puts: new Set<number>() }
  let seals = 0
  let puts = 0
  const agentTask = jest.fn(async (type: string, payload: Record<string, unknown>): Promise<unknown> => {
    switch (type) {
      case ROOMS_TASK.keysList02:
        return { rooms: [{ roomId: ROOM, epoch: 3, earliestReadableEpoch: 0, member: ME }] }
      case ROOMS_TASK.keysBrowse:
        return { records: [{ key: 'older', version: host.head, status: 'active' }], complete: true }
      case ROOMS_TASK.keysProfileRead:
        return { roomId: ROOM, status: 'found', profile: { name: 'Room', recordMembers: ['kind'] } }
      case ROOMS_TASK.keysRead: {
        const stored = host.records.get(String(payload.key))
        if (!stored) throw refusal('rooms/keys/read:notFound')
        // Sealed for another version: the associated data does not match, so it does not open.
        if (stored.sealedFor !== stored.version) throw new Error('the record did not decrypt at its version')
        return { key: payload.key, version: stored.version, status: 'active', plaintext: stored.plaintext }
      }
      case ROOMS_TASK.keysSeal02:
      case ROOMS_TASK.keysSeal03:
        seals += 1
        if (fail.seals.has(seals)) throw new Error('the agent did not answer')
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
  const sendCompleted = jest.fn(async (_did: string, _to: string, document: Record<string, unknown>) => {
    const p = document.payload as { key: string; expectedVersion?: number; sealed: { ciphertext: string } }
    puts += 1
    if (fail.puts.has(puts)) throw new Error('the host could not be reached')
    const current = host.records.get(p.key)
    if (
      p.expectedVersion !== undefined &&
      (p.expectedVersion === 0 ? !!current : current?.version !== p.expectedVersion)
    )
      throw refusal('rooms/records/put:versionConflict')
    const plaintext = p.sealed.ciphertext.slice('sealed:'.length)
    const sealedFor = (JSON.parse(unb64(plaintext)) as { version: number }).version
    host.head += 1
    host.records.set(p.key, { version: host.head, sealedFor, plaintext })
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
  const settle = async () => {
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0))
  }
  /** The room screen: the room listed, and watched from its newest version. */
  const openWatched = async () => {
    await service.listMyRooms()
    await service.listNotes(ROOM)
    await service.recordFeaturesIn(ROOM)
    service.watchRoom(ROOM, host.head)
    await settle()
    expect(service.roomWatched(ROOM)).toBe(true)
  }
  /** Another member's post, stored without the phone reading the room (a signal it missed). */
  const landsUnseen = (n = 1) => {
    for (let i = 0; i < n; i++) {
      host.head += 1
      host.records.set(`theirs-${host.head}`, { version: host.head, sealedFor: host.head, plaintext: '' })
    }
  }
  const send = (idempotencyKey: string, body = 'hello') =>
    service.sendRecord(ROOM, { type: 'message', body, idempotencyKey })
  /** The post's own record: whether it opens where the host stores it. */
  const opens = (idempotencyKey: string) => {
    const stored = host.records.get(service.postKeyFor(idempotencyKey))
    return stored ? stored.sealedFor === stored.version : undefined
  }
  return { service, host, fail, send, opens, openWatched, landsUnseen, sendCompleted }
}

describe('a post left under a seal for another version', () => {
  test.each([
    ['the second seal fails', (s: ReturnType<typeof setup>) => s.fail.seals.add(2)],
    ['the second put fails', (s: ReturnType<typeof setup>) => s.fail.puts.add(2)],
  ])('is sealed again by its retry and opens, when %s', async (_name, failSecond) => {
    const s = setup()
    await s.openWatched()
    // A post since the listing that the phone did not read: the room's newest version is not the one held.
    s.landsUnseen()
    failSecond(s)
    await expect(s.send('post-1')).rejects.toThrow()
    // The race left it stored under a seal for the version it guessed: nobody can open it.
    expect(s.opens('post-1')).toBe(false)

    const again = await s.send('post-1')
    expect(s.opens('post-1')).toBe(true)
    expect(again).toEqual({ key: s.service.postKeyFor('post-1'), version: s.host.records.get(again.key)?.version })
    // One record for the post, written over where it was, not a second one.
    expect([...s.host.records.keys()].filter((k) => !k.startsWith('theirs-'))).toEqual([again.key])
  })

  test('is sealed again by its retry after the room kept moving through every try', async () => {
    const s = setup()
    await s.openWatched()
    s.landsUnseen()
    // Each put lands under a stale seal while others keep posting: the write gives up with the post stored.
    const put = s.sendCompleted.getMockImplementation()!
    s.sendCompleted.mockImplementation(async (...args) => {
      const answer = await put(...args)
      s.landsUnseen()
      return answer
    })
    await expect(s.send('post-1')).rejects.toThrow(/roomKeptMoving|kept moving/)
    expect(s.opens('post-1')).toBe(false)

    s.sendCompleted.mockImplementation(put)
    await s.send('post-1')
    expect(s.opens('post-1')).toBe(true)
  })

  test('control: a post that landed whole and lost its answer is still taken as sent, with no second write', async () => {
    const s = setup()
    await s.openWatched()
    // Its put is stored at the version it was sealed for, and the answer never reaches the phone.
    const put = s.sendCompleted.getMockImplementation()!
    s.sendCompleted.mockImplementationOnce(async (...args) => {
      await put(...args)
      throw new Error('the answer was lost')
    })
    await expect(s.send('post-1')).rejects.toThrow()
    expect(s.opens('post-1')).toBe(true)
    const writes = s.sendCompleted.mock.calls.length

    const again = await s.send('post-1')
    expect(again.version).toBe(s.host.records.get(again.key)?.version)
    // The retry's one put is the create-only one the host refused: nothing was written over the post.
    expect(s.sendCompleted.mock.calls).toHaveLength(writes + 1)
    expect(s.opens('post-1')).toBe(true)
  })

  test('once sealed again, a later retry of it is taken as sent, not written a third time', async () => {
    const s = setup()
    await s.openWatched()
    s.landsUnseen()
    s.fail.seals.add(2)
    await expect(s.send('post-1')).rejects.toThrow()
    const repaired = await s.send('post-1')
    expect(s.opens('post-1')).toBe(true)
    const writes = s.sendCompleted.mock.calls.length

    const third = await s.send('post-1')
    expect(third.version).toBe(repaired.version)
    expect(s.sendCompleted.mock.calls).toHaveLength(writes + 1)
    expect(s.opens('post-1')).toBe(true)
  })
})
