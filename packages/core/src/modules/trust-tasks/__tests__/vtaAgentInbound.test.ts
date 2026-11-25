/**
 * What the agent client does with a message its session did not take, said by what happens and not by which function
 * does it: a reply to something this phone asked is that ask's answer and never a request; a message nobody asked for
 * goes on to whoever acts on it.
 *
 * The one ask this phone makes that is answered through this path is a decision on a request relayed from another
 * person's agent (the phone's own agent's answers come back through the session). That ask goes with the trusted
 * approvers feature; the first describe below goes with it, the second does not.
 */
import { ROLE_OFFER_PROMPT } from '../approverRole'
import { TRUSTED_APPROVERS_REMOTE_OFF, setTrustedApproversEnabled } from '../module/trustedApproversFlag'
import { forgetAllVersions } from '../module/taskVersions'
import { VTA_TASK } from '../module/VtaClient'
import { VtaAgentController } from '../module/vtaAgent'
import { memoryGenericRecords } from '../../../../__tests__/modules/vrc/fixtures/memoryGenericRecords'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))
jest.mock('@bifold/trust-tasks', () => ({
  ...jest.requireActual('@bifold/trust-tasks'),
  signDocumentProof: async (_agent: unknown, doc: Record<string, unknown>, did: string) => ({
    ...doc,
    proof: { by: did },
  }),
}))
jest.mock('../module/vtaReplyProof', () => ({
  checkVtaReply: async (_agent: unknown, body: Record<string, unknown>, vtaDid: string) => {
    const by = (body.proof as { by?: string } | undefined)?.by
    return by === vtaDid ? { kind: 'verified', signer: by } : { kind: 'unsigned' }
  },
}))

const SAM_AGENT = 'did:webvh:sams-agent.example'
const JORDAN_AGENT = 'did:webvh:jordans-agent.example'
const JORDAN = 'did:peer:2.jordans-phone'
const DIGEST = 'zQmDigestDigestDigestDigest'
const ENVELOPE = 'https://didcomm.org/trust-task/2.0/envelope'
const flush = () => new Promise((resolve) => setImmediate(resolve))

type Internals = { current?: Record<string, unknown>; inbound(plaintext: unknown): void }

/** Jordan's phone, which said yes to being Sam's approver. */
function jordanPhone() {
  const store = memoryGenericRecords()
  void store.save({
    content: {
      open: false,
      connectionId: 'c-sam',
      asker: 'Sam',
      agentDid: SAM_AGENT,
      actions: ['shareCredential'],
      request: {},
      receivedAt: new Date().toISOString(),
      answered: 'accepted',
      answeredAs: JORDAN,
    },
    tags: { recordType: ROLE_OFFER_PROMPT, connectionId: 'c-sam' },
  })
  return { genericRecords: store, config: { logger: { info: jest.fn(), warn: jest.fn() } } } as never
}

const consentRequest = {
  id: 'm-1',
  type: ENVELOPE,
  from: SAM_AGENT,
  body: {
    id: 'req-1',
    type: VTA_TASK.consentRequest,
    issuer: SAM_AGENT,
    recipient: JORDAN,
    payload: {
      challenge: 'c'.repeat(32),
      taskType: 'https://trusttasks.org/spec/vault/credentials/present/0.1',
      payloadDigest: DIGEST,
      requester: 'did:peer:2.sams-phone',
      approverSet: 'keyring-trusted-approvers',
      minApprovals: 1,
      expiresAt: '2099-01-01T00:00:00Z',
    },
  },
}

/** A phone whose sent messages are answered by `answer`, the answer arriving through the session's inbound. */
function phone(answer: (sent: Record<string, unknown>) => Record<string, unknown> | undefined) {
  const vta = new VtaAgentController()
  vta.configure({
    decisionDeadlineMs: 300,
    confirmOwner: jest.fn(async () => ({ ok: true as const })),
    checkConsentRequest: async () => ({ ok: true }),
  } as never)
  const sent: Record<string, unknown>[] = []
  const internals = vta as unknown as Internals
  const client = {
    managerDid: JORDAN,
    decideConsent: jest.fn(async () => ({ status: 'granted' })),
    sendTo: jest.fn(async (_peer: string, plaintext: Record<string, unknown>) => {
      sent.push(plaintext)
      const reply = answer(plaintext)
      if (reply) setImmediate(() => internals.inbound(reply))
    }),
  }
  internals.current = { client, vtaDid: JORDAN_AGENT, agent: jordanPhone(), store: {} }
  return { vta, internals, sent }
}

const replyTo = (to: Record<string, unknown>, from = SAM_AGENT) => ({
  id: 'r',
  type: ENVELOPE,
  from,
  thid: to.thid,
  body: {
    type: `${(to.body as { type: string }).type}#response`,
    payload: { status: 'recorded' },
    proof: { by: from },
  },
})

beforeEach(() => {
  TRUSTED_APPROVERS_REMOTE_OFF.off = false
  setTrustedApproversEnabled(true)
  forgetAllVersions()
})
afterAll(() => setTrustedApproversEnabled(false))

describe('a reply to an ask this phone made', () => {
  it('resolves that ask, and is not listed as a request (control: with no reply the ask is not answered)', async () => {
    const answered = phone((to) => replyTo(to))
    answered.internals.inbound(consentRequest)
    await flush()
    await flush()
    await answered.vta.decide('req-1', 'deny')
    expect(answered.vta.getState().approvals).toHaveLength(1)
    expect(answered.vta.getState().approvals[0]).toMatchObject({ status: 'denied' })

    const silent = phone(() => undefined)
    silent.internals.inbound(consentRequest)
    await flush()
    await flush()
    await expect(silent.vta.decide('req-1', 'deny')).rejects.toThrow(/did not take the decision/)
    expect(silent.vta.getState().approvals[0]).toMatchObject({ status: 'failed' })
  })

  it('does not resolve it when it comes from someone else', async () => {
    const { vta, internals } = phone((to) => replyTo(to, 'did:webvh:impostor.example'))
    internals.inbound(consentRequest)
    await flush()
    await flush()
    await expect(vta.decide('req-1', 'deny')).rejects.toThrow(/did not take the decision/)
  })
})

describe('a message nobody asked for', () => {
  it("is handed on: a request from the phone's own agent is listed, a room signal reaches its listener", async () => {
    const vta = new VtaAgentController()
    const internals = vta as unknown as Internals
    const heard = jest.fn()
    vta.onRoomSignal(heard)
    const payload = { roomId: 'did:webvh:room:a', member: 'did:key:me', host: 'did:webvh:host', latestVersion: 4 }
    internals.inbound({
      id: 'p',
      type: ENVELOPE,
      from: JORDAN_AGENT,
      // Threaded to nothing this phone asked.
      thid: 'not-an-ask-of-ours',
      body: { type: VTA_TASK.roomsKeysChanged, payload },
    })
    expect(heard).toHaveBeenCalledWith(payload)
    expect(vta.getState().approvals).toEqual([])
  })

  it('is handed on even when it is threaded to an ask that is not waiting, or from another sender while one is', async () => {
    const { vta, internals } = phone(() => undefined)
    const heard = jest.fn()
    vta.onRoomSignal(heard)
    internals.inbound({
      id: 'late',
      type: ENVELOPE,
      from: SAM_AGENT,
      thid: 'a-decision-long-since-answered',
      body: { type: VTA_TASK.roomsKeysChanged, payload: { roomId: 'r' } },
    })
    expect(heard).toHaveBeenCalledWith({ roomId: 'r' })
  })
})
