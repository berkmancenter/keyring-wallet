/**
 * The key copies a session fetches go to the agent a few at a time (keyCopySweep.ts): the sweep fetches the first
 * identity's alone and then up to three identities side by side, and an export shares the agent channel's read lane.
 * 8 copies took 3.3 to 4.2 s one at a time on a tester's phone (11-17).
 *
 * What these rows hold, beyond "they go together": the lane's own rules still apply to an export, a task outside the
 * lane still runs alone and is never kept waiting by exports that are only queued (the order a join's backfill and
 * every write depend on), and with the switch off or killed everything goes one at a time, as before.
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
jest.mock('../module/tspCapability', () => ({ chooseCarriage: jest.fn(async () => 'didcomm') }))
jest.mock('../module/vtaReplyProof', () => ({ checkVtaReply: jest.fn(async () => ({ kind: 'unsigned' })) }))
jest.mock('../module/vtiTsp', () => ({
  ...jest.requireActual('../module/vtiTsp'),
  packTrustTaskForPeer: jest.fn(),
}))

import { VTA_TASK, VtaClient } from '../module/VtaClient'
import { isKeyCopiesTogetherOn, KEY_COPIES_AT_ONCE, KEY_COPIES_TOGETHER, sweepKeyCopies } from '../module/keyCopySweep'
import { StepUpDeclined } from '../module/stepUp'
import { inReadLane, VTA_READ_LANE_SIZE } from '../module/vtaReadLane'
import { VtiRefusal } from '../module/vtiAgent'

type Doc = { type: string; threadId: string; payload: Record<string, unknown> }

const EXPORT = 'https://trusttasks.org/spec/keys/export-secret/0.1'
const WHOAMI = 'https://trusttasks.org/spec/auth/whoami/0.1'
const CONFIG = 'https://trusttasks.org/spec/config/show/0.1'
const READ = 'https://trusttasks.org/spec/rooms/keys/read/0.1'
const BACKFILL = 'https://trusttasks.org/spec/rooms/keys/backfill/0.2'

function harness(options: { readLaneSize?: number } = {}) {
  const logger = { warn: jest.fn(), info: jest.fn(), debug: jest.fn() }
  const client = new VtaClient({ config: { logger } } as never, 'did:webvh:agent', {} as never, {
    onInbound: jest.fn(),
    ...options,
  })
  const docs: Doc[] = []
  const answered = new Set<number>()
  const sendTo = jest.fn(async (_to: string, message: { body: Doc }) => {
    docs.push(message.body)
  })
  const internals = client as unknown as {
    session: unknown
    identity: unknown
    tsp: unknown
    mediator: unknown
    deliver: (m: unknown) => void
  }
  internals.session = { sendTo, sendTspFrame: jest.fn(), isOpen: true, stop: jest.fn(async () => undefined) }
  internals.identity = { did: 'did:peer:2.phone' }
  internals.tsp = { identity: {}, resolver: {} }
  internals.mediator = { did: 'did:web:mediator' }
  const name = (d: Doc) =>
    d.type === EXPORT
      ? `export:${String(d.payload.keyId)}`
      : d.payload.key
        ? `${d.type.split('/spec/')[1]}:${String(d.payload.key)}`
        : d.type.split('/spec/')[1]
  /** Everything sent so far, in order. */
  const sent = () => docs.map(name)
  /** What is on the wire now: sent and not yet answered. */
  const onWire = () => docs.map((d, i) => (answered.has(i) ? undefined : name(d))).filter((n): n is string => !!n)
  const answer = (index: number) => {
    const doc = docs[index]
    answered.add(index)
    internals.deliver({
      id: `urn:uuid:reply-${index}-${Math.random()}`,
      type: 'https://trusttasks.org/binding/didcomm/v2',
      from: 'did:webvh:agent',
      thid: doc.threadId,
      created_time: Math.floor(Date.now() / 1000),
      body: { type: `${doc.type}#response`, threadId: doc.threadId, payload: { ok: index } },
    })
  }
  /** Answer the task named `what` that is on the wire. */
  const answerNamed = (what: string) => {
    const index = docs.findIndex((d, i) => !answered.has(i) && name(d) === what)
    if (index < 0) throw new Error(`${what} is not on the wire: ${onWire().join(', ') || 'nothing is'}`)
    answer(index)
  }
  const unthreaded = () =>
    internals.deliver({
      id: `urn:uuid:unthreaded-${Math.random()}`,
      type: 'https://trusttasks.org/binding/didcomm/v2',
      from: 'did:webvh:agent',
      created_time: Math.floor(Date.now() / 1000),
      body: { type: 'https://trusttasks.org/spec/whatever#response', payload: {} },
    })
  return { client, logger, sent, onWire, answer, answerNamed, unthreaded, docs }
}

