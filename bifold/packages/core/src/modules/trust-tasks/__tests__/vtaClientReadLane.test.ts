/**
 * The read lane (vtaReadLane.ts): opening a room reads its first page one record per task, and the agent client sent
 * one task at a time, so ten posts took about 5 s (lab sim, 10-30). Reads of a room may now be on the wire three at a
 * time; every other task still runs alone, in the order asked. The lane opens only once the session's agent has
 * threaded a reply (over DIDComm or TSP alike), and an unthreaded reply closes it for the session. With a lane size of
 * 1 the client sends exactly what it sent before, in the same order.
 */
jest.mock('@bifold/trust-tasks', () => {
  const actual = jest.requireActual('@bifold/trust-tasks')
  return {
    ...actual,
    signDocumentProof: jest.fn(async (_agent: unknown, doc: Record<string, unknown>) => doc),
    tsp: {
      ...actual.tsp,
      CODEC_FORMS_RELATIONSHIPS: true,
      packInviteV1: jest.fn(async () => ({ bytes: new Uint8Array([0x49]) })),
    },
  }
})
const mockCarriage = { value: 'didcomm' as 'didcomm' | 'tsp' }
jest.mock('../module/tspCapability', () => ({ chooseCarriage: jest.fn(async () => mockCarriage.value) }))
jest.mock('../module/vtaReplyProof', () => ({ checkVtaReply: jest.fn(async () => ({ kind: 'unsigned' })) }))
jest.mock('../module/vtiTsp', () => ({
  ...jest.requireActual('../module/vtiTsp'),
  packTrustTaskForPeer: jest.fn(),
}))

import { TspReplyBreaker, VtaClient, VtaTaskDropped } from '../module/VtaClient'
import { VTA_READ_LANE_SIZE, inReadLane } from '../module/vtaReadLane'

const READ = 'https://trusttasks.org/spec/rooms/keys/read/0.1'
const BROWSE = 'https://trusttasks.org/spec/rooms/keys/browse/0.1'
const WHOAMI = 'https://trusttasks.org/spec/auth/whoami/0.1'
const WRITE = 'https://trusttasks.org/spec/rooms/records/put/0.1'

type Doc = { type: string; threadId: string; payload: Record<string, unknown> }

function harness(options: { readLaneSize?: number; breaker?: TspReplyBreaker } = {}) {
  const logger = { warn: jest.fn(), info: jest.fn(), debug: jest.fn() }
  const onInbound = jest.fn()
  const client = new VtaClient({ config: { logger } } as never, 'did:webvh:agent', {} as never, {
    onInbound,
    ...options,
  })
  const docs: Doc[] = []
  const sendTo = jest.fn(async (_to: string, message: { body: Doc }) => {
    docs.push(message.body)
  })
  const sendTspFrame = jest.fn(async () => undefined)
  const internals = client as unknown as {
    session: unknown
    identity: unknown
    tsp: unknown
    mediator: unknown
    deliver: (m: unknown) => void
  }
  internals.session = { sendTo, sendTspFrame, isOpen: true, stop: jest.fn(async () => undefined) }
  internals.identity = { did: 'did:peer:2.phone' }
  internals.tsp = { identity: {}, resolver: {} }
  internals.mediator = { did: 'did:web:mediator' }
  const { packTrustTaskForPeer } = jest.requireMock('../module/vtiTsp') as { packTrustTaskForPeer: jest.Mock }
  packTrustTaskForPeer.mockImplementation(async (_t: unknown, _f: string, _to: string, doc: Doc) => {
    docs.push(doc)
    return { bytes: new Uint8Array([0x54]), revision: 'v1' }
  })
  /** What was sent, in order: the type and, for a read, its key. */
  const sent = () =>
    docs.map((d) =>
      d.payload.key ? `${d.type.split('/spec/')[1]}:${String(d.payload.key)}` : d.type.split('/spec/')[1]
    )
  /** Answer what was sent `index`-th, threaded to it, with `payload`. */
  const answer = (index: number, payload: Record<string, unknown> = { ok: index }) => {
    const doc = docs[index]
    internals.deliver({
      id: `urn:uuid:reply-${index}-${Math.random()}`,
      type: 'https://trusttasks.org/binding/didcomm/v2',
      from: 'did:webvh:agent',
      thid: doc.threadId,
      created_time: Math.floor(Date.now() / 1000),
      body: { type: `${doc.type}#response`, threadId: doc.threadId, payload },
    })
  }
  /** A reply naming no thread at all. */
  const unthreaded = () =>
    internals.deliver({
      id: `urn:uuid:unthreaded-${Math.random()}`,
      type: 'https://trusttasks.org/binding/didcomm/v2',
      from: 'did:webvh:agent',
      created_time: Math.floor(Date.now() / 1000),
      body: { type: 'https://trusttasks.org/spec/whatever#response', payload: {} },
    })
  return { client, logger, onInbound, sent, answer, unthreaded, docs }
}

