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
      this.open = true
    }
    async stop() {
      this.open = false
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

import { DeviceEventEmitter } from 'react-native'

import { plainError } from '../screens/plainError'
import {
  VTI_ANSWER_HOLD_MS,
  VTI_BACKLOG_GRACE_MS,
  VTI_SIGNIN_ONLINE_WITHIN_MS,
  VTI_SIGNIN_REST_FIRST_MS,
  VTI_SIGNIN_REST_MAX_MS,
  VtiSentNoAnswer,
  isVtiReadTask,
  signInRestUntil,
  vtiAgent,
} from '../module/vtiAgent'
import { fakeAgent } from '../../../../__tests__/helpers/cardVault'
import { VTI_JOIN_STATUS_LATE_EVENT } from '../module/communityChanged'
import { OFFERS_LIST_TYPES } from '../../rooms/real/wire'

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
    ['a refusal', orphanOf('https://trusttasks.org/spec/trust-task-error/0.1')],
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