const flush = async () => {
  for (let i = 0; i < 16; i++) await Promise.resolve()
}

const exportKey = (client: VtaClient, keyId: string) => client.task(EXPORT, { keyId }, 30_000)
const read = (client: VtaClient, key: string) => client.task(READ, { key }, 30_000)

/** Answer one task so the session knows its agent threads replies: the lane is open after this. */
async function threadedSession(h: ReturnType<typeof harness>) {
  const who = h.client.task(WHOAMI, {}, 30_000)
  await flush()
  h.answer(h.docs.length - 1)
  await who
  await flush()
}

const SHIPPED = { ...KEY_COPIES_TOGETHER }
afterEach(() => Object.assign(KEY_COPIES_TOGETHER, SHIPPED))

describe('what the release ships', () => {
  it('is on, not killed, and three identities at a time: the read lane’s own size', () => {
    expect(SHIPPED).toEqual({ on: true, remoteOff: false })
    expect(isKeyCopiesTogetherOn()).toBe(true)
    expect(KEY_COPIES_AT_ONCE).toBe(3)
    expect(KEY_COPIES_AT_ONCE).toBe(VTA_READ_LANE_SIZE)
  })

  it('leaves the read lane’s own list alone: an export is not a rooms read to anything that asks', () => {
    expect(inReadLane(EXPORT)).toBe(false)
  })
})

describe('exports on the agent channel, switched on', () => {
  it('once the lane is open, three are on the wire together and the fourth waits for a place', async () => {
    const h = harness()
    await threadedSession(h)
    const all = ['a', 'b', 'c', 'd'].map((k) => exportKey(h.client, k))
    await flush()
    expect(h.onWire()).toEqual(['export:a', 'export:b', 'export:c'])
    h.answerNamed('export:b')
    await flush()
    expect(h.onWire()).toEqual(['export:a', 'export:c', 'export:d'])
    h.answerNamed('export:a')
    h.answerNamed('export:c')
    h.answerNamed('export:d')
    await expect(Promise.all(all)).resolves.toHaveLength(4)
  })

  it('before this session’s agent has threaded a reply, they go one at a time', async () => {
    const h = harness()
    const all = ['a', 'b', 'c'].map((k) => exportKey(h.client, k))
    await flush()
    expect(h.onWire()).toEqual(['export:a'])
    h.answerNamed('export:a')
    await flush()
    // That answer was threaded: the lane is open, and the rest go together.
    expect(h.onWire()).toEqual(['export:b', 'export:c'])
    h.answerNamed('export:b')
    h.answerNamed('export:c')
    await Promise.all(all)
  })

  it('a reply with no thread while two are on the wire is taken by neither, and they go one at a time from then', async () => {
    const h = harness()
    await threadedSession(h)
    const first = ['a', 'b'].map((k) => exportKey(h.client, k))
    await flush()
    expect(h.onWire()).toEqual(['export:a', 'export:b'])
    h.unthreaded()
    const later = ['c', 'd'].map((k) => exportKey(h.client, k))
    await flush()
    // The lane is shut: nothing joins the two on the wire, though there is a place.
    expect(h.onWire()).toEqual(['export:a', 'export:b'])
    h.answerNamed('export:a')
    await flush()
    expect(h.onWire()).toEqual(['export:b'])
    h.answerNamed('export:b')
    await flush()
    expect(h.onWire()).toEqual(['export:c'])
    h.answerNamed('export:c')
    await flush()
    expect(h.onWire()).toEqual(['export:d'])
    h.answerNamed('export:d')
    await Promise.all([...first, ...later])
  })

  it('with the lane rolled back to 1, they go one at a time', async () => {
    const h = harness({ readLaneSize: 1 })
    await threadedSession(h)
    const all = ['a', 'b'].map((k) => exportKey(h.client, k))
    await flush()
    expect(h.onWire()).toEqual(['export:a'])
    h.answerNamed('export:a')
    await flush()
    h.answerNamed('export:b')
    await Promise.all(all)
  })

  it('reads and exports count against one size: two reads on the wire leave room for one export', async () => {
    const h = harness()
    await threadedSession(h)
    const all = [read(h.client, 'r1'), read(h.client, 'r2'), exportKey(h.client, 'a'), exportKey(h.client, 'b')]
    await flush()
    expect(h.onWire()).toEqual(['rooms/keys/read/0.1:r1', 'rooms/keys/read/0.1:r2', 'export:a'])
    h.answerNamed('rooms/keys/read/0.1:r1')
    await flush()
    expect(h.onWire()).toEqual(['rooms/keys/read/0.1:r2', 'export:a', 'export:b'])
    h.answerNamed('rooms/keys/read/0.1:r2')
    h.answerNamed('export:a')
    h.answerNamed('export:b')
    await Promise.all(all)
  })

  it('a task outside the lane waits for the exports on the wire, runs alone, and holds what was asked after it', async () => {
    const h = harness()
    await threadedSession(h)
    const all = [
      exportKey(h.client, 'a'),
      exportKey(h.client, 'b'),
      h.client.task(CONFIG, {}, 30_000),
      exportKey(h.client, 'c'),
    ]
    await flush()
    // The third place in the lane stays empty: the task that must run alone is next, and nothing passes it.
    expect(h.onWire()).toEqual(['export:a', 'export:b'])
    h.answerNamed('export:a')
    await flush()
    expect(h.onWire()).toEqual(['export:b'])
    h.answerNamed('export:b')
    await flush()
    expect(h.onWire()).toEqual(['config/show/0.1'])
    h.answerNamed('config/show/0.1')
    await flush()
    expect(h.onWire()).toEqual(['export:c'])
    h.answerNamed('export:c')
    await Promise.all(all)
  })

  // The order a join depends on (agentRoomsService: backfill is asked, then the room's reads; backfillRunsAlone.test.ts).
  it('a join’s backfill still runs alone beside the sweep: no export or read is on the wire with it', async () => {
    const h = harness()
    await threadedSession(h)
    const all = [
      exportKey(h.client, 'a'),
      exportKey(h.client, 'b'),
      h.client.task(BACKFILL, { roomId: 'r' }, 30_000),
      read(h.client, 'r1'),
      read(h.client, 'r2'),
      exportKey(h.client, 'c'),
    ]
    await flush()
    expect(h.onWire()).toEqual(['export:a', 'export:b'])
    h.answerNamed('export:a')
    h.answerNamed('export:b')
    await flush()
    expect(h.onWire()).toEqual(['rooms/keys/backfill/0.2'])
    h.answerNamed('rooms/keys/backfill/0.2')
    await flush()
    // Only after its answer: the reads asked behind it, and the export behind them.
    expect(h.onWire()).toEqual(['rooms/keys/read/0.1:r1', 'rooms/keys/read/0.1:r2', 'export:c'])
    h.answerNamed('rooms/keys/read/0.1:r1')
    h.answerNamed('rooms/keys/read/0.1:r2')
    h.answerNamed('export:c')
    await Promise.all(all)
  })
})

