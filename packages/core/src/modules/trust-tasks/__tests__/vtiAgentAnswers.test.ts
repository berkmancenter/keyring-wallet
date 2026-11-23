/**
 * A community's answer reaches the ask it answers, and is not lost when it is
 * late (found on origin/main, 2026-09-25):
 *  - one pending slot matched by type: a status poll asked during a submit
 *    took the submit's slot, and the submit's answer was lost;
 *  - a write asked over TSP that met silence was sent AGAIN over DIDComm — a
 *    second submit, which the community refuses as `requestAlreadyOpen`;
 *  - an answer that came after the 30 s clock was dropped, and the person was
 *    told their agent had not answered and to try again.
 *
 * Replies are threaded as vtc-service threads them: over DIDComm `thid` is the
 * request message's id (`envelope_task_handler`, `thid = msg.id`), and the
 * reply document's `threadId` is the request's (Trust Tasks SPEC §4.9); over
 * TSP there is only the document's `threadId` (`handle_tsp`).
 */
const mockSessions: Array<{
  did: string
  mediator: string
  onMessage: (m: unknown) => void
  onTspFrame?: (bytes: Uint8Array) => Promise<void>
  tsp: Uint8Array[]
  didcomm: unknown[]
}> = []
const mockGreetings: Array<{ from: string; to: string }> = []
const mockAdvertised: Record<string, string | undefined> = {}
const mockTspVia: Record<string, string | undefined> = {}
const mockPacked: Record<string, unknown>[] = []
/** Identities whose sign-in fails, as a mediator answering 503 does. */
const mockFailStart = new Set<string>()
/** Identities whose sign-in fails as a borrowed key whose agent is gone does (its DID log 404). */
const mockGoneStart = new Set<string>()
/** Identities whose socket never opens until released (`mockRelease`), as a sign-in suspended in the background. */
const mockHangStart = new Set<string>()
const mockRelease: Record<string, () => void> = {}
/** Sessions stopped, by DID. */
const mockStopped: string[] = []
let mockStarts = 0

jest.mock('@bifold/trust-tasks', () => ({
  tsp: { CODEC_FORMS_RELATIONSHIPS: true, peekRevision: () => ({ minor: 0 }) },
  TRUST_TASK_V2_ENVELOPE_TYPE: 'https://trusttasks.org/binding/didcomm/0.1/envelope',
}))
// Stands in for eddsa-jcs-2022: records who signed, with which keys.
jest.mock('../documentProof', () => ({
  signDocumentProof: jest.fn(
    async (
      _a: unknown,
      doc: Record<string, unknown>,
      did: string,
      o: { kmsKeyId?: string; verificationMethodId?: string }
    ) => ({
      ...doc,
      proof: { signer: did, kmsKeyId: o.kmsKeyId, verificationMethod: o.verificationMethodId },
    })
  ),
}))
jest.mock('../module/VtiMediatorTransport', () => ({
  advertisedMediatorDid: jest.fn(async (_a: unknown, did: string) => mockAdvertised[did]),
  advertisedTspMediatorDid: jest.fn(async (_a: unknown, did: string) => mockTspVia[did]),
  createVtiClientDid: jest.fn(async () => 'did:peer:client'),
  resolveVtiMediator: jest.fn(async (_a: unknown, did: string) => ({ did, wsEndpoint: `wss://${did}` })),
  resolveDidDocumentRetrying: jest.fn(),
  vtiClientIdentityFromDid: jest.fn(async (_a: unknown, did: string) => ({ did })),
  vtiClientIdentityFromPersona: jest.fn(async (_a: unknown, did: string) => ({ did })),
  VtiMediatorSession: class {
    private open = false
    readonly record: (typeof mockSessions)[number]
    constructor(
      _agent: unknown,
      identity: { did: string },
      mediator: { did: string },
      opts: { onMessage: (m: unknown) => void; onTspFrame?: (bytes: Uint8Array) => Promise<void> }
    ) {
      this.record = {
        did: identity.did,
        mediator: mediator.did,
        onMessage: opts.onMessage,
        onTspFrame: opts.onTspFrame,
        tsp: [],
        didcomm: [],
      }
      mockSessions.push(this.record)
    }
    get isOpen() {
      return this.open
    }
    async start() {
      mockStarts++
      if (mockFailStart.has(this.record.did))
        throw new Error('challenge answered 503 with a non-JSON body: no available server')
      if (mockGoneStart.has(this.record.did))
        throw new Error(
          `the in-memory copy of vta-copy:did:webvh:gone-agent:${this.record.did}#key-1 could not be fetched: Unable to resolve did document for did 'did:webvh:gone-agent': notFound resolver_error: HTTP error! status: 404`
        )
      if (mockHangStart.has(this.record.did))
        await new Promise<void>((resolve) => (mockRelease[this.record.did] = resolve))
      this.open = true
    }
    async stop() {
      this.open = false
      mockStopped.push(this.record.did)
    }
    async sendTspFrame(bytes: Uint8Array) {
      this.record.tsp.push(bytes)
    }
    async sendTo(_to: string, message: unknown) {
      this.record.didcomm.push(message)
    }
  },
}))
jest.mock('../module/vtiTsp', () => ({
  frameForm: () => 'short',
  getPeerLegCarriage: () => 'didcomm',
  LOG_PREFIX: '[tsp]',
  greetPeerOverTsp: jest.fn(async (_s: unknown, from: string, to: string) => {
    mockGreetings.push({ from, to })
    return { bytes: new Uint8Array([0xf8]) }
  }),
  packTrustTaskForPeer: jest.fn(async (_s: unknown, _from: string, _to: string, doc: Record<string, unknown>) => {
    mockPacked.push(doc)
    return { bytes: new Uint8Array([1]), revision: 'rev3' }
  }),
  tspSessionForPersona: jest.fn(async () => ({ identity: {}, resolver: {} })),
  unpackTrustTaskFromPeer: jest.fn(),
}))
jest.mock('../module/tspCapability', () => ({
  chooseCarriage: jest.fn(async (_a: unknown, peer: string, _can: boolean, o: { decided?: Map<string, string> }) => {
    const decided = o.decided?.get(peer)
    if (decided) return decided
    o.decided?.set(peer, 'tsp')
    return 'tsp'
  }),
}))

import { AppState, DeviceEventEmitter } from 'react-native'

import { plainError } from '../screens/plainError'
import {
  VTI_ANSWER_HOLD_MS,
  VTI_BACKLOG_GRACE_MS,
  VTI_SIGNIN_ONLINE_WITHIN_MS,
  VTI_SIGNIN_REST_FIRST_MS,
  VTI_SIGNIN_REST_MAX_MS,
  VTI_SIGNIN_TURN_MS,
  VtiNoOwnSession,
  VtiSentNoAnswer,
  isVtiReadTask,
  signInRestUntil,
  vtiAgent,
} from '../module/vtiAgent'
import { fakeAgent } from '../../../../__tests__/helpers/cardVault'
import { VTI_JOIN_STATUS_LATE_EVENT } from '../module/communityChanged'
import { VTI_READ_REASK, VTI_READ_REASK_AFTER_MS, isReadReaskOn } from '../module/readReaskSwitch'
import { OFFERS_LIST_TYPES } from '../../rooms/real/wire'
import {
  dropAllOwnSessions,
  dropOwnSession,
  keepOwnSession,
  ownSessionFor,
  ownSessionOpening,
} from '../module/vtiOwnSessions'

const logger = { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() }
const agent = { config: { logger } } as never
const persona = (did: string) =>
  ({
    did,
    communityDid: 'did:webvh:c:host',
    kmsKeyIds: { keyAgreement: 'ka', signing: 'sig' },
    vtaKeyIds: { signing: `${did}#key-0`, keyAgreement: `${did}#key-1` },
  }) as never

const SUBMIT = 'https://trusttasks.org/spec/vtc/join-requests/submit/0.2'
const STATUS = 'https://trusttasks.org/spec/vtc/join-requests/status/0.1'
const MANIFEST = 'https://trusttasks.org/spec/vtc/join-requests/manifest/0.2'
const WITHDRAW = 'https://trusttasks.org/spec/vtc/join-requests/withdraw/0.1'
const SUPPLEMENT = 'https://trusttasks.org/spec/vtc/join-requests/supplement/0.1'
const SELF_REMOVE = 'https://trusttasks.org/spec/vtc/members/self-remove/0.1'
const PROFILE = 'https://trusttasks.org/spec/vtc/vetting/vetters/profile/0.1'
const manifest = { criteria: [], requirementsDigest: 'd' } as never

type Sent = { id: string; thid?: string; body: { threadId: string; type: string } }

/** A DIDComm reply as vtc-service sends one: `thid` = the request message's id, the document threaded on the request's. */
const didcommReply = (sent: Sent, type: string, payload: Record<string, unknown>) => ({
  id: `urn:uuid:reply-${sent.id}`,
  type: `${type}#response`,
  thid: sent.id,
  body: { id: `urn:uuid:doc-${sent.id}`, type: `${type}#response`, threadId: sent.body.threadId, payload },
})

/** A TSP reply: no message, only the document, threaded on the request document's `threadId`. */
const tspReply = (threadId: string, type: string, payload: Record<string, unknown>) => ({
  plaintext: { type: `${type}#response`, body: { type: `${type}#response`, threadId, payload } },
  unpacked: { sender: 'did:webvh:c:any', revision: 'rev3' },
})

