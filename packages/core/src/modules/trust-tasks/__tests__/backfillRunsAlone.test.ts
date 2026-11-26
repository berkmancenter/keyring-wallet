/**
 * A sealed room's key backfill runs alone on the agent's channel, and the room's reads asked after it wait for its
 * answer. bifold #1085 stopped waiting for the backfill before the accept answers (the room is shown first) and relies on
 * exactly this: the order lives here, not in the rooms module. Putting rooms/keys/backfill in VTA_READ_LANE_TYPES would
 * let a browse overtake it with nothing in rooms failing, so this does.
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
import { inReadLane } from '../module/vtaReadLane'
import { ROOMS_TASK } from '../../rooms/real/wire'

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

/** Answer one task so the session knows its agent threads replies: from then on, reads share the lane. */
async function threadedSession(h: ReturnType<typeof harness>) {
  const who = h.client.task('https://trusttasks.org/spec/auth/whoami/0.1', {}, 30_000)
  await flush()
  h.answer(h.docs.length - 1)
  await who
  await flush()
}

const BROWSE = ROOMS_TASK.keysBrowse04
const ROOM = 'did:webvh:room:joined'

describe("a room's key backfill on the agent's channel (#1085 depends on it)", () => {
  it('is not a read-lane task', () => {
    expect(inReadLane(ROOMS_TASK.keysBackfill)).toBe(false)
  })

  it('control: on a threaded session two browses go out together', async () => {
    const h = harness()
    await threadedSession(h)
    const a = h.client.task(BROWSE, { roomId: ROOM }, 30_000)
    const b = h.client.task(BROWSE, { roomId: 'did:webvh:room:other' }, 30_000)
    await flush()
    expect(h.sent().slice(1)).toEqual(['rooms/keys/browse/0.4', 'rooms/keys/browse/0.4'])
    h.answer(1)
    h.answer(2)
    await Promise.all([a, b])
  })

  it("a browse asked after it is sent only once the backfill's answer is in", async () => {
    const h = harness()
    await threadedSession(h)
    const backfill = h.client.task(ROOMS_TASK.keysBackfill, { roomId: ROOM, host: 'did:webvh:community' }, 30_000)
    await flush()
    const browse = h.client.task(BROWSE, { roomId: ROOM }, 30_000)
    await flush()
    expect(h.sent().slice(1)).toEqual(['rooms/keys/backfill/0.2'])
    h.answer(1)
    await backfill
    await flush()
    expect(h.sent().slice(1)).toEqual(['rooms/keys/backfill/0.2', 'rooms/keys/browse/0.4'])
    h.answer(2)
    await browse
  })
})