describe('exports on the agent channel, switched off', () => {
  it.each([
    ['on false', { on: false, remoteOff: false }],
    ['remoteOff set (the kill)', { on: true, remoteOff: true }],
    ['on not a boolean', { on: 'true', remoteOff: false }],
    ['remoteOff not a boolean', { on: true, remoteOff: 'false' }],
    ['remoteOff missing', { on: true, remoteOff: undefined }],
  ])('%s: reads as off, and exports go one at a time with the lane open', async (_name, values) => {
    Object.assign(KEY_COPIES_TOGETHER, values)
    expect(isKeyCopiesTogetherOn()).toBe(false)
    const h = harness()
    await threadedSession(h)
    const all = ['a', 'b', 'c'].map((k) => exportKey(h.client, k))
    for (const k of ['a', 'b', 'c']) {
      await flush()
      expect(h.onWire()).toEqual([`export:${k}`])
      h.answerNamed(`export:${k}`)
    }
    await Promise.all(all)
  })

  it('off, an export is alone on the wire: a read asked beside it waits', async () => {
    KEY_COPIES_TOGETHER.on = false
    const h = harness()
    await threadedSession(h)
    const all = [exportKey(h.client, 'a'), read(h.client, 'r1')]
    await flush()
    expect(h.onWire()).toEqual(['export:a'])
    h.answerNamed('export:a')
    await flush()
    expect(h.onWire()).toEqual(['rooms/keys/read/0.1:r1'])
    h.answerNamed('rooms/keys/read/0.1:r1')
    await Promise.all(all)
  })
})

