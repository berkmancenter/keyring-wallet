/**
 * B4 of the TSP 1.0 bridge on the agent (VTA) leg (cutover plan §6.2): the
 * background probe, and the fallback from TSP 1.0 to DIDComm mid-session.
 *
 * The carriage rule itself is `tspCapability.test.ts`; here `chooseCarriage`
 * is a stand-in that keeps the session's decision as the real one does, and
 * either asks for a probe or chooses TSP 1.0.
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
      peekRevision: jest.fn(() => ({ revision: 'v1', major: 1, minor: 0, recognised: true })),
    },
  }
})
const mockDecision = { next: 'probe' as 'probe' | 'tsp' }
jest.mock('../module/tspCapability', () => ({
  chooseCarriage: jest.fn(
    async (
      _agent: unknown,
      did: string,
      _can: boolean,
      options: { decided?: Map<string, string>; onProbeWanted?: (did: string, serviceId?: string) => void }
    ) => {
      const already = options.decided?.get(did)
      if (already) return already
      const carriage = mockDecision.next === 'tsp' ? 'tsp' : 'didcomm'
      if (mockDecision.next === 'probe') options.onProbeWanted?.(did, `${did}#tsp`)
      options.decided?.set(did, carriage)
      return carriage
    }
  ),
}))
jest.mock('../module/vtaReplyProof', () => ({ checkVtaReply: jest.fn(async () => ({ kind: 'unsigned' })) }))
jest.mock('../module/vtiTsp', () => ({
  ...jest.requireActual('../module/vtiTsp'),
  packTrustTaskForPeer: jest.fn(),
}))

import { MemoryTspProbeStore } from '../module/tspProbe'
import { VTA_TASK, VtaClient, VtaNoAnswer, isReadOnlyVtaTask } from '../module/VtaClient'
import { MemoryTspPeerRevisionStore, isFreshV1 } from '../module/vtiTsp'

const AGENT = 'did:webvh:agent'
const WRITE = 'https://trusttasks.org/spec/vta/acl/grant/0.1'

function harness(options: { answerProbeWhileSending?: boolean } = {}) {
  const logger = { warn: jest.fn(), info: jest.fn(), debug: jest.fn() }
  const probeStore = new MemoryTspProbeStore()
  const peerRevisionStore = new MemoryTspPeerRevisionStore()
  const client = new VtaClient({ config: { logger } } as never, AGENT, {} as never, { probeStore, peerRevisionStore })
  // Everything sent, in order, as "<carriage>:<what>".
  const sent: string[] = []
  const docs: { carriage: 'tsp' | 'didcomm'; doc: Record<string, unknown>; revision?: string }[] = []
  const sendTspFrame = jest.fn(async (bytes: Uint8Array) => {
    if (bytes[0] === 0x49) sent.push('tsp:invite')
    else sent.push(`tsp:${String(docs.at(-1)?.doc.type)}`)
    // The agent's answer can reach `deliver` before the probe's wait has begun.
    if (options.answerProbeWhileSending && docs.at(-1)?.doc.type === VTA_TASK.whoAmI && bytes[0] !== 0x49)
      answer(VTA_TASK.whoAmI)
  })
  const sendTo = jest.fn(async (_to: string, message: { body: Record<string, unknown> }) => {
    docs.push({ carriage: 'didcomm', doc: message.body })
    sent.push(`didcomm:${String(message.body.type)}`)
  })
  const internals = client as unknown as {
    session: unknown
    identity: unknown
    tsp: unknown
    mediator: unknown
    deliver: (m: unknown) => void
  }
  internals.session = { sendTspFrame, sendTo, isOpen: true }
  internals.identity = { did: 'did:peer:2.phone' }
  internals.tsp = { identity: {}, resolver: {} }
  internals.mediator = { did: 'did:web:mediator' }
  const { packTrustTaskForPeer } = jest.requireMock('../module/vtiTsp') as { packTrustTaskForPeer: jest.Mock }
  packTrustTaskForPeer.mockImplementation(
    async (_tsp: unknown, _from: string, _to: string, doc: Record<string, unknown>, revision?: string) => {
      docs.push({ carriage: 'tsp', doc, revision })
      return { bytes: new Uint8Array([0x54]), revision: revision ?? 'rev3' }
    }
  )
  /** Answer the latest document of a type, as the agent would. */
  const answer = (type: string) => {
    const doc = [...docs].reverse().find((d) => d.doc.type === type)?.doc as { type: string; threadId: string }
    internals.deliver({
      id: `urn:uuid:reply-${Math.random()}`,
      type: 'https://trusttasks.org/binding/didcomm/v2',
      from: AGENT,
      thid: doc.threadId,
      created_time: Math.floor(Date.now() / 1000),
      body: { type: `${doc.type}#response`, threadId: doc.threadId, payload: { ok: true } },
    })
  }
  return { client, sent, docs, answer, logger, probeStore, peerRevisionStore, sendTo }
}
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve()
}

describe('which VTA tasks only read', () => {
  it('whoami, list, show, status and get with a version; nothing else', () => {
    for (const t of [VTA_TASK.whoAmI, VTA_TASK.configShow, VTA_TASK.didsList, VTA_TASK.serversList])
      expect([t, isReadOnlyVtaTask(t)]).toEqual([t, true])
    for (const t of [WRITE, VTA_TASK.didsCreate, VTA_TASK.consentDecision, 'https://t/whoami'])
      expect([t, isReadOnlyVtaTask(t)]).toEqual([t, false])
  })
})

