/**
 * Opening a room asks the agent less (lab sim, 10-30: 7–8 s an open). The room's two listings at mount share one
 * browse, and a post read once is not read again while the room's listing still names that version: reopening a room
 * read its whole first page again, one task at a time. What was opened is a decrypted body, so it is forgotten when
 * the wallet locks and when the member leaves the community, and only so many are kept.
 */
import { DeviceEventEmitter } from 'react-native'

import { WALLET_LOCKED_EVENT } from '../../../utils/walletLocked'
import {
  AgentRoomsService,
  MAX_OPENED_RECORDS,
  type RoomsBackend,
  type RoomsCommunity,
} from '../real/agentRoomsService'
import { ROOMS_TASK } from '../real/wire'

const COMMUNITY: RoomsCommunity = { did: 'did:webvh:community:a', name: 'Garden club', personaDid: 'did:key:persona-a' }
const ROOM = 'did:webvh:room:0123456789abcdef'
const HOST = 'did:webvh:community:a'

const b64url = (s: string) => Buffer.from(s, 'utf8').toString('base64url')
/** A sealed record's signed body, as `rooms/keys/read` returns it in `plaintext`. */
const sealedBody = (key: string, version: number, body: string) =>
  b64url(
    JSON.stringify({ roomId: ROOM, key, version, author: 'did:key:alice', body, proof: { type: 'DataIntegrityProof' } })
  )

type HostRecord = { key: string; version: number; body: string }
const record = (key: string, version: number, body = `words of ${key}`): HostRecord => ({ key, version, body })

function backend(records: HostRecord[]) {
  let browseAnswer: (() => void) | undefined
  const agentTask = jest.fn(async (type: string, payload: Record<string, unknown>): Promise<unknown> => {
    switch (type) {
      case ROOMS_TASK.keysList02:
        return { rooms: [{ roomId: ROOM, epoch: 3, earliestReadableEpoch: 1, member: 'did:key:persona-a' }] }
      case ROOMS_TASK.keysBrowse:
        if (holdBrowse) await new Promise<void>((resolve) => (browseAnswer = resolve))
        return {
          records: records.map(({ key, version }) => ({
            key,
            version,
            status: 'active',
            author: 'did:key:alice',
            updatedAt: '2026-10-30T09:00:00Z',
          })),
          complete: true,
        }
      case ROOMS_TASK.keysRead: {
        const r = records.find((x) => x.key === payload.key)
        if (!r) throw new Error(`no such record ${String(payload.key)}`)
        return {
          key: r.key,
          version: r.version,
          status: 'active',
          author: 'did:key:alice',
          updatedAt: '2026-10-30T09:00:00Z',
          plaintext: sealedBody(r.key, r.version, r.body),
        }
      }
      default:
        throw new Error(`unexpected agent task ${type}`)
    }
  })
  let holdBrowse = false
  const b: RoomsBackend = {
    agentLinked: () => true,
    agentServedTypes: async () => [ROOMS_TASK.keysList02, ROOMS_TASK.keysBrowse, ROOMS_TASK.keysRead],
    agentTask,
    communities: async () => [COMMUNITY],
    communityTask: jest.fn(async () => ({
      items: [{ roomId: ROOM, host: HOST, visibility: 'attributed', actions: ['read'], state: 'admitted' }],
    })),
    sendCompleted: jest.fn(async () => ({})),
    newId: () => 'id-1',
    leaveCommunity: jest.fn(async () => undefined),
    decodeBase64Url: (s) => Buffer.from(s, 'base64url').toString('utf8'),
    encodeBase64Url: (s) => Buffer.from(s, 'utf8').toString('base64url'),
    hiddenOffers: async () => [],
    hideOffer: jest.fn(async () => undefined),
    warn: jest.fn(),
  } as RoomsBackend
  const calls = (task: string) => agentTask.mock.calls.filter(([type]) => type === task)
  const reads = () => calls(ROOMS_TASK.keysRead).map(([, p]) => p.key)
  const browses = () => calls(ROOMS_TASK.keysBrowse).length
  const holdBrowses = () => {
    holdBrowse = true
    return () => {
      holdBrowse = false
      browseAnswer?.()
    }
  }
  return { b, reads, browses, holdBrowses }
}