async function until(check: () => boolean, ms = 2000) {
  const end = Date.now() + ms
  while (!check()) {
    if (Date.now() > end) throw new Error('until: timed out')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

/** Connect as a fresh persona to a community reached over DIDComm (another mediator) or TSP (ours). */
async function connectTo(community: string, carriage: 'didcomm' | 'tsp', who: string) {
  mockTspVia[community] = carriage === 'tsp' ? 'did:peer:lab' : 'did:webvh:their-mediator'
  await vtiAgent.connect(agent, 'did:peer:lab', { persona: persona(who) })
  return mockSessions.at(-1)!
}

jest.setTimeout(30000)

beforeEach(async () => {
  await vtiAgent.disconnect()
  vtiAgent.answerTimeoutMs = 30000
  vtiAgent.submitAnswerTimeoutMs = 60000
  mockSessions.length = 0
  mockGreetings.length = 0
  mockPacked.length = 0
  for (const k of Object.keys(mockAdvertised)) delete mockAdvertised[k]
  for (const k of Object.keys(mockTspVia)) delete mockTspVia[k]
})

afterEach(() => {
  jest.restoreAllMocks()
  vtiAgent.answerTimeoutMs = 30000
  vtiAgent.submitAnswerTimeoutMs = 60000
})

describe('T1: concurrent asks each get their own answer', () => {
  for (const order of ['submit answered first', 'status answered first'] as const) {
    it(`over DIDComm, ${order}`, async () => {
      const community = `did:webvh:c:concurrent-${order.split(' ')[0]}`
      const session = await connectTo(community, 'didcomm', `did:webvh:p:concurrent-${order.split(' ')[0]}`)
      const submit = vtiAgent.ask(community, SUBMIT, { vp: {} }, 1000)
      await until(() => session.didcomm.length === 1)
      const status = vtiAgent.ask(community, STATUS, {}, 1000)
      await until(() => session.didcomm.length === 2)
      const [sentSubmit, sentStatus] = session.didcomm as Sent[]
      const submitAnswer = didcommReply(sentSubmit, SUBMIT, { requestId: 'r1', verdict: { effect: 'refer' } })
      const statusAnswer = didcommReply(sentStatus, STATUS, { requestId: 'r1', status: 'pending' })
      const answers = order === 'submit answered first' ? [submitAnswer, statusAnswer] : [statusAnswer, submitAnswer]
      for (const answer of answers) session.onMessage(answer)
      expect(await submit).toMatchObject({
        type: `${SUBMIT}#response`,
        body: { payload: { verdict: { effect: 'refer' } } },
      })
      expect(await status).toMatchObject({ type: `${STATUS}#response`, body: { payload: { status: 'pending' } } })
    })
  }

  it('over TSP, where only the document threads the answer', async () => {
    const community = 'did:webvh:c:concurrent-tsp'
    const session = await connectTo(community, 'tsp', 'did:webvh:p:concurrent-tsp')
    const { unpackTrustTaskFromPeer } = jest.requireMock('../module/vtiTsp') as { unpackTrustTaskFromPeer: jest.Mock }
    const submit = vtiAgent.ask(community, SUBMIT, { vp: {} }, 1000)
    await until(() => mockPacked.length === 1)
    const status = vtiAgent.ask(community, STATUS, {}, 1000)
    await until(() => mockPacked.length === 2)
    const [submitDoc, statusDoc] = mockPacked as { threadId: string }[]
    unpackTrustTaskFromPeer
      .mockResolvedValueOnce(tspReply(statusDoc.threadId, STATUS, { status: 'deferred' }))
      .mockResolvedValueOnce(tspReply(submitDoc.threadId, SUBMIT, { verdict: { effect: 'refer' } }))
    await session.onTspFrame?.(new Uint8Array([1]))
    await session.onTspFrame?.(new Uint8Array([2]))
    expect(await submit).toMatchObject({ body: { payload: { verdict: { effect: 'refer' } } } })
    expect(await status).toMatchObject({ body: { payload: { status: 'deferred' } } })
    expect(session.didcomm).toHaveLength(0)
  })
})

// 277.8: the session asked as one identity and moved to another 2 ms later. The answer reached the first identity's
// listener, was left on the mediator for a session no longer signed in as it, and came back at every drain until the
// session's next turn. A listener may now hand over an answer the session asked for, or drop one nothing waits for.
describe('an answer a listener heard for the shared session', () => {
  const MEMBERSHIPS = 'https://trusttasks.org/spec/vtc/rooms/memberships/list/0.1'
  const orphanOf = (type: string) => ({
    id: 'urn:uuid:late',
    type,
    thid: 'urn:uuid:no-such-request',
    body: { type, threadId: 'urn:uuid:no-such-request', payload: {} },
  })

  it('is given to the ask waiting for it, by thread', async () => {
    const community = 'did:webvh:c:listener-answer'
    const who = 'did:webvh:p:listener-answer'
    const session = await connectTo(community, 'didcomm', who)
    const status = vtiAgent.ask(community, STATUS, {}, 1000)
    await until(() => session.didcomm.length === 1)
    const reply = didcommReply((session.didcomm as Sent[])[0], STATUS, { status: 'pending' })
    expect(vtiAgent.answerFromListener(who, reply as never)).toBe('answered')
    expect(await status).toMatchObject({ body: { payload: { status: 'pending' } } })
  })

  it("is not given to another identity's ask, which goes on waiting for its own answer", async () => {
    const community = 'did:webvh:c:listener-other'
    const session = await connectTo(community, 'didcomm', 'did:webvh:p:listener-other')
    const status = vtiAgent.ask(community, STATUS, {}, 1000)
    await until(() => session.didcomm.length === 1)
    const reply = didcommReply((session.didcomm as Sent[])[0], STATUS, { status: 'pending' })
    expect(vtiAgent.answerFromListener('did:webvh:p:someone-else', reply as never)).toBeUndefined()
    session.onMessage(reply)
    expect(await status).toMatchObject({ body: { payload: { status: 'pending' } } })
  })

  it('is an orphan when it answers a read and threads on no ask, in the binding envelope or not', () => {
    const type = `${MEMBERSHIPS}#response`
    expect(vtiAgent.answerFromListener('did:webvh:p:a', orphanOf(type) as never)).toBe('orphan')
    const enveloped = {
      id: 'urn:uuid:late-2',
      type: 'https://trusttasks.org/binding/didcomm/0.1/envelope',
      thid: 'urn:uuid:no-such-request',
      body: { type, threadId: 'urn:uuid:no-such-request', payload: {} },
    }
    expect(vtiAgent.answerFromListener('did:webvh:p:a', enveloped as never)).toBe('orphan')
  })

  // What 276.10 protects: taken by a listener, a vetting request was acknowledged and lost. All of these stay.
  it.each([
    ['a vetting request', orphanOf('https://trusttasks.org/spec/vetting/request/0.1')],
    [
      'an answer to a vetting request, which is a write',
      orphanOf('https://trusttasks.org/spec/vetting/request/0.1#response'),
    ],
    ['an answer to a write nothing waits for', orphanOf(`${SUBMIT}#response`)],
    ['a refusal that threads on no ask of this phone’s', orphanOf('https://trusttasks.org/spec/trust-task-error/0.1')],
    [
      'a refusal that names no thread',
      {
        id: 'urn:uuid:bare-refusal',
        type: 'https://trusttasks.org/spec/trust-task-error/0.6',
        body: { type: 'https://trusttasks.org/spec/trust-task-error/0.6', payload: { code: 'malformed' } },
      },
    ],
    [
      'a problem-report that threads on no ask',
      {
        id: 'urn:uuid:stray-problem',
        type: 'https://didcomm.org/report-problem/2.0/problem-report',
        pthid: 'urn:uuid:no-such-request',
        body: { code: 'e.p.msg.unsupported' },
      },
    ],
    [
      'an answer to a read that names no thread',
      { id: 'urn:uuid:bare', type: `${MEMBERSHIPS}#response`, body: { type: `${MEMBERSHIPS}#response`, payload: {} } },
    ],
  ])("stays the shared session's: %s", (_what, message) => {
    expect(vtiAgent.answerFromListener('did:webvh:p:a', message as never)).toBeUndefined()
  })
})

// The real order on a phone in two communities: the session moves to another identity with an ask out, and the first
// identity's listener hears the answer. `connect` disconnects the old session on the way, so a test that doesn't switch
// never sees what that does to the ask (277.11, report 482B: the answer was dropped, the caller waited out 30 s).
describe('an answer that comes after the session moved on', () => {
  const FIRST = 'did:webvh:c:switch-first'
  const SECOND = 'did:webvh:c:switch-second'
  const A = 'did:webvh:p:switch-a'
  const B = 'did:webvh:p:switch-b'
  const MEMBERSHIPS = 'https://trusttasks.org/spec/vtc/rooms/memberships/list/0.1'
  // Longer than a sign-in: an ask whose clock ended during the switch is the control's case below.
  const asked = async (type: string, timeoutMs = 15000) => {
    const session = await connectTo(FIRST, 'didcomm', A)
    const before = session.didcomm.length
    const answer = vtiAgent.ask(FIRST, type, {}, timeoutMs)
    await until(() => session.didcomm.length === before + 1)
    const sent = (session.didcomm as Sent[])[before]
    return { session, sent, answer }
  }

  it('reaches the ask that waits for it, sent as that identity', async () => {
    const { sent, answer } = await asked(MEMBERSHIPS)
    await connectTo(SECOND, 'didcomm', B)
    expect(vtiAgent.getState().did).toBe(B)
    expect(vtiAgent.answerFromListener(A, didcommReply(sent, MEMBERSHIPS, { items: [] }) as never)).toBe('answered')
    expect(await answer).toMatchObject({ body: { payload: { items: [] } } })
  })

  it("reaches a write's ask too: its only copy", async () => {
    const { sent, answer } = await asked(SUBMIT)
    await connectTo(SECOND, 'didcomm', B)
    expect(vtiAgent.answerFromListener(A, didcommReply(sent, SUBMIT, { id: 'r1' }) as never)).toBe('answered')
    expect(await answer).toMatchObject({ body: { payload: { id: 'r1' } } })
  })

  it("is no one else's: another identity's listener doesn't take it", async () => {
    const { sent, answer } = await asked(MEMBERSHIPS, 100)
    await connectTo(SECOND, 'didcomm', B)
    expect(vtiAgent.answerFromListener(B, didcommReply(sent, MEMBERSHIPS, { items: [] }) as never)).toBeUndefined()
    expect(await answer).toBeUndefined()
  })

  it("a reply naming no thread on the new session doesn't answer the old identity's ask", async () => {
    const { sent, answer } = await asked(MEMBERSHIPS)
    let answered = false
    void answer.then(() => (answered = true))
    const second = await connectTo(SECOND, 'didcomm', B)
    second.onMessage({
      id: 'urn:uuid:bare',
      type: `${MEMBERSHIPS}#response`,
      from: FIRST,
      body: { payload: { items: ['not a'] } },
    })
    await new Promise((r) => setTimeout(r, 20))
    expect(answered).toBe(false)
    // Its own answer still reaches it.
    expect(vtiAgent.answerFromListener(A, didcommReply(sent, MEMBERSHIPS, { items: ['a'] }) as never)).toBe('answered')
    expect(await answer).toMatchObject({ body: { payload: { items: ['a'] } } })
  })

  it("the new identity's identical ask is its own, sent anew", async () => {
    const { sent, answer } = await asked(MEMBERSHIPS)
    const second = await connectTo(FIRST, 'didcomm', B)
    const own = vtiAgent.ask(FIRST, MEMBERSHIPS, {}, 2000)
    await until(() => second.didcomm.length === 1)
    second.onMessage(didcommReply((second.didcomm as Sent[])[0], MEMBERSHIPS, { items: ['b'] }))
    expect(await own).toMatchObject({ body: { payload: { items: ['b'] } } })
    expect(vtiAgent.answerFromListener(A, didcommReply(sent, MEMBERSHIPS, { items: ['a'] }) as never)).toBe('answered')
    expect(await answer).toMatchObject({ body: { payload: { items: ['a'] } } })
  })

  it('an ask no one waits for any more is not kept (control): its answer is an orphan', async () => {
    const { sent, answer } = await asked(MEMBERSHIPS, 1)
    expect(await answer).toBeUndefined()
    await connectTo(SECOND, 'didcomm', B)
    expect(vtiAgent.answerFromListener(A, didcommReply(sent, MEMBERSHIPS, { items: [] }) as never)).toBe('orphan')
  })

  it("a late answer kept for later is the identity's that asked: another doesn't take it", async () => {
    const kept = await asked(MEMBERSHIPS, 50)
    await connectTo(SECOND, 'didcomm', B)
    expect(await kept.answer).toBeUndefined()
    expect(vtiAgent.answerFromListener(A, didcommReply(kept.sent, MEMBERSHIPS, { items: [] }) as never)).toBe(
      'answered'
    )
    const second = await connectTo(FIRST, 'didcomm', B)
    expect(second).toBeDefined()
    expect(vtiAgent.takeHeldAnswer(FIRST, MEMBERSHIPS)).toBeUndefined()
  })
})

describe('a room offers listing is a read', () => {
  it.each(OFFERS_LIST_TYPES)('%s', (type) => {
    expect(isVtiReadTask(type)).toBe(true)
  })

  it('an answer to one that threads on no ask is dropped, not left on the mediator to come back', () => {
    const type = `${OFFERS_LIST_TYPES[0]}#response`
    const orphan = { id: 'urn:uuid:late', type, thid: 'urn:uuid:no-such', body: { type, threadId: 'urn:uuid:no-such' } }
    expect(vtiAgent.answerFromListener('did:webvh:p:a', orphan as never)).toBe('orphan')
  })

  it('accepting an offer is still a write (control)', () => {
    expect(isVtiReadTask('https://trusttasks.org/spec/vtc/rooms/offers/accept/0.1')).toBe(false)
  })
})

describe('T2: a write is sent once', () => {
  it('is not sent again over DIDComm when TSP is silent', async () => {
    const community = 'did:webvh:c:silent-write'
    const session = await connectTo(community, 'tsp', 'did:webvh:p:silent-write')
    expect(await vtiAgent.ask(community, SUBMIT, { vp: {} }, 50)).toBeUndefined()
    expect(session.didcomm).toHaveLength(0)
    expect(mockPacked.filter((d) => d.type === SUBMIT)).toHaveLength(1)
  })

  it('rejects as sent-with-no-answer, and a retry sends nothing more', async () => {
    const community = 'did:webvh:c:silent-apply'
    const session = await connectTo(community, 'tsp', 'did:webvh:p:silent-apply')
    const submitsPacked = () => mockPacked.filter((d) => d.type === SUBMIT).length
    vtiAgent.answerTimeoutMs = 50
    vtiAgent.submitAnswerTimeoutMs = 50
    const error = await vtiAgent.apply(community, manifest).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(VtiSentNoAnswer)
    expect(error).toMatchObject({
      taskType: SUBMIT,
      requestId: (mockPacked.at(-1) as { threadId: string }).threadId,
      communityDid: community,
      sentAt: expect.any(Number),
    })
    expect(session.didcomm).toHaveLength(0)
    expect(submitsPacked()).toBe(1)
    expect(plainError(error)).toMatchObject({ line: 'Errors.SentNoAnswer', retry: false })

    // Trying again waits on the submit already sent: nothing more goes out, over either carriage.
    await expect(vtiAgent.apply(community, manifest)).rejects.toBeInstanceOf(VtiSentNoAnswer)
    expect(submitsPacked()).toBe(1)
    expect(session.didcomm).toHaveLength(0)
  }, 10000)

  it('classifies only the reads as safe to send twice', () => {
    const ROOM_MEMBERSHIPS = 'https://trusttasks.org/spec/vtc/rooms/memberships/list/0.1'
    expect([MANIFEST, STATUS, ROOM_MEMBERSHIPS].filter(isVtiReadTask)).toEqual([MANIFEST, STATUS, ROOM_MEMBERSHIPS])
    expect([SUBMIT, SUPPLEMENT, WITHDRAW, SELF_REMOVE, PROFILE, 'https://t/unknown/0.1'].filter(isVtiReadTask)).toEqual(
      []
    )
  })
})

// IN-127, 10-06: four refusals of a join reached the report as bare "inbound
// trust-task-error" lines, and nothing said why.
describe("a community's refusal is logged with its code and words", () => {
  it('names the task it answers, the code, and the message, cut short', async () => {
    const community = 'did:webvh:c:refusal-log'
    const session = await connectTo(community, 'didcomm', 'did:webvh:p:refusal-log')
    logger.warn.mockClear()
    const asked = vtiAgent.apply(community, manifest).catch((e: unknown) => e)
    await until(() => session.didcomm.length > 0)
    const sent = session.didcomm[0] as Sent
    session.onMessage({
      id: 'urn:uuid:refused',
      type: 'https://trusttasks.org/spec/trust-task-error/0.5',
      thid: sent.id,
      body: {
        type: 'https://trusttasks.org/spec/trust-task-error/0.5',
        threadId: sent.body.threadId,
        payload: { code: 'requestAlreadyOpen', message: 'a request from this applicant is open' },
      },
    })
    await asked
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringMatching(
        /refused vtc\/join-requests\/submit: requestAlreadyOpen — a request from this applicant is open/
      )
    )
  })
})

describe('T3: a late answer is kept for the next caller', () => {
  // 238: a status answer after the clock ran out is announced, so the screen
  // showing the request asks again and gets it at once.
  it('a late answer about where a join stands is announced for that community', async () => {
    const community = 'did:webvh:c:late-status'
    const session = await connectTo(community, 'didcomm', 'did:webvh:p:late-status')
    const heard = jest.fn()
    const sub = DeviceEventEmitter.addListener(VTI_JOIN_STATUS_LATE_EVENT, heard)
    vtiAgent.answerTimeoutMs = 50
    await expect(vtiAgent.status(community)).rejects.toBeInstanceOf(VtiSentNoAnswer)
    const asked = session.didcomm[0] as Sent
    session.onMessage(didcommReply(asked, STATUS, { status: 'pending' }))
    expect(heard).toHaveBeenCalledWith({ communityDid: community })
    sub.remove()
  })

  // 7b's R5, 10-06: a community retrying a DID lookup after a 429 answers at about 30 s.
  it('a join submit waits 60 s by default, not the usual 30 s', async () => {
    const fresh = new (vtiAgent.constructor as new () => typeof vtiAgent)()
    expect(fresh.answerTimeoutMs).toBe(30000)
    expect(fresh.submitAnswerTimeoutMs).toBe(60000)
    const community = 'did:webvh:c:submit-clock'
    await connectTo(community, 'didcomm', 'did:webvh:p:submit-clock')
    const ask = jest.spyOn(vtiAgent, 'ask').mockResolvedValue(undefined)
    await vtiAgent.apply(community, manifest).catch(() => undefined)
    expect(ask).toHaveBeenCalledWith(community, SUBMIT, expect.anything(), 60000)
  })

  it('gives a retried submit the answer that came after its clock ran out, without sending it again', async () => {
    const community = 'did:webvh:c:late-submit'
    const session = await connectTo(community, 'didcomm', 'did:webvh:p:late-submit')
    const inbox = jest.fn()
    const stop = vtiAgent.onInbound(inbox)
    vtiAgent.answerTimeoutMs = 50
    vtiAgent.submitAnswerTimeoutMs = 50
    const error = await vtiAgent.apply(community, manifest).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(VtiSentNoAnswer)
    const sent = session.didcomm[0] as Sent
    expect((error as VtiSentNoAnswer).requestId).toBe(sent.body.threadId)

    session.onMessage(
      didcommReply(sent, SUBMIT, { requestId: 'r9', verdict: { effect: 'refer', with: { needs: ['x'] } } })
    )
    expect(inbox).not.toHaveBeenCalled()

    const verdict = await vtiAgent.apply(community, manifest)
    expect(verdict).toMatchObject({ requestId: 'r9', effect: 'refer', needs: ['x'] })
    expect(session.didcomm).toHaveLength(1)
    stop()
  })

  it('hands a late answer to takeHeldAnswer by request id, once', async () => {
    const community = 'did:webvh:c:late-status'
    const session = await connectTo(community, 'didcomm', 'did:webvh:p:late-status')
    expect(await vtiAgent.ask(community, STATUS, {}, 30)).toBeUndefined()
    const error = vtiAgent.sentNoAnswer(community, STATUS)
    const sent = session.didcomm[0] as Sent
    expect(error.requestId).toBe(sent.body.threadId)
    expect(vtiAgent.takeHeldAnswer(community, STATUS, error.requestId)).toBeUndefined()

    session.onMessage(didcommReply(sent, STATUS, { status: 'deferred' }))
    expect(vtiAgent.takeHeldAnswer(community, STATUS, 'urn:uuid:another')).toBeUndefined()
    expect(vtiAgent.takeHeldAnswer(community, STATUS, error.requestId)).toMatchObject({
      body: { payload: { status: 'deferred' } },
    })
    expect(vtiAgent.takeHeldAnswer(community, STATUS, error.requestId)).toBeUndefined()
  })

  // 7b's R5, 10-06: a join answered 0.2 s after the 30 s clock, and nothing took it.
  it('a submit that met silence learns its late answer as a verdict, without asking again', async () => {
    const community = 'did:webvh:c:late-verdict'
    const session = await connectTo(community, 'didcomm', 'did:webvh:p:late-verdict')
    vtiAgent.answerTimeoutMs = 30
    vtiAgent.submitAnswerTimeoutMs = 30
    const error = (await vtiAgent.apply(community, manifest).catch((e: unknown) => e)) as VtiSentNoAnswer
    expect(error).toBeInstanceOf(VtiSentNoAnswer)
    const waiting = vtiAgent.lateVerdict(error, 2000)
    const sent = session.didcomm[0] as Sent
    session.onMessage(didcommReply(sent, SUBMIT, { requestId: 'r7', verdict: { effect: 'refer' } }))
    await expect(waiting).resolves.toMatchObject({ requestId: 'r7', effect: 'refer' })
    expect(session.didcomm).toHaveLength(1)
    // Taken once.
    expect(vtiAgent.takeHeldAnswer(community, SUBMIT, error.requestId)).toBeUndefined()
  })

  it('a late refusal is thrown as the refusal; no late answer is undefined once the hold is over', async () => {
    const community = 'did:webvh:c:late-refusal'
    const session = await connectTo(community, 'didcomm', 'did:webvh:p:late-refusal')
    vtiAgent.answerTimeoutMs = 30
    vtiAgent.submitAnswerTimeoutMs = 30
    const error = (await vtiAgent.apply(community, manifest).catch((e: unknown) => e)) as VtiSentNoAnswer
    await expect(vtiAgent.lateVerdict(error, 30)).resolves.toBeUndefined()

    const again = vtiAgent.lateVerdict(error, 2000)
    const sent = session.didcomm[0] as Sent
    session.onMessage({
      id: 'urn:uuid:refused',
      type: 'https://trusttasks.org/spec/trust-task-error/0.1',
      thid: sent.id,
      body: {
        type: 'https://trusttasks.org/spec/trust-task-error/0.1',
        threadId: sent.body.threadId,
        payload: { code: 'requestAlreadyOpen', message: 'open' },
      },
    })
    await expect(again).rejects.toMatchObject({ code: expect.stringMatching(/requestAlreadyOpen/) })
  })

  it('lets the ask go once the hold is over; the answer then goes to the inbox', async () => {
    const community = 'did:webvh:c:late-too-late'
    const session = await connectTo(community, 'didcomm', 'did:webvh:p:late-too-late')
    const inbox = jest.fn()
    const stop = vtiAgent.onInbound(inbox)
    expect(await vtiAgent.ask(community, STATUS, {}, 30)).toBeUndefined()
    const sent = session.didcomm[0] as Sent
    const now = Date.now()
    jest.spyOn(Date, 'now').mockReturnValue(now + VTI_ANSWER_HOLD_MS + 1)
    session.onMessage(didcommReply(sent, STATUS, { status: 'deferred' }))
    expect(vtiAgent.takeHeldAnswer(community, STATUS)).toBeUndefined()
    expect(inbox).toHaveBeenCalledTimes(1)
    stop()
  })
})

// rooms/keys/act: the person's agent completes a room request as the member, and the phone sends it unchanged.
describe('a document the agent completed is sent as it is', () => {
  const PUT = 'https://trusttasks.org/spec/rooms/records/put/0.1'
  const completed = (extra: Record<string, unknown> = {}) => ({
    id: 'urn:uuid:put-1',
    type: PUT,
    issuer: 'did:webvh:p:member',
    recipient: 'did:webvh:c:rooms',
    issuedAt: '2026-10-29T12:00:00Z',
    payload: { roomId: 'did:webvh:room:open', key: 'note/abc', expectedVersion: 0, presentation: { type: 'VP' } },
    proof: { type: 'DataIntegrityProof', proofValue: 'z-agent' },
    ...extra,
  })

  it('over DIDComm: the body is the agent’s document, untouched, and its answer comes back', async () => {
    const community = 'did:webvh:c:rooms-didcomm'
    const session = await connectTo(community, 'didcomm', 'did:webvh:p:rooms-didcomm')
    const document = completed({ recipient: community })
    const put = vtiAgent.sendCompleted(community, document)
    await until(() => session.didcomm.length === 1)
    const [sent] = session.didcomm as Sent[]
    expect(sent.body).toEqual(document)
    session.onMessage(didcommReply(sent, PUT, { key: 'note/abc', version: 1 }))
    expect(await put).toEqual({ key: 'note/abc', version: 1 })
  })

  it('over TSP: the packed document is the agent’s, threaded by its id', async () => {
    const community = 'did:webvh:c:rooms-tsp'
    const session = await connectTo(community, 'tsp', 'did:webvh:p:rooms-tsp')
    const { unpackTrustTaskFromPeer } = jest.requireMock('../module/vtiTsp') as { unpackTrustTaskFromPeer: jest.Mock }
    const document = completed({ recipient: community })
    const put = vtiAgent.sendCompleted(community, document)
    await until(() => mockPacked.length === 1)
    expect(mockPacked[0]).toEqual(document)
    unpackTrustTaskFromPeer.mockResolvedValueOnce(tspReply(document.id, PUT, { key: 'note/abc', version: 1 }))
    await session.onTspFrame?.(new Uint8Array([1]))
    expect(await put).toEqual({ key: 'note/abc', version: 1 })
  })

  it('over TSP: an answer threaded on the document’s own threadId reaches it too', async () => {
    vtiAgent.answerTimeoutMs = 1000
    const community = 'did:webvh:c:rooms-thread'
    const session = await connectTo(community, 'tsp', 'did:webvh:p:rooms-thread')
    const { unpackTrustTaskFromPeer } = jest.requireMock('../module/vtiTsp') as { unpackTrustTaskFromPeer: jest.Mock }
    const document = completed({ recipient: community, threadId: 'urn:uuid:act-thread' })
    const put = vtiAgent.sendCompleted(community, document)
    await until(() => mockPacked.length === 1)
    unpackTrustTaskFromPeer.mockResolvedValueOnce(tspReply('urn:uuid:act-thread', PUT, { key: 'note/abc', version: 1 }))
    await session.onTspFrame?.(new Uint8Array([1]))
    expect(await put).toEqual({ key: 'note/abc', version: 1 })
  })
})

// Rooms fix 2 (rooms-slow, 11-05): a sign-in waited a fixed 2 s after its socket opened (2.002-2.030 s on 35 of 36
// sign-ins, 277.12), several in a row at launch. Answers reach their asks by thread; the one reply the wait kept from
// being mistaken for a fresh answer — no thread, no time, flushed from the mediator's backlog — is held back by type
// for VTI_BACKLOG_GRACE_MS instead, and nothing else waits.
describe('signing in: no fixed wait, and a stale reply naming no thread answers nothing', () => {
  const C = 'did:webvh:c:no-wait'
  const MEMBERSHIPS = 'https://trusttasks.org/spec/vtc/rooms/memberships/list/0.1'
  const bare = (id: string, items: string[], extra: Record<string, unknown> = {}) => ({
    id,
    type: `${MEMBERSHIPS}#response`,
    from: C,
    body: { payload: { items } },
    ...extra,
  })
  const askOn = async (who: string) => {
    const session = await connectTo(C, 'didcomm', who)
    const answer = vtiAgent.ask(C, MEMBERSHIPS, {}, 3000)
    let answered = false
    void answer.then(() => (answered = true))
    await until(() => session.didcomm.length === 1)
    return { session, answer, answered: () => answered }
  }
  afterEach(() => {
    vtiAgent.now = () => Date.now()
  })

  it('a sign-in is done once its socket opens: no fixed 2 s', async () => {
    const started = Date.now()
    await connectTo(C, 'didcomm', 'did:webvh:p:no-wait-1')
    expect(vtiAgent.getState()).toMatchObject({ status: 'connected', did: 'did:webvh:p:no-wait-1' })
    expect(Date.now() - started).toBeLessThan(1000)
  })

  it('a reply naming no thread and no time, as the session opens, does not answer a fresh ask; its own answer does', async () => {
    const { session, answer, answered } = await askOn('did:webvh:p:no-wait-2')
    session.onMessage(bare('urn:uuid:stale', ['stale']))
    await new Promise((r) => setTimeout(r, 20))
    expect(answered()).toBe(false)
    session.onMessage(didcommReply((session.didcomm as Sent[])[0], MEMBERSHIPS, { items: ['fresh'] }))
    expect(await answer).toMatchObject({ body: { payload: { items: ['fresh'] } } })
  })

  it('past the grace, a reply naming no thread still answers by its type (control)', async () => {
    const opened = Date.now()
    vtiAgent.now = () => opened
    const { session, answer } = await askOn('did:webvh:p:no-wait-3')
    vtiAgent.now = () => opened + VTI_BACKLOG_GRACE_MS
    session.onMessage(bare('urn:uuid:bare-late', ['late']))
    expect(await answer).toMatchObject({ body: { payload: { items: ['late'] } } })
  })

  // ac's question on #942: a threadless refusal (the VTC's unrouted parse error) answers any ask by type, and a timed
  // one within 5 s of the ask reads as fresh. Flushed on a quick drop and reconnect, it must not attach to a new ask.
  it('within the grace, a reply naming no thread is held back even when it names a time; past it, it answers', async () => {
    const opened = Date.now()
    vtiAgent.now = () => opened
    const { session, answer, answered } = await askOn('did:webvh:p:no-wait-4')
    const timed = { created_time: Math.floor(opened / 1000) + 1 }
    session.onMessage(bare('urn:uuid:bare-timed-early', ['early'], timed))
    await new Promise((r) => setTimeout(r, 20))
    expect(answered()).toBe(false)
    vtiAgent.now = () => opened + VTI_BACKLOG_GRACE_MS
    session.onMessage(bare('urn:uuid:bare-timed-late', ['late'], timed))
    expect(await answer).toMatchObject({ body: { payload: { items: ['late'] } } })
  })

  // The one threadless reply a community sends: its unrouted error, when it could not read the document at all
  // (trust-tasks-rs builds it with no thread: there is no request to respond to). It refuses any ask's type. Within the
  // grace it may be a stale one flushed from the mediator, so it waits; past it, it is the community's refusal.
  it("a community's unrouted error — no thread, no time — is held back within the grace and refuses after it", async () => {
    const opened = Date.now()
    vtiAgent.now = () => opened
    const { session, answer, answered } = await askOn('did:webvh:p:no-wait-6')
    const unrouted = {
      id: 'urn:uuid:unrouted',
      type: 'https://trusttasks.org/spec/trust-task-error/0.1',
      from: C,
      body: { payload: { code: 'malformed', message: 'could not parse the document' } },
    }
    session.onMessage(unrouted)
    await new Promise((r) => setTimeout(r, 20))
    expect(answered()).toBe(false)
    vtiAgent.now = () => opened + VTI_BACKLOG_GRACE_MS
    session.onMessage({ ...unrouted, id: 'urn:uuid:unrouted-2' })
    expect(await answer).toMatchObject({ type: 'https://trusttasks.org/spec/trust-task-error/0.1' })
  })

  it('a reply naming its thread answers at once, within the grace (control)', async () => {
    const opened = Date.now()
    vtiAgent.now = () => opened
    const { session, answer } = await askOn('did:webvh:p:no-wait-5')
    session.onMessage(didcommReply((session.didcomm as Sent[])[0], MEMBERSHIPS, { items: ['threaded'] }))
    expect(await answer).toMatchObject({ body: { payload: { items: ['threaded'] } } })
  })
})

// Rooms fix 3 (rooms-slow, 11-05): an identity whose mediator is down (QmPv211, 503) or whose agent is gone (QmT6Jb)
// took 10-26 s per sign-in, retried every 30 s from launch by background callers, and every other sign-in queued
// behind each try. After a failure, a background sign-in leaves that identity alone for a while, kept across launches;
// the person's own steps always try.
describe('an identity whose sign-in failed rests from background sign-ins', () => {
  const C = 'did:webvh:c:rest'
  const DEAD = 'did:webvh:p:rest-dead'
  const LIVE = 'did:webvh:p:rest-live'
  let clock = 0
  const tryAs = (who: string, background: boolean, onAgent: unknown = agent) => {
    mockTspVia[C] = 'did:webvh:their-mediator'
    return vtiAgent.connect(onAgent as never, 'did:peer:lab', { persona: persona(who), background })
  }
  const refusedName = async (p: Promise<unknown>) =>
    (await p.then(
      () => 'signed in',
      (e: Error) => e.name
    )) as string
  beforeEach(() => {
    clock = Date.parse('2026-11-05T22:00:00Z')
    vtiAgent.now = () => clock
    vtiAgent.forgetSignInRestsForTests()
    mockFailStart.clear()
    mockStarts = 0
  })
  afterEach(() => {
    vtiAgent.now = () => Date.now()
    vtiAgent.forgetSignInRestsForTests()
    mockFailStart.clear()
  })

  it('after a failure, a background sign-in is refused at once, without trying; the person’s own still tries', async () => {
    mockFailStart.add(DEAD)
    expect(await refusedName(tryAs(DEAD, true))).toBe('Error')
    const tries = mockStarts
    expect(await refusedName(tryAs(DEAD, true))).toBe('VtiSignInResting')
    expect(mockStarts).toBe(tries)
    // The person's own step (an ordinary connect) still tries.
    expect(await refusedName(tryAs(DEAD, false))).toBe('Error')
    expect(mockStarts).toBe(tries + 1)
  })

  it('another identity is not held back by it (control)', async () => {
    mockFailStart.add(DEAD)
    await refusedName(tryAs(DEAD, true))
    expect(await refusedName(tryAs(LIVE, true))).toBe('signed in')
  })

  it('once its rest runs out it is tried again, and a success ends the rest', async () => {
    mockFailStart.add(DEAD)
    await refusedName(tryAs(DEAD, true))
    clock += VTI_SIGNIN_REST_FIRST_MS - 1
    expect(await refusedName(tryAs(DEAD, true))).toBe('VtiSignInResting')
    clock += 1
    mockFailStart.delete(DEAD)
    expect(await refusedName(tryAs(DEAD, true))).toBe('signed in')
    await vtiAgent.disconnect()
    mockFailStart.add(DEAD)
    await refusedName(tryAs(DEAD, true))
    // Back to the first step, not doubled from before the success.
    clock += VTI_SIGNIN_REST_FIRST_MS
    expect(await refusedName(tryAs(DEAD, true))).toBe('Error')
  })

  it('while the phone is online it doubles with each failure, up to its limit', async () => {
    mockFailStart.add(DEAD)
    await refusedName(tryAs(LIVE, true)) // online
    let rest = VTI_SIGNIN_REST_FIRST_MS
    for (let i = 0; i < 3; i++) {
      await vtiAgent.disconnect()
      await refusedName(tryAs(LIVE, true)) // keeps the phone counted as online
      expect(await refusedName(tryAs(DEAD, true))).toBe('Error')
      clock += rest - 1
      expect(await refusedName(tryAs(DEAD, true))).toBe('VtiSignInResting')
      clock += 1
      rest *= 2
    }
    expect(signInRestUntil({ did: DEAD, failedAt: 0, count: 60 })).toBe(VTI_SIGNIN_REST_MAX_MS)
  })

  it('offline — nothing signed in lately — every failure stays at the first step', async () => {
    mockFailStart.add(DEAD)
    for (let i = 0; i < 4; i++) {
      expect(await refusedName(tryAs(DEAD, true))).toBe('Error')
      clock += VTI_SIGNIN_REST_FIRST_MS
    }
    // Online again, but long ago: still the first step.
    expect(VTI_SIGNIN_ONLINE_WITHIN_MS).toBeGreaterThan(VTI_SIGNIN_REST_FIRST_MS)
  })

  it('kept across a launch: read back from the phone, the identity is still left alone', async () => {
    const { agent: withRecords } = fakeAgent()
    ;(withRecords as unknown as { config: unknown }).config = { logger }
    mockFailStart.add(DEAD)
    await refusedName(tryAs(DEAD, true, withRecords))
    await new Promise((r) => setTimeout(r, 0)) // the write is not waited for
    vtiAgent.forgetSignInRestsForTests() // a new launch: nothing in memory
    const tries = mockStarts
    expect(await refusedName(tryAs(DEAD, true, withRecords))).toBe('VtiSignInResting')
    expect(mockStarts).toBe(tries)
  })
})

describe('one sign-in cannot hold the turn: a time limit, a late socket closed, a gone agent rests from listings (11-17)', () => {
  const C = 'did:webvh:c:turn'
  const HUNG = 'did:webvh:p:turn-hung'
  const NEXT = 'did:webvh:p:turn-next'
  const GONE = 'did:webvh:p:turn-gone'
  const DOWN = 'did:webvh:p:turn-down'
  const as = (who: string, opts: { background?: boolean; listing?: boolean } = {}) => {
    mockTspVia[C] = 'did:webvh:their-mediator'
    return vtiAgent.connect(agent, 'did:peer:lab', { persona: persona(who), ...opts })
  }
  const outcome = async (p: Promise<unknown>) =>
    (await p.then(
      () => 'signed in',
      (e: Error) => e.name
    )) as string
  /** A sign-in that never opens until released; its outcome is read once it settles. */
  const hang = () => {
    mockHangStart.add(HUNG)
    let ended: string | undefined
    void outcome(as(HUNG)).then((o) => (ended = o))
    return { ended: () => ended }
  }
  beforeEach(() => {
    vtiAgent.forgetSignInRestsForTests()
    vtiAgent.signInTurnMs = 150
    for (const set of [mockFailStart, mockGoneStart, mockHangStart]) set.clear()
    mockStopped.length = 0
    mockStarts = 0
  })
  afterEach(async () => {
    // A hung attempt is released, so nothing is left running into the next test.
    for (const did of Object.keys(mockRelease)) mockRelease[did]()
    await new Promise((r) => setTimeout(r, 10))
    for (const did of Object.keys(mockRelease)) delete mockRelease[did]
    vtiAgent.signInTurnMs = VTI_SIGNIN_TURN_MS
    vtiAgent.now = () => Date.now()
    vtiAgent.forgetSignInRestsForTests()
    for (const set of [mockFailStart, mockGoneStart, mockHangStart]) set.clear()
  })

  it('a sign-in that hangs is let go at the limit: the one queued behind it signs in', async () => {
    const hung = hang()
    expect(await outcome(as(NEXT))).toBe('signed in')
    expect(vtiAgent.getState()).toMatchObject({ status: 'connected', did: NEXT })
    // The let-go caller is not rejected from the timer: it hears VtiSignInTimedOut once its attempt settles.
    expect(hung.ended()).toBeUndefined()
    mockRelease[HUNG]()
    await until(() => hung.ended() !== undefined, 500)
    expect(hung.ended()).toBe('VtiSignInTimedOut')
  })

  it('control: a slow but healthy sign-in inside the limit signs in', async () => {
    vtiAgent.signInTurnMs = 2000
    const slow = hang()
    await until(() => !!mockRelease[HUNG])
    await new Promise((r) => setTimeout(r, 100))
    mockRelease[HUNG]()
    await until(() => slow.ended() !== undefined, 500)
    expect(slow.ended()).toBe('signed in')
    expect(vtiAgent.getState()).toMatchObject({ status: 'connected', did: HUNG })
  })

  it('the let-go sign-in opening late is closed, never kept beside the one that signed in since', async () => {
    hang()
    expect(await outcome(as(NEXT))).toBe('signed in')
    mockRelease[HUNG]()
    await until(() => mockStopped.includes(HUNG))
    expect(vtiAgent.getState()).toMatchObject({ status: 'connected', did: NEXT })
  })

  it('the limit is wall time: back from a background longer than it, the turn ends at once (control: a short trip does not)', async () => {
    vtiAgent.signInTurnMs = 10_000
    let clock = Date.parse('2026-11-17T02:37:15Z')
    vtiAgent.now = () => clock
    let onChange: ((s: string) => void) | undefined
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, h: (s: string) => void) => {
      onChange = h
      return { remove: () => undefined }
    }) as never)
    hang()
    await until(() => !!onChange && !!mockRelease[HUNG])
    let next: string | undefined
    void outcome(as(NEXT)).then((o) => (next = o))
    // A short trip away: back before the limit, the queued sign-in still waits.
    clock += 5_000
    onChange!('active')
    await new Promise((r) => setTimeout(r, 30))
    expect(next).toBeUndefined()
    // 14 minutes away, as on 11-17: the first look back lets the turn go, though the paused timer has not fired.
    clock += 14 * 60_000
    onChange!('active')
    await until(() => next !== undefined, 500)
    expect(next).toBe('signed in')
  })

  it('let go after its socket opened, during its last read: never committed, and the sign-in after it keeps the session (ac, #1095)', async () => {
    let releaseRead = () => undefined as void
    const slowStore = {
      list: () => new Promise<[]>((resolve) => (releaseRead = () => resolve([]))),
    }
    mockTspVia[C] = 'did:webvh:their-mediator'
    let ended: string | undefined
    void outcome(
      vtiAgent.connect(agent, 'did:peer:lab', { persona: persona(HUNG), peerRevisionStore: slowStore as never })
    ).then((o) => (ended = o))
    // The socket opens (no hang), then the last read waits: the limit lets the turn go there.
    await until(() => mockStopped.includes(HUNG), 1000)
    // connect keeps a given store for later sign-ins: the next one brings its own, so it does not wait on the slow one.
    const fast = { list: async () => [] }
    mockTspVia[C] = 'did:webvh:their-mediator'
    expect(
      await outcome(
        vtiAgent.connect(agent, 'did:peer:lab', { persona: persona(NEXT), peerRevisionStore: fast as never })
      )
    ).toBe('signed in')
    releaseRead()
    await until(() => ended !== undefined, 500)
    expect(ended).toBe('VtiSignInTimedOut')
    // The let-go attempt committed nothing: the later sign-in still owns the state and the session.
    expect(vtiAgent.getState()).toMatchObject({ status: 'connected', did: NEXT })
    expect(mockSessions.filter((m) => m.did === HUNG)).toHaveLength(1)
    expect(mockStopped).toContain(HUNG)
    expect(mockStopped).not.toContain(NEXT)
  })

  it('the let-go sign-in is closed at once, while its socket is still opening (the DID has one mediator slot)', async () => {
    hang()
    // Not released: the socket never opened, and the session is already stopped.
    await until(() => mockStopped.includes(HUNG), 1000)
  })

  it("letting a sign-in go stops only that attempt's session, never another identity's own session (ac, #1095)", async () => {
    const OTHER = 'did:webvh:p:turn-own-other'
    const kept = { sendTo: async () => undefined }
    keepOwnSession(OTHER, kept)
    hang()
    await until(() => mockStopped.includes(HUNG), 1000)
    // The other identity's own session is untouched: the let-go stops the attempt's session object, not by DID.
    expect(ownSessionFor(OTHER)).toBe(kept)
    expect(mockStopped).toEqual([HUNG])
    dropAllOwnSessions()
  })

  it('a let-go identity rests from background sign-ins at once, as a failure does', async () => {
    hang()
    await until(() => mockStopped.includes(HUNG), 1000)
    const tries = mockStarts
    expect(await outcome(as(HUNG, { background: true }))).toBe('VtiSignInResting')
    expect(mockStarts).toBe(tries)
  })

  it("an identity whose agent is gone rests from a screen's listing too, without a try", async () => {
    mockGoneStart.add(GONE)
    expect(await outcome(as(GONE, { listing: true }))).toBe('Error')
    const tries = mockStarts
    expect(await outcome(as(GONE, { listing: true }))).toBe('VtiSignInResting')
    expect(mockStarts).toBe(tries)
    // The person's own step still tries.
    expect(await outcome(as(GONE))).toBe('Error')
    expect(mockStarts).toBe(tries + 1)
  })

  it('control: any other failure (a mediator answering 503) still lets a listing try', async () => {
    mockFailStart.add(DOWN)
    expect(await outcome(as(DOWN, { listing: true }))).toBe('Error')
    const tries = mockStarts
    expect(await outcome(as(DOWN, { listing: true }))).toBe('Error')
    expect(mockStarts).toBe(tries + 1)
  })

  it('no rejection ever comes from the limit itself: a hung sign-in nobody waits on rejects nothing (CI on #1095)', async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (e: unknown) => unhandled.push(e)
    process.on('unhandledRejection', onUnhandled)
    try {
      hang()
      await until(() => mockStopped.includes(HUNG), 1000)
      await new Promise((r) => setTimeout(r, 50))
      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })
})

