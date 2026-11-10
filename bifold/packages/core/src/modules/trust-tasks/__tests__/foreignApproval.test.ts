/**
 * Approving for someone else's agent (trusted-approver plan §9, T2). Jordan's phone said yes to being Sam's approver;
 * Sam's agent now asks it about a task. Shown only from an agent this phone approves for, checked against THAT agent;
 * the decision goes to that agent, signed and sealed as this phone's manager DID; and only that agent's own reply,
 * threaded to the decision and proven, answers it.
 */
import { ROLE_OFFER_PROMPT } from '../approverRole'
import {
  foreignDecisionTypes,
  approvedAgentOf,
  forgetForeignWaiters,
  sendForeignDecision,
  takeForeignReply,
  type ForeignSendPort,
} from '../module/foreignApproval'
import { forgetAllVersions } from '../module/taskVersions'
import { TRUSTED_APPROVERS_REMOTE_OFF, setTrustedApproversEnabled } from '../module/trustedApproversFlag'
import { VTA_TASK } from '../module/VtaClient'
import { VtaAgentController } from '../module/vtaAgent'
import { requestLine } from '../screens/requestWords'
import { memoryGenericRecords } from '../../../../__tests__/modules/vrc/fixtures/memoryGenericRecords'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

// A stand-in signature: names the DID that made it and the purpose it was made for.
jest.mock('@bifold/trust-tasks', () => ({
  ...jest.requireActual('@bifold/trust-tasks'),
  signDocumentProof: async (
    _agent: unknown,
    doc: Record<string, unknown>,
    did: string,
    opts?: { proofPurpose?: string }
  ) => ({
    ...doc,
    proof: { by: did, proofPurpose: opts?.proofPurpose },
  }),
}))
// A reply is the asking agent's only when its stand-in proof names that agent.
jest.mock('../module/vtaReplyProof', () => ({
  checkVtaReply: async (_agent: unknown, body: Record<string, unknown>, vtaDid: string) => {
    const by = (body.proof as { by?: string } | undefined)?.by
    if (!by) return { kind: 'unsigned' }
    return by === vtaDid ? { kind: 'verified', signer: by } : { kind: 'wrongSigner', signer: by }
  },
}))

const SAM_AGENT = 'did:webvh:sams-agent.example'
const JORDAN_AGENT = 'did:webvh:jordans-agent.example'
const JORDAN = 'did:peer:2.jordans-phone'
const DIGEST = 'zQmDigestDigestDigestDigest'
const flush = () => new Promise((resolve) => setImmediate(resolve))

/** Jordan's phone, having answered Sam's offer (`answered`), or not at all. */
function jordanPhone(answered?: 'accepted' | 'declined') {
  const store = memoryGenericRecords()
  if (answered)
    void store.save({
      content: {
        open: false,
        connectionId: 'c-sam',
        asker: 'Sam',
        agentDid: SAM_AGENT,
        actions: ['shareCredential'],
        request: {},
        receivedAt: new Date().toISOString(),
        answered,
        ...(answered === 'accepted' ? { answeredAs: JORDAN } : {}),
      },
      tags: { recordType: ROLE_OFFER_PROMPT, connectionId: 'c-sam' },
    })
  return { genericRecords: store, config: { logger: { info: jest.fn(), warn: jest.fn() } } } as never
}

/** A session that sends through `sent`, and has Sam's agent answer with `answer(sent)` if given. */
function session(answer?: (sent: Record<string, unknown>) => Record<string, unknown> | undefined) {
  const sent: Record<string, unknown>[] = []
  const port: ForeignSendPort = {
    agent: {} as never,
    managerDid: JORDAN,
    sendTo: jest.fn(async (_peer: string, plaintext: unknown) => {
      sent.push(plaintext as Record<string, unknown>)
      const reply = answer?.(plaintext as Record<string, unknown>)
      if (reply) setImmediate(() => takeForeignReply(reply as never))
    }),
  }
  return { port, sent }
}

