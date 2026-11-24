/**
 * What the agent client does with a message its session did not take, said by what happens and not by which function
 * does it: a message nobody asked for goes on to whoever acts on it (a room signal reaches its listener; it is not
 * listed as an approval, also when it is threaded to an ask that is no longer waiting).
 *
 * The trusted approvers feature once added a group here for a decision on a request relayed from another person's
 * agent, the one ask this phone made that was answered through this path; it went with the feature.
 */
import { forgetAllVersions } from '../module/taskVersions'
import { VTA_TASK } from '../module/VtaClient'
import { VtaAgentController } from '../module/vtaAgent'

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
const ENVELOPE = 'https://didcomm.org/trust-task/2.0/envelope'

type Internals = { current?: Record<string, unknown>; inbound(plaintext: unknown): void }

/** The agent the phone runs on: nothing in these rows reads it. */
const jordanPhone = () => ({ config: { logger: { info: jest.fn(), warn: jest.fn() } } }) as never

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

beforeEach(() => {
  forgetAllVersions()
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
