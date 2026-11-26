/**
 * The heartbeat beside the agent client's queue (vtaReadLane.ts, besideQueue). In a tester's run (276.10, 10-30) a
 * presence heartbeat the agent never answered held whoami and the rooms' key list for its whole 30 s, so rooms
 * reached Messages 46 s after launch. Once the session's agent threads its replies, a heartbeat starts at once and
 * nothing waits for it; every other task keeps its place in the queue. Before threading is known, in a session whose
 * agent answered unthreaded, and with the switch off, the heartbeat runs alone in the queue as before.
 */
jest.mock('@bifold/trust-tasks', () => {
  const actual = jest.requireActual('@bifold/trust-tasks')
  return {
    ...actual,
    signDocumentProof: jest.fn(async (_agent: unknown, doc: Record<string, unknown>) => doc),
  }
})
jest.mock('../module/tspCapability', () => ({ chooseCarriage: jest.fn(async () => 'didcomm') }))
jest.mock('../module/vtaReplyProof', () => ({ checkVtaReply: jest.fn(async () => ({ kind: 'unsigned' })) }))

import { VtaClient } from '../module/VtaClient'
import { AGENT_DEVICE_TASK } from '../module/vtaDevices'
import { besideQueue, VTA_BESIDE_TYPES, VTA_HEARTBEAT_BESIDE } from '../module/vtaReadLane'

const HEARTBEAT = 'https://trusttasks.org/spec/device/heartbeat/0.2'
const HEARTBEAT03 = 'https://trusttasks.org/spec/device/heartbeat/0.3'
const WHOAMI = 'https://trusttasks.org/spec/auth/whoami/0.1'
const KEYS_LIST = 'https://trusttasks.org/spec/rooms/keys/list/0.2'
const REGISTER = 'https://trusttasks.org/spec/device/register/0.2'

type Doc = { type: string; threadId: string; payload: Record<string, unknown> }

// Every client a test makes, so that one failing part way leaves nothing on the wire: an ask still out would time
// out 30 s later, in whatever suite the worker runs then.
const clients: VtaClient[] = []
afterEach(() => {
  for (const client of clients.splice(0)) client.dropQueued()
})

function harness(options: { heartbeatBeside?: boolean } = {}) {
  const logger = { warn: jest.fn(), info: jest.fn(), debug: jest.fn() }
  const client = new VtaClient({ config: { logger } } as never, 'did:webvh:agent', {} as never, {
    onInbound: jest.fn(),
    ...options,
  })
  clients.push(client)
  // A task dropped after a failed test has no one awaiting it: its refusal is handled here.
  const task = client.task.bind(client)
  client.task = ((...args: Parameters<VtaClient['task']>) => {
    const asked = task(...args)
    asked.catch(() => undefined)
    return asked
  }) as VtaClient['task']
  const docs: Doc[] = []
  const internals = client as unknown as { session: unknown; identity: unknown; deliver: (m: unknown) => void }
  internals.session = {
    sendTo: jest.fn(async (_to: string, message: { body: Doc }) => void docs.push(message.body)),
    sendTspFrame: jest.fn(async () => undefined),
    isOpen: true,
    stop: jest.fn(async () => undefined),
  }
  internals.identity = { did: 'did:peer:2.phone' }
  const sent = () => docs.map((d) => d.type.split('/spec/')[1])
  const reply = (index: number, threaded = true) => {
    const doc = docs[index]
    internals.deliver({
      id: `urn:uuid:reply-${index}-${Math.random()}`,
      type: 'https://trusttasks.org/binding/didcomm/v2',
      from: 'did:webvh:agent',
      ...(threaded ? { thid: doc.threadId } : {}),
      created_time: Math.floor(Date.now() / 1000),
      body: { type: `${doc.type}#response`, ...(threaded ? { threadId: doc.threadId } : {}), payload: { ok: index } },
    })
  }
  return { client, logger, docs, sent, reply }
}

const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve()
}

/** Answer a whoami, threaded or not, so the session knows how its agent replies. */
async function session(h: ReturnType<typeof harness>, threaded = true) {
  const who = h.client.task(WHOAMI, {}, 30_000)
  await flush()
  h.reply(h.docs.length - 1, threaded)
  await who
  await flush()
}

