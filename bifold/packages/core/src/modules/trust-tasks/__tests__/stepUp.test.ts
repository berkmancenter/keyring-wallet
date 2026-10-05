/**
 * The phone as its own step-up approver, as upstream does it at VTI afcf2470.
 *
 * A rule's `requireStepUp` refuses the task with `auth:step_up_required` and a
 * signed `auth/step-up/approve-request` in `details.approveRequest`, addressed
 * to the caller itself (vta-service `initiate_self_step_up`: self-approve is
 * the only step-up there is). The caller answers on the same session with a
 * DID-signed `auth/step-up/approve-response/0.2` — approved, or a signed
 * denial with a reason — and, approved, re-submits the task (vta-mobile-core
 * `stepup.rs`). Both request versions are read: 0.1 spells the evidence kind
 * `did-signed`, 0.2 `didSigned`. A challenge under 16 characters (the
 * schema's minimum) is not answered. The `reason` is what the person reads,
 * word for word.
 */
import { STEP_UP_TASK, StepUpDeclined, approveResponsePayload, stepUpRequestOf } from '../module/stepUp'
import { STEP_UP_ASK_TIMEOUT_MS, VtaAgentController } from '../module/vtaAgent'
import { OwnerNotConfirmed, deviceRefusalOf } from '../module/vtaOwner'
import { VtaClient } from '../module/VtaClient'
import { VtiRefusal } from '../module/vtiAgent'

const VTA = 'did:webvh:agent'
const PHONE = 'did:key:z6MkPhoneManager'
const CHALLENGE = 'Y2hhbGxlbmdlLWZyb20tdGhlLWFnZW50LTAx'
const REASON = 'Approve disclosing 2 attributes to did:web:shop.example'
const DEVICES_ADD = 'https://trusttasks.org/spec/acl/grant/0.1'

const approveRequest = (
  version: '0.1' | '0.2' | '0.4' = '0.2',
  payload: Record<string, unknown> = {},
  envelope: Record<string, unknown> = {}
) => ({
  id: 'urn:uuid:step-up-1',
  type: `https://trusttasks.org/spec/auth/step-up/approve-request/${version}`,
  issuer: VTA,
  recipient: PHONE,
  issuedAt: '2026-09-29T14:00:00Z',
  payload: {
    subject: PHONE,
    sessionId: 'session-7',
    challenge: CHALLENGE,
    reason: REASON,
    targetAcr: 'aal2',
    // 0.4 names the evidence it takes in `accepts` (required); 0.1/0.2 in `acceptableEvidence`.
    ...(version === '0.4'
      ? { accepts: ['didSigned', 'webauthn'] }
      : { acceptableEvidence: version === '0.1' ? ['did-signed', 'webauthn'] : ['didSigned', 'webauthn'] }),
    ttl: 300,
    ...payload,
  },
  proof: { type: 'DataIntegrityProof', proofPurpose: 'authentication' },
  ...envelope,
})

const stepUpRefusal = (request: unknown = approveRequest()) =>
  new VtiRefusal('taskFailed', 'task failed: auth:step_up_required', {
    reason: 'auth:step_up_required',
    requiredAcr: 'aal2',
    approveRequest: request,
  })