// Sessions phase B (rooms-slow §8b): an identity the shared session is not signed in as asks over its own session, its
// listener, so nothing waits on a sign-in or a hold of the shared session.
describe('an ask as an identity, over its own session', () => {
  type SentAs = Sent & { from: string; body: Sent['body'] & { issuer: string; proof?: { signer: string } } }
  const own = () => {
    const sent: SentAs[] = []
    return { sent, session: { sendTo: async (_to: string, message: unknown) => void sent.push(message as SentAs) } }
  }
  afterEach(() => dropAllOwnSessions())

  it('goes out on that session, from and signed as the identity; its answer comes back there; the shared session sends nothing', async () => {
    const community = 'did:webvh:c:own-one'
    const shared = await connectTo(community, 'didcomm', 'did:webvh:p:shared-one')
    const mine = own()
    keepOwnSession('did:webvh:p:own-one', mine.session)
    expect(vtiAgent.ownSessionOpen('did:webvh:p:own-one')).toBe(true)
    const asked = vtiAgent.askAs(persona('did:webvh:p:own-one'), community, STATUS, {}, 1000)
    await until(() => mine.sent.length === 1)
    const [message] = mine.sent
    expect([message.from, message.body.issuer, message.body.proof?.signer]).toEqual([
      'did:webvh:p:own-one',
      'did:webvh:p:own-one',
      'did:webvh:p:own-one',
    ])
    expect(shared.didcomm).toHaveLength(0)
    expect(
      vtiAgent.answerFromListener('did:webvh:p:own-one', didcommReply(message, STATUS, { status: 'pending' }) as never)
    ).toBe('answered')
    expect(await asked).toMatchObject({ body: { payload: { status: 'pending' } } })
  })

  it('goes over DIDComm even to a community the shared session would ask over TSP', async () => {
    const community = 'did:webvh:c:own-tsp'
    const shared = await connectTo(community, 'tsp', 'did:webvh:p:shared-tsp')
    const mine = own()
    keepOwnSession('did:webvh:p:own-tsp', mine.session)
    const asked = vtiAgent.askAs(persona('did:webvh:p:own-tsp'), community, STATUS, {}, 1000)
    await until(() => mine.sent.length === 1)
    expect([shared.tsp.length, mockPacked.length]).toEqual([0, 0])
    vtiAgent.answerFromListener('did:webvh:p:own-tsp', didcommReply(mine.sent[0], STATUS, {}) as never)
    await asked
  })

  it('throws, sending nothing, for an identity whose own session is not open', async () => {
    const community = 'did:webvh:c:own-none'
    const shared = await connectTo(community, 'didcomm', 'did:webvh:p:shared-none')
    expect(vtiAgent.ownSessionOpen('did:webvh:p:no-session')).toBe(false)
    await expect(vtiAgent.askAs(persona('did:webvh:p:no-session'), community, STATUS, {}, 1000)).rejects.toBeInstanceOf(
      VtiNoOwnSession
    )
    expect(shared.didcomm).toHaveLength(0)
  })

  it('the identity the shared session is signed in as has no own session here: it asks the shared way (control)', async () => {
    const community = 'did:webvh:c:own-shared'
    await connectTo(community, 'didcomm', 'did:webvh:p:shared-self')
    keepOwnSession('did:webvh:p:shared-self', own().session)
    expect(vtiAgent.ownSessionOpen('did:webvh:p:shared-self')).toBe(false)
    await expect(
      vtiAgent.askAs(persona('did:webvh:p:shared-self'), community, STATUS, {}, 1000)
    ).rejects.toBeInstanceOf(VtiNoOwnSession)
  })

  // ZN6C-WNXG (11-18): a directory lookup over an identity's own session was refused in half a second, the refusal was
  // left on the mediator as "the shared session's", and the lookup waited 30 s as "no answer". A member's card never
  // showed, since the lookups after it were never asked.
  describe('a refusal of an ask sent over the identity’s own session', () => {
    const DIRECTORY = 'https://trusttasks.org/spec/vtc/directory/query/0.1'
    const refusalOn = (sent: Sent, code: string) => ({
      id: `urn:uuid:refused-${sent.id}`,
      type: 'https://trusttasks.org/spec/trust-task-error/0.6',
      from: 'did:webvh:c:own-refused',
      thid: sent.id,
      body: {
        type: 'https://trusttasks.org/spec/trust-task-error/0.6',
        threadId: sent.body.threadId,
        payload: { code, message: 'no directory entry for that DID is visible to this caller' },
      },
    })

    it('heard on its listener, is given to the ask at once, as the refusal it is, and said with its code', async () => {
      const community = 'did:webvh:c:own-refused'
      await connectTo(community, 'didcomm', 'did:webvh:p:refused-shared')
      const mine = own()
      keepOwnSession('did:webvh:p:refused-own', mine.session)
      logger.warn.mockClear()
      const asked = vtiAgent
        .communityTaskAs(persona('did:webvh:p:refused-own'), community, DIRECTORY, {})
        .catch((e: unknown) => e)
      await until(() => mine.sent.length === 1)
      expect(vtiAgent.answerFromListener('did:webvh:p:refused-own', refusalOn(mine.sent[0], 'notFound') as never)).toBe(
        'answered'
      )
      const outcome = (await asked) as { name?: string; code?: string }
      expect(outcome).not.toBeInstanceOf(VtiSentNoAnswer)
      expect([outcome.name, outcome.code]).toEqual(['VtiRefusal', 'notFound'])
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringMatching(/refused vtc\/directory\/query: notFound — no directory/)
      )
    })

    it('a problem-report threaded on the ask answers it too', async () => {
      const community = 'did:webvh:c:own-problem'
      await connectTo(community, 'didcomm', 'did:webvh:p:problem-shared')
      const mine = own()
      keepOwnSession('did:webvh:p:problem-own', mine.session)
      const asked = vtiAgent
        .communityTaskAs(persona('did:webvh:p:problem-own'), community, DIRECTORY, {})
        .catch((e: unknown) => e)
      await until(() => mine.sent.length === 1)
      const report = {
        id: 'urn:uuid:problem',
        type: 'https://didcomm.org/report-problem/2.0/problem-report',
        pthid: mine.sent[0].id,
        body: { code: 'e.p.msg.unsupported', comment: 'unsupported message type' },
      }
      expect(vtiAgent.answerFromListener('did:webvh:p:problem-own', report as never)).toBe('answered')
      // The refusal it stands for, not an empty answer.
      expect(((await asked) as { name?: string }).name).toBe('VtiRefusal')
    })

    it('heard on another identity’s listener, it is not that ask’s: it stays where it is (control)', async () => {
      const community = 'did:webvh:c:own-refused-other'
      await connectTo(community, 'didcomm', 'did:webvh:p:refused-shared-2')
      const mine = own()
      keepOwnSession('did:webvh:p:refused-own-2', mine.session)
      const asked = vtiAgent.askAs(persona('did:webvh:p:refused-own-2'), community, DIRECTORY, {}, 300)
      await until(() => mine.sent.length === 1)
      expect(
        vtiAgent.answerFromListener('did:webvh:p:someone-else', refusalOn(mine.sent[0], 'notFound') as never)
      ).toBeUndefined()
      await expect(asked).resolves.toBeUndefined()
    })
  })

  // A listing waits for a listener that is opening (#1114, QG4P-MQCT). What the wait must never end in: the identity's
  // own session used while the shared session is signed in as that identity, two sockets on one DID again.
  describe('a listing’s wait for an own session that is opening', () => {
    const opening = (did: string) => {
      let listens!: () => void
      ownSessionOpening(did, new Promise<void>((resolve) => (listens = resolve)))
      return () => (keepOwnSession(did, own().session), listens())
    }

    it('ends open once the listener listens', async () => {
      await connectTo('did:webvh:c:wait-open', 'didcomm', 'did:webvh:p:wait-shared')
      const listens = opening('did:webvh:p:wait-own')
      const waited = vtiAgent.ownSessionOnceOpen('did:webvh:p:wait-own', 5000)
      listens()
      await expect(waited).resolves.toBe(true)
    })

    it('ends not open when the shared session signed in as that identity during the wait, though its listener listened', async () => {
      await connectTo('did:webvh:c:wait-taken', 'didcomm', 'did:webvh:p:wait-other')
      const listens = opening('did:webvh:p:wait-taken')
      const waited = vtiAgent.ownSessionOnceOpen('did:webvh:p:wait-taken', 5000)
      await connectTo('did:webvh:c:wait-taken', 'didcomm', 'did:webvh:p:wait-taken')
      listens()
      await expect(waited).resolves.toBe(false)
    })

    it('does not wait at all for the identity the shared session is signed in as (control)', async () => {
      await connectTo('did:webvh:c:wait-self', 'didcomm', 'did:webvh:p:wait-self')
      opening('did:webvh:p:wait-self')
      await expect(vtiAgent.ownSessionOnceOpen('did:webvh:p:wait-self', 60_000)).resolves.toBe(false)
    })
  })

  // ee's read of #1022 (11-12): the listener can let go of the identity while its ask is out. A poll signs the shared
  // session in as it (a mediator keeps one live connection per DID, so the listener steps aside), or the listener
  // restarts. The answer then comes on another session; it reaches the ask by its thread, and only once.
  it('handed over mid-ask: the answer on the shared session, now signed in as the identity, answers it, once', async () => {
    const community = 'did:webvh:c:own-handover'
    await connectTo(community, 'didcomm', 'did:webvh:p:shared-handover')
    const mine = own()
    keepOwnSession('did:webvh:p:own-handover', mine.session)
    const asked = vtiAgent.askAs(persona('did:webvh:p:own-handover'), community, STATUS, {}, 1000)
    await until(() => mine.sent.length === 1)
    // The listener steps aside, and the shared session signs in as the identity.
    dropOwnSession('did:webvh:p:own-handover', mine.session)
    const shared = await connectTo(community, 'didcomm', 'did:webvh:p:own-handover')
    const reply = didcommReply(mine.sent[0], STATUS, { status: 'approved' })
    shared.onMessage(reply)
    expect(await asked).toMatchObject({ body: { payload: { status: 'approved' } } })
    // The same answer heard again on the identity's listener answers nothing more.
    expect(vtiAgent.answerFromListener('did:webvh:p:own-handover', reply as never)).not.toBe('answered')
    expect(shared.didcomm).toHaveLength(0)
  })

  it('restarted mid-ask: the answer on the new listener answers it, and later asks go out on the new one', async () => {
    const community = 'did:webvh:c:own-restart'
    await connectTo(community, 'didcomm', 'did:webvh:p:shared-restart')
    const older = own()
    keepOwnSession('did:webvh:p:own-restart', older.session)
    const asked = vtiAgent.askAs(persona('did:webvh:p:own-restart'), community, STATUS, {}, 1000)
    await until(() => older.sent.length === 1)
    // The listener restarts: the new one registers, then the old one's stop lets go of only its own session.
    const newer = own()
    keepOwnSession('did:webvh:p:own-restart', newer.session)
    dropOwnSession('did:webvh:p:own-restart', older.session)
    const reply = didcommReply(older.sent[0], STATUS, { status: 'pending' })
    expect(vtiAgent.answerFromListener('did:webvh:p:own-restart', reply as never)).toBe('answered')
    expect(await asked).toMatchObject({ body: { payload: { status: 'pending' } } })
    expect(vtiAgent.answerFromListener('did:webvh:p:own-restart', reply as never)).not.toBe('answered')
    const again = vtiAgent.askAs(persona('did:webvh:p:own-restart'), community, STATUS, {}, 1000)
    await until(() => newer.sent.length === 1)
    expect(older.sent).toHaveLength(1)
    vtiAgent.answerFromListener('did:webvh:p:own-restart', didcommReply(newer.sent[0], STATUS, {}) as never)
    await again
  })

  // GXT8-STDZ (278.27, 11-17): three identities' own-session listings went out at 19:01:42.137; 13 ms later the shared
  // session signed in as another identity, and its `disconnect` cleared every ask with no waiter, which an ask still
  // being sent has. The three answers came back "answers no ask: dropped" and each listing waited out its clock.
  describe('the shared session signs in as another identity while an own-session ask is still being sent', () => {
    const MEMBERSHIPS = 'https://trusttasks.org/spec/vtc/rooms/memberships/list/0.1'
    /** An own session whose send is held until `release()`: the ask is recorded, and nothing waits on it yet. */
    const held = () => {
      const sent: SentAs[] = []
      let release = () => undefined as void
      const gate = new Promise<void>((resolve) => (release = resolve))
      const session = {
        sendTo: async (_to: string, message: unknown) => {
          sent.push(message as SentAs)
          await gate
        },
      }
      return { sent, session, release: () => release() }
    }

    it("keeps that ask: its answer, heard on the identity's listener, still answers it", async () => {
      const community = 'did:webvh:c:gxt8-own'
      await connectTo(community, 'didcomm', 'did:webvh:p:gxt8-shared-before')
      const mine = held()
      keepOwnSession('did:webvh:p:gxt8-own', mine.session)
      const asked = vtiAgent.askAs(persona('did:webvh:p:gxt8-own'), community, MEMBERSHIPS, {}, 2000)
      await until(() => mine.sent.length === 1)
      // Mid-send, the shared session moves to another identity (the kicked persona's sign-in, in the report).
      await connectTo(community, 'didcomm', 'did:webvh:p:gxt8-shared-after')
      mine.release()
      const reply = didcommReply(mine.sent[0], MEMBERSHIPS, { items: ['kept'] })
      expect(vtiAgent.answerFromListener('did:webvh:p:gxt8-own', reply as never)).toBe('answered')
      expect(await asked).toMatchObject({ body: { payload: { items: ['kept'] } } })
    })

    it("still clears the shared session's own ask that nothing waits on, in the same sign-in (control)", async () => {
      const community = 'did:webvh:c:gxt8-control'
      const before = await connectTo(community, 'didcomm', 'did:webvh:p:gxt8-ctl-before')
      // The shared session's ask: its clock runs out, so nothing waits on it.
      const sharedAsk = vtiAgent.ask(community, MEMBERSHIPS, {}, 1)
      await until(() => before.didcomm.length === 1)
      expect(await sharedAsk).toBeUndefined()
      const mine = held()
      keepOwnSession('did:webvh:p:gxt8-ctl-own', mine.session)
      const asked = vtiAgent.askAs(persona('did:webvh:p:gxt8-ctl-own'), community, MEMBERSHIPS, {}, 2000)
      await until(() => mine.sent.length === 1)
      await connectTo(community, 'didcomm', 'did:webvh:p:gxt8-ctl-after')
      mine.release()
      const sharedReply = didcommReply((before.didcomm as Sent[])[0], MEMBERSHIPS, { items: [] })
      expect(vtiAgent.answerFromListener('did:webvh:p:gxt8-ctl-before', sharedReply as never)).toBe('orphan')
      const ownReply = didcommReply(mine.sent[0], MEMBERSHIPS, { items: ['own'] })
      expect(vtiAgent.answerFromListener('did:webvh:p:gxt8-ctl-own', ownReply as never)).toBe('answered')
      expect(await asked).toMatchObject({ body: { payload: { items: ['own'] } } })
    })
  })

  it("a listener that stops drops only its own session, never a newer one's (control)", () => {
    const older = own().session
    const newer = own().session
    keepOwnSession('did:webvh:p:own-two', older)
    keepOwnSession('did:webvh:p:own-two', newer)
    dropOwnSession('did:webvh:p:own-two', older)
    expect(ownSessionFor('did:webvh:p:own-two')).toBe(newer)
    dropOwnSession('did:webvh:p:own-two', newer)
    expect(ownSessionFor('did:webvh:p:own-two')).toBeUndefined()
  })
})

