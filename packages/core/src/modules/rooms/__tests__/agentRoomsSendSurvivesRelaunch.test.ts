/**
 * A post's words are kept in the wallet for the length of its write (messageCache `sendJournalOf`), so a post an app
 * stopped between its two puts, stored under another version's seal, is sealed again at the room's next listing after a
 * relaunch (#1039's part B; Alberto, 11-26). Kept as the room's copies are and under their rules, and let go by each of:
 * the write ending, the next listing after a relaunch whether or not the repair goes through, the room left or gone,
 * and the copies' days.
 */
import { AgentRoomsService, type RoomsBackend, type RoomsCommunity } from '../real/agentRoomsService'
import { ROOMS_TASK } from '../real/wire'
import {
  emptyGoneRooms,
  emptyMessageCache,
  MSG_CACHE_DAYS,
  resetMessageCache,
  sendJournalOf,
  setMessageCacheBiometryGate,
  sweepMessageCache,
} from '../messageCache'
import { cacheWallet } from './fixtures/cacheWallet'

const COMMUNITY: RoomsCommunity = { did: 'did:webvh:community:a', name: 'Garden club', personaDid: 'did:key:persona-a' }
const HOST = COMMUNITY.did
const ROOM = 'did:webvh:room:attributed1'
const ME = COMMUNITY.personaDid
const T0 = 1_800_000_000_000
const DAY = 24 * 3600 * 1000

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

/** The room's host, shared by every run of the app: what it stores outlives the phone's memory. */
function roomHost() {
  return { head: 4, records: new Map<string, Stored>() }
}

/**
 * One run of the app over `host` and `wallet`: a fresh service, nothing in memory from an earlier run. `seals` decides
 * each seal by its number in this run: 'hang' never answers (the app stopped there), 'fail' refuses.
 */
