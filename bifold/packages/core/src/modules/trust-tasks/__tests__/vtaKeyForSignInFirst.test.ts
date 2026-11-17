/**
 * A key copy a sign-in waits for goes ahead of what is queued on the agent's channel (vtaReadLane
 * VTA_KEY_FOR_SIGN_IN_FIRST, VtaClient Priority). A cold start's first sign-in on a tester's phone (11-16) waited behind
 * the start's reads and the sweep's exports for 3-5 of its 12.7 s. It ships OFF: off, every task keeps the order asked.
 * On, it never cuts a task on the wire, keeps the order among what goes first, and the sweep's exports keep their place
 * unless a sign-in joins one still queued.
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
import { isKeyForSignInFirstOn, VTA_KEY_FOR_SIGN_IN_FIRST } from '../module/vtaReadLane'
import type { Priority } from '../module/VtaClient'
import type { VtiPersona } from '../module/VtiIdentityStore'
import { inMemoryKeyId } from '../module/vtaKeys'

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

const EXPORT = 'https://trusttasks.org/spec/keys/export-secret/0.1'
const CONFIG = 'https://trusttasks.org/spec/config/show/0.1'
const DEVICES = 'https://trusttasks.org/spec/device/list/0.3'
const WHOAMI_ = 'https://trusttasks.org/spec/auth/whoami/0.1'

const exportKey = (client: VtaClient, keyId: string, priority?: Priority) =>
  client.task(EXPORT, { keyId }, 30_000, {}, undefined, priority ? { priority } : {})

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

afterEach(() => {
  VTA_KEY_FOR_SIGN_IN_FIRST.on = false
  VTA_KEY_FOR_SIGN_IN_FIRST.remoteOff = false
})

describe("a sign-in's key copy on the agent's channel", () => {
  it('ships off: an export asked as first keeps the order asked', async () => {
    expect(VTA_KEY_FOR_SIGN_IN_FIRST.on).toBe(false)
    const h = harness()
    const start = await busyStart(h)
    const exported = exportKey(h.client, 'k', { first: true })
    expect(await drain(h, 4)).toEqual([
      'auth/whoami/0.1',
      'config/show/0.1',
      'device/list/0.3',
      'keys/export-secret/0.1',
    ])
    await Promise.all([...start, exported])
  })

  it.each([
    ['remoteOff set', { on: true, remoteOff: true }],
    ['on not a boolean', { on: 'true', remoteOff: false }],
    ['remoteOff not a boolean', { on: true, remoteOff: 'false' }],
    ['remoteOff missing', { on: true, remoteOff: undefined }],
  ])('fails closed (%s): off, and an export asked as first keeps the order asked', async (_name, values) => {
    Object.assign(VTA_KEY_FOR_SIGN_IN_FIRST, values)
    expect(isKeyForSignInFirstOn()).toBe(false)
    const h = harness()
    const start = await busyStart(h)
    const exported = exportKey(h.client, 'k', { first: true })
    expect(await drain(h, 4)).toEqual([
      'auth/whoami/0.1',
      'config/show/0.1',
      'device/list/0.3',
      'keys/export-secret/0.1',
    ])
    await Promise.all([...start, exported])
  })

  it('a kill set after an export was asked as first leaves a later raise doing nothing', async () => {
    VTA_KEY_FOR_SIGN_IN_FIRST.on = true
    VTA_KEY_FOR_SIGN_IN_FIRST.remoteOff = true
    const h = harness()
    const start = await busyStart(h)
    const place: Priority = { first: true }
    const sweep = exportKey(h.client, 'k', place)
    await flush()
    place.raise?.()
    expect(await drain(h, 4)).toEqual([
      'auth/whoami/0.1',
      'config/show/0.1',
      'device/list/0.3',
      'keys/export-secret/0.1',
    ])
    await Promise.all([...start, sweep])
  })

  it('on: goes ahead of what is queued, never of the task on the wire, and says so', async () => {
    VTA_KEY_FOR_SIGN_IN_FIRST.on = true
    const h = harness()
    const start = await busyStart(h)
    const exported = exportKey(h.client, 'k', { first: true })
    expect(await drain(h, 4)).toEqual([
      'auth/whoami/0.1',
      'keys/export-secret/0.1',
      'config/show/0.1',
      'device/list/0.3',
    ])
    expect(h.logger.info).toHaveBeenCalledWith(expect.stringContaining(`${EXPORT} goes ahead of 2 queued`))
    await Promise.all([...start, exported])
  })

  it("on, control: the sweep's export (first: false) and one with no priority keep their place", async () => {
    VTA_KEY_FOR_SIGN_IN_FIRST.on = true
    const h = harness()
    const start = await busyStart(h)
    const sweep = exportKey(h.client, 'k', { first: false })
    const plain = exportKey(h.client, 'j')
    expect(await drain(h, 5)).toEqual([
      'auth/whoami/0.1',
      'config/show/0.1',
      'device/list/0.3',
      'keys/export-secret/0.1',
      'keys/export-secret/0.1',
    ])
    await Promise.all([...start, sweep, plain])
  })

  it('on: two that go first keep the order they were asked in', async () => {
    VTA_KEY_FOR_SIGN_IN_FIRST.on = true
    const h = harness()
    const start = await busyStart(h)
    const a = exportKey(h.client, 'a', { first: true })
    const b = exportKey(h.client, 'b', { first: true })
    await drain(h, 5)
    expect(h.docs.slice(1, 3).map((d) => d.payload.keyId)).toEqual(['a', 'b'])
    await Promise.all([...start, a, b])
  })

  it('on: raising one that goes first already keeps it ahead of a later one', async () => {
    VTA_KEY_FOR_SIGN_IN_FIRST.on = true
    const h = harness()
    const start = await busyStart(h)
    const place: Priority = { first: true }
    const a = exportKey(h.client, 'a', place)
    const b = exportKey(h.client, 'b', { first: true })
    await flush()
    place.raise?.()
    await drain(h, 5)
    expect(h.docs.slice(1, 3).map((d) => d.payload.keyId)).toEqual(['a', 'b'])
    await Promise.all([...start, a, b])
  })

  it('on: the sweep export a sign-in joins while still queued is raised ahead of the rest', async () => {
    VTA_KEY_FOR_SIGN_IN_FIRST.on = true
    const h = harness()
    const start = await busyStart(h)
    const place: Priority = { first: false }
    const sweep = exportKey(h.client, 'k', place)
    await flush()
    place.first = true
    place.raise?.()
    expect(await drain(h, 4)).toEqual([
      'auth/whoami/0.1',
      'keys/export-secret/0.1',
      'config/show/0.1',
      'device/list/0.3',
    ])
    await Promise.all([...start, sweep])
  })

  it('raised once started, or while off, it changes nothing', async () => {
    const h = harness()
    const start = await busyStart(h)
    const place: Priority = { first: false }
    const sweep = exportKey(h.client, 'k', place)
    await flush()
    place.first = true
    place.raise?.() // off
    VTA_KEY_FOR_SIGN_IN_FIRST.on = true
    expect(await drain(h, 4)).toEqual([
      'auth/whoami/0.1',
      'config/show/0.1',
      'device/list/0.3',
      'keys/export-secret/0.1',
    ])
    place.raise?.() // started and answered
    await Promise.all([...start, sweep])
  })
})

describe('raised after it started', () => {
  it('on: changes nothing, and the export is sent once', async () => {
    VTA_KEY_FOR_SIGN_IN_FIRST.on = true
    const h = harness()
    const who = h.client.task(WHOAMI_, {}, 30_000)
    const place: Priority = { first: false }
    const exported = exportKey(h.client, 'k', place)
    const rest = [h.client.task(CONFIG, {}, 30_000), h.client.task(DEVICES, {}, 30_000)]
    await flush()
    h.answer(0)
    await flush()
    expect(h.sent()).toEqual(['auth/whoami/0.1', 'keys/export-secret/0.1'])
    place.first = true
    place.raise?.()
    expect(await drain(h, 4)).toEqual([
      'auth/whoami/0.1',
      'keys/export-secret/0.1',
      'config/show/0.1',
      'device/list/0.3',
    ])
    await Promise.all([who, exported, ...rest])
  })
})

describe('borrowKey', () => {
  it('asks its export with the place it was given', async () => {
    const c = new VtaClient({ config: { logger: { info: jest.fn() } } } as never, 'did:webvh:agent', {} as never)
    const task = jest.spyOn(c, 'task').mockRejectedValue(new Error('stop here'))
    const place: Priority = { first: true }
    await expect(c.borrowKey('did:webvh:QmPersona:dids.example:al-first#key-0', place)).rejects.toThrow('stop here')
    expect(task).toHaveBeenCalledWith(EXPORT, expect.anything(), undefined, undefined, undefined, { priority: place })
  })

  it('control: with no place given it asks exactly as before, with the task defaults', async () => {
    const c = new VtaClient({ config: { logger: { info: jest.fn() } } } as never, 'did:webvh:agent', {} as never)
    const task = jest.spyOn(c, 'task').mockRejectedValue(new Error('stop here'))
    await expect(c.borrowKey('did:webvh:QmPersona:dids.example:al-first#key-0')).rejects.toThrow('stop here')
    expect(task.mock.calls[0]).toHaveLength(2)
  })
})

describe('the place a key fetch asks for, by who asked', () => {
  const VTA = 'did:webvh:agent'
  const PERSONA = 'did:webvh:QmPersona:dids.example:al-first'
  const persona = {
    did: PERSONA,
    vtaDid: VTA,
    vtaKeyIds: { signing: `${PERSONA}#key-0`, keyAgreement: `${PERSONA}#key-1` },
    kmsKeyIds: {
      signing: inMemoryKeyId(VTA, `${PERSONA}#key-0`),
      keyAgreement: inMemoryKeyId(VTA, `${PERSONA}#key-1`),
    },
  } as unknown as VtiPersona
  const agent = {
    dependencyManager: { resolve: () => ({ backends: [{ backend: 'inMemory', isHeld: async () => false }] }) },
    kms: { getPublicKey: async () => Promise.reject(new Error('not held')) },
    config: { logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn() } },
  }
  /** A client whose exports wait for `release`, recording the place each was asked with. */
  const client = (places: (Priority | undefined)[], release: Promise<void>) => {
    const c = new VtaClient(agent as never, VTA, {} as never)
    jest.spyOn(c, 'connect').mockResolvedValue(undefined)
    jest.spyOn(c, 'borrowKey').mockImplementation(async (vtaKeyId: string, priority?: Priority) => {
      places.push(priority)
      await release
      return { keyId: inMemoryKeyId(VTA, vtaKeyId), curve: 'Ed25519', publicKeyMultibase: 'z' }
    })
    return c
  }

  it.each([
    ['on use', true],
    ['session sweep', false],
  ] as const)('%s asks first: %s', async (source, first) => {
    const places: (Priority | undefined)[] = []
    await client(places, Promise.resolve()).holdPersonaKeys(persona, source)
    expect(places.map((p) => p?.first)).toEqual([first, first])
  })

  it("a sign-in that joins the sweep's fetch raises it", async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const places: (Priority | undefined)[] = []
    const sweepClient = client(places, gate)
    const sweep = sweepClient.holdPersonaKeys(persona, 'session sweep')
    await flush()
    const place = places[0]!
    place.raise = jest.fn()
    const signIn = client([], gate).holdPersonaKeys(persona, 'on use')
    await flush()
    expect(place.first).toBe(true)
    expect(place.raise).toHaveBeenCalledTimes(1)
    release()
    await Promise.allSettled([sweep, signIn])
  })

  it("control: another sweep joining the sweep's fetch raises nothing", async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const places: (Priority | undefined)[] = []
    const sweep = client(places, gate).holdPersonaKeys(persona, 'session sweep')
    await flush()
    const place = places[0]!
    place.raise = jest.fn()
    const again = client([], gate).holdPersonaKeys(persona, 'session sweep')
    await flush()
    expect(place.first).toBe(false)
    expect(place.raise).not.toHaveBeenCalled()
    release()
    await Promise.allSettled([sweep, again])
  })
})