describe('the sweep', () => {
  /** Fetches that end when told, and what ran when. */
  function fetches() {
    const log: string[] = []
    const ends = new Map<string, (step: 'go' | 'stop') => void>()
    const fetch = (item: string) =>
      new Promise<'go' | 'stop'>((resolve) => {
        log.push(`start ${item}`)
        ends.set(item, (step) => {
          log.push(`end ${item}`)
          resolve(step)
        })
      })
    const end = async (item: string, step: 'go' | 'stop' = 'go') => {
      const finish = ends.get(item)
      if (!finish) throw new Error(`${item} is not running`)
      ends.delete(item)
      finish(step)
      await flush()
    }
    return { log, fetch, end, running: () => [...ends.keys()] }
  }

  it('one at a time (1): each starts when the one before has ended, in order', async () => {
    const f = fetches()
    const done = sweepKeyCopies(['a', 'b', 'c'], f.fetch, 1)
    await flush()
    expect(f.running()).toEqual(['a'])
    await f.end('a')
    expect(f.running()).toEqual(['b'])
    await f.end('b')
    await f.end('c')
    await done
    expect(f.log).toEqual(['start a', 'end a', 'start b', 'end b', 'start c', 'end c'])
  })

  it('one at a time: a stop ends it, and nothing after is started', async () => {
    const f = fetches()
    const done = sweepKeyCopies(['a', 'b', 'c'], f.fetch, 1)
    await flush()
    await f.end('a', 'stop')
    await done
    expect(f.log).toEqual(['start a', 'end a'])
  })

  it('together (3): the first alone, then three side by side, the next as a place frees, in order', async () => {
    const f = fetches()
    const done = sweepKeyCopies(['a', 'b', 'c', 'd', 'e', 'f'], f.fetch, 3)
    await flush()
    expect(f.running()).toEqual(['a'])
    await f.end('a')
    expect(f.running()).toEqual(['b', 'c', 'd'])
    await f.end('c')
    expect(f.running()).toEqual(['b', 'd', 'e'])
    await f.end('b')
    expect(f.running()).toEqual(['d', 'e', 'f'])
    await f.end('d')
    await f.end('e')
    await f.end('f')
    await done
    expect(f.log.filter((l) => l.startsWith('start'))).toEqual(
      ['a', 'b', 'c', 'd', 'e', 'f'].map((item) => `start ${item}`)
    )
  })

  it('together: the first says stop, alone, and nothing else is ever started', async () => {
    const f = fetches()
    const done = sweepKeyCopies(['a', 'b', 'c', 'd'], f.fetch, 3)
    await flush()
    await f.end('a', 'stop')
    await done
    expect(f.log).toEqual(['start a', 'end a'])
  })

  it('together: a later stop starts nothing more, and the sweep ends only when what was running has', async () => {
    const f = fetches()
    let ended = false
    const done = sweepKeyCopies(['a', 'b', 'c', 'd', 'e', 'f'], f.fetch, 3).then(() => {
      ended = true
    })
    await flush()
    await f.end('a')
    await f.end('c', 'stop')
    expect(f.running()).toEqual(['b', 'd'])
    expect(ended).toBe(false)
    await f.end('b')
    expect(f.running()).toEqual(['d'])
    await f.end('d')
    await done
    expect(f.log.filter((l) => l.startsWith('start'))).toEqual(['start a', 'start b', 'start c', 'start d'])
  })

  // A callback that throws must end the sweep as a stop does: nothing goes on asking for key copies behind it.
  it('one at a time: a fetch that throws ends it with that error, and nothing after is started', async () => {
    const started: string[] = []
    const done = sweepKeyCopies(
      ['a', 'b', 'c'],
      async (item) => {
        started.push(item)
        if (item === 'b') throw new Error('b broke')
        return 'go'
      },
      1
    )
    await expect(done).rejects.toThrow('b broke')
    expect(started).toEqual(['a', 'b'])
  })

  it('together: the first throws, alone, and nothing else is ever started', async () => {
    const started: string[] = []
    const done = sweepKeyCopies(
      ['a', 'b', 'c', 'd'],
      async (item) => {
        started.push(item)
        throw new Error(`${item} broke`)
      },
      3
    )
    await expect(done).rejects.toThrow('a broke')
    await flush()
    expect(started).toEqual(['a'])
  })

  it('together: a later one throws, nothing more is started, and the sweep throws only once the others have ended', async () => {
    const log: string[] = []
    const ends = new Map<string, { go: () => void; fail: (e: Error) => void }>()
    const fetch = (item: string) =>
      new Promise<'go' | 'stop'>((resolve, reject) => {
        log.push(`start ${item}`)
        ends.set(item, { go: () => resolve('go'), fail: reject })
      })
    let outcome: string | undefined
    const done = sweepKeyCopies(['a', 'b', 'c', 'd', 'e', 'f'], fetch, 3).then(
      () => (outcome = 'ended'),
      (e: Error) => (outcome = `threw ${e.message}`)
    )
    await flush()
    ends.get('a')?.go()
    await flush()
    expect(log).toEqual(['start a', 'start b', 'start c', 'start d'])
    ends.get('c')?.fail(new Error('c broke'))
    await flush()
    // Two are still running: not ended yet, and no place freed by the throw was taken.
    expect(outcome).toBeUndefined()
    ends.get('b')?.go()
    await flush()
    expect(outcome).toBeUndefined()
    ends.get('d')?.go()
    await done
    expect(outcome).toBe('threw c broke')
    expect(log).toEqual(['start a', 'start b', 'start c', 'start d'])
  })

  it.each([
    ['none', [] as string[]],
    ['one', ['a']],
    ['two', ['a', 'b']],
  ])('together, with %s to fetch: each is fetched once and it ends', async (_name, items) => {
    const seen: string[] = []
    await sweepKeyCopies(
      items,
      async (item) => {
        seen.push(item)
        return 'go'
      },
      3
    )
    expect(seen).toEqual(items)
  })
})