describe('opening a room asks the agent less', () => {
  it('two listings of the room asked at once share one browse, and each caller gets its own list', async () => {
    const { b, browses, holdBrowses } = backend([record('p1', 1), record('p2', 1)])
    const service = new AgentRoomsService(b)
    await service.listMyRooms()
    const release = holdBrowses()
    const posts = service.listNotes(ROOM)
    const notesTab = service.listNotes(ROOM)
    await new Promise((resolve) => setImmediate(resolve))
    release()
    const [a, c] = await Promise.all([posts, notesTab])
    expect(browses()).toBe(1)
    expect(a.notes.map((n) => n.key)).toEqual(['p1', 'p2'])
    expect(a.notes).not.toBe(c.notes)
    // Once it has answered, the next listing (a refresh, a reopen) asks again.
    await service.listNotes(ROOM)
    expect(browses()).toBe(2)
  })

  it('a post read once is not read again while the listing still names its version', async () => {
    const { b, reads } = backend([record('p1', 1)])
    const service = new AgentRoomsService(b)
    await service.listNotes(ROOM)
    const first = await service.readNote(ROOM, 'p1')
    // The reopen: the room is listed again and its page read again.
    await service.listNotes(ROOM)
    const again = await service.readNote(ROOM, 'p1')
    expect(reads()).toEqual(['p1'])
    expect(String(again.body)).toBe('words of p1')
    expect(again).toEqual(first)
  })

  it('without a listing that names the version, a read always asks the agent', async () => {
    const { b, reads } = backend([record('p1', 1)])
    const service = new AgentRoomsService(b)
    await service.readNote(ROOM, 'p1')
    await service.readNote(ROOM, 'p1')
    expect(reads()).toEqual(['p1', 'p1'])
  })

  it('a post at a new version (an edit, a retract) is read afresh, never served its old body', async () => {
    const records = [record('p1', 1, 'first words')]
    const { b, reads } = backend(records)
    const service = new AgentRoomsService(b)
    await service.listNotes(ROOM)
    await service.readNote(ROOM, 'p1')
    records[0] = record('p1', 2, 'edited words')
    await service.listNotes(ROOM)
    const edited = await service.readNote(ROOM, 'p1')
    expect(reads()).toEqual(['p1', 'p1'])
    expect(String(edited.body)).toBe('edited words')
  })

  it('a listing that answers late never takes a post back to an older version', async () => {
    const records = [record('p1', 2, 'edited words')]
    const { b, reads } = backend(records)
    const service = new AgentRoomsService(b)
    await service.listNotes(ROOM)
    await service.readNote(ROOM, 'p1')
    records[0] = record('p1', 1, 'first words') // what an earlier, slower listing would have said
    await service.listNotes(ROOM)
    const held = await service.readNote(ROOM, 'p1')
    expect(reads()).toEqual(['p1'])
    expect(String(held.body)).toBe('edited words')
  })

  it('a read that finds a newer version than the listing named reuses that newer copy next time', async () => {
    const records = [record('p1', 1, 'first words')]
    const { b, reads } = backend(records)
    const service = new AgentRoomsService(b)
    await service.listNotes(ROOM)
    records[0] = record('p1', 2, 'edited words') // edited after the listing, before the read
    await service.readNote(ROOM, 'p1')
    const again = await service.readNote(ROOM, 'p1')
    expect(reads()).toEqual(['p1'])
    expect(String(again.body)).toBe('edited words')
  })

  it('what was opened is forgotten when the wallet locks', async () => {
    const { b, reads } = backend([record('p1', 1)])
    const service = new AgentRoomsService(b)
    await service.listNotes(ROOM)
    await service.readNote(ROOM, 'p1')
    DeviceEventEmitter.emit(WALLET_LOCKED_EVENT, 'timeout')
    await service.listNotes(ROOM)
    await service.readNote(ROOM, 'p1')
    expect(reads()).toEqual(['p1', 'p1'])
  })

  it('what was opened in a community’s rooms is forgotten when the member leaves it', async () => {
    const { b, reads } = backend([record('p1', 1)])
    const service = new AgentRoomsService(b)
    await service.listMyRooms()
    await service.listNotes(ROOM)
    await service.readNote(ROOM, 'p1')
    await service.leaveViaCommunity(COMMUNITY.did)
    await service.listMyRooms() // joined again: the community lists the room once more
    await service.listNotes(ROOM)
    await service.readNote(ROOM, 'p1')
    expect(reads()).toEqual(['p1', 'p1'])
  })

  it('a record the files tab reuses counts as used, and outlasts one nothing reused since', async () => {
    const records = [record('p0', 1), record('p1', 1)]
    const { b, reads } = backend(records)
    const service = new AgentRoomsService(b)
    await service.listNotes(ROOM)
    await service.readNote(ROOM, 'p0')
    await service.readNote(ROOM, 'p1') // p0 is now the least recently used
    records.splice(1, 1) // p1 leaves the host's listing, so the files tab reuses only p0
    await service.listFiles(ROOM) // the files tab reuses p0: now p1 is the least recently used
    // Fill the cache with other posts until exactly one of p0 and p1 has to go.
    for (let i = 2; i <= MAX_OPENED_RECORDS; i++) records.push(record(`p${i}`, 1))
    records.push(record('p1', 1))
    await service.listNotes(ROOM)
    for (let i = 2; i <= MAX_OPENED_RECORDS; i++) await service.readNote(ROOM, `p${i}`)
    const before = reads().length
    await service.readNote(ROOM, 'p0') // the files tab's reuse kept it
    expect(reads()).toHaveLength(before)
    await service.readNote(ROOM, 'p1') // nothing reused it since: dropped
    expect(reads().slice(before)).toEqual(['p1'])
  })

  it(`keeps at most ${MAX_OPENED_RECORDS} opened posts, dropping the one used least recently`, async () => {
    const records = Array.from({ length: MAX_OPENED_RECORDS + 1 }, (_, i) => record(`p${i}`, 1))
    const { b, reads } = backend(records)
    const service = new AgentRoomsService(b)
    await service.listNotes(ROOM)
    await service.readNote(ROOM, 'p0')
    await service.readNote(ROOM, 'p1')
    await service.readNote(ROOM, 'p0') // used again: now p1 is the least recently used
    for (let i = 2; i <= MAX_OPENED_RECORDS; i++) await service.readNote(ROOM, `p${i}`)
    const before = reads().length
    await service.readNote(ROOM, 'p0')
    await service.readNote(ROOM, `p${MAX_OPENED_RECORDS}`)
    expect(reads()).toHaveLength(before)
    await service.readNote(ROOM, 'p1')
    expect(reads().slice(before)).toEqual(['p1'])
  })
})

