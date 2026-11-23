/**
 * The text post count, through the real service and the real parser: a read answers as it did, nothing reaches what
 * the screen is given, and no copy of the signed body stays on the kept record.
 */
import { AgentRoomsService, type RoomsBackend, type RoomsCommunity } from '../real/agentRoomsService'
import type { ResolveSender } from '../real/files/sender'
import { parseRead, ROOMS_TASK } from '../real/wire'

import { resolverOf, signBody, testAuthor } from './fixtures/signedBody'

// The real count, with its waits shortened: a post's check normally starts ten seconds later.
jest.mock('../real/files/textSenderCount', () => {
  const actual = jest.requireActual('../real/files/textSenderCount')
  return {
    ...actual,
    TextSenderCount: class extends actual.TextSenderCount {
      constructor(resolve: unknown, log: unknown) {
        super(resolve, log, { startDelayMs: 20, gapMs: 5, whenIdle: async () => undefined })
      }
    },
  }
})

const ROOM = 'did:webvh:room.example'
const HOST = 'did:webvh:community.example'
const COMMUNITY: RoomsCommunity = { did: HOST, name: 'A community', personaDid: 'did:key:persona' }
const ALICE = testAuthor('did:webvh:alice.example', 7)
const b64url = (s: string) => Buffer.from(s, 'utf8').toString('base64url')
const decode = (s: string) => Buffer.from(s, 'base64url').toString('utf8')

const sealedText = (over: Record<string, unknown> = {}) =>
  signBody(ALICE, { roomId: ROOM, key: 'p1', version: 2, author: ALICE.did, body: 'hello', ...over })

describe('parseRead, for the count', () => {
  const read = (over: Record<string, unknown>) =>
    parseRead({ key: 'p1', version: 2, status: 'active', ...over }, decode)

  it('a sealed text record carries its signed body for the count', () => {
    const body = sealedText()
    expect(read({ plaintext: b64url(JSON.stringify(body)) })?.signedText).toEqual(body)
  })

  it('a sealed record that is no JSON object is null: counted, as not a body', () => {
    expect(read({ plaintext: b64url('just words') })?.signedText).toBeNull()
    expect(read({ plaintext: b64url('[1,2]') })?.signedText).toBeNull()
  })

  it('an open room’s record, a tombstone and a file record are not for the count', () => {
    expect(read({ cleartext: { body: 'open' } })).not.toHaveProperty('signedText')
    expect(read({ status: 'retracted', plaintext: b64url(JSON.stringify(sealedText())) })).not.toHaveProperty(
      'signedText'
    )
    const file = { fileId: 'A'.repeat(43), name: 'a.pdf', size: 1, digest: 'd', epoch: 1, segmentSize: 1, blobRef: 'b' }
    expect(read({ plaintext: b64url(JSON.stringify(sealedText({ file }))) })).not.toHaveProperty('signedText')
  })
})