describe('the background probe of the agent', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    mockDecision.next = 'probe'
  })
  afterEach(() => jest.useRealTimers())

  it('runs beside the task, which goes over DIDComm and is not held up', async () => {
    const { client, sent, answer } = harness()
    const asked = client.task(VTA_TASK.configShow, {}, 30_000)
    await flush()
    // The task over DIDComm, and the probe's invite and whoami over TSP 1.0.
    expect(sent).toEqual(
      expect.arrayContaining(['didcomm:' + VTA_TASK.configShow, 'tsp:invite', 'tsp:' + VTA_TASK.whoAmI])
    )
    answer(VTA_TASK.configShow)
    await expect(asked).resolves.toEqual({ ok: true })
  })

  it("its answer moves later asks to TSP 1.0, and is never taken as a task's answer", async () => {
    const { client, sent, docs, answer, probeStore } = harness()
    const first = client.task(VTA_TASK.configShow, {}, 30_000)
    await flush()
    const probe = client.probeInFlight
    expect(probe).toBeDefined()
    // The probe's answer arrives first: it must not resolve the DIDComm task.
    answer(VTA_TASK.whoAmI)
    await flush()
    let settled = false
    void first.then(() => (settled = true))
    await flush()
    expect(settled).toBe(false)
    expect(await probe).toBe('answered')
    answer(VTA_TASK.configShow)
    await first

    sent.length = 0
    const second = client.task(VTA_TASK.didsList, {}, 30_000)
    await flush()
    expect(sent).toEqual(['tsp:' + VTA_TASK.didsList])
    expect(docs.at(-1)?.revision).toBe('v1')
    answer(VTA_TASK.didsList)
    await second
    expect(probeStore.records.get(AGENT)?.outcome).toBe('answered')
  })

  it('an answer that arrives while the probe is still sending is not lost (no false "unanswered")', async () => {
    const { client, answer, probeStore } = harness({ answerProbeWhileSending: true })
    const first = client.task(VTA_TASK.configShow, {}, 30_000)
    await flush()
    const probe = client.probeInFlight
    answer(VTA_TASK.configShow)
    await first
    expect(await probe).toBe('answered')
    expect(probeStore.records.get(AGENT)?.outcome).toBe('answered')
  })

  it('silent for 15 s while the agent answered DIDComm: "unanswered", and the session stays on DIDComm', async () => {
    const { client, sent, answer, probeStore } = harness()
    const first = client.task(VTA_TASK.configShow, {}, 30_000)
    await flush()
    answer(VTA_TASK.configShow)
    await first
    const probe = client.probeInFlight
    jest.advanceTimersByTime(15_001)
    expect(await probe).toBe('unanswered')
    expect(probeStore.records.get(AGENT)?.outcome).toBe('unanswered')
    sent.length = 0
    const second = client.task(VTA_TASK.didsList, {}, 30_000)
    await flush()
    expect(sent).toEqual(['didcomm:' + VTA_TASK.didsList])
    answer(VTA_TASK.didsList)
    await second
  })
})

describe('falling back from TSP 1.0 mid-session (§6.2, change 2)', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    mockDecision.next = 'tsp'
  })
  afterEach(() => jest.useRealTimers())

  it('a read that TSP 1.0 did not answer is asked again over DIDComm, and the record goes stale', async () => {
    const { client, sent, answer, peerRevisionStore } = harness()
    await peerRevisionStore.observe(AGENT, 'v1', 0)
    expect(isFreshV1(await peerRevisionStore.get(AGENT))).toBe(true)
    const asked = client.task(VTA_TASK.configShow, {}, 30_000)
    await flush()
    expect(sent).toEqual(['tsp:invite', 'tsp:' + VTA_TASK.configShow])
    jest.advanceTimersByTime(30_001)
    await flush()
    expect(sent.at(-1)).toBe('didcomm:' + VTA_TASK.configShow)
    answer(VTA_TASK.configShow)
    await expect(asked).resolves.toEqual({ ok: true })
    expect(isFreshV1(await peerRevisionStore.get(AGENT))).toBe(false)
    // The rest of the session is DIDComm.
    sent.length = 0
    const next = client.task(VTA_TASK.didsList, {}, 30_000)
    await flush()
    expect(sent).toEqual(['didcomm:' + VTA_TASK.didsList])
    answer(VTA_TASK.didsList)
    await next
  })

  it('a write that TSP 1.0 did not answer is not sent again: it says it got no answer, as today', async () => {
    const { client, sent, sendTo, peerRevisionStore } = harness()
    await peerRevisionStore.observe(AGENT, 'v1', 0)
    const asked = client.task(WRITE, {}, 30_000)
    await flush()
    jest.advanceTimersByTime(30_001)
    const error = await asked.then(() => undefined).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(VtaNoAnswer)
    expect(sendTo).not.toHaveBeenCalled()
    expect(sent.filter((s) => s.endsWith(WRITE))).toEqual(['tsp:' + WRITE])
    expect(isFreshV1(await peerRevisionStore.get(AGENT))).toBe(false)
  })
})
