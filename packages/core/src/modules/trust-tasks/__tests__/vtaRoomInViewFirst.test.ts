/**
 * The open room's own reads go ahead of what is queued on the agent's channel (vtaReadLane VTA_ROOM_IN_VIEW_FIRST,
 * VtaClient Priority.inView). A room's browse waited behind Messages' queued watches and key list on a tester's phone,
 * 0.25-0.7 s each time (K2QJ-Z9G9, 11-17). Never ahead of a task on the wire, only a read-lane task, and in order among
 * what goes first.
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
import { isRoomInViewFirstOn, VTA_KEY_FOR_SIGN_IN_FIRST, VTA_ROOM_IN_VIEW_FIRST } from '../module/vtaReadLane'

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

const CONFIG = 'https://trusttasks.org/spec/config/show/0.1'
const DEVICES = 'https://trusttasks.org/spec/device/list/0.3'
const WHOAMI_ = 'https://trusttasks.org/spec/auth/whoami/0.1'

/** whoami on the wire, then config/show and device/list queued: the start's reads a sign-in waited behind. */
async function busyStart(h: ReturnType<typeof harness>) {
  const tasks = [
    h.client.task(WHOAMI_, {}, 30_000),
    h.client.task(CONFIG, {}, 30_000),
    h.client.task(DEVICES, {}, 30_000),
  ]
  await flush()
  return tasks
}

/** Answer each task as it reaches the wire until `n` have been sent; the order they went in. */
async function drain(h: ReturnType<typeof harness>, n: number) {
  for (let i = 0; i < n; i++) {
    await flush()
    h.answer(i)
  }
  await flush()
  return h.sent()
}

const BROWSE = 'https://trusttasks.org/spec/rooms/keys/browse/0.4'
const EXPORT_KEY = 'https://trusttasks.org/spec/keys/export-secret/0.1'
const read = (client: VtaClient, inView: boolean, type = BROWSE) =>
  client.task(
    type,
    { roomId: 'did:webvh:room' },
    30_000,
    {},
    undefined,
    inView ? { priority: { first: false, inView } } : {}
  )

afterEach(() => {
  VTA_ROOM_IN_VIEW_FIRST.on = true
  VTA_ROOM_IN_VIEW_FIRST.remoteOff = false
  VTA_KEY_FOR_SIGN_IN_FIRST.on = false
})

describe("the open room's reads on the agent's channel", () => {
  it('a read the open room asks goes ahead of what is queued, never ahead of what is on the wire', async () => {
    const h = harness()
    const start = await busyStart(h)
    const browse = read(h.client, true)
    expect(await drain(h, 4)).toEqual([
      'auth/whoami/0.1',
      'rooms/keys/browse/0.4',
      'config/show/0.1',
      'device/list/0.3',
    ])
    expect(h.logger.info).toHaveBeenCalledWith(expect.stringContaining('rooms/keys/browse/0.4 goes ahead of 2 queued'))
    await Promise.all([...start, browse])
  })

  it('control: a read not asked as in view keeps the order asked', async () => {
    const h = harness()
    const start = await busyStart(h)
    const browse = read(h.client, false)
    expect(await drain(h, 4)).toEqual([
      'auth/whoami/0.1',
      'config/show/0.1',
      'device/list/0.3',
      'rooms/keys/browse/0.4',
    ])
    await Promise.all([...start, browse])
  })

  it('control: a task outside the read lane asked as in view keeps the order asked', async () => {
    const h = harness()
    const start = await busyStart(h)
    const other = read(h.client, true, WHOAMI_)
    expect(await drain(h, 4)).toEqual(['auth/whoami/0.1', 'config/show/0.1', 'device/list/0.3', 'auth/whoami/0.1'])
    await Promise.all([...start, other])
  })

  it.each([
    ['switched off', { on: false, remoteOff: false }],
    ['remoteOff set', { on: true, remoteOff: true }],
    ['on not a boolean', { on: 'true', remoteOff: false }],
    ['remoteOff missing', { on: true, remoteOff: undefined }],
  ])("fails closed (%s): the open room's read keeps the order asked", async (_name, values) => {
    Object.assign(VTA_ROOM_IN_VIEW_FIRST, values)
    expect(isRoomInViewFirstOn()).toBe(false)
    const h = harness()
    const start = await busyStart(h)
    const browse = read(h.client, true)
    expect(await drain(h, 4)).toEqual([
      'auth/whoami/0.1',
      'config/show/0.1',
      'device/list/0.3',
      'rooms/keys/browse/0.4',
    ])
    await Promise.all([...start, browse])
  })

  it("in order among what goes first: two of the open room's reads keep theirs", async () => {
    const h = harness()
    const start = await busyStart(h)
    const first = read(h.client, true)
    const second = read(h.client, true, 'https://trusttasks.org/spec/rooms/keys/read/0.2')
    expect(await drain(h, 5)).toEqual([
      'auth/whoami/0.1',
      'rooms/keys/browse/0.4',
      'rooms/keys/read/0.2',
      'config/show/0.1',
      'device/list/0.3',
    ])
    await Promise.all([...start, first, second])
  })

  // ac (11-18): the boundary with a sign-in's key (VTA_KEY_FOR_SIGN_IN_FIRST). An in-view read is asked with
  // first: false, so keyFirst() never takes it, and among what goes first it never passes a key asked before it.
  it("control: with the sign-in key's switch on and this one off, an in-view read keeps the order asked", async () => {
    VTA_KEY_FOR_SIGN_IN_FIRST.on = true
    VTA_ROOM_IN_VIEW_FIRST.on = false
    const h = harness()
    const start = await busyStart(h)
    const browse = read(h.client, true)
    expect(await drain(h, 4)).toEqual([
      'auth/whoami/0.1',
      'config/show/0.1',
      'device/list/0.3',
      'rooms/keys/browse/0.4',
    ])
    await Promise.all([...start, browse])
  })

  it("never passes a sign-in's key asked before it: both go first, the key ahead", async () => {
    VTA_KEY_FOR_SIGN_IN_FIRST.on = true
    const h = harness()
    const start = await busyStart(h)
    const key = h.client.task(EXPORT_KEY, { keyId: 'k' }, 30_000, {}, undefined, { priority: { first: true } })
    const browse = read(h.client, true)
    expect(await drain(h, 5)).toEqual([
      'auth/whoami/0.1',
      'keys/export-secret/0.1',
      'rooms/keys/browse/0.4',
      'config/show/0.1',
      'device/list/0.3',
    ])
    await Promise.all([...start, key, browse])
  })
})
