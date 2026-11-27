/**
 * The reconcile of HCP approvals in flight (step 7.27 track C, part 3): for every {@link HcpApprovalInFlight} the
 * approve flow left behind (the approval failed, `onApproved` failed, or the app stopped in between), either complete
 * it or revoke its grant by the `grantId` it carries. Meant to run at app start, beside the base path's reconcile
 * (`../revoke.ts`, `reconcileAgents`), before any HCP approve flow starts; wiring it there is not this track's work
 * (that file and `../services.ts` are on the brief's do-not-touch list), so nothing calls it yet.
 *
 * For each approval in flight, in this order:
 * - its client's connection already names its grant: `onApproved` wrote it and stopped before removing the approval
 *   in flight, which is removed now (`completed`);
 * - the consent request is listed `approved`: the connection is written now (`completed`). `approvedAt` is the
 *   earlier of now and the request's own `expiresAt`, since it cannot have been approved after that;
 * - the consent request could still be approved (listed or not, its `expiresAt` has not passed, and it is not denied
 *   or expired): nothing is done yet (`waiting`), so a grant still to come is not left without a record;
 * - otherwise the grant is revoked by `grantId`, sent once: revoked, or refused `notFound` (the VTA holds no such
 *   grant, so there is nothing to revoke), removes the approval in flight (`revoked`, `absent`); any other refusal,
 *   or an unreachable VTA, keeps it for the next reconcile (`kept`).
 *
 * Does nothing unless both HCP flags are on. Nothing here logs a payload or a response.
 *
 * @module connected-agents/hcp/reconcile
 */
import type { HcpApprovalSource } from './approvals'
import { isHcpEnabled } from './hcpFlag'
import type { HcpConnectionStore } from './store'
import { HCP_GRANTS_REVOKE, type HcpApprovalInFlight, type HcpConnection } from './types'
import { callHcp, type HcpVtaPort } from './vtaPort'

/** The refusal code of a revoke for a grant the VTA does not hold. */
export const HCP_GRANT_NOT_FOUND = 'notFound'

export interface HcpReconcileDeps {
  store: Pick<HcpConnectionStore, 'listInFlight' | 'get' | 'complete' | 'removeInFlight'>
  source: Pick<HcpApprovalSource, 'list'>
  port: HcpVtaPort
  clock: () => Date
}

export type HcpReconcileOutcome =
  | { id: string; grantId: string; outcome: 'completed' }
  | { id: string; grantId: string; outcome: 'waiting' }
  | { id: string; grantId: string; outcome: 'revoked' }
  | { id: string; grantId: string; outcome: 'absent' }
  | { id: string; grantId: string; outcome: 'kept'; refused?: string; unreachable?: true }

/** The connection a confirmed approval in flight becomes. */
function connectionOf(flight: HcpApprovalInFlight, approvedAt: Date): HcpConnection {
  return {
    id: flight.id,
    name: flight.name,
    grantId: flight.grantId,
    threadId: flight.threadId,
    approvedAt: approvedAt.toISOString(),
    expiresAt: new Date(approvedAt.getTime() + flight.expiresInSeconds * 1000).toISOString(),
  }
}

async function reconcileOne(deps: HcpReconcileDeps, flight: HcpApprovalInFlight): Promise<HcpReconcileOutcome> {
  const { id, grantId } = flight
  const existing = await deps.store.get(id)
  if (existing?.grantId === grantId) {
    await deps.store.removeInFlight(id, grantId)
    return { id, grantId, outcome: 'completed' }
  }

  const now = deps.clock()
  const approval = deps.source.list().find((a) => a.id === flight.approvalId)
  const requestEnds = Date.parse(flight.approvalExpiresAt)
  if (approval?.status === 'approved') {
    const approvedAt = new Date(Math.min(now.getTime(), Number.isNaN(requestEnds) ? now.getTime() : requestEnds))
    await deps.store.complete(connectionOf(flight, approvedAt))
    return { id, grantId, outcome: 'completed' }
  }
  const settled = approval?.status === 'denied' || approval?.status === 'expired'
  if (!settled && now.getTime() < requestEnds) return { id, grantId, outcome: 'waiting' }

  const outcome = await callHcp<unknown>(deps.port, HCP_GRANTS_REVOKE, { grantId })
  if (outcome.ok) {
    await deps.store.removeInFlight(id, grantId)
    return { id, grantId, outcome: 'revoked' }
  }
  if ('refused' in outcome && outcome.refused === HCP_GRANT_NOT_FOUND) {
    await deps.store.removeInFlight(id, grantId)
    return { id, grantId, outcome: 'absent' }
  }
  return 'refused' in outcome
    ? { id, grantId, outcome: 'kept', refused: outcome.refused }
    : { id, grantId, outcome: 'kept', unreachable: true }
}

/**
 * Reconcile every approval in flight, one after another. A store error on one record is not caught: the caller's
 * next reconcile starts again from the records as they are.
 */
export async function reconcileHcpApprovals(deps: HcpReconcileDeps): Promise<HcpReconcileOutcome[]> {
  if (!isHcpEnabled()) return []
  const results: HcpReconcileOutcome[] = []
  for (const flight of await deps.store.listInFlight()) results.push(await reconcileOne(deps, flight))
  return results
}