// BC46-XSQD (279.4, 11-18): nine asks went to one community in the same millisecond; seven were answered within a
// second, two never were, and a rooms listing waited out a clock for one of them. A read left unanswered while the
// community answers something sent after it is asked once more (readReaskSwitch.ts). This treats the symptom: why
// the first got no answer is not known here.
describe('a read left unanswered while the community answers a later ask', () => {
  const MEMBERSHIPS = 'https://trusttasks.org/spec/vtc/rooms/memberships/list/0.1'
  const OFFERS = OFFERS_LIST_TYPES[0]
  const WAIT = 60
  const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
  type SentRead = Sent & { thid: string; from: string; to: string[]; body: Sent['body'] & { id: string } }
  const sentOf = (session: { didcomm: unknown[] }) => session.didcomm as SentRead[]

  beforeEach(() => {
    vtiAgent.readReaskAfterMs = WAIT
    Object.assign(VTI_READ_REASK, { on: true, remoteOff: false })
    logger.warn.mockClear()
  })
  afterEach(() => {
    vtiAgent.readReaskAfterMs = VTI_READ_REASK_AFTER_MS
    Object.assign(VTI_READ_REASK, { on: true, remoteOff: false })
  })

  /** A session to `community`, one read sent and unanswered, then a later read sent and answered. */
  async function overtaken(name: string) {
    const community = `did:webvh:c:reask-${name}`
    const session = await connectTo(community, 'didcomm', `did:webvh:p:reask-${name}`)
    const first = vtiAgent.ask(community, MEMBERSHIPS, {}, 2000)
    await until(() => session.didcomm.length === 1)
    const later = vtiAgent.ask(community, OFFERS, {}, 2000)
    await until(() => session.didcomm.length === 2)
    return { community, session, first, later }
  }

  it('the switch ships on, with three seconds of wait, and reads as off for anything but on true and remoteOff false', () => {
    expect(isReadReaskOn()).toBe(true)
    expect(VTI_READ_REASK_AFTER_MS).toBe(3000)
    for (const [on, remoteOff] of [
      [true, true],
      [false, false],
      [1, false],
      [true, undefined],
    ]) {
      Object.assign(VTI_READ_REASK, { on, remoteOff })
      expect(isReadReaskOn()).toBe(false)
    }
  })

  it('is asked once more, as a new request with its own thread; the answer to that one is the ask’s', async () => {
    const { session, first, later } = await overtaken('second')
    session.onMessage(didcommReply(sentOf(session)[1], OFFERS, { items: [] }))
    await later
    // Answered at once, before the wait is up: not yet.
    expect(session.didcomm).toHaveLength(2)
    await until(() => session.didcomm.length === 3)
    expect(logger.warn.mock.calls.map((call) => String(call[0])).filter((l) => l.includes('asked once more'))).toEqual([
      expect.stringMatching(
        /^vtiAgent: vtc\/rooms\/memberships\/list asked as did:webvh:p:reask-second had no answer in \d+ ms while did:webvh:c:reask-second answered a later ask: asked once more$/
      ),
    ])
    const [one, , again] = sentOf(session)
    expect(again.body.type).toBe(MEMBERSHIPS)
    expect(again.to).toEqual(one.to)
    expect(again.from).toBe(one.from)
    // A new message, a new document and a new thread: an ordinary second request, not the first one twice.
    expect(again.id).not.toBe(one.id)
    expect(again.thid).not.toBe(one.thid)
    expect(again.body.threadId).not.toBe(one.body.threadId)
    expect(again.thid).toBe(again.body.threadId)
    expect(again.body.id).not.toBe(one.body.id)
    session.onMessage(didcommReply(again, MEMBERSHIPS, { items: ['second'] }))
    expect(await first).toMatchObject({ body: { payload: { items: ['second'] } } })
  })

  it('the answer to the first request, coming after all, is the ask’s too', async () => {
    const { session, first, later } = await overtaken('first')
    session.onMessage(didcommReply(sentOf(session)[1], OFFERS, { items: [] }))
    await later
    await until(() => session.didcomm.length === 3)
    session.onMessage(didcommReply(sentOf(session)[0], MEMBERSHIPS, { items: ['first'] }))
    expect(await first).toMatchObject({ body: { payload: { items: ['first'] } } })
  })

  // A reply names its request by the message it answers, by the request document's thread, or by the document's own
  // id (`askAnswered`): each of the second request's three is the ask's, as each of the first's is.
  it.each([
    ['its thread alone, as a reply over TSP does', (again: SentRead) => ({ thread: again.body.threadId })],
    ['its document’s id alone', (again: SentRead) => ({ thread: again.body.id })],
    ['its message alone', (again: SentRead) => ({ thread: again.id })],
  ])('an answer naming the second request by %s is the ask’s', async (_name, by) => {
    const { session, first, later } = await overtaken(`by-${_name.split(' ')[1]}`)
    session.onMessage(didcommReply(sentOf(session)[1], OFFERS, { items: [] }))
    await later
    await until(() => session.didcomm.length === 3)
    const { thread } = by(sentOf(session)[2])
    session.onMessage({
      id: 'urn:uuid:reply-to-the-second',
      type: `${MEMBERSHIPS}#response`,
      thid: thread,
      body: { type: `${MEMBERSHIPS}#response`, payload: { items: ['named'] } },
    })
    expect(await first).toMatchObject({ body: { payload: { items: ['named'] } } })
  })

  it('a wait whose timer fires a moment early by the clock still asks: nothing else would look again', async () => {
    const { session, first, later } = await overtaken('early-timer')
    session.onMessage(didcommReply(sentOf(session)[1], OFFERS, { items: [] }))
    await later
    // From here the clock reads 20 ms behind: when the wait's timer fires, the clock says the wait is not up yet.
    const real = Date.now
    const clock = jest.spyOn(Date, 'now').mockImplementation(() => real() - 20)
    await new Promise((resolve) => setTimeout(resolve, WAIT + 15))
    clock.mockRestore()
    expect(session.didcomm).toHaveLength(3)
    session.onMessage(didcommReply(sentOf(session)[2], MEMBERSHIPS, { items: [] }))
    expect(await first).toBeDefined()
  })

  it('is asked at the later answer, when that comes after the wait is up', async () => {
    const { session, first, later } = await overtaken('late-answer')
    await pause(WAIT + 40)
    // The wait is up and the community has answered nothing: nothing more is sent.
    expect(session.didcomm).toHaveLength(2)
    session.onMessage(didcommReply(sentOf(session)[1], OFFERS, { items: [] }))
    await later
    await until(() => session.didcomm.length === 3)
    session.onMessage(didcommReply(sentOf(session)[2], MEMBERSHIPS, { items: [] }))
    expect(await first).toBeDefined()
  })

  it('once: more later answers ask it no third time', async () => {
    const { community, session, first, later } = await overtaken('once')
    session.onMessage(didcommReply(sentOf(session)[1], OFFERS, { items: [] }))
    await later
    await until(() => session.didcomm.length === 3)
    const more = vtiAgent.ask(community, STATUS, {}, 2000)
    await until(() => session.didcomm.length === 4)
    session.onMessage(didcommReply(sentOf(session)[3], STATUS, { status: 'pending' }))
    await more
    await pause(WAIT + 40)
    expect(session.didcomm).toHaveLength(4)
    session.onMessage(didcommReply(sentOf(session)[2], MEMBERSHIPS, { items: [] }))
    await first
  })

  it('control: a community that answers nothing is not asked more', async () => {
    const { session } = await overtaken('silent')
    await pause(WAIT + 60)
    expect(session.didcomm).toHaveLength(2)
  })

  it('control: an answer to an ask sent EARLIER does not count: the community may be taking them in turn', async () => {
    const community = 'did:webvh:c:reask-earlier'
    const session = await connectTo(community, 'didcomm', 'did:webvh:p:reask-earlier')
    const earlier = vtiAgent.ask(community, OFFERS, {}, 2000)
    await until(() => session.didcomm.length === 1)
    void vtiAgent.ask(community, MEMBERSHIPS, {}, 2000)
    await until(() => session.didcomm.length === 2)
    await pause(WAIT + 20)
    session.onMessage(didcommReply(sentOf(session)[0], OFFERS, { items: [] }))
    await earlier
    await pause(WAIT + 40)
    expect(session.didcomm).toHaveLength(2)
  })

  it('control: another community’s answer does not count', async () => {
    const one = 'did:webvh:c:reask-one'
    const other = 'did:webvh:c:reask-other'
    mockTspVia[other] = 'did:webvh:their-mediator'
    const session = await connectTo(one, 'didcomm', 'did:webvh:p:reask-two-communities')
    void vtiAgent.ask(one, MEMBERSHIPS, {}, 2000)
    await until(() => session.didcomm.length === 1)
    const elsewhere = vtiAgent.ask(other, OFFERS, {}, 2000)
    await until(() => session.didcomm.length === 2)
    session.onMessage(didcommReply(sentOf(session)[1], OFFERS, { items: [] }))
    await elsewhere
    await pause(WAIT + 60)
    expect(session.didcomm).toHaveLength(2)
  })

  it('control: a write is never sent twice, whatever the community answers after it', async () => {
    const community = 'did:webvh:c:reask-write'
    const session = await connectTo(community, 'didcomm', 'did:webvh:p:reask-write')
    void vtiAgent.ask(community, SUBMIT, { vp: {} }, 2000)
    await until(() => session.didcomm.length === 1)
    const later = vtiAgent.ask(community, OFFERS, {}, 2000)
    await until(() => session.didcomm.length === 2)
    session.onMessage(didcommReply(sentOf(session)[1], OFFERS, { items: [] }))
    await later
    await pause(WAIT + 60)
    expect(session.didcomm).toHaveLength(2)
  })

  it('control: a document prepared elsewhere is never made again here', async () => {
    const community = 'did:webvh:c:reask-prepared'
    const session = await connectTo(community, 'didcomm', 'did:webvh:p:reask-prepared')
    const prepared = { id: 'urn:uuid:prepared', type: MEMBERSHIPS, threadId: 'urn:uuid:prepared-thread', payload: {} }
    void vtiAgent.ask(community, MEMBERSHIPS, {}, 2000, prepared)
    await until(() => session.didcomm.length === 1)
    const later = vtiAgent.ask(community, OFFERS, {}, 2000)
    await until(() => session.didcomm.length === 2)
    session.onMessage(didcommReply(sentOf(session)[1], OFFERS, { items: [] }))
    await later
    await pause(WAIT + 60)
    expect(session.didcomm).toHaveLength(2)
  })

  it.each([
    ['remoteOff', { on: true, remoteOff: true }],
    ['on false', { on: false, remoteOff: false }],
  ])('kill: with %s nothing is asked a second time', async (name, values) => {
    Object.assign(VTI_READ_REASK, values)
    const { session, later } = await overtaken(`kill-${name.replace(' ', '-')}`)
    session.onMessage(didcommReply(sentOf(session)[1], OFFERS, { items: [] }))
    await later
    await pause(WAIT + 60)
    expect(session.didcomm).toHaveLength(2)
  })

  it('turned off after the read was sent: it is not asked again', async () => {
    const { session, later } = await overtaken('off-during')
    VTI_READ_REASK.remoteOff = true
    session.onMessage(didcommReply(sentOf(session)[1], OFFERS, { items: [] }))
    await later
    await pause(WAIT + 60)
    expect(session.didcomm).toHaveLength(2)
  })

  it('turned on after the read was sent: that read was set up for none, and is not asked again', async () => {
    VTI_READ_REASK.remoteOff = true
    const { session, later } = await overtaken('on-during')
    VTI_READ_REASK.remoteOff = false
    session.onMessage(didcommReply(sentOf(session)[1], OFFERS, { items: [] }))
    await later
    await pause(WAIT + 60)
    expect(session.didcomm).toHaveLength(2)
  })

  it('a read whose clock has run out is not asked again: nobody waits for it', async () => {
    const community = 'did:webvh:c:reask-gone'
    const session = await connectTo(community, 'didcomm', 'did:webvh:p:reask-gone')
    vtiAgent.readReaskAfterMs = 120
    const first = vtiAgent.ask(community, MEMBERSHIPS, {}, 30)
    await until(() => session.didcomm.length === 1)
    const later = vtiAgent.ask(community, OFFERS, {}, 2000)
    await until(() => session.didcomm.length === 2)
    expect(await first).toBeUndefined()
    await pause(140)
    session.onMessage(didcommReply(sentOf(session)[1], OFFERS, { items: [] }))
    await later
    await pause(60)
    expect(session.didcomm).toHaveLength(2)
  })

  it('the shared session moved to another identity: nothing is sent as the first one over it', async () => {
    const community = 'did:webvh:c:reask-moved'
    const before = await connectTo(community, 'didcomm', 'did:webvh:p:reask-moved-before')
    vtiAgent.readReaskAfterMs = 150
    void vtiAgent.ask(community, MEMBERSHIPS, {}, 2000)
    await until(() => before.didcomm.length === 1)
    const later = vtiAgent.ask(community, OFFERS, {}, 2000)
    await until(() => before.didcomm.length === 2)
    const after = await connectTo(community, 'didcomm', 'did:webvh:p:reask-moved-after')
    // The first identity's listener hears the later ask's answer, as it would after the switch.
    const reply = didcommReply(sentOf(before)[1], OFFERS, { items: [] })
    expect(vtiAgent.answerFromListener('did:webvh:p:reask-moved-before', reply as never)).toBe('answered')
    await later
    await pause(200)
    expect(before.didcomm).toHaveLength(2)
    expect(after.didcomm).toHaveLength(0)
  })

  it('over an identity’s own session: asked once more over that session, as that identity', async () => {
    const community = 'did:webvh:c:reask-own'
    const shared = await connectTo(community, 'didcomm', 'did:webvh:p:reask-own-shared')
    const sent: SentRead[] = []
    const who = 'did:webvh:p:reask-own'
    keepOwnSession(who, { sendTo: async (_to: string, message: unknown) => void sent.push(message as never) })
    try {
      const first = vtiAgent.askAs(persona(who), community, MEMBERSHIPS, {}, 2000)
      await until(() => sent.length === 1)
      const later = vtiAgent.askAs(persona(who), community, OFFERS, {}, 2000)
      await until(() => sent.length === 2)
      expect(vtiAgent.answerFromListener(who, didcommReply(sent[1], OFFERS, { items: [] }) as never)).toBe('answered')
      await later
      await until(() => sent.length === 3)
      expect(sent[2].from).toBe(who)
      expect(sent[2].body.type).toBe(MEMBERSHIPS)
      expect(shared.didcomm).toHaveLength(0)
      expect(vtiAgent.answerFromListener(who, didcommReply(sent[2], MEMBERSHIPS, { items: [] }) as never)).toBe(
        'answered'
      )
      expect(await first).toBeDefined()
    } finally {
      dropAllOwnSessions()
    }
  })

  it('control: the shared session’s answers do not count for an ask over an identity’s own session', async () => {
    const community = 'did:webvh:c:reask-own-ctl'
    const shared = await connectTo(community, 'didcomm', 'did:webvh:p:reask-own-ctl-shared')
    const sent: Sent[] = []
    const who = 'did:webvh:p:reask-own-ctl'
    keepOwnSession(who, { sendTo: async (_to: string, message: unknown) => void sent.push(message as never) })
    try {
      void vtiAgent.askAs(persona(who), community, MEMBERSHIPS, {}, 2000)
      await until(() => sent.length === 1)
      const later = vtiAgent.ask(community, OFFERS, {}, 2000)
      await until(() => shared.didcomm.length === 1)
      shared.onMessage(didcommReply(sentOf(shared)[0], OFFERS, { items: [] }))
      await later
      await pause(WAIT + 60)
      expect(sent).toHaveLength(1)
    } finally {
      dropAllOwnSessions()
    }
  })
})

