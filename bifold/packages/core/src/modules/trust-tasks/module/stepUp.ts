/**
 * The phone as its own step-up approver (VTI afcf2470).
 *
 * A rule's `requireStepUp` refuses a task with `auth:step_up_required` and a
 * VTA-signed `auth/step-up/approve-request` in `details.approveRequest`,
 * addressed to the caller itself — self-approve is the only step-up upstream
 * initiates (vta-service `trust_tasks/step_up.rs` `initiate_self_step_up`).
 * The caller answers on the same session with a DID-signed
 * `auth/step-up/approve-response/0.2` (vta-mobile-core `stepup.rs`): approved,
 * or a signed denial carrying a reason. The VTA verifies that answer's proof
 * as an `assertionMethod` proof by the caller, which is how every task this
 * client sends is signed.
 *
 * @module trust-tasks/module/stepUp
 */
import { VtiRefusal } from './vtiAgent'

export const STEP_UP_TASK = {
  approveRequest01: 'https://trusttasks.org/spec/auth/step-up/approve-request/0.1',
  approveRequest02: 'https://trusttasks.org/spec/auth/step-up/approve-request/0.2',
  /**
   * 0.4 (trust-tasks-tf ce07a039): `accepts` replaces `acceptableEvidence`,
   * `sessionId` is absent for a step-up bound to one operation (`boundTo`).
   * vta-service v0.52.0 still mints 0.2 (step_up.rs:807-821); this phone reads
   * 0.4 ahead of time.
   */
  approveRequest04: 'https://trusttasks.org/spec/auth/step-up/approve-request/0.4',
  approveResponse: 'https://trusttasks.org/spec/auth/step-up/approve-response/0.2',
  /** The answer to an approve-request 0.4 ("the ratification of an earlier approve-request/0.4", approve-response/0.6 spec.md:85). */
  approveResponse06: 'https://trusttasks.org/spec/auth/step-up/approve-response/0.6',
} as const

/**
 * The approve-response type that answers a request of this type. A response
 * follows its request's version, never the newest this phone speaks: an
 * approver that moved first would have every step-up refused as an
 * unsupported type (vta-sdk trust_tasks.rs:161-172).
 */
export const approveResponseTypeFor = (requestType: string): string =>
  requestType === STEP_UP_TASK.approveRequest04 ? STEP_UP_TASK.approveResponse06 : STEP_UP_TASK.approveResponse

const STEP_UP_REQUIRED = 'auth:step_up_required'

/** The schema's `challenge` minimum (approve-request 0.1 and 0.2: `minLength: 16`). */
export const MIN_STEP_UP_CHALLENGE_LENGTH = 16

/** What a denial says when the person gave no words of their own (`deniedReason` is required then). */
export const STEP_UP_DENIED_REASON = 'Declined on this phone'

/** An approve-request this phone can answer: what the answer echoes, and what the person reads. */
export interface StepUpRequest {
  issuer: string
  subject: string
  sessionId: string
  challenge: string
  /** The agent's own words for why it asks, shown to the person as they are. */
  reason: string
  targetAcr?: string
  /** The approve-response type to answer with ({@link approveResponseTypeFor}). */
  responseType: string
}

/** Why a step-up refusal is not answered: the refusal then stands as it came. */
export type StepUpUnanswerable =
  | 'noRequest'
  | 'malformed'
  | 'weakChallenge'
  | 'notForThisPhone'
  | 'notFromTheAgent'
  | 'evidenceUnsupported'
  /** A 0.4 request bound to one operation (no `sessionId`): answered inline elsewhere, not on this session. */
  | 'boundStepUp'

/** The person said no; a signed denial went to the agent and the task was not done. */
export class StepUpDeclined extends Error {
  constructor() {
    super('You declined the extra check, so your agent did not do this.')
    this.name = 'StepUpDeclined'
  }
}

const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.length > 0