describe('reading a step-up refusal', () => {
  it('reads a 0.2 approve-request', () => {
    expect(stepUpRequestOf(stepUpRefusal(), { vtaDid: VTA, me: PHONE })).toEqual({
      ok: true,
      request: {
        issuer: VTA,
        subject: PHONE,
        sessionId: 'session-7',
        challenge: CHALLENGE,
        reason: REASON,
        targetAcr: 'aal2',
        responseType: STEP_UP_TASK.approveResponse,
      },
    })
  })

  it('reads a 0.4 approve-request ahead of the agent, and answers it with approve-response 0.6', () => {
    expect(stepUpRequestOf(stepUpRefusal(approveRequest('0.4')), { vtaDid: VTA, me: PHONE })).toEqual({
      ok: true,
      request: {
        issuer: VTA,
        subject: PHONE,
        sessionId: 'session-7',
        challenge: CHALLENGE,
        reason: REASON,
        targetAcr: 'aal2',
        responseType: 'https://trusttasks.org/spec/auth/step-up/approve-response/0.6',
      },
    })
  })

  it('does not answer a 0.4 request that takes no DID-signed evidence, or names none', () => {
    const webauthnOnly = approveRequest('0.4', { accepts: ['webauthn'] })
    expect(stepUpRequestOf(stepUpRefusal(webauthnOnly), { vtaDid: VTA, me: PHONE })).toEqual({
      ok: false,
      why: 'evidenceUnsupported',
    })
    // 0.4 dropped `acceptableEvidence` for a REQUIRED `accepts` (approve-request/0.4 schema:41-50).
    const oldSpelling = approveRequest('0.4', { accepts: undefined, acceptableEvidence: ['didSigned'] })
    expect(stepUpRequestOf(stepUpRefusal(oldSpelling), { vtaDid: VTA, me: PHONE })).toEqual({
      ok: false,
      why: 'malformed',
    })
  })

  it('leaves a 0.4 step-up bound to one operation (no sessionId) to be answered elsewhere', () => {
    const bound = approveRequest('0.4', { sessionId: undefined, boundTo: 'sha256:op' })
    expect(stepUpRequestOf(stepUpRefusal(bound), { vtaDid: VTA, me: PHONE })).toEqual({ ok: false, why: 'boundStepUp' })
  })

  it('reads a 0.1 approve-request, whose evidence is spelled did-signed', () => {
    expect(stepUpRequestOf(stepUpRefusal(approveRequest('0.1')), { vtaDid: VTA, me: PHONE })).toMatchObject({
      ok: true,
      request: { challenge: CHALLENGE, reason: REASON },
    })
  })

  it('keeps the reason word for word', () => {
    const reason = '  Rotate keys — "agent-2"\nthen re-sign  '
    expect(stepUpRequestOf(stepUpRefusal(approveRequest('0.2', { reason })), { vtaDid: VTA, me: PHONE })).toMatchObject(
      { ok: true, request: { reason } }
    )
  })

  it('leaves every other refusal alone', () => {
    expect(
      stepUpRequestOf(new VtiRefusal('taskFailed', 'task failed: auth:unauthorized'), { vtaDid: VTA, me: PHONE })
    ).toBeUndefined()
    expect(stepUpRequestOf(new Error('auth:step_up_required'), { vtaDid: VTA, me: PHONE })).toBeUndefined()
  })

  it('cannot answer a step-up that carries no approve-request', () => {
    const bare = new VtiRefusal('taskFailed', 'task failed: auth:step_up_required', { reason: 'auth:step_up_required' })
    expect(stepUpRequestOf(bare, { vtaDid: VTA, me: PHONE })).toEqual({ ok: false, why: 'noRequest' })
  })

  it('does not answer a challenge under 16 characters', () => {
    expect(
      stepUpRequestOf(stepUpRefusal(approveRequest('0.2', { challenge: 'short-challenge' })), {
        vtaDid: VTA,
        me: PHONE,
      })
    ).toEqual({ ok: false, why: 'weakChallenge' })
    expect(
      stepUpRequestOf(stepUpRefusal(approveRequest('0.2', { challenge: 'x'.repeat(16) })), { vtaDid: VTA, me: PHONE })
    ).toMatchObject({ ok: true })
  })

  it('does not answer a request for someone else, or from anyone but the linked agent', () => {
    expect(
      stepUpRequestOf(stepUpRefusal(approveRequest('0.2', { subject: 'did:key:z6MkOther' })), {
        vtaDid: VTA,
        me: PHONE,
      })
    ).toEqual({ ok: false, why: 'notForThisPhone' })
    expect(
      stepUpRequestOf(stepUpRefusal(approveRequest('0.2', {}, { recipient: 'did:key:z6MkOther' })), {
        vtaDid: VTA,
        me: PHONE,
      })
    ).toEqual({ ok: false, why: 'notForThisPhone' })
    expect(
      stepUpRequestOf(stepUpRefusal(approveRequest('0.2', {}, { issuer: 'did:webvh:someone-else' })), {
        vtaDid: VTA,
        me: PHONE,
      })
    ).toEqual({ ok: false, why: 'notFromTheAgent' })
  })

  it('does not answer a request that is not an approve-request, or lacks what the answer echoes', () => {
    const wrongType = { ...approveRequest(), type: 'https://trusttasks.org/spec/auth/step-up/approve-response/0.2' }
    expect(stepUpRequestOf(stepUpRefusal(wrongType), { vtaDid: VTA, me: PHONE })).toEqual({
      ok: false,
      why: 'malformed',
    })
    expect(
      stepUpRequestOf(stepUpRefusal(approveRequest('0.2', { sessionId: '' })), { vtaDid: VTA, me: PHONE })
    ).toEqual({ ok: false, why: 'malformed' })
    expect(
      stepUpRequestOf(stepUpRefusal(approveRequest('0.2', { reason: undefined })), { vtaDid: VTA, me: PHONE })
    ).toEqual({ ok: false, why: 'malformed' })
  })

  it('does not answer a request that accepts only a passkey', () => {
    expect(
      stepUpRequestOf(stepUpRefusal(approveRequest('0.2', { acceptableEvidence: ['webauthn'] })), {
        vtaDid: VTA,
        me: PHONE,
      })
    ).toEqual({ ok: false, why: 'evidenceUnsupported' })
  })
})