describe('a post read by two surfaces at once', () => {
  // Opening a room reads its newest posts for the chat and for its Notes tab at the same moment: ten of an open's
  // first twenty reads were the same records twice (276.10, 10-30).
  /** Reads answer only when `open` is called, in the order asked; `failNext` makes the next read fail instead. */
  function heldReads(records: HostRecord[]) {
    const h = backend(records)
    const agentTask = h.b.agentTask as jest.Mock
    const answer = agentTask.getMockImplementation()!
    const gates: (() => void)[] = []
    let fail = false
    agentTask.mockImplementation(async (type: string, payload: Record<string, unknown>) => {
      if (type !== ROOMS_TASK.keysRead) return answer(type, payload)
      await new Promise<void>((resolve) => gates.push(resolve))
      if (fail) {
        fail = false
        throw new Error('the VTA did not answer')
      }
      return answer(type, payload)
    })
    const tick = () => new Promise((resolve) => setImmediate(resolve))
    return { ...h, open: (n: number) => gates[n](), failNext: () => (fail = true), tick }
  }

  it('is asked of the agent once, and each caller gets the post', async () => {
    const { b, reads, open, tick } = heldReads([record('p1', 1)])
    const service = new AgentRoomsService(b)
    await service.listNotes(ROOM)
    const chat = service.readNote(ROOM, 'p1')
    const notesTab = service.readNote(ROOM, 'p1')
    await tick()
    open(0)
    const [a, c] = await Promise.all([chat, notesTab])
    expect(reads()).toEqual(['p1'])
    expect(String(a.body)).toBe('words of p1')
    expect(c).toEqual(a)
  })

  it('two different posts at once are two reads (control)', async () => {
    const { b, reads, open, tick } = heldReads([record('p1', 1), record('p2', 1)])
    const service = new AgentRoomsService(b)
    await service.listNotes(ROOM)
    const both = Promise.all([service.readNote(ROOM, 'p1'), service.readNote(ROOM, 'p2')])
    await tick()
    open(0)
    open(1)
    await both
    expect(reads()).toEqual(['p1', 'p2'])
  })

  it('a read that failed fails both callers, and the next read asks again', async () => {
    const { b, reads, open, failNext, tick } = heldReads([record('p1', 1)])
    const service = new AgentRoomsService(b)
    await service.listNotes(ROOM)
    failNext()
    const both = Promise.allSettled([service.readNote(ROOM, 'p1'), service.readNote(ROOM, 'p1')])
    await tick()
    open(0)
    expect((await both).map((r) => r.status)).toEqual(['rejected', 'rejected'])
    const again = service.readNote(ROOM, 'p1')
    await tick()
    open(1)
    expect(String((await again).body)).toBe('words of p1')
    expect(reads()).toEqual(['p1', 'p1'])
  })

  it('a read out when the wallet locks is not joined after the lock', async () => {
    const { b, reads, open, tick } = heldReads([record('p1', 1)])
    const service = new AgentRoomsService(b)
    await service.listNotes(ROOM)
    const before = service.readNote(ROOM, 'p1')
    await tick()
    DeviceEventEmitter.emit(WALLET_LOCKED_EVENT, 'timeout')
    await service.listNotes(ROOM)
    const after = service.readNote(ROOM, 'p1')
    await tick()
    expect(reads()).toEqual(['p1', 'p1'])
    open(0)
    open(1)
    await Promise.all([before, after])
  })

  it('a read out when the member leaves the community answers its caller, and is not kept', async () => {
    const { b, open, tick } = heldReads([record('p1', 1)])
    const service = new AgentRoomsService(b)
    await service.listMyRooms()
    await service.listNotes(ROOM)
    const before = service.readNote(ROOM, 'p1')
    await tick()
    await service.leaveViaCommunity(COMMUNITY.did)
    open(0)
    expect(String((await before).body)).toBe('words of p1')
    // Nothing of the room just left is kept.
    const opened = (service as unknown as { opened: Map<string, unknown> }).opened
    expect([...opened.keys()].filter((k) => k.startsWith(`${ROOM}\n`))).toEqual([])
  })

  it('a read that answers after the lock answers its caller, and is not kept', async () => {
    const { b, reads, open, tick } = heldReads([record('p1', 1)])
    const service = new AgentRoomsService(b)
    await service.listNotes(ROOM)
    const before = service.readNote(ROOM, 'p1')
    await tick()
    DeviceEventEmitter.emit(WALLET_LOCKED_EVENT, 'timeout')
    open(0)
    expect(String((await before).body)).toBe('words of p1')
    // After the unlock the room is listed and its post read again: nothing read before the lock was kept.
    await service.listNotes(ROOM)
    const again = service.readNote(ROOM, 'p1')
    await tick()
    open(1)
    await again
    expect(reads()).toEqual(['p1', 'p1'])
  })
})