const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve()
}
const read = (client: VtaClient, key: string) => client.task(READ, { key }, 30_000)

/** Answer one task so the session knows its agent threads replies. */
async function threadedSession(h: ReturnType<typeof harness>) {
  const who = h.client.task(WHOAMI, {}, 30_000)
  await flush()
  h.answer(h.docs.length - 1)
  await who
  await flush()
}

beforeEach(() => {
  mockCarriage.value = 'didcomm'
})

describe('the read lane', () => {
  it('names only reads, by exact type, and holds 3 by default', () => {
    expect(VTA_READ_LANE_SIZE).toBe(3)
    expect(inReadLane(READ)).toBe(true)
    expect(inReadLane(BROWSE)).toBe(true)
    expect(inReadLane('https://trusttasks.org/spec/rooms/keys/browse/0.2')).toBe(true)
    expect(inReadLane(WRITE)).toBe(false)
    expect(inReadLane('https://trusttasks.org/spec/rooms/keys/read/0.2')).toBe(false)
  })

  it('stays shut until a reply comes back threaded: the first reads go one at a time', async () => {
    const h = harness()
    const reads = ['a', 'b', 'c'].map((k) => read(h.client, k))
    await flush()
    expect(h.sent()).toEqual(['rooms/keys/read/0.1:a'])
    h.answer(0)
    await flush()
    // Threaded: the rest go together.
    expect(h.sent()).toEqual(['rooms/keys/read/0.1:a', 'rooms/keys/read/0.1:b', 'rooms/keys/read/0.1:c'])
    h.answer(1)
    h.answer(2)
    await expect(Promise.all(reads)).resolves.toEqual([{ ok: 0 }, { ok: 1 }, { ok: 2 }])
  })

  it('once open, up to 3 reads are on the wire and the 4th waits for a place', async () => {
    const h = harness()
    await threadedSession(h)
    const reads = ['a', 'b', 'c', 'd'].map((k) => read(h.client, k))
    await flush()
    expect(h.sent().slice(1)).toEqual(['rooms/keys/read/0.1:a', 'rooms/keys/read/0.1:b', 'rooms/keys/read/0.1:c'])
    h.answer(2)
    await flush()
    expect(h.sent().slice(1)).toEqual([
      'rooms/keys/read/0.1:a',
      'rooms/keys/read/0.1:b',
      'rooms/keys/read/0.1:c',
      'rooms/keys/read/0.1:d',
    ])
    ;[1, 3, 4].forEach((i) => h.answer(i))
    await Promise.all(reads)
  })

  it('replies that come back out of order reach their own task', async () => {
    const h = harness()
    await threadedSession(h)
    const reads = ['a', 'b', 'c'].map((k) => read(h.client, k))
    await flush()
    h.answer(3, { key: 'c' })
    h.answer(1, { key: 'a' })
    h.answer(2, { key: 'b' })
    await expect(Promise.all(reads)).resolves.toEqual([{ key: 'a' }, { key: 'b' }, { key: 'c' }])
  })

  it('a write waits for the reads on the wire, runs alone, and the reads asked after it wait for it', async () => {
    const h = harness()
    await threadedSession(h)
    const r1 = read(h.client, 'a')
    const r2 = read(h.client, 'b')
    const write = h.client.task(WRITE, { key: 'w' }, 30_000)
    const r3 = read(h.client, 'c')
    await flush()
    expect(h.sent().slice(1)).toEqual(['rooms/keys/read/0.1:a', 'rooms/keys/read/0.1:b'])
    h.answer(1)
    await flush()
    expect(h.sent()).toHaveLength(3) // b still on the wire: the write waits
    h.answer(2)
    await flush()
    expect(h.sent().slice(3)).toEqual(['rooms/records/put/0.1:w'])
    h.answer(3)
    await flush()
    expect(h.sent().slice(4)).toEqual(['rooms/keys/read/0.1:c'])
    h.answer(4)
    await Promise.all([r1, r2, write, r3])
  })

  it('an unthreaded reply with two reads on the wire is taken by neither, and the session goes one at a time', async () => {
    const h = harness()
    await threadedSession(h)
    const r1 = read(h.client, 'a')
    const r2 = read(h.client, 'b')
    await flush()
    h.unthreaded()
    expect(h.onInbound).toHaveBeenCalledTimes(1)
    expect(h.logger.warn).toHaveBeenCalledWith(expect.stringContaining('taken by none'))
    h.answer(1, { key: 'a' })
    h.answer(2, { key: 'b' })
    await expect(Promise.all([r1, r2])).resolves.toEqual([{ key: 'a' }, { key: 'b' }])
    // The lane stays shut for the session, threaded replies or not.
    const more = ['c', 'd'].map((k) => read(h.client, k))
    await flush()
    expect(h.sent().slice(3)).toEqual(['rooms/keys/read/0.1:c'])
    h.answer(3)
    await flush()
    expect(h.sent().slice(3)).toEqual(['rooms/keys/read/0.1:c', 'rooms/keys/read/0.1:d'])
    h.answer(4)
    await Promise.all(more)
  })

  it('a disconnect shuts the lane until the next session threads a reply', async () => {
    const h = harness()
    await threadedSession(h)
    await h.client.disconnect()
    ;(h.client as unknown as { session: unknown }).session = {
      sendTo: async (_to: string, m: { body: Doc }) => h.docs.push(m.body),
      isOpen: true,
    }
    const reads = ['a', 'b'].map((k) => read(h.client, k))
    await flush()
    expect(h.sent().slice(1)).toEqual(['rooms/keys/read/0.1:a'])
    h.answer(1)
    await flush()
    h.answer(2)
    await Promise.all(reads)
  })

  it('dropping the queue stops every read on the wire and every one waiting', async () => {
    const h = harness()
    await threadedSession(h)
    const reads = ['a', 'b', 'c', 'd'].map((k) => read(h.client, k))
    await flush()
    h.client.dropQueued()
    for (const r of reads) await expect(r).rejects.toBeInstanceOf(VtaTaskDropped)
    expect(h.sent().slice(1)).toHaveLength(3) // the 4th was never sent
  })

  it('with a lane of 1, every task goes one at a time in the order asked, as before the lane', async () => {
    const order = async (readLaneSize?: number) => {
      const h = harness({ readLaneSize })
      await threadedSession(h)
      const asked = [
        read(h.client, 'a'),
        h.client.task(WRITE, { key: 'w' }, 30_000),
        read(h.client, 'b'),
        read(h.client, 'c'),
      ]
      const seen: string[][] = []
      for (let i = 1; i <= 4; i++) {
        await flush()
        seen.push(h.sent().slice(1))
        h.answer(i)
      }
      await Promise.all(asked)
      return seen
    }
    const one = await order(1)
    expect(one).toEqual([
      ['rooms/keys/read/0.1:a'],
      ['rooms/keys/read/0.1:a', 'rooms/records/put/0.1:w'],
      ['rooms/keys/read/0.1:a', 'rooms/records/put/0.1:w', 'rooms/keys/read/0.1:b'],
      ['rooms/keys/read/0.1:a', 'rooms/records/put/0.1:w', 'rooms/keys/read/0.1:b', 'rooms/keys/read/0.1:c'],
    ])
    // The control: the same asks with the lane on put b and c on the wire together.
    const three = await order(3)
    expect(three[2]).toEqual([
      'rooms/keys/read/0.1:a',
      'rooms/records/put/0.1:w',
      'rooms/keys/read/0.1:b',
      'rooms/keys/read/0.1:c',
    ])
  })
})