describe('the sweep over the agent channel', () => {
  /** Five identities, two keys each, fetched as VtaClient.holdPersonaKeys does: signing, then key agreement. */
  const identities = ['p0', 'p1', 'p2', 'p3', 'p4']
  const sweep = (h: ReturnType<typeof harness>, atOnce: number) =>
    sweepKeyCopies(
      identities,
      async (p) => {
        await exportKey(h.client, `${p}.s`)
        await exportKey(h.client, `${p}.k`)
        return 'go'
      },
      atOnce
    )

  /** Answer whatever is on the wire, oldest first, until nothing is; the most that were ever on the wire together. */
  async function runOut(h: ReturnType<typeof harness>, before?: (wire: string[]) => void) {
    let most = 0
    for (let turn = 0; turn < 60; turn++) {
      await flush()
      const wire = h.onWire()
      if (wire.length === 0) return most
      most = Math.max(most, wire.length)
      before?.(wire)
      h.answerNamed(wire[0])
    }
    throw new Error('the sweep did not end')
  }

  it('on: the first identity alone, then never more than three exports on the wire, and all ten are fetched', async () => {
    const h = harness()
    await threadedSession(h)
    const done = sweep(h, isKeyCopiesTogetherOn() ? KEY_COPIES_AT_ONCE : 1)
    await flush()
    expect(h.onWire()).toEqual(['export:p0.s'])
    h.answerNamed('export:p0.s')
    await flush()
    expect(h.onWire()).toEqual(['export:p0.k'])
    h.answerNamed('export:p0.k')
    await flush()
    expect(h.onWire()).toEqual(['export:p1.s', 'export:p2.s', 'export:p3.s'])
    expect(await runOut(h)).toBe(3)
    await done
    expect(h.sent().filter((s) => s.startsWith('export:'))).toHaveLength(10)
  })

  // The order to fear: exports queued ahead of a person's own task. The sweep only ever has three identities' asks out,
  // so a task asked mid-sweep waits for the exports on the wire and for no others.
  it('on: a task asked mid-sweep goes as soon as the exports on the wire are answered, before any other export', async () => {
    const h = harness()
    await threadedSession(h)
    const done = sweep(h, KEY_COPIES_AT_ONCE)
    await flush()
    h.answerNamed('export:p0.s')
    await flush()
    h.answerNamed('export:p0.k')
    await flush()
    expect(h.onWire()).toEqual(['export:p1.s', 'export:p2.s', 'export:p3.s'])
    const mine = h.client.task(CONFIG, {}, 30_000)
    for (const p of ['p1', 'p2', 'p3']) {
      h.answerNamed(`export:${p}.s`)
      await flush()
    }
    // Each identity asked for its second key as its first was answered; all three wait behind the person's task.
    expect(h.onWire()).toEqual(['config/show/0.1'])
    h.answerNamed('config/show/0.1')
    await mine
    await flush()
    expect(h.onWire()).toEqual(['export:p1.k', 'export:p2.k', 'export:p3.k'])
    await runOut(h)
    await done
    const order = h.sent()
    expect(order.slice(order.indexOf('export:p3.s') + 1, order.indexOf('export:p1.k'))).toEqual(['config/show/0.1'])
  })

  it('off: one export on the wire at a time throughout, and a task asked mid-sweep is next', async () => {
    KEY_COPIES_TOGETHER.remoteOff = true
    const h = harness()
    await threadedSession(h)
    const done = sweep(h, isKeyCopiesTogetherOn() ? KEY_COPIES_AT_ONCE : 1)
    await flush()
    h.answerNamed('export:p0.s')
    await flush()
    expect(h.onWire()).toEqual(['export:p0.k'])
    const mine = h.client.task(CONFIG, {}, 30_000)
    h.answerNamed('export:p0.k')
    await flush()
    expect(h.onWire()).toEqual(['config/show/0.1'])
    h.answerNamed('config/show/0.1')
    await mine
    expect(await runOut(h)).toBe(1)
    await done
    expect(h.sent().filter((s) => s.startsWith('export:'))).toHaveLength(10)
  })
})

