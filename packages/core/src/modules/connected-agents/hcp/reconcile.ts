/**
 * The reconcile of HCP approvals in flight (step 7.27 track C, part 3): for every {@link HcpApprovalInFlight} the
 * approve flow left behind (the approval failed, `onApproved` failed, or the app stopped in between), either complete
 * it or revoke its grant by the `grantId` it carries. Meant to run at app start, beside the base path's reconcile
 * (`../revoke.ts`, `reconcileAgents`), before any HCP approve flow starts; wiring it there is not this track's work
 * (that file and `../services.ts` are on the brief's do-not-touch list), so nothing calls it yet.
 *
 * The approvals in flight are taken newest first (by `startedAt`), and for each, in this order:
 * - its client's connection already names its grant: `onApproved` wrote it and stopped before removing the approval
 *   in flight, which is removed now (`completed`);
 * - the consent request is listed `approved`: the connection is written now (`completed`). `approvedAt` is the
 *   earlier of now and the request's own `expiresAt`, since it cannot have been approved after that. Unless the
 *   client's connection is for another grant approved at or after this approval started: a newer approval for the
 *   same client has completed, so this grant is not made the connection but revoked, as below;
 * - the consent request could still be approved (listed or not, its `expiresAt` has not passed, and it is not denied
 *   or expired): nothing is done yet (`waiting`), so a grant still to come is not left without a record;
 * - otherwise the grant is revoked by `grantId`, sent once: revoked, or refused `notFound` (the VTA holds no such
 *   grant, so there is nothing to revoke), removes the approval in flight (`revoked`, `absent`); any other refusal,
 *   or an unreachable VTA, keeps it for the next reconcile (`kept`).
 *
 * Then each retiring grant (a connection a newer one replaced, see `./store.ts`), marked `retiring: true`: if its
 * client's connection still names it (the app stopped inside `complete`, before the newer connection was written), it
 * is removed and nothing is sent (`current`); otherwise its grant is revoked as above (`revoked`, `absent`, `kept`).
 *
 * Does nothing unless both HCP flags are on. Nothing here logs a payload or a response.
 *
 * @module connected-agents/hcp/reconcile
 */
import type { HcpApprovalSource } from './approvals'
import { isHcpEnabled } from './hcpFlag'
import type { HcpConnectionStore } from './store'
import { HCP_GRANTS_REVOKE, type HcpApprovalInFlight, type HcpConnection, type HcpRetiringGrant } from './types'
import { callHcp, type HcpVtaPort } from './vtaPort'

/** The refusal code of a revoke for a grant the VTA does not hold. */
export const HCP_GRANT_NOT_FOUND = 'notFound'

export interface HcpReconcileDeps {
  store: Pick<
    HcpConnectionStore,
    'listInFlight' | 'get' | 'complete' | 'removeInFlight' | 'listRetiring' | 'removeRetiring'
  >
  source: Pick<HcpApprovalSource, 'list'>
  port: HcpVtaPort
  clock: () => Date
}

type RevokeOutcome =
  | { outcome: 'revoked' }
  | { outcome: 'absent' }
  | { outcome: 'kept'; refused?: string; unreachable?: true }

export type HcpReconcileOutcome = { id: string; grantId: string } & (
  | { outcome: 'completed' }
  | { outcome: 'waiting' }
  | RevokeOutcome
  | ({ retiring: true } & ({ outcome: 'current' } | RevokeOutcome))
)

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

/** Revoke `grantId`, sent once; `remove` drops the record that names it when the VTA no longer holds the grant. */
async function revokeGrant(
  deps: HcpReconcileDeps,
  grantId: string,
  remove: () => Promise<unknown>
): Promise<RevokeOutcome> {
  const outcome = await callHcp<unknown>(deps.port, HCP_GRANTS_REVOKE, { grantId })
  if (outcome.ok) {
    await remove()
    return { outcome: 'revoked' }
  }
  if ('refused' in outcome && outcome.refused === HCP_GRANT_NOT_FOUND) {
    await remove()
    return { outcome: 'absent' }
  }
  return 'refused' in outcome ? { outcome: 'kept', refused: outcome.refused } : { outcome: 'kept', unreachable: true }
}

async function reconcileOne(deps: HcpReconcileDeps, flight: HcpApprovalInFlight): Promise<HcpReconcileOutcome> {
  const { id, grantId } = flight
  const existing = await deps.store.get(id)
  if (existing?.grantId === grantId) {
    await deps.store.removeInFlight(id, grantId)
    return { id, grantId, outcome: 'completed' }
  }
  // A newer approval for the same client completed after this one started: this grant is never made the connection.
  const superseded = !!existing && Date.parse(existing.approvedAt) >= Date.parse(flight.startedAt)

  const now = deps.clock()
  const approval = deps.source.list().find((a) => a.id === flight.approvalId)
  const requestEnds = Date.parse(flight.approvalExpiresAt)
  if (approval?.status === 'approved' && !superseded) {
    const approvedAt = new Date(Math.min(now.getTime(), Number.isNaN(requestEnds) ? now.getTime() : requestEnds))
    await deps.store.complete(connectionOf(flight, approvedAt), now)
    return { id, grantId, outcome: 'completed' }
  }
  const settled = approval?.status === 'approved' || approval?.status === 'denied' || approval?.status === 'expired'
  if (!settled && now.getTime() < requestEnds) return { id, grantId, outcome: 'waiting' }

  return { id, grantId, ...(await revokeGrant(deps, grantId, () => deps.store.removeInFlight(id, grantId))) }
}

async function reconcileRetiring(deps: HcpReconcileDeps, retiring: HcpRetiringGrant): Promise<HcpReconcileOutcome> {
  const { id, grantId } = retiring
  if ((await deps.store.get(id))?.grantId === grantId) {
    await deps.store.removeRetiring(id, grantId)
    return { id, grantId, retiring: true, outcome: 'current' }
  }
  const outcome = await revokeGrant(deps, grantId, () => deps.store.removeRetiring(id, grantId))
  return { id, grantId, retiring: true, ...outcome }
}

/**
 * Reconcile every approval in flight, newest first, one after another, then every retiring grant (listed after, so
 * one a completion here retired is included). A store error on one record is not caught: the caller's next reconcile
 * starts again from the records as they are.
 */
export async function reconcileHcpApprovals(deps: HcpReconcileDeps): Promise<HcpReconcileOutcome[]> {
  if (!isHcpEnabled()) return []
  const results: HcpReconcileOutcome[] = []
  const flights = [...(await deps.store.listInFlight())].sort(
    (a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt)
  )
  for (const flight of flights) results.push(await reconcileOne(deps, flight))
  for (const retiring of await deps.store.listRetiring()) results.push(await reconcileRetiring(deps, retiring))
  return results
}