// What a report needs to tell an ask that went out and was not answered from one that never left (BC46-XSQD).
describe('what the log says of an ask over the shared session', () => {
  const MEMBERSHIPS = 'https://trusttasks.org/spec/vtc/rooms/memberships/list/0.1'
  const PCS_HIDDEN = 'https://trusttasks.org/spec/vtc/vetting/pcs-challenge/0.1'
  const said = (level: 'info' | 'warn') => logger[level].mock.calls.map((call) => String(call[0]))
  /** A DID as a log line names it (didPrefix). */
  const short = (did: string) => (did.length > 24 ? `${did.slice(0, 24)}…` : did)
  beforeEach(() => {
    logger.info.mockClear()
    logger.warn.mockClear()
  })

  it('says it went out, the task and as which identity, by prefix', async () => {
    const community = 'did:webvh:c:said-sent'
    const session = await connectTo(community, 'didcomm', 'did:webvh:p:said-sent')
    void vtiAgent.ask(community, MEMBERSHIPS, {}, 50)
    await until(() => session.didcomm.length === 1)
    expect(said('info')).toContain(
      `vtiAgent: vtc/rooms/memberships/list asked as ${short('did:webvh:p:said-sent')} over the shared session`
    )
    await new Promise((resolve) => setTimeout(resolve, 80))
  })

  it('says when its clock ran out with no answer', async () => {
    const community = 'did:webvh:c:said-unanswered'
    const session = await connectTo(community, 'didcomm', 'did:webvh:p:said-unanswered')
    const asked = vtiAgent.ask(community, MEMBERSHIPS, {}, 40)
    await until(() => session.didcomm.length === 1)
    expect(await asked).toBeUndefined()
    expect(said('warn')).toContain(
      `vtiAgent: vtc/rooms/memberships/list asked as ${short('did:webvh:p:said-unanswered')} over the shared session had no answer when its 40 ms clock ran out`
    )
  })

  it('says how long the wait really was when the app was not running for part of it', async () => {
    const community = 'did:webvh:c:said-slept'
    const session = await connectTo(community, 'didcomm', 'did:webvh:p:said-slept')
    const real = Date.now
    const asked = vtiAgent.ask(community, MEMBERSHIPS, {}, 40)
    await until(() => session.didcomm.length === 1)
    // The clock stops with the app in the background: by the time it fires, 39 s more have passed.
    const now = jest.spyOn(Date, 'now').mockImplementation(() => real() + 39_000)
    expect(await asked).toBeUndefined()
    now.mockRestore()
    const line = said('warn').find((l) => l.includes('had no answer when its 40 ms clock ran out'))
    expect(line).toMatch(/, 39\d{3} ms after the wait began \(the app was not running for about 3[89]\d{3} ms of it\)$/)
  })

  it('control: an answered ask says nothing of a clock', async () => {
    const community = 'did:webvh:c:said-answered'
    const session = await connectTo(community, 'didcomm', 'did:webvh:p:said-answered')
    const asked = vtiAgent.ask(community, MEMBERSHIPS, {}, 500)
    await until(() => session.didcomm.length === 1)
    session.onMessage(didcommReply((session.didcomm as Sent[])[0], MEMBERSHIPS, { items: [] }))
    await asked
    // Its own identity's lines only: an earlier row's unanswered ask may run out its clock meanwhile.
    expect(said('warn').filter((l) => l.includes('clock ran out') && l.includes('said-answered'))).toEqual([])
  })

  it('names no identity for a hidden-vetting task', async () => {
    const community = 'did:webvh:c:said-hidden'
    const session = await connectTo(community, 'didcomm', 'did:webvh:p:said-hidden')
    const asked = vtiAgent.ask(community, PCS_HIDDEN, {}, 40)
    await until(() => session.didcomm.length === 1)
    expect(await asked).toBeUndefined()
    const lines = [...said('info'), ...said('warn')].filter((l) => l.includes('asked'))
    expect(lines.length).toBeGreaterThan(0)
    expect(lines.filter((l) => l.includes('said-hidden'))).toEqual([])
  })
})