// Tasks side by side can each be refused with a step-up at the same moment, and the person is shown one card at a
// time (vtaAgent askStepUp keeps one): a second ask replaced the first's card, and its task then waited the whole two
// minutes for an answer nobody could give. Reachable from the sweep once exports go together.
describe('step-ups for tasks refused side by side', () => {
  const VTA = 'did:webvh:agent'
  const PHONE = 'did:key:z6MkPhoneManager'
  const stepUpRefusal = () =>
    new VtiRefusal('taskFailed', 'task failed: auth:step_up_required', {
      reason: 'auth:step_up_required',
      requiredAcr: 'aal2',
      approveRequest: {
        id: 'urn:uuid:step-up-1',
        type: 'https://trusttasks.org/spec/auth/step-up/approve-request/0.2',
        issuer: VTA,
        recipient: PHONE,
        issuedAt: '2026-11-18T08:00:00Z',
        payload: {
          subject: PHONE,
          sessionId: 'session-7',
          challenge: 'Y2hhbGxlbmdlLWZyb20tdGhlLWFnZW50LTAx',
          reason: 'Confirm it is you',
          targetAcr: 'aal2',
          acceptableEvidence: ['didSigned', 'webauthn'],
          ttl: 300,
        },
        proof: { type: 'DataIntegrityProof', proofPurpose: 'authentication' },
      },
    })

  /**
   * A client whose agent refuses a task with a step-up until the session is elevated. `stillWants` are keys it wants
   * a step-up for once more even then; `breaks` are keys whose re-send fails for a reason of its own.
   */
  function stepped(options: { stillWants?: string[]; breaks?: string[] } = {}) {
    const logger = { info: jest.fn(), warn: jest.fn(), debug: jest.fn() }
    const asks: Array<{ answer: (c: 'approve' | 'deny') => void; fail: (e: Error) => void }> = []
    let asking = 0
    let mostAsking = 0
    const ask = jest.fn(
      () =>
        new Promise<'approve' | 'deny'>((resolve, reject) => {
          asking++
          mostAsking = Math.max(mostAsking, asking)
          const end = () => asking--
          asks.push({
            answer: (c) => (end(), resolve(c)),
            fail: (e) => (end(), reject(e)),
          })
        })
    )
    const vta = new VtaClient({ config: { logger } } as never, VTA, {} as never, { onStepUp: ask })
    jest.spyOn(vta, 'managerDid', 'get').mockReturnValue(PHONE)
    ;(vta as unknown as { replyThreading: string }).replyThreading = 'threaded'
    const agent = { elevated: false, stillWants: new Set(options.stillWants), breaks: new Set(options.breaks) }
    const sends: string[] = []
    jest
      .spyOn(vta as unknown as { sendTask: (...a: unknown[]) => Promise<unknown> }, 'sendTask')
      .mockImplementation(async (...args: unknown[]) => {
        const [type, payload] = args as [string, Record<string, unknown>]
        if (type.includes('/auth/step-up/approve-response/')) {
          sends.push(`answer:${String(payload.decision)}`)
          if (payload.decision === 'approved') agent.elevated = true
          return { status: 'ok' }
        }
        const key = String(payload.keyId ?? payload.key)
        sends.push(`${type === EXPORT ? 'export' : 'read'}:${key}`)
        await Promise.resolve()
        if (!agent.elevated) throw stepUpRefusal()
        if (agent.stillWants.delete(key)) throw stepUpRefusal()
        if (agent.breaks.has(key)) throw new Error(`${key} failed for a reason of its own`)
        return { ok: key }
      })
    return { vta, ask, asks, agent, sends, logger, mostAsking: () => mostAsking }
  }

  it('three exports refused at once: the person is asked once, and after a yes the other two go through unasked', async () => {
    const h = stepped()
    const all = ['a', 'b', 'c'].map((k) => exportKey(h.vta, k))
    await flush()
    expect(h.sends).toEqual(['export:a', 'export:b', 'export:c'])
    expect(h.ask).toHaveBeenCalledTimes(1)
    h.asks[0].answer('approve')
    await expect(Promise.all(all)).resolves.toEqual([{ ok: 'a' }, { ok: 'b' }, { ok: 'c' }])
    expect(h.ask).toHaveBeenCalledTimes(1)
    expect(h.sends).toEqual(['export:a', 'export:b', 'export:c', 'answer:approved', 'export:a', 'export:b', 'export:c'])
  })

  it('a no answers all three: asked once, one signed no, and nothing is sent again', async () => {
    const h = stepped()
    const all = ['a', 'b', 'c'].map((k) => exportKey(h.vta, k))
    const ended = Promise.allSettled(all)
    await flush()
    h.asks[0].answer('deny')
    const results = await ended
    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected', 'rejected'])
    for (const r of results) expect((r as PromiseRejectedResult).reason).toBeInstanceOf(StepUpDeclined)
    expect(h.ask).toHaveBeenCalledTimes(1)
    expect(h.sends).toEqual(['export:a', 'export:b', 'export:c', 'answer:denied'])
  })

  it('a check that could not be made ends all three the same way: asked once, nothing sent', async () => {
    const h = stepped()
    const ended = Promise.allSettled(['a', 'b', 'c'].map((k) => exportKey(h.vta, k)))
    await flush()
    h.asks[0].fail(new Error('the extra check was not answered'))
    const results = await ended
    for (const r of results)
      expect((r as PromiseRejectedResult).reason).toMatchObject({ message: 'the extra check was not answered' })
    expect(h.ask).toHaveBeenCalledTimes(1)
    expect(h.sends).toEqual(['export:a', 'export:b', 'export:c'])
  })

  it('an agent that still wants a step-up for one of them: asked again, one card at a time, and the third goes through', async () => {
    const h = stepped({ stillWants: ['b'] })
    const all = ['a', 'b', 'c'].map((k) => exportKey(h.vta, k))
    await flush()
    h.asks[0].answer('approve')
    await flush()
    expect(h.ask).toHaveBeenCalledTimes(2)
    h.asks[1].answer('approve')
    await expect(Promise.all(all)).resolves.toEqual([{ ok: 'a' }, { ok: 'b' }, { ok: 'c' }])
    expect(h.ask).toHaveBeenCalledTimes(2)
    expect(h.mostAsking()).toBe(1)
  })

  it('one whose re-send fails for a reason of its own fails with that, and the one behind it still goes through', async () => {
    const h = stepped({ breaks: ['b'] })
    const [a, b, c] = ['a', 'b', 'c'].map((k) => exportKey(h.vta, k))
    const bEnded = b.then(
      () => 'resolved',
      (e: Error) => e.message
    )
    await flush()
    h.asks[0].answer('approve')
    await expect(a).resolves.toEqual({ ok: 'a' })
    await expect(bEnded).resolves.toBe('b failed for a reason of its own')
    await expect(c).resolves.toEqual({ ok: 'c' })
    expect(h.ask).toHaveBeenCalledTimes(1)
  })

  it('the one the person answered for fails after the yes for a reason of its own: the two behind it still go through', async () => {
    const h = stepped({ breaks: ['a'] })
    const [a, b, c] = ['a', 'b', 'c'].map((k) => exportKey(h.vta, k))
    const aEnded = a.then(
      () => 'resolved',
      (e: Error) => e.message
    )
    await flush()
    h.asks[0].answer('approve')
    await expect(aEnded).resolves.toBe('a failed for a reason of its own')
    await expect(b).resolves.toEqual({ ok: 'b' })
    await expect(c).resolves.toEqual({ ok: 'c' })
    expect(h.ask).toHaveBeenCalledTimes(1)
  })

  it('a step-up that comes when none is being answered is asked at once, with nothing sent before the answer', async () => {
    const h = stepped()
    const first = exportKey(h.vta, 'a')
    await flush()
    h.asks[0].answer('approve')
    await first
    // The elevation lapsed: a later task is refused again, and asks as the first did.
    h.agent.elevated = false
    h.sends.length = 0
    const later = exportKey(h.vta, 'd')
    await flush()
    expect(h.ask).toHaveBeenCalledTimes(2)
    expect(h.sends).toEqual(['export:d'])
    h.asks[1].answer('approve')
    await expect(later).resolves.toEqual({ ok: 'd' })
    expect(h.sends).toEqual(['export:d', 'answer:approved', 'export:d'])
  })

  it('killed: each is asked as it comes, as before (two reads in the lane both ask at once)', async () => {
    KEY_COPIES_TOGETHER.remoteOff = true
    const h = stepped()
    const all = ['r1', 'r2'].map((k) => read(h.vta, k))
    const ended = Promise.allSettled(all)
    await flush()
    expect(h.ask).toHaveBeenCalledTimes(2)
    expect(h.mostAsking()).toBe(2)
    h.asks[0].answer('approve')
    h.asks[1].answer('approve')
    await ended
  })

  it('on, two reads in the lane refused at once are asked once too', async () => {
    const h = stepped()
    const all = ['r1', 'r2'].map((k) => read(h.vta, k))
    await flush()
    expect(h.ask).toHaveBeenCalledTimes(1)
    h.asks[0].answer('approve')
    await expect(Promise.all(all)).resolves.toEqual([{ ok: 'r1' }, { ok: 'r2' }])
    expect(h.ask).toHaveBeenCalledTimes(1)
  })
})