describe('the heartbeat beside the queue', () => {
  it('names the heartbeat alone, at both versions, and is on by default', () => {
    expect(VTA_HEARTBEAT_BESIDE).toBe(true)
    expect(besideQueue(HEARTBEAT)).toBe(true)
    expect(besideQueue(HEARTBEAT03)).toBe(true)
    expect(besideQueue(REGISTER)).toBe(false)
    expect(besideQueue(KEYS_LIST)).toBe(false)
    expect(besideQueue('https://trusttasks.org/spec/device/list/0.3')).toBe(false)
  })

  it('holds exactly the heartbeat versions Keyring sends: one added to the ladder and missed here fails', () => {
    // A heartbeat version left out would go back into the one-at-a-time queue with nothing else failing.
    const sent = Object.values(AGENT_DEVICE_TASK).filter((type) => /\/device\/heartbeat\//.test(type))
    expect(sent.length).toBeGreaterThanOrEqual(2)
    expect([...VTA_BESIDE_TYPES].sort()).toEqual([...sent].sort())
  })

  it('an unanswered heartbeat holds nothing: whoami and the key list go out and are answered while it waits', async () => {
    const h = harness()
    await session(h)
    const beat = h.client.task(HEARTBEAT03, {}, 30_000)
    await flush()
    const who = h.client.task(WHOAMI, {}, 30_000)
    const keys = h.client.task(KEYS_LIST, { includePersonal: true }, 30_000)
    await flush()
    // whoami goes out beside the heartbeat; the key list runs alone too, so it waits for whoami, not for the beat.
    expect(h.sent().slice(1)).toEqual(['device/heartbeat/0.3', 'auth/whoami/0.1'])
    h.reply(2)
    await expect(who).resolves.toEqual({ ok: 2 })
    await flush()
    expect(h.sent().slice(1)).toEqual(['device/heartbeat/0.3', 'auth/whoami/0.1', 'rooms/keys/list/0.2'])
    h.reply(3)
    await expect(keys).resolves.toEqual({ ok: 3 })
    // The heartbeat is still out, and its late answer is its own.
    h.reply(1)
    await expect(beat).resolves.toEqual({ ok: 1 })
    expect(h.logger.info.mock.calls.flat().join('\n')).not.toMatch(
      /waits behind https:\/\/trusttasks\.org\/spec\/device\/heartbeat/
    )
  })

  it('a heartbeat asked while a write is on the wire starts at once, and the write behind it is not held', async () => {
    const h = harness()
    await session(h)
    const register = h.client.task(REGISTER, {}, 30_000)
    await flush()
    const beat = h.client.task(HEARTBEAT, {}, 30_000)
    await flush()
    expect(h.sent().slice(1)).toEqual(['device/register/0.2', 'device/heartbeat/0.2'])
    // Control: a task that is not a heartbeat still waits for the write, and names it, not the heartbeat.
    const keys = h.client.task(KEYS_LIST, {}, 30_000)
    await flush()
    expect(h.sent()).not.toContain('rooms/keys/list/0.2')
    expect(h.logger.info.mock.calls.flat().join('\n')).toMatch(
      /keys\/list\/0\.2 waits behind https:\/\/trusttasks\.org\/spec\/device\/register\/0\.2/
    )
    h.reply(1)
    await register
    await flush()
    expect(h.sent()).toContain('rooms/keys/list/0.2')
    h.reply(3)
    h.reply(2)
    await expect(Promise.all([beat, keys])).resolves.toEqual([{ ok: 2 }, { ok: 3 }])
  })

  it('before the session has threaded a reply, the heartbeat runs alone and the key list waits for it', async () => {
    const h = harness()
    const beat = h.client.task(HEARTBEAT, {}, 30_000)
    const keys = h.client.task(KEYS_LIST, {}, 30_000)
    await flush()
    expect(h.sent()).toEqual(['device/heartbeat/0.2'])
    h.reply(0)
    await beat
    await flush()
    expect(h.sent()).toEqual(['device/heartbeat/0.2', 'rooms/keys/list/0.2'])
    h.reply(1)
    await keys
  })

  it('in a session whose agent answered unthreaded, the heartbeat runs alone', async () => {
    const h = harness()
    await session(h, false)
    const beat = h.client.task(HEARTBEAT, {}, 30_000)
    const keys = h.client.task(KEYS_LIST, {}, 30_000)
    await flush()
    expect(h.sent().slice(1)).toEqual(['device/heartbeat/0.2'])
    h.reply(1, false)
    await beat
    await flush()
    expect(h.sent().slice(1)).toEqual(['device/heartbeat/0.2', 'rooms/keys/list/0.2'])
    h.reply(2, false)
    await keys
  })

  it('switched off (the rollback), the heartbeat runs alone in the queue as before, and is named as the wait', async () => {
    const h = harness({ heartbeatBeside: false })
    await session(h)
    const beat = h.client.task(HEARTBEAT, {}, 30_000)
    await flush()
    const keys = h.client.task(KEYS_LIST, {}, 30_000)
    await flush()
    expect(h.sent().slice(1)).toEqual(['device/heartbeat/0.2'])
    expect(h.logger.info.mock.calls.flat().join('\n')).toMatch(
      /keys\/list\/0\.2 waits behind https:\/\/trusttasks\.org\/spec\/device\/heartbeat\/0\.2/
    )
    h.reply(1)
    await beat
    await flush()
    expect(h.sent().slice(1)).toEqual(['device/heartbeat/0.2', 'rooms/keys/list/0.2'])
    h.reply(2)
    await keys
  })
})
