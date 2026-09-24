/**
 * joinSubmission — what the phone knows about a join request it sent, kept so
 * the screens can say where a join stands instead of guessing (p220 items 1, 2
 * and 7).
 *
 * The record is written before the send, so a request whose answer was lost is
 * still known to exist ("Sent — waiting for the community"), and updated from
 * whatever the community says: the verdict, a refusal, or a later poll of its
 * status task. Both ways in write it — a plain join and a vetting application.
 *
 * @module trust-tasks/module/joinSubmission
 */

import type { JoinSubmission, VtiCommunityStore } from './VtiCommunityStore'
import { VtiRefusal, type JoinRequestStatus, type VtiVerdict } from './vtiAgent'

/** What a community still needs, read from the verbatim `needs` of a verdict or a status. */
export type JoinNeed =
  | { kind: 'statements'; count: number }
  | { kind: 'invitation' }
  | { kind: 'vetting' }
  | { kind: 'agreement'; id: string }
  | { kind: 'other'; raw: string }

/**
 * One need, as `join.rego` and the host name them: `vetting:statements:<n>`,
 * `vetting:invitation`, a bare `vetting`, `agreed:<id>`. Anything else is kept
 * verbatim, so a screen can still show it rather than drop it.
 */
export function parseJoinNeed(raw: string): JoinNeed {
  const statements = /^vetting:statements:(\d+)$/.exec(raw)
  if (statements) return { kind: 'statements', count: Number(statements[1]) }
  if (raw === 'vetting:invitation') return { kind: 'invitation' }
  if (raw === 'vetting') return { kind: 'vetting' }
  const agreed = /^agreed:(.+)$/.exec(raw)
  if (agreed) return { kind: 'agreement', id: agreed[1] }
  return { kind: 'other', raw }
}

/** A verdict's effect as the request's state: what the community's status task would say. */
export function statusOfEffect(effect: string): JoinSubmission['status'] | undefined {
  switch (effect) {
    case 'allow':
      return 'approved'
    case 'requestMore':
    case 'request_more':
      return 'deferred'
    case 'refer':
    case 'pending':
      return 'pending'
    case 'deny':
    case 'reject':
      return 'rejected'
    default:
      return undefined
  }
}

const KNOWN: ReadonlyArray<NonNullable<JoinSubmission['status']>> = [
  'pending',
  'deferred',
  'approved',
  'rejected',
  'withdrawn',
]

/**
 * Record a request as sent, before the send. Replaces any earlier record for
 * the community: this is now the request that matters.
 */
export async function recordSent(
  store: VtiCommunityStore,
  sent: Pick<JoinSubmission, 'communityDid' | 'personaDid' | 'withInvitation' | 'via'>,
  now = new Date()
): Promise<void> {
  await store.saveSubmission?.({ ...sent, sentAt: now.toISOString() })
}

/**
 * Record what the community answered to the request just sent: a verdict, or
 * a refusal. Anything else — no answer at all — leaves the record as sent.
 */
export async function recordAnswer(
  store: VtiCommunityStore,
  communityDid: string,
  answer: { verdict: VtiVerdict } | { refusal: unknown },
  now = new Date()
): Promise<void> {
  const current = await store.getSubmission?.(communityDid)
  if (!current) return
  if ('refusal' in answer && !(answer.refusal instanceof VtiRefusal)) return
  const acknowledgedAt = current.acknowledgedAt ?? now.toISOString()
  if ('verdict' in answer) {
    const status = statusOfEffect(answer.verdict.effect)
    await store.saveSubmission?.({
      ...current,
      acknowledgedAt,
      requestId: answer.verdict.requestId ?? current.requestId,
      status,
      needs: status === 'deferred' ? answer.verdict.needs : undefined,
      rejection: undefined,
    })
    return
  }
  // A refusal is an answer: the community received the request and said no to
  // this send. It does not say the request was decided (an open one, say).
  await store.saveSubmission?.({ ...current, acknowledgedAt })
}

/** Record a poll of the community's status task. */
export async function recordStatus(
  store: VtiCommunityStore,
  communityDid: string,
  polled: JoinRequestStatus,
  now = new Date()
): Promise<JoinSubmission | undefined> {
  const current = await store.getSubmission?.(communityDid)
  if (!current) return undefined
  const status = KNOWN.includes(polled.status as NonNullable<JoinSubmission['status']>)
    ? (polled.status as JoinSubmission['status'])
    : current.status
  const next: JoinSubmission = {
    ...current,
    acknowledgedAt: current.acknowledgedAt ?? now.toISOString(),
    requestId: polled.requestId ?? current.requestId,
    status,
    needs: status === 'deferred' ? (polled.needs ?? current.needs) : undefined,
    rejection:
      status === 'rejected'
        ? { code: polled.code ?? 'rejected', reason: polled.reason, decidedAt: polled.decidedAt }
        : undefined,
  }
  await store.saveSubmission?.(next)
  return next
}