/** Sam's agent's reply to the decision envelope `to`, threaded and signed by `by`. */
const replyTo = (to: Record<string, unknown>, by = SAM_AGENT, body: Record<string, unknown> = {}) => ({
  id: 'r',
  type: 'https://didcomm.org/trust-task/2.0/envelope',
  from: by,
  thid: to.thid,
  body: {
    type: `${(to.body as { type: string }).type}#response`,
    payload: { status: 'recorded' },
    proof: { by },
    ...body,
  },
})

const request = { issuer: SAM_AGENT, challenge: 'c'.repeat(32), payloadDigest: DIGEST }

beforeEach(() => {
  TRUSTED_APPROVERS_REMOTE_OFF.off = false
  setTrustedApproversEnabled(true)
  forgetForeignWaiters()
  forgetAllVersions()
})
afterAll(() => setTrustedApproversEnabled(false))

describe('which agents this phone approves for', () => {
  test('one whose person this phone said yes to; not a no, not another agent, not with the switch off', async () => {
    const doc = { issuer: SAM_AGENT }
    expect(await approvedAgentOf(jordanPhone('accepted'), doc)).toEqual({
      agentDid: SAM_AGENT,
      asker: 'Sam',
      answeredAs: JORDAN,
    })
    expect(await approvedAgentOf(jordanPhone('declined'), doc)).toBeUndefined()
    expect(await approvedAgentOf(jordanPhone('accepted'), { issuer: 'did:webvh:someone-else' })).toBeUndefined()
    expect(await approvedAgentOf(jordanPhone(), doc)).toBeUndefined()
    setTrustedApproversEnabled(false)
    expect(await approvedAgentOf(jordanPhone('accepted'), doc)).toBeUndefined()
    setTrustedApproversEnabled(true)
    TRUSTED_APPROVERS_REMOTE_OFF.off = true
    expect(await approvedAgentOf(jordanPhone('accepted'), doc)).toBeUndefined()
  })
})

