/**
 * A member's own write goes ahead of what is queued on the agent's channel (vtaReadLane, goesFirst): its seal, and the
 * agent completing its `rooms/records/put`. 278.12: a reply's seal waited behind a background browse or read in every
 * one of three sends on an iPhone 11 (0.1–0.8 s each). It never cuts short a task already on the wire, and the parts of
 * writes keep their own order. Every other task keeps its place, as before.
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

import { type TspReplyBreaker, VtaClient } from '../module/VtaClient'
import { goesFirst, VTA_SEND_ACT_TYPES, VTA_SEND_SEAL_TYPES, VTA_SENDS_FIRST } from '../module/vtaReadLane'

const READ = 'https://trusttasks.org/spec/rooms/keys/read/0.1'
const BROWSE = 'https://trusttasks.org/spec/rooms/keys/browse/0.1'
const WHOAMI = 'https://trusttasks.org/spec/auth/whoami/0.1'
const SEAL = 'https://trusttasks.org/spec/rooms/keys/seal/0.3'
const ACT = 'https://trusttasks.org/spec/rooms/keys/act/0.9'
const PUT = 'https://trusttasks.org/spec/rooms/records/put/0.3'
const OFFERS = 'https://trusttasks.org/spec/vtc/rooms/offers/list/0.4'

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

const seal = (client: VtaClient, key: string) => client.task(SEAL, { key }, 30_000)
const act = (client: VtaClient, key: string, completes: string) =>
  client.task(ACT, { key, document: { type: completes } }, 30_000)

describe('what goes first', () => {
  it('is on, a seal at every version Keyring sends, and an act only when it completes a records put', () => {
    expect(VTA_SENDS_FIRST).toBe(true)
    for (const type of VTA_SEND_SEAL_TYPES) expect(goesFirst(type, {})).toBe(true)
    for (const type of VTA_SEND_ACT_TYPES) expect(goesFirst(type, { document: { type: PUT } })).toBe(true)
    expect(goesFirst(ACT, { document: { type: OFFERS } })).toBe(false)
    expect(goesFirst(ACT, {})).toBe(false)
    expect(goesFirst(ACT, { document: 'put' })).toBe(false)
    expect(goesFirst(READ, { document: { type: PUT } })).toBe(false)
    expect(goesFirst(WHOAMI, undefined)).toBe(false)
  })
})

describe("a member's own write, on the agent's channel", () => {
  it('a seal goes ahead of the reads queued, never of those on the wire', async () => {
    const h = harness()
    await threadedSession(h)
    const reads = ['a', 'b', 'c', 'd'].map((k) => read(h.client, k))
    await flush()
    const sealed = seal(h.client, 's')
    await flush()
    expect(h.sent().slice(1)).toEqual(['rooms/keys/read/0.1:a', 'rooms/keys/read/0.1:b', 'rooms/keys/read/0.1:c'])
    for (const i of [1, 2, 3]) h.answer(i)
    await flush()
    // The seal before d, which was asked first.
    expect(h.sent().slice(4)).toEqual(['rooms/keys/seal/0.3:s'])
    h.answer(4)
    await flush()
    expect(h.sent().slice(5)).toEqual(['rooms/keys/read/0.1:d'])
    h.answer(5)
    await Promise.all([...reads, sealed])
    expect(h.logger.info).toHaveBeenCalledWith(expect.stringContaining(`${SEAL} goes ahead of 1 queued`))
  })

  it('a task that is no part of a write keeps its place behind the reads asked before it (control)', async () => {
    const h = harness()
    await threadedSession(h)
    const reads = ['a', 'b', 'c', 'd'].map((k) => read(h.client, k))
    await flush()
    const who = h.client.task(WHOAMI, {}, 30_000)
    await flush()
    h.answer(1)
    await flush()
    // d takes the lane's free place; whoami waits for every read.
    expect(h.sent().slice(4)).toEqual(['rooms/keys/read/0.1:d'])
    for (const i of [2, 3, 4]) h.answer(i)
    await flush()
    expect(h.sent().slice(5)).toEqual(['auth/whoami/0.1'])
    h.answer(5)
    await Promise.all([...reads, who])
  })

  it('an act completing a put goes first; one completing a listing of offers keeps its place', async () => {
    const h = harness()
    const first = h.client.task(BROWSE, { key: 'page' }, 30_000)
    await flush()
    const r1 = read(h.client, 'r1')
    const offers = act(h.client, 'offers', OFFERS)
    const put = act(h.client, 'put', PUT)
    await flush()
    for (let i = 0; i < 4; i++) {
      h.answer(i)
      await flush()
    }
    expect(h.sent()).toEqual([
      'rooms/keys/browse/0.1:page',
      'rooms/keys/act/0.9:put',
      'rooms/keys/read/0.1:r1',
      'rooms/keys/act/0.9:offers',
    ])
    await Promise.all([first, r1, offers, put])
  })

  it('the parts of writes keep the order they were asked in', async () => {
    const h = harness()
    const first = h.client.task(BROWSE, { key: 'page' }, 30_000)
    await flush()
    const r1 = read(h.client, 'r1')
    const s1 = seal(h.client, 's1')
    const s2 = seal(h.client, 's2')
    await flush()
    for (let i = 0; i < 4; i++) {
      h.answer(i)
      await flush()
    }
    expect(h.sent()).toEqual([
      'rooms/keys/browse/0.1:page',
      'rooms/keys/seal/0.3:s1',
      'rooms/keys/seal/0.3:s2',
      'rooms/keys/read/0.1:r1',
    ])
    await Promise.all([first, r1, s1, s2])
  })
})
