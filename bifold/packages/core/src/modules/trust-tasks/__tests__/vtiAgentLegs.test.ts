/**
 * The community leg's session rules, found on 2026-09-22:
 *  - a greeting (XRFI) introduces one identity to one peer — a new persona
 *    must greet a community an earlier persona already greeted;
 *  - two connects for the same persona make one socket, not two;
 *  - a persona's session rides the mediator its own DID document names;
 *  - a community that advertises TSP and does not answer it is asked again
 *    over DIDComm (the VTA Farm's first-vtc, VTI-Q15).
 */
const mockSessions: Array<{ did: string; mediator: string; onMessage: (m: unknown) => void; tsp: Uint8Array[]; didcomm: unknown[] }> = []
const mockGreetings: Array<{ from: string; to: string }> = []
const mockAdvertised: Record<string, string | undefined> = {}
const mockTspVia: Record<string, string | undefined> = {}
const mockPacked: Record<string, unknown>[] = []

jest.mock('@bifold/trust-tasks', () => ({
  tsp: { CODEC_FORMS_RELATIONSHIPS: true },
  TRUST_TASK_V2_ENVELOPE_TYPE: 'https://trusttasks.org/binding/didcomm/0.1/envelope',
}))
// Stands in for eddsa-jcs-2022: records who signed, with which keys.
jest.mock('../documentProof', () => ({
  signDocumentProof: jest.fn(
    async (_a: unknown, doc: Record<string, unknown>, did: string, o: { kmsKeyId?: string; verificationMethodId?: string }) => ({
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
    constructor(_agent: unknown, identity: { did: string }, mediator: { did: string }, opts: { onMessage: (m: unknown) => void }) {
      this.record = { did: identity.did, mediator: mediator.did, onMessage: opts.onMessage, tsp: [], didcomm: [] }
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

import { vtiAgent } from '../module/vtiAgent'

const logger = { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() }
const agent = { config: { logger } } as never
const persona = (did: string) =>
  ({
    did,
    communityDid: 'did:webvh:c:host',
    kmsKeyIds: { keyAgreement: 'ka', signing: 'sig' },
    vtaKeyIds: { signing: `${did}#key-0`, keyAgreement: `${did}#key-1` },
  }) as never

jest.setTimeout(30000)

beforeEach(async () => {
  await vtiAgent.disconnect()
  mockSessions.length = 0
  mockGreetings.length = 0
  mockPacked.length = 0
  for (const k of Object.keys(mockAdvertised)) delete mockAdvertised[k]
  for (const k of Object.keys(mockTspVia)) delete mockTspVia[k]
})

describe('the community leg', () => {
  it('greets a community again as a new persona', async () => {
    const community = 'did:webvh:c:greets'
    // The community answers over TSP, so this is not the DIDComm fallback.
    const answerTsp = () => {
      const session = mockSessions.at(-1)!
      const timer = setInterval(() => {
        if (session.tsp.length >= 2) {
          clearInterval(timer)
          session.onMessage({ type: 'https://t/ask/0.1#response', body: {} })
        }
      }, 5)
    }
    await vtiAgent.connect(agent, 'did:peer:lab', { persona: persona('did:webvh:p:old') })
    answerTsp()
    await vtiAgent.ask(community, 'https://t/ask/0.1', {}, 2000)
    await vtiAgent.connect(agent, 'did:peer:lab', { persona: persona('did:webvh:p:new') })
    answerTsp()
    await vtiAgent.ask(community, 'https://t/ask/0.1', {}, 2000)
    expect(mockGreetings).toEqual([
      { from: 'did:webvh:p:old', to: community },
      { from: 'did:webvh:p:new', to: community },
    ])
  })

  it('makes one session when two callers connect the same persona at once', async () => {
    const p = persona('did:webvh:p:one')
    await Promise.all([
      vtiAgent.connect(agent, 'did:peer:lab', { persona: p }),
      vtiAgent.connect(agent, 'did:peer:lab', { persona: p }),
    ])
    expect(mockSessions.filter((s) => s.did === 'did:webvh:p:one')).toHaveLength(1)
  })

  it("rides the persona's own mediator, and the configured one only as a fallback", async () => {
    mockAdvertised['did:webvh:p:farm'] = 'did:webvh:farm-mediator'
    await vtiAgent.connect(agent, 'did:peer:lab', { persona: persona('did:webvh:p:farm') })
    expect(mockSessions.at(-1)?.mediator).toBe('did:webvh:farm-mediator')

    await vtiAgent.connect(agent, 'did:peer:lab', { persona: persona('did:webvh:p:plain') })
    expect(mockSessions.at(-1)?.mediator).toBe('did:peer:lab')

    await expect(vtiAgent.connect(agent, undefined, { persona: persona('did:webvh:p:nowhere') })).rejects.toThrow(
      /no mediator/
    )
  })

  it('asks over DIDComm when a community does not answer TSP, and stays on DIDComm', async () => {
    const COMMUNITY = 'did:webvh:c:silent-on-tsp'
    await vtiAgent.connect(agent, 'did:peer:lab', { persona: persona('did:webvh:p:x') })
    const session = mockSessions.at(-1)!
    const asked = vtiAgent.ask(COMMUNITY, 'https://t/manifest/0.2', {}, 30)
    // Answer only what arrives over DIDComm.
    const reply = setInterval(() => {
      if (session.didcomm.length) {
        clearInterval(reply)
        session.onMessage({ type: 'https://t/manifest/0.2#response', body: { payload: { criteria: [] } } })
      }
    }, 5)
    const answer = await asked
    expect(answer).toMatchObject({ type: 'https://t/manifest/0.2#response' })
    expect(session.tsp.length).toBeGreaterThan(0)
    expect(session.didcomm).toHaveLength(1)

    // The next ask goes straight to DIDComm.
    const tspBefore = session.tsp.length
    await vtiAgent.ask(COMMUNITY, 'https://t/submit/0.2', {}, 20)
    expect(session.tsp.length).toBe(tspBefore)
    expect(session.didcomm).toHaveLength(2)
  })

  it('asks a community behind another mediator over DIDComm from the start', async () => {
    const community = 'did:webvh:c:other-mediator'
    mockTspVia[community] = 'did:webvh:their-mediator'
    await vtiAgent.connect(agent, 'did:peer:lab', { persona: persona('did:webvh:p:y') })
    const session = mockSessions.at(-1)!
    const timer = setInterval(() => {
      if (session.didcomm.length) {
        clearInterval(timer)
        session.onMessage({ type: 'https://t/manifest/0.2#response', body: {} })
      }
    }, 5)
    const answer = await vtiAgent.ask(community, 'https://t/manifest/0.2', {}, 2000)
    expect(answer).toMatchObject({ type: 'https://t/manifest/0.2#response' })
    expect(session.tsp).toHaveLength(0)
    expect(session.didcomm).toHaveLength(1)
  })

  it('keeps TSP for a community on our own mediator', async () => {
    const community = 'did:webvh:c:same-mediator'
    mockTspVia[community] = 'did:peer:lab'
    await vtiAgent.connect(agent, 'did:peer:lab', { persona: persona('did:webvh:p:z') })
    const session = mockSessions.at(-1)!
    const timer = setInterval(() => {
      if (session.tsp.length >= 2) {
        clearInterval(timer)
        session.onMessage({ type: 'https://t/manifest/0.2#response', body: {} })
      }
    }, 5)
    await vtiAgent.ask(community, 'https://t/manifest/0.2', {}, 2000)
    expect(session.tsp.length).toBeGreaterThanOrEqual(2)
    expect(session.didcomm).toHaveLength(0)
  })
})

/**
 * vti #1687 (VTI-42): a VTC takes a Trust Task over DIDComm only in the
 * binding envelope. vti #1672: it refuses a task whose spec declares the proof
 * REQUIRED without one, whatever the carriage.
 */
describe('what a community is asked, and how', () => {
  const ENVELOPE = 'https://trusttasks.org/binding/didcomm/0.1/envelope'
  const SUBMIT = 'https://trusttasks.org/spec/vtc/join-requests/submit/0.2'
  const MANIFEST = 'https://trusttasks.org/spec/vtc/join-requests/manifest/0.2'
  const WITHDRAW = 'https://trusttasks.org/spec/vtc/join-requests/withdraw/0.1'
  const SUPPLEMENT = 'https://trusttasks.org/spec/vtc/join-requests/supplement/0.1'
  const community = 'did:webvh:c:enveloped'

  /** Connect as a persona on DIDComm (community behind another mediator) and answer the first DIDComm send. */
  async function askOverDidcomm(type: string, reply: (sent: { thid?: string }) => unknown, personaDid = 'did:webvh:p:env') {
    mockTspVia[community] = 'did:webvh:their-mediator'
    await vtiAgent.connect(agent, 'did:peer:lab', { persona: persona(personaDid) })
    const session = mockSessions.at(-1)!
    const timer = setInterval(() => {
      if (session.didcomm.length) {
        clearInterval(timer)
        session.onMessage(reply(session.didcomm[0] as { thid?: string }))
      }
    }, 5)
    const answer = await vtiAgent.ask(community, type, { hello: 'world' }, 2000)
    return { answer, sent: session.didcomm[0] as Record<string, unknown> }
  }

  it('sends the task in the binding envelope, with the document as its body', async () => {
    const { sent } = await askOverDidcomm(MANIFEST, () => ({ type: `${MANIFEST}#response`, body: {} }))
    expect(sent.type).toBe(ENVELOPE)
    expect(sent.body).toMatchObject({
      type: MANIFEST,
      issuer: 'did:webvh:p:env',
      recipient: community,
      payload: { hello: 'world' },
    })
    expect(typeof (sent.body as Record<string, unknown>).issuedAt).toBe('string')
    expect((sent.body as Record<string, unknown>).threadId).toBe(sent.thid)
  })

  it('signs a task whose spec requires a proof, as the persona under its own key', async () => {
    // A fresh persona per task: a reconnect as the same one reuses the session, whose first send is the one read.
    for (const [i, type] of [SUBMIT, WITHDRAW, SUPPLEMENT].entries()) {
      const who = `did:webvh:p:signs-${i}`
      const { sent } = await askOverDidcomm(type, () => ({ type: `${type}#response`, body: {} }), who)
      expect((sent.body as Record<string, unknown>).type).toBe(type)
      expect((sent.body as Record<string, unknown>).proof).toEqual({
        signer: who,
        kmsKeyId: 'sig',
        verificationMethod: `${who}#key-0`,
      })
    }
  })

  it('leaves a task unsigned when its spec declares no proof', async () => {
    const { sent } = await askOverDidcomm(MANIFEST, () => ({ type: `${MANIFEST}#response`, body: {} }))
    expect((sent.body as Record<string, unknown>).proof).toBeUndefined()
  })

  it('reads a reply typed as the document, as a VTC sends today', async () => {
    const { answer } = await askOverDidcomm(SUBMIT, () => ({
      type: `${SUBMIT}#response`,
      body: { type: `${SUBMIT}#response`, payload: { status: 'pending' } },
    }))
    expect(answer).toMatchObject({ type: `${SUBMIT}#response`, body: { payload: { status: 'pending' } } })
  })

  it('reads a reply in the envelope, as binding §5 has a VTC send it', async () => {
    const { answer } = await askOverDidcomm(SUBMIT, () => ({
      type: ENVELOPE,
      body: { type: `${SUBMIT}#response`, payload: { status: 'pending' } },
    }))
    expect(answer).toMatchObject({ type: `${SUBMIT}#response`, body: { payload: { status: 'pending' } } })
  })

  it('reads a refusal in the envelope as a refusal', async () => {
    const ERROR = 'https://trusttasks.org/spec/trust-task-error/0.1'
    const { answer } = await askOverDidcomm(SUBMIT, () => ({
      type: ENVELOPE,
      body: { type: ERROR, payload: { code: 'proofRequired' } },
    }))
    expect(answer).toMatchObject({ type: ERROR })
  })

  it("reads a DIDComm problem-report threaded on the request as the community's refusal", async () => {
    const { answer } = await askOverDidcomm(SUBMIT, (sent) => ({
      type: 'https://didcomm.org/report-problem/2.0/problem-report',
      thid: (sent as { id?: string }).id,
      body: { code: 'e.p.msg.bad-request', comment: 'unsupported message type' },
    }))
    expect(answer).toMatchObject({
      type: 'https://trusttasks.org/spec/trust-task-error/problem-report',
      body: { payload: { code: 'e.p.msg.bad-request', message: 'unsupported message type' } },
    })
  })

  it('does not take a problem-report about some other message as the answer', async () => {
    mockTspVia[community] = 'did:webvh:their-mediator'
    await vtiAgent.connect(agent, 'did:peer:lab', { persona: persona('did:webvh:p:other-report') })
    const session = mockSessions.at(-1)!
    const timer = setInterval(() => {
      if (session.didcomm.length) {
        clearInterval(timer)
        session.onMessage({
          type: 'https://didcomm.org/report-problem/2.0/problem-report',
          thid: 'urn:uuid:not-this-request',
          body: { code: 'e.p.msg.bad-request' },
        })
      }
    }, 5)
    expect(await vtiAgent.ask(community, SUBMIT, {}, 200)).toBeUndefined()
  })

  it('carries the same signed document over TSP', async () => {
    const same = 'did:webvh:c:tsp-signed'
    mockTspVia[same] = 'did:peer:lab'
    await vtiAgent.connect(agent, 'did:peer:lab', { persona: persona('did:webvh:p:tsp') })
    const session = mockSessions.at(-1)!
    const timer = setInterval(() => {
      if (session.tsp.length >= 2) {
        clearInterval(timer)
        session.onMessage({ type: `${SUBMIT}#response`, body: {} })
      }
    }, 5)
    await vtiAgent.ask(same, SUBMIT, { vp: {} }, 2000)
    expect(mockPacked.at(-1)).toMatchObject({
      type: SUBMIT,
      issuer: 'did:webvh:p:tsp',
      recipient: same,
      proof: { signer: 'did:webvh:p:tsp' },
    })
  })

  it('sends unsigned, and says so, when the session is not a persona', async () => {
    mockTspVia[community] = 'did:webvh:their-mediator'
    await vtiAgent.connect(agent, 'did:peer:lab')
    const session = mockSessions.at(-1)!
    logger.warn.mockClear()
    await vtiAgent.ask(community, SUBMIT, {}, 20)
    const sent = session.didcomm[0] as Record<string, unknown>
    expect(sent.type).toBe(ENVELOPE)
    expect((sent.body as Record<string, unknown>).proof).toBeUndefined()
    expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/needs a proof/))
  })
})