function run(
  host: ReturnType<typeof roomHost>,
  wallet: ReturnType<typeof cacheWallet>,
  seals: Record<number, 'hang' | 'fail'> = {},
  { journal = true, stoppedEarly = false }: { journal?: boolean; stoppedEarly?: boolean } = {}
) {
  const clock = { now: T0 }
  let sealed = 0
  const agentTask = jest.fn(async (type: string, payload: Record<string, unknown>): Promise<unknown> => {
    switch (type) {
      case ROOMS_TASK.keysList02:
        return { rooms: [{ roomId: ROOM, epoch: 3, earliestReadableEpoch: 0, member: ME }] }
      case ROOMS_TASK.keysBrowse:
        // A host that stopped early: a page with nothing of the room's newer records, and not the end.
        if (stoppedEarly) return { records: [{ key: 'older', version: 1, status: 'active' }], complete: false }
        return {
          records: [
            { key: 'older', version: 1, status: 'active' },
            ...[...host.records].map(([key, r]) => ({ key, version: r.version, status: 'active' })),
          ],
          complete: true,
        }
      case ROOMS_TASK.keysProfileRead:
        return { roomId: ROOM, status: 'found', profile: { name: 'Room', recordMembers: ['kind', 'inReplyTo'] } }
      case ROOMS_TASK.keysRead: {
        const stored = host.records.get(String(payload.key))
        if (!stored) throw refusal('rooms/keys/read:notFound')
        if (stored.sealedFor !== stored.version) throw new Error('the record did not decrypt at its version')
        return { key: payload.key, version: stored.version, status: 'active', plaintext: stored.plaintext }
      }
      case ROOMS_TASK.keysSeal02:
      case ROOMS_TASK.keysSeal03: {
        sealed += 1
        if (seals[sealed] === 'hang') return new Promise(() => undefined)
        if (seals[sealed] === 'fail') throw new Error('the agent did not answer')
        return { sealed: { ciphertext: `sealed:${String(payload.plaintext)}`, nonce: 'nonce', epoch: 3 } }
      }
      case ROOMS_TASK.keysWatch01: {
        const rooms = payload.rooms as { roomId: string }[]
        return {
          member: payload.member,
          host: payload.host,
          watches: rooms.map(({ roomId }) => ({
            roomId,
            armed: true,
            expiresAt: new Date(clock.now + 7 * DAY).toISOString(),
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
    const p = document.payload as { key: string; expectedVersion?: number; sealed: { ciphertext: string } }
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
  const warn = jest.fn()
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
    warn,
    recordSending: true,
    liveDelivery: true,
    ...(journal ? { sendsInFlight: sendJournalOf(wallet) } : {}),
  } as unknown as RoomsBackend
  const service = new AgentRoomsService(b, undefined, { now: () => clock.now })
  const settle = async () => {
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0))
  }
  /** The room screen: listed, and watched from its newest version, so a post guesses the room's head. */
  const openWatched = async () => {
    await service.listMyRooms()
    await service.listNotes(ROOM)
    await service.recordFeaturesIn(ROOM)
    service.watchRoom(ROOM, host.head)
    await settle()
  }
  /** Another member's post the phone did not read: the head it holds is stale. */
  const landsUnseen = () => {
    host.head += 1
    host.records.set(`theirs-${host.head}`, { version: host.head, sealedFor: host.head, plaintext: '' })
  }
  const send = (idempotencyKey: string, body = 'hello') =>
    service.sendRecord(ROOM, { type: 'message', body, idempotencyKey })
  /** The room's next listing, and whatever it settles. */
  const list = async () => {
    await service.listMyRooms()
    await service.listNotes(ROOM)
    await settle()
  }
  return { service, warn, settle, openWatched, landsUnseen, send, list, sendCompleted }
}

const opens = (host: ReturnType<typeof roomHost>, service: AgentRoomsService, idempotencyKey: string) => {
  const stored = host.records.get(service.postKeyFor(idempotencyKey))
  return stored ? stored.sealedFor === stored.version : undefined
}
/** The posts the wallet keeps as being written, in every room. */
const keptSends = (wallet: ReturnType<typeof cacheWallet>) =>
  [...wallet.records.values()]
    .filter((r) => r.tags.type === 'rooms.msgcache.send')
    .flatMap((r) => (Array.isArray(r.content.sends) ? (r.content.sends as { key: string; body: string }[]) : []))

let biometry = true
beforeEach(() => {
  biometry = true
  setMessageCacheBiometryGate(async () => biometry)
  resetMessageCache()
})

describe('a post the app stopped writing under another version seal', () => {
  test('is sealed again at the room next listing after a relaunch, and let go', async () => {
    const host = roomHost()
    const wallet = cacheWallet()
    const first = run(host, wallet, { 2: 'hang' })
    await first.openWatched()
    first.landsUnseen()
    // The first put lands at the next version under the seal for the guessed one; the app stops at the second seal.
    void first.send('post-1', 'the words')
    await first.settle()
    expect(opens(host, first.service, 'post-1')).toBe(false)
    expect(keptSends(wallet).map((s) => s.body)).toEqual(['the words'])

    // A relaunch: nothing in memory, the wallet and the room as they were.
    const second = run(host, wallet)
    await second.list()
    expect(opens(host, second.service, 'post-1')).toBe(true)
    expect(keptSends(wallet)).toEqual([])
    expect(second.warn).toHaveBeenCalledWith(expect.stringContaining('was sealed again'))
    // Its words, and nothing else of it, went to no log.
    expect(second.warn.mock.calls.flat().join('\n')).not.toContain('the words')
  })

  test('control: with nothing kept for the length of the write, the relaunch cannot repair it', async () => {
    const host = roomHost()
    const wallet = cacheWallet()
    const first = run(host, wallet, { 2: 'hang' }, { journal: false })
    await first.openWatched()
    first.landsUnseen()
    void first.send('post-1')
    await first.settle()
    const second = run(host, wallet, {}, { journal: false })
    await second.list()
    expect(opens(host, second.service, 'post-1')).toBe(false)
  })
})

describe('a post kept as being written is let go', () => {
  test('when its write ends whole', async () => {
    const host = roomHost()
    const wallet = cacheWallet()
    const r = run(host, wallet)
    await r.openWatched()
    await r.send('post-1', 'the words')
    expect(opens(host, r.service, 'post-1')).toBe(true)
    expect(keptSends(wallet)).toEqual([])
    // Control: it was kept while it was written.
    expect(wallet.genericRecords.save).toHaveBeenCalledWith(
      expect.objectContaining({ tags: expect.objectContaining({ type: 'rooms.msgcache.send' }) })
    )
  })

  test('when its write fails with nothing landed', async () => {
    const host = roomHost()
    const wallet = cacheWallet()
    const r = run(host, wallet)
    await r.openWatched()
    // The host refuses the put: nothing was stored.
    r.sendCompleted.mockRejectedValueOnce(new Error('the host could not be reached'))
    await expect(r.send('post-1')).rejects.toThrow()
    expect(host.records.has(r.service.postKeyFor('post-1'))).toBe(false)
    expect(keptSends(wallet)).toEqual([])
  })

  test('control: a write that failed after landing under a wrong seal stays kept, for the next listing or a retry', async () => {
    const host = roomHost()
    const wallet = cacheWallet()
    const r = run(host, wallet, { 2: 'fail' })
    await r.openWatched()
    r.landsUnseen()
    await expect(r.send('post-1', 'the words')).rejects.toThrow()
    expect(opens(host, r.service, 'post-1')).toBe(false)
    expect(keptSends(wallet).map((s) => s.body)).toEqual(['the words'])
    // A retry in this run repairs it (#1039) and lets it go.
    await r.send('post-1', 'the words')
    expect(opens(host, r.service, 'post-1')).toBe(true)
    expect(keptSends(wallet)).toEqual([])
  })

  test('at the next listing after a relaunch when its put never landed', async () => {
    const host = roomHost()
    const wallet = cacheWallet()
    const first = run(host, wallet)
    await first.openWatched()
    // Kept before the put; the app stops before the host stores it.
    first.sendCompleted.mockImplementationOnce(() => new Promise(() => undefined))
    void first.send('post-1')
    await first.settle()
    expect(keptSends(wallet)).toHaveLength(1)
    const second = run(host, wallet)
    await second.list()
    expect(keptSends(wallet)).toEqual([])
    expect(host.records.has(second.service.postKeyFor('post-1'))).toBe(false)
    expect(second.sendCompleted).not.toHaveBeenCalled()
  })

  test('at the next listing after a relaunch even when the repair is refused', async () => {
    const host = roomHost()
    const wallet = cacheWallet()
    const first = run(host, wallet, { 2: 'hang' })
    await first.openWatched()
    first.landsUnseen()
    void first.send('post-1')
    await first.settle()
    const second = run(host, wallet, { 1: 'fail' })
    await second.list()
    expect(opens(host, second.service, 'post-1')).toBe(false)
    expect(keptSends(wallet)).toEqual([])
    expect(second.warn).toHaveBeenCalledWith(expect.stringContaining('was not sealed again'))
  })

  test.each([
    ['the room left', (w: ReturnType<typeof cacheWallet>) => emptyMessageCache(w, { room: ROOM }, 'left')],
    [
      'the room gone from a listing',
      (w: ReturnType<typeof cacheWallet>) => emptyGoneRooms(w, [{ roomId: ROOM, standing: 'removed' }]),
    ],
    [
      `kept past ${MSG_CACHE_DAYS} days`,
      (w: ReturnType<typeof cacheWallet>) =>
        sweepMessageCache(w, [{ communityDid: COMMUNITY.did, personaDid: ME }], T0 + (MSG_CACHE_DAYS + 1) * DAY),
    ],
  ])('when %s', async (_name, empty) => {
    const host = roomHost()
    const wallet = cacheWallet()
    const first = run(host, wallet, { 2: 'hang' })
    await first.openWatched()
    first.landsUnseen()
    void first.send('post-1', 'the words')
    await first.settle()
    expect(keptSends(wallet)).toHaveLength(1)
    await empty(wallet)
    expect(keptSends(wallet)).toEqual([])
    // Emptied, never removed (tier.mjs, "deletes stored records"): the record stays, naming nothing.
    expect(JSON.stringify([...wallet.records.values()].map((r) => r.content))).not.toContain('the words')
  })

  test('control: a sweep within the days, with the membership standing, keeps it', async () => {
    const host = roomHost()
    const wallet = cacheWallet()
    const first = run(host, wallet, { 2: 'hang' })
    await first.openWatched()
    first.landsUnseen()
    void first.send('post-1')
    await first.settle()
    await sweepMessageCache(wallet, [{ communityDid: COMMUNITY.did, personaDid: ME }], T0 + DAY)
    expect(keptSends(wallet)).toHaveLength(1)
  })
})

describe('a post left under a wrong seal by a failed write is kept no longer than', () => {
  test('a retry that fails too: let go, and the loss said', async () => {
    const host = roomHost()
    const wallet = cacheWallet()
    const r = run(host, wallet, { 2: 'fail', 3: 'fail' })
    await r.openWatched()
    r.landsUnseen()
    await expect(r.send('post-1')).rejects.toThrow()
    expect(keptSends(wallet)).toHaveLength(1)
    await expect(r.send('post-1')).rejects.toThrow()
    expect(keptSends(wallet)).toEqual([])
    expect(r.warn).toHaveBeenCalledWith(expect.stringContaining('let go: its retry failed'))
  })

  test("the same run's next listing of the room, which seals it again and lets it go", async () => {
    const host = roomHost()
    const wallet = cacheWallet()
    const r = run(host, wallet, { 2: 'fail' })
    await r.openWatched()
    r.landsUnseen()
    await expect(r.send('post-1')).rejects.toThrow()
    expect(keptSends(wallet)).toHaveLength(1)
    await r.list()
    expect(opens(host, r.service, 'post-1')).toBe(true)
    expect(keptSends(wallet)).toEqual([])
  })

  test('a next listing that cannot show it: let go unchecked, and said', async () => {
    const host = roomHost()
    const wallet = cacheWallet()
    const first = run(host, wallet, { 2: 'hang' })
    await first.openWatched()
    first.landsUnseen()
    void first.send('post-1')
    await first.settle()
    expect(keptSends(wallet)).toHaveLength(1)
    const second = run(host, wallet, {}, { stoppedEarly: true })
    await second.list()
    expect(keptSends(wallet)).toEqual([])
    expect(second.warn).toHaveBeenCalledWith(expect.stringContaining('let go unchecked'))
  })
})

describe('a phone without biometric unlock', () => {
  test('keeps no words of a post being written, so a relaunch has nothing to repair it with', async () => {
    biometry = false
    const host = roomHost()
    const wallet = cacheWallet()
    const first = run(host, wallet, { 2: 'hang' })
    await first.openWatched()
    first.landsUnseen()
    void first.send('post-1', 'the words')
    await first.settle()
    expect(wallet.genericRecords.save).not.toHaveBeenCalled()
    expect(JSON.stringify([...wallet.records.values()])).not.toContain('the words')
    const second = run(host, wallet)
    await second.list()
    expect(opens(host, second.service, 'post-1')).toBe(false)
  })
})

describe('a listing while the post is still being written', () => {
  test('does not settle it', async () => {
    const host = roomHost()
    const wallet = cacheWallet()
    const r = run(host, wallet, { 2: 'hang' })
    await r.openWatched()
    r.landsUnseen()
    void r.send('post-1')
    await r.settle()
    await r.list()
    expect(keptSends(wallet)).toHaveLength(1)
    expect(opens(host, r.service, 'post-1')).toBe(false)
  })
})