describe('sending the decision to the asking agent', () => {
  test("goes to Sam's agent as Jordan: signed for assertionMethod, sealed by the same DID, and answered by its reply", async () => {
    const { port, sent } = session((to) => replyTo(to))
    const answer = await sendForeignDecision(port, request, 'approve', undefined, 500)
    expect(port.sendTo).toHaveBeenCalledWith(SAM_AGENT, expect.anything())
    const [envelope] = sent
    expect(envelope).toMatchObject({ from: JORDAN, to: [SAM_AGENT] })
    expect(envelope.body).toMatchObject({
      type: foreignDecisionTypes()[0],
      issuer: JORDAN,
      recipient: SAM_AGENT,
      payload: { challenge: request.challenge, payloadDigest: DIGEST, decision: 'approve' },
      proof: { by: JORDAN, proofPurpose: 'assertionMethod' },
    })
    expect(answer).toMatchObject({ payload: { status: 'recorded' } })
  })

  test("a reply threaded to it but from another sender is not taken, and the decision is not answered (control: Sam's agent's is)", async () => {
    const { port } = session((to) => replyTo(to, 'did:webvh:impostor.example'))
    await expect(sendForeignDecision(port, request, 'approve', undefined, 50)).rejects.toThrow(/did not answer/)
  })

  test("a reply from Sam's agent's address but not proven by it is not its answer", async () => {
    const { port } = session((to) => ({
      ...replyTo(to),
      body: { ...replyTo(to).body, proof: { by: 'did:peer:2.other' } },
    }))
    await expect(sendForeignDecision(port, request, 'deny', undefined, 500)).rejects.toThrow(/not the asking agent's/)
  })

  test('a version the agent does not serve steps down once; any other refusal is not sent again', async () => {
    const { port, sent } = session((to) =>
      (to.body as { type: string }).type === foreignDecisionTypes()[0]
        ? replyTo(to, SAM_AGENT, {
            type: 'https://trusttasks.org/spec/trust-task-error/0.1',
            payload: { code: 'unsupportedVersion', details: { servedVersions: [foreignDecisionTypes()[1]] } },
          })
        : replyTo(to)
    )
    await sendForeignDecision(port, request, 'approve', undefined, 500)
    expect(sent.map((e) => (e.body as { type: string }).type)).toEqual([...foreignDecisionTypes()])

    forgetAllVersions()
    const refused = session((to) =>
      replyTo(to, SAM_AGENT, {
        type: 'https://trusttasks.org/spec/trust-task-error/0.1',
        payload: { code: 'noPending', message: 'nothing waits for this approver' },
      })
    )
    await expect(sendForeignDecision(refused.port, request, 'approve', undefined, 500)).rejects.toThrow(/nothing waits/)
    expect(refused.sent).toHaveLength(1)
  })

  test('with the switch off, or a digest that is not one, nothing is sent', async () => {
    const { port } = session()
    setTrustedApproversEnabled(false)
    await expect(sendForeignDecision(port, request, 'approve', undefined, 50)).rejects.toThrow(/switched off/)
    setTrustedApproversEnabled(true)
    await expect(sendForeignDecision(port, { ...request, payloadDigest: 'not-a-digest' }, 'approve')).rejects.toThrow(
      /digestMultibase/
    )
    expect(port.sendTo).not.toHaveBeenCalled()
  })
})

describe("the controller, on Jordan's phone", () => {
  const consentRequest = (issuer: string) => ({
    id: 'm-1',
    type: 'https://didcomm.org/trust-task/2.0/envelope',
    from: issuer,
    body: {
      id: 'req-1',
      type: VTA_TASK.consentRequest,
      issuer,
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
  })

  function controller(
    answered?: 'accepted' | 'declined',
    answer: (sent: Record<string, unknown>) => Record<string, unknown> | undefined = (to) => replyTo(to)
  ) {
    const checked: string[] = []
    const vta = new VtaAgentController()
    const confirmOwner = jest.fn(async () => ({ ok: true as const }))
    vta.configure({
      decisionDeadlineMs: 500,
      confirmOwner,
      checkConsentRequest: async (_agent: unknown, doc: Record<string, unknown>, expect: { vtaDid: string }) => {
        checked.push(expect.vtaDid)
        return doc.issuer === expect.vtaDid ? { ok: true } : { ok: false, reason: 'wrong-issuer' }
      },
    } as never)
    const sent: Record<string, unknown>[] = []
    const client = {
      managerDid: JORDAN,
      decideConsent: jest.fn(async () => ({ status: 'granted' })),
      sendTo: jest.fn(async (_peer: string, plaintext: Record<string, unknown>) => {
        sent.push(plaintext)
        // Sam's agent's reply reaches this phone the way any message does: through the session's inbound.
        const reply = answer(plaintext)
        if (reply) setImmediate(() => internals.inbound(reply))
      }),
    }
    const internals = vta as unknown as {
      current?: Record<string, unknown>
      inbound(plaintext: unknown): void
    }
    internals.current = { client, vtaDid: JORDAN_AGENT, agent: jordanPhone(answered), store: {} }
    return { vta, internals, client, sent, checked, confirmOwner }
  }

  test("a request from Sam's agent is checked against Sam's agent and listed as Sam's", async () => {
    const { vta, internals, checked } = controller('accepted')
    internals.inbound(consentRequest(SAM_AGENT))
    await flush()
    await flush()
    expect(checked).toEqual([SAM_AGENT])
    expect(vta.getState().approvals).toEqual([
      expect.objectContaining({ requestCheck: 'verified', forAgent: { agentDid: SAM_AGENT, asker: 'Sam' } }),
    ])
  })

  test('from an agent this phone never said yes to, it is checked against its own agent, and not shown (control above)', async () => {
    for (const answered of [undefined, 'declined'] as const) {
      const { vta, internals, checked } = controller(answered)
      internals.inbound(consentRequest(SAM_AGENT))
      await flush()
      await flush()
      expect(checked).toEqual([JORDAN_AGENT])
      expect(vta.getState().approvals).toEqual([])
    }
  })

  test('with the switch off, a request from an agent this phone approves for is not shown either', async () => {
    setTrustedApproversEnabled(false)
    const { vta, internals } = controller('accepted')
    internals.inbound(consentRequest(SAM_AGENT))
    await flush()
    await flush()
    expect(vta.getState().approvals).toEqual([])
  })

  test("Approve on it asks Face ID, then goes to Sam's agent, never to Jordan's own; it is not Jordan's agent's activity", async () => {
    const { vta, internals, client, sent, confirmOwner } = controller('accepted')
    internals.inbound(consentRequest(SAM_AGENT))
    await flush()
    await flush()
    const before = vta.getState().activity.length
    await vta.decide('req-1', 'approve')
    expect(confirmOwner).toHaveBeenCalled()
    expect(client.decideConsent).not.toHaveBeenCalled()
    expect(client.sendTo).toHaveBeenCalledWith(SAM_AGENT, expect.anything())
    expect(sent[0].body).toMatchObject({ recipient: SAM_AGENT, payload: { decision: 'approve' } })
    expect(vta.getState().approvals[0]).toMatchObject({ status: 'approved' })
    expect(vta.getState().activity.length).toBe(before)
  })

  test("past the deadline after a step-down, the card names Sam's agent, not Jordan's own (control: vtaDecide.test)", async () => {
    // The first version is refused at once, so the second waits out the whole deadline and the outer one fires first.
    const { vta, internals, sent } = controller('accepted', (to) =>
      (to.body as { type: string }).type === foreignDecisionTypes()[0]
        ? replyTo(to, SAM_AGENT, {
            type: 'https://trusttasks.org/spec/trust-task-error/0.1',
            payload: { code: 'unsupportedVersion', details: { servedVersions: [foreignDecisionTypes()[1]] } },
          })
        : undefined
    )
    internals.inbound(consentRequest(SAM_AGENT))
    await flush()
    await flush()
    await expect(vta.decide('req-1', 'deny')).rejects.toThrow('the asking agent did not take the decision within 0.5 s')
    expect(sent).toHaveLength(2)
    expect(vta.getState().approvals[0]).toMatchObject({ status: 'failed' })
    expect(String(vta.getState().approvals[0].error)).not.toMatch(/VTA/)
  })

  test("Sam's agent's reply is that wait's, never a request (it is not listed)", async () => {
    const { vta, internals } = controller('accepted')
    internals.inbound(consentRequest(SAM_AGENT))
    await flush()
    await flush()
    await vta.decide('req-1', 'deny')
    expect(vta.getState().approvals).toHaveLength(1)
    expect(vta.getState().approvals[0]).toMatchObject({ status: 'denied' })
  })
})

describe('the card', () => {
  const t = ((key: string, opts?: Record<string, unknown>) =>
    opts && 'asker' in opts ? `${key}(${opts.asker})` : key) as never
  const approval = {
    requester: 'did:peer:2.sams-phone',
    taskType: 'https://trusttasks.org/spec/vault/credentials/present/0.1',
  }

  test("names the person whose agent asks, never a device of theirs (control: Jordan's own agent's request is the device's)", () => {
    expect(requestLine({ ...approval, forAgent: { asker: 'Sam' } }, {}, t)).toMatch(
      /^Requests\.ForAgentAsks(To|Something)\(Sam\)$/
    )
    expect(requestLine({ ...approval, forAgent: { asker: '' } }, {}, t)).toMatch(/\(Approver\.UnnamedContact\)$/)
    expect(requestLine(approval, {}, t)).not.toMatch(/ForAgent/)
  })
})