// An approval (consent) is not a step-up: each held task waits for its own grant, named by its own digest, so three
// held at once share nothing while they wait. What the person is SHOWN is one comparison code, the last one's
// (vtaAgent onConsentPending keeps one): known, and not changed here.
describe('exports held for an approval side by side', () => {
  const VTA = 'did:webvh:agent'
  const held = (key: string) =>
    new VtiRefusal('taskFailed', 'task failed: auth:consent_required', {
      reason: 'auth:consent_required',
      payloadDigest: `digest-${key}`,
      challenge: `challenge-${key}`,
      consentRequests: [],
    })

  function heldClient() {
    const logger = { info: jest.fn(), warn: jest.fn(), debug: jest.fn() }
    const pending: string[] = []
    const vta = new VtaClient({ config: { logger } } as never, VTA, {} as never, {
      onInbound: jest.fn(),
      onConsentPending: ({ payloadDigest }: { payloadDigest?: string }) => pending.push(String(payloadDigest)),
    })
    jest.spyOn(vta, 'managerDid', 'get').mockReturnValue('did:key:z6MkPhoneManager')
    ;(vta as unknown as { replyThreading: string }).replyThreading = 'threaded'
    const granted = new Set<string>()
    const sends: string[] = []
    jest
      .spyOn(vta as unknown as { sendTask: (...a: unknown[]) => Promise<unknown> }, 'sendTask')
      .mockImplementation(async (...args: unknown[]) => {
        const key = String((args[1] as { keyId: string }).keyId)
        sends.push(`export:${key}`)
        await Promise.resolve()
        if (!granted.has(key)) throw held(key)
        return { ok: key }
      })
    /** The agent's notice that the approver said yes to `key`'s request. */
    const grant = (key: string) => {
      granted.add(key)
      ;(vta as unknown as { deliver: (m: unknown) => void }).deliver({
        id: `urn:uuid:granted-${key}`,
        type: 'https://trusttasks.org/binding/didcomm/v2',
        from: VTA,
        created_time: Math.floor(Date.now() / 1000),
        body: { type: VTA_TASK.consentGranted, payload: { payloadDigest: `digest-${key}` } },
      })
    }
    return { vta, pending, sends, grant }
  }

  it('three held at once: each is told as pending, waits for its own grant, and goes through when it comes', async () => {
    const h = heldClient()
    const done: string[] = []
    const all = ['a', 'b', 'c'].map((k) => exportKey(h.vta, k).then(() => done.push(k)))
    await flush()
    expect(h.sends).toEqual(['export:a', 'export:b', 'export:c'])
    expect(h.pending).toEqual(['digest-a', 'digest-b', 'digest-c'])
    // Granted out of order: each grant frees its own task and no other.
    h.grant('c')
    await flush()
    expect(done).toEqual(['c'])
    h.grant('a')
    await flush()
    expect(done).toEqual(['c', 'a'])
    h.grant('b')
    await Promise.all(all)
    expect(done).toEqual(['c', 'a', 'b'])
    expect(h.sends).toEqual(['export:a', 'export:b', 'export:c', 'export:c', 'export:a', 'export:b'])
  })
})