describe('the answer, as auth/step-up/approve-response/0.2', () => {
  const request = { issuer: VTA, subject: PHONE, sessionId: 'session-7', challenge: CHALLENGE, reason: REASON }

  it('approves with the echoes and DID-signed evidence', () => {
    expect(approveResponsePayload(request, 'approved')).toEqual({
      subject: PHONE,
      sessionId: 'session-7',
      challenge: CHALLENGE,
      decision: 'approved',
      evidence: { kind: 'didSigned' },
    })
  })

  it('denies with a reason, which a denial requires', () => {
    expect(approveResponsePayload(request, 'denied')).toEqual({
      subject: PHONE,
      sessionId: 'session-7',
      challenge: CHALLENGE,
      decision: 'denied',
      deniedReason: 'Declined on this phone',
      evidence: { kind: 'didSigned' },
    })
  })
})

describe('a task that needs a step-up', () => {
  function client(ask?: jest.Mock) {
    const vta = new VtaClient({ config: { logger: { info: jest.fn(), warn: jest.fn() } } } as never, VTA, {} as never, {
      ...(ask ? { onStepUp: ask } : {}),
    })
    jest.spyOn(vta, 'managerDid', 'get').mockReturnValue(PHONE)
    const send = jest.spyOn(vta as unknown as { sendTask: (...a: unknown[]) => Promise<unknown> }, 'sendTask')
    return { vta, send }
  }

  it('asks the person with the reason, answers approved, and re-submits the task', async () => {
    const ask = jest.fn(async () => 'approve' as const)
    const { vta, send } = client(ask)
    send
      .mockRejectedValueOnce(stepUpRefusal())
      .mockResolvedValueOnce({ status: 'elevated' })
      .mockResolvedValueOnce({ granted: true })

    await expect(vta.task(DEVICES_ADD, { subject: 'did:key:z6MkNew' })).resolves.toEqual({ granted: true })
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({ reason: REASON, challenge: CHALLENGE }), {
      taskType: DEVICES_ADD,
    })
    expect(send.mock.calls.map((c) => c[0])).toEqual([DEVICES_ADD, STEP_UP_TASK.approveResponse, DEVICES_ADD])
    // The answer waits for the agent's reply like any task.
    expect(send.mock.calls[1][2]).toBe(30000)
    expect(send.mock.calls[1][1]).toEqual({
      subject: PHONE,
      sessionId: 'session-7',
      challenge: CHALLENGE,
      decision: 'approved',
      evidence: { kind: 'didSigned' },
    })
    expect(STEP_UP_TASK.approveResponse).toBe('https://trusttasks.org/spec/auth/step-up/approve-response/0.2')
  })

  it('answers a 0.4 approve-request with approve-response 0.6, the same members', async () => {
    const ask = jest.fn(async () => 'approve' as const)
    const { vta, send } = client(ask)
    send
      .mockRejectedValueOnce(stepUpRefusal(approveRequest('0.4')))
      .mockResolvedValueOnce({ status: 'elevated' })
      .mockResolvedValueOnce({ granted: true })

    await expect(vta.task(DEVICES_ADD, {})).resolves.toEqual({ granted: true })
    expect(send.mock.calls.map((c) => c[0])).toEqual([
      DEVICES_ADD,
      'https://trusttasks.org/spec/auth/step-up/approve-response/0.6',
      DEVICES_ADD,
    ])
    expect(send.mock.calls[1][1]).toEqual({
      subject: PHONE,
      sessionId: 'session-7',
      challenge: CHALLENGE,
      decision: 'approved',
      evidence: { kind: 'didSigned' },
    })
  })

  it('sends a signed denial when the person says no, and does not re-submit', async () => {
    const ask = jest.fn(async () => 'deny' as const)
    const { vta, send } = client(ask)
    send.mockRejectedValueOnce(stepUpRefusal()).mockResolvedValueOnce({ status: 'denied' })

    await expect(vta.task(DEVICES_ADD, {})).rejects.toBeInstanceOf(StepUpDeclined)
    expect(send.mock.calls.map((c) => c[0])).toEqual([DEVICES_ADD, STEP_UP_TASK.approveResponse])
    expect(send.mock.calls[1][1]).toMatchObject({ decision: 'denied', deniedReason: 'Declined on this phone' })
  })

  it('sends nothing when the person could not be asked (the check failed), and says so', async () => {
    const ask = jest.fn(async () => {
      throw new Error("Keyring couldn't confirm it's you.")
    })
    const { vta, send } = client(ask)
    send.mockRejectedValueOnce(stepUpRefusal())
    await expect(vta.task(DEVICES_ADD, {})).rejects.toThrow(/couldn't confirm/)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('does not answer a weak challenge: the refusal stands, nothing is sent', async () => {
    const ask = jest.fn(async () => 'approve' as const)
    const { vta, send } = client(ask)
    const refusal = stepUpRefusal(approveRequest('0.2', { challenge: 'short' }))
    send.mockRejectedValueOnce(refusal)
    await expect(vta.task(DEVICES_ADD, {})).rejects.toBe(refusal)
    expect(ask).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('without a way to ask, the refusal stands as before', async () => {
    const { vta, send } = client()
    const refusal = stepUpRefusal()
    send.mockRejectedValueOnce(refusal)
    await expect(vta.task(DEVICES_ADD, {})).rejects.toBe(refusal)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('an approval the agent refuses is that refusal, and the task is not re-submitted', async () => {
    const ask = jest.fn(async () => 'approve' as const)
    const { vta, send } = client(ask)
    const answerRefused = new VtiRefusal('taskFailed', 'auth/step-up/approve-response:challengeExpired')
    send.mockRejectedValueOnce(stepUpRefusal()).mockRejectedValueOnce(answerRefused)
    await expect(vta.task(DEVICES_ADD, {})).rejects.toBe(answerRefused)
    expect(send).toHaveBeenCalledTimes(2)
  })
})

describe('asking the person', () => {
  // 228 lab check (09-29): on Android the owner check right after a device
  // act's own check passed without a prompt, so the reason — which lived only
  // in that prompt — was never shown. The card shows it first, in the app;
  // the owner check still runs after it.
  const request = { issuer: VTA, subject: PHONE, sessionId: 'session-7', challenge: CHALLENGE, reason: REASON }
  type Asking = { askStepUp: (r: typeof request, c?: { taskType?: string }) => Promise<string> }
  const ask = (answer: { ok: boolean; reason?: 'cancelled' | 'failed' | 'unavailable' }) => {
    const controller = new VtaAgentController()
    const confirmOwner = jest.fn(async () => answer)
    controller.setOwnerChecks({ confirmOwner, deviceCanOwn: async () => true })
    const asked = (controller as unknown as Asking).askStepUp(request, { taskType: DEVICES_ADD })
    const card = () => controller.getState().stepUpAsk
    return { controller, confirmOwner, asked, card }
  }

  it("shows the agent's reason, word for word, before any owner check", async () => {
    const { confirmOwner, card, controller } = ask({ ok: true })
    await Promise.resolve()
    expect(card()).toMatchObject({ reason: REASON, taskType: DEVICES_ADD })
    expect(confirmOwner).not.toHaveBeenCalled()
    controller.answerStepUp(card()!.id, 'deny')
  })

  it('confirmed on the card, then the owner check, is approve', async () => {
    const { confirmOwner, asked, card, controller } = ask({ ok: true })
    await Promise.resolve()
    controller.answerStepUp(card()!.id, 'approve')
    await expect(asked).resolves.toBe('approve')
    expect(confirmOwner).toHaveBeenCalledWith(REASON)
    expect(card()).toBeUndefined()
  })

  it("Don't allow on the card is no, without an owner check", async () => {
    const { confirmOwner, asked, card, controller } = ask({ ok: true })
    await Promise.resolve()
    controller.answerStepUp(card()!.id, 'deny')
    await expect(asked).resolves.toBe('deny')
    expect(confirmOwner).not.toHaveBeenCalled()
  })

  it('confirmed on the card but cancelled at the owner check is no', async () => {
    const { asked, card, controller } = ask({ ok: false, reason: 'cancelled' })
    await Promise.resolve()
    controller.answerStepUp(card()!.id, 'approve')
    await expect(asked).resolves.toBe('deny')
  })

  it('an owner check that failed answers nothing', async () => {
    const { asked, card, controller } = ask({ ok: false, reason: 'failed' })
    await Promise.resolve()
    controller.answerStepUp(card()!.id, 'approve')
    await expect(asked).rejects.toBeInstanceOf(OwnerNotConfirmed)
  })

  it('an answer for another card is ignored', async () => {
    const { card, controller } = ask({ ok: true })
    await Promise.resolve()
    controller.answerStepUp('not-this-card', 'approve')
    expect(card()).toBeDefined()
    controller.answerStepUp(card()!.id, 'deny')
  })

  it('a card left unanswered answers nothing, and goes away', async () => {
    jest.useFakeTimers()
    try {
      const { asked, card } = ask({ ok: true })
      const settled = asked.catch((e: unknown) => e)
      await Promise.resolve()
      expect(card()).toBeDefined()
      jest.advanceTimersByTime(STEP_UP_ASK_TIMEOUT_MS)
      expect(await settled).toBeInstanceOf(OwnerNotConfirmed)
      expect(card()).toBeUndefined()
    } finally {
      jest.useRealTimers()
    }
  })

  it('a screen words the outcomes', () => {
    expect(deviceRefusalOf(new StepUpDeclined()).reason).toBe('stepUpDeclined')
    expect(deviceRefusalOf(new OwnerNotConfirmed('failed')).reason).toBe('notConfirmed')
    expect(deviceRefusalOf(stepUpRefusal()).reason).toBe('stepUpRequired')
    // A refusal Keyring has no words for is still a refusal, with its code (al-phone, 10-05).
    expect(deviceRefusalOf(new VtiRefusal('validationFailed', 'payload member not allowed'))).toMatchObject({
      reason: 'refused',
      code: 'validationFailed',
      detail: 'payload member not allowed',
    })
  })
})