/**
 * The approve-request in a step-up refusal, if this phone can answer it:
 * version 0.1 or 0.2, from the linked agent, about this phone's own session,
 * a challenge of at least 16 characters, and DID-signed evidence acceptable.
 * Undefined for any other error.
 */
export function stepUpRequestOf(
  error: unknown,
  expect: { vtaDid: string; me: string }
): { ok: true; request: StepUpRequest } | { ok: false; why: StepUpUnanswerable } | undefined {
  if (!(error instanceof VtiRefusal)) return undefined
  const details = (error.details ?? undefined) as { reason?: unknown; approveRequest?: unknown } | undefined
  const isStepUp =
    details?.reason === STEP_UP_REQUIRED || error.code === STEP_UP_REQUIRED || error.message.includes(STEP_UP_REQUIRED)
  if (!isStepUp) return undefined
  const no = (why: StepUpUnanswerable) => ({ ok: false as const, why })

  const doc = details?.approveRequest
  if (!doc || typeof doc !== 'object') return no('noRequest')
  const d = doc as Record<string, unknown>
  const type = d.type
  if (
    type !== STEP_UP_TASK.approveRequest01 &&
    type !== STEP_UP_TASK.approveRequest02 &&
    type !== STEP_UP_TASK.approveRequest04
  )
    return no('malformed')
  const p = d.payload as Record<string, unknown> | undefined
  if (!p || typeof p !== 'object') return no('malformed')
  const { subject, sessionId, challenge, reason } = p
  // 0.4: "Absent only when the step-up is bound to one operation" (approve-request/0.4 schema:18).
  if (type === STEP_UP_TASK.approveRequest04 && sessionId === undefined && p.boundTo !== undefined)
    return no('boundStepUp')
  if (!nonEmpty(subject) || !nonEmpty(sessionId) || !nonEmpty(challenge) || !nonEmpty(reason)) return no('malformed')
  if (challenge.length < MIN_STEP_UP_CHALLENGE_LENGTH) return no('weakChallenge')
  if (d.issuer !== expect.vtaDid) return no('notFromTheAgent')
  if (subject !== expect.me || (d.recipient !== undefined && d.recipient !== expect.me)) return no('notForThisPhone')
  // 0.1/0.2 name the evidence they take in `acceptableEvidence` (optional);
  // 0.4 in `accepts` (required; `webauthn | approverSigned | didSigned`).
  const acceptable = type === STEP_UP_TASK.approveRequest04 ? p.accepts : p.acceptableEvidence
  if (type === STEP_UP_TASK.approveRequest04 && !Array.isArray(acceptable)) return no('malformed')
  if (Array.isArray(acceptable) && !acceptable.some((k) => k === 'didSigned' || k === 'did-signed'))
    return no('evidenceUnsupported')

  return {
    ok: true,
    request: {
      issuer: d.issuer,
      subject,
      sessionId,
      challenge,
      reason,
      ...(typeof p.targetAcr === 'string' ? { targetAcr: p.targetAcr } : {}),
      responseType: approveResponseTypeFor(type),
    },
  }
}

/**
 * The approve-response payload: the request's echoes, the decision, DID-signed
 * evidence. The same members are valid in 0.2 and 0.6: 0.6 keeps `subject`,
 * `challenge`, `decision` required, `sessionId` echoed when the request carried
 * one, `deniedReason` for a denial, and `didSigned` among the evidence kinds; it
 * adds `approverSigned`, which this phone does not send (approve-response/0.6
 * payload.schema.json:8-23, 92-109). The framework proof stays required either way.
 */
export function approveResponsePayload(
  request: Pick<StepUpRequest, 'subject' | 'sessionId' | 'challenge'>,
  decision: 'approved' | 'denied'
): Record<string, unknown> {
  return {
    subject: request.subject,
    sessionId: request.sessionId,
    challenge: request.challenge,
    decision,
    ...(decision === 'denied' ? { deniedReason: STEP_UP_DENIED_REASON } : {}),
    evidence: { kind: 'didSigned' },
  }
}
