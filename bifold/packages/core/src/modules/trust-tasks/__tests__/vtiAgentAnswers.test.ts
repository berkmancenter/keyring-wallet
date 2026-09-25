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

import { plainError } from '../screens/plainError'
import { VTI_ANSWER_HOLD_MS, VtiSentNoAnswer, isVtiReadTask, vtiAgent } from '../module/vtiAgent'

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
  mockSessions.length = 0
  mockGreetings.length = 0
  mockPacked.length = 0
  for (const k of Object.keys(mockAdvertised)) delete mockAdvertised[k]
  for (const k of Object.keys(mockTspVia)) delete mockTspVia[k]
})

afterEach(() => {
  jest.restoreAllMocks()
  vtiAgent.answerTimeoutMs = 30000
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
    expect([MANIFEST, STATUS].filter(isVtiReadTask)).toEqual([MANIFEST, STATUS])
    expect([SUBMIT, SUPPLEMENT, WITHDRAW, SELF_REMOVE, PROFILE, 'https://t/unknown/0.1'].filter(isVtiReadTask)).toEqual(
      []
    )
  })
})

describe('T3: a late answer is kept for the next caller', () => {
  it('gives a retried submit the answer that came after its clock ran out, without sending it again', async () => {
    const community = 'did:webvh:c:late-submit'
    const session = await connectTo(community, 'didcomm', 'did:webvh:p:late-submit')
    const inbox = jest.fn()
    const stop = vtiAgent.onInbound(inbox)
    vtiAgent.answerTimeoutMs = 50
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