describe('reading a post, with the count on', () => {
  const FILE = {
    fileId: 'A'.repeat(43),
    name: 'a.pdf',
    size: 1,
    digest: 'uEiD',
    epoch: 3,
    segmentSize: 65520,
    blobRef: 'uEiB',
  }

  function backend(records: Record<string, unknown>[], resolveSender?: ResolveSender) {
    const agentTask = jest.fn(async (type: string, payload: Record<string, unknown>) => {
      if (type === ROOMS_TASK.keysList02)
        return { memberships: [{ roomId: ROOM, host: HOST }], rooms: [{ roomId: ROOM, host: HOST }] }
      if (type === ROOMS_TASK.keysRead) {
        const record = records.find((r) => r.key === payload.key)
        if (!record) throw new Error(`no record ${String(payload.key)}`)
        return {
          status: 'active',
          verification: { priorRoots: 'noneHeld' },
          updatedAt: '2026-11-04T10:00:00Z',
          author: ALICE.did,
          ...record,
        }
      }
      throw new Error(`unexpected agent task ${type}`)
    })
    return {
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
      decodeBase64Url: decode,
      encodeBase64Url: b64url,
      hiddenOffers: async () => [],
      hideOffer: jest.fn(async () => undefined),
      warn: jest.fn(),
      resolveSender,
    } as unknown as RoomsBackend
  }
  const POST = { key: 'p1', version: 2, plaintext: b64url(JSON.stringify(sealedText())) }
  const known = () => resolverOf(ALICE).resolve
  const countLines = (b: RoomsBackend) =>
    (b.warn as jest.Mock).mock.calls.map(([line]) => String(line)).filter((l) => l.includes('text post signatures'))
  const waitForLine = async (b: RoomsBackend) => {
    for (let i = 0; i < 300 && countLines(b).length === 0; i++) await new Promise((r) => setTimeout(r, 10))
  }

  it('control: the check runs and logs its count, with the real pause', async () => {
    const b = backend([POST], known())
    await new AgentRoomsService(b).readNote(ROOM, 'p1')
    await waitForLine(b)
    expect(countLines(b)).toHaveLength(1)
    expect(countLines(b)[0]).toContain('checked 1 (confirmed 1, unconfirmed 0, refused 0)')
    expect(countLines(b)[0]).not.toContain(ROOM)
    expect(countLines(b)[0]).not.toContain(ALICE.did)
  })

  it('a read does not wait for the author’s document, which may never come', async () => {
    const never = jest.fn(() => new Promise<never>(() => undefined))
    const note = await new AgentRoomsService(backend([POST], never)).readNote(ROOM, 'p1')
    expect(note.body).toBe('hello')
    expect(never).not.toHaveBeenCalled() // the check has not even started when the read answers
  })

  it('what the screen gets is the same with the count on or off, for a post that fails the check too', async () => {
    const forged = { ...POST, plaintext: b64url(JSON.stringify({ ...sealedText(), body: 'changed' })) }
    for (const record of [POST, forged]) {
      const on = backend([record], known())
      const off = backend([record])
      const withCount = await new AgentRoomsService(on).readNote(ROOM, 'p1')
      expect(withCount).toEqual(await new AgentRoomsService(off).readNote(ROOM, 'p1'))
      await waitForLine(on)
      expect(withCount).toEqual(await new AgentRoomsService(on).readNote(ROOM, 'p1'))
    }
  })

  it('checks against the author the host recorded, and the version the agent says it was sealed at', async () => {
    const forHost = backend([{ ...POST, author: 'did:key:someone-else' }], known())
    await new AgentRoomsService(forHost).readNote(ROOM, 'p1')
    await waitForLine(forHost)
    expect(countLines(forHost)[0]).toContain('kinds: author-differs 1')

    const curated = {
      key: 'p1',
      version: 7,
      ext: { 'org.openvtc.rooms': { sealedAt: 2 } },
      plaintext: POST.plaintext,
    }
    const forSealed = backend([curated], known())
    await new AgentRoomsService(forSealed).readNote(ROOM, 'p1')
    await waitForLine(forSealed)
    expect(countLines(forSealed)[0]).toContain('kinds: holds 1')

    const past = backend([{ ...curated, version: 1 }], known())
    await new AgentRoomsService(past).readNote(ROOM, 'p1')
    await waitForLine(past)
    expect(countLines(past)[0]).toContain('kinds: past-version 1')
  })

  it('a build that fetches no documents counts nothing', async () => {
    const b = backend([POST])
    await new AgentRoomsService(b).readNote(ROOM, 'p1')
    await new Promise((r) => setTimeout(r, 300))
    expect(countLines(b)).toEqual([])
  })

  it('the kept record holds no signed copy, and a read of it is not counted twice', async () => {
    const b = backend([POST], known())
    const service = new AgentRoomsService(b)
    await service.readNote(ROOM, 'p1')
    await service.readNote(ROOM, 'p1')
    const kept = [...(service as unknown as { opened: Map<string, object> }).opened.values()]
    expect(kept.length).toBeGreaterThan(0)
    for (const record of kept) expect(record).not.toHaveProperty('signedText')
    await waitForLine(b)
    expect(countLines(b)[0]).toContain('checked 1 ')
  })

  it('a lock says what was counted', async () => {
    const b = backend(
      [POST, { key: 'p2', version: 2, plaintext: b64url(JSON.stringify(sealedText({ key: 'p2' }))) }],
      known()
    )
    const service = new AgentRoomsService(b)
    await service.readNote(ROOM, 'p1')
    await waitForLine(b)
    await service.readNote(ROOM, 'p2')
    await new Promise((r) => setTimeout(r, 400))
    expect(countLines(b)).toHaveLength(1) // inside the minute: no second line yet
    service.dropOpenedRecords()
    expect(countLines(b)).toHaveLength(2)
    expect(countLines(b)[1]).toContain('checked 2 ')
  })

  it('a file record is still checked before its read answers, and is not in the count', async () => {
    const record = {
      key: 'f1',
      version: 4,
      plaintext: b64url(JSON.stringify(sealedText({ key: 'f1', version: 4, body: undefined, file: FILE }))),
    }
    const resolve = known()
    const b = backend([record], resolve)
    const note = await new AgentRoomsService(b).readNote(ROOM, 'f1')
    expect(resolve).toHaveBeenCalledTimes(1) // already, when the read answers
    expect(note.files?.[0].sender).toBe('confirmed')
    await new Promise((r) => setTimeout(r, 300))
    expect(countLines(b)).toEqual([])
  })
})