describe('the read lane over TSP', () => {
  beforeEach(() => {
    mockCarriage.value = 'tsp'
  })

  it('a TSP session whose agent threads its replies opens the lane', async () => {
    const h = harness()
    await threadedSession(h)
    const reads = ['a', 'b', 'c'].map((k) => read(h.client, k))
    await flush()
    expect(h.sent().slice(1)).toEqual(['rooms/keys/read/0.1:a', 'rooms/keys/read/0.1:b', 'rooms/keys/read/0.1:c'])
    ;[1, 2, 3].forEach((i) => h.answer(i))
    await Promise.all(reads)
  })

  it('a TSP session whose agent answers unthreaded stays one at a time', async () => {
    const h = harness()
    const who = h.client.task(WHOAMI, {}, 30_000)
    await flush()
    h.unthreaded() // the one task on the wire takes it, as before; the lane stays shut
    await who
    const reads = ['a', 'b'].map((k) => read(h.client, k))
    await flush()
    expect(h.sent().slice(1)).toEqual(['rooms/keys/read/0.1:a'])
    h.answer(1)
    await flush()
    h.answer(2)
    await Promise.all(reads)
  })

  it('reads that go unanswered together count once against the breaker; an ask after them counts again', async () => {
    jest.useFakeTimers()
    try {
      const breaker = new TspReplyBreaker()
      const h = harness({ breaker })
      await threadedSession(h)
      const together = ['a', 'b', 'c'].map((k) => h.client.task(READ, { key: k }, 1_000).catch((e: unknown) => e))
      await flush()
      expect(h.sent().slice(1)).toHaveLength(3)
      await jest.advanceTimersByTimeAsync(1_000)
      await Promise.all(together)
      expect(breaker.noAnswerInARow).toBe(1)
      expect(breaker.open).toBe(false) // three silences at once are one: the breaker (2 in a row) stays shut
      // The control: the next ask, sent after that silence and unanswered too, counts, and opens it.
      const next = h.client.task(WRITE, { key: 'd' }, 1_000).catch((e: unknown) => e)
      await flush()
      await jest.advanceTimersByTimeAsync(1_000)
      await next
      expect(breaker.noAnswerInARow).toBe(2)
      expect(breaker.open).toBe(true)
    } finally {
      jest.useRealTimers()
    }
  })
})
