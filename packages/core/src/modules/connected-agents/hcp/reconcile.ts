/**
 * The reconcile of HCP approvals in flight (step 7.27 track C, part 3): for every {@link HcpApprovalInFlight} the
 * approve flow left behind (the approval failed, `onApproved` failed, or the app stopped in between), either complete
 * it or revoke its grant by its `grantId`, learnt from the audit log first when the record has none (`./grantId.ts`;
 * VTI hcp.md §5.1 pre-assigns none). Meant to run at app start, beside the base path's reconcile
 * (`../revoke.ts`, `reconcileAgents`), before any HCP approve flow starts; `../services.ts` runs it in
 * `services.reconcile`, as its own step after `reconcileAgents`, whenever the root has built the HCP ports (backlog 2,
 * fb-W1). "Approved but not recorded" relies on this reconcile running at app start, so no approve flow may become
 * reachable without it.
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
 *   or an unreachable VTA, keeps it for the next reconcile (`kept`). The HCP flags turned off meanwhile (`off`) is not
 *   a failed revoke: the record is kept and the reconcile stops there.
 *
 * A record with no `grantId` learns it before the revoke. When no `grant.issued` event names it yet, there may be no
 * grant: if the grant's `expiresAt` has passed, or (approval in flight) the consent request was denied or expired,
 * there is nothing to revoke and the record is removed (`absent`); otherwise it is kept (`kept`, `grantNotIssued`).
 *
 * Then each retiring grant (a connection a newer one replaced, see `./store.ts`), marked `retiring: true`: if its
 * client's connection still names it (the app stopped inside `complete`, before the newer connection was written), it
 * is removed and nothing is sent (`current`), decided and removed in one step under the client's lock; otherwise its
 * grant is revoked as above (`revoked`, `absent`, `kept`, `off`).
 *
 * Does nothing unless both HCP flags are on. Nothing here logs a payload or a response.
 *
 * @module connected-agents/hcp/reconcile
 */
import type { HcpApprovalSource } from './approvals'
import { isHcpEnabled } from './hcpFlag'
import { HCP_GRANT_NOT_ISSUED, learnHcpGrantId } from './grantId'
import type { HcpConnectionStore } from './store'
import { HCP_GRANTS_REVOKE, type HcpApprovalInFlight, type HcpConnection, type HcpRetiringGrant } from './types'
import { callHcp, type HcpVtaPort, onHcpFailure } from './vtaPort'

/** The refusal code of a revoke for a grant the VTA does not hold. */
export const HCP_GRANT_NOT_FOUND = 'notFound'

export interface HcpReconcileDeps {
  store: Pick<
    HcpConnectionStore,
    | 'listInFlight'
    | 'get'
    | 'complete'
    | 'removeInFlight'
    | 'listRetiring'
    | 'removeRetiring'
    | 'removeRetiringIfCurrent'
  >
  source: Pick<HcpApprovalSource, 'list'>
  port: HcpVtaPort
  clock: () => Date
}

type RevokeOutcome =
  | { outcome: 'revoked' }
  | { outcome: 'absent' }
  | { outcome: 'kept'; refused?: string; unreachable?: true }
  | { outcome: 'off' }

/** `grantId` is absent when it could not be learnt. */
export type HcpReconcileOutcome = { id: string; threadId: string; grantId?: string } & (
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
    ...(flight.grantId ? { grantId: flight.grantId } : {}),
    threadId: flight.threadId,
    approvedAt: approvedAt.toISOString(),
    expiresAt: flight.expiresAt,
    ...(flight.chosenPurpose ? { chosenPurpose: flight.chosenPurpose } : {}),
  }
}

/** What revoking a record's grant needs. `noGrant`: with no `grant.issued` event yet, there is certainly none. */
interface RevokeTarget {
  id: string
  grantId?: string
  since?: string
  exclude: string[]
  noGrant: boolean
  remove: () => Promise<unknown>
}

/**
 * Revoke the target's grant, sent once, learning its id first if needed; `remove` drops the record when the VTA no
 * longer holds the grant. Gives the grant id it used, if any.
 */
async function revokeGrant(
  deps: HcpReconcileDeps,
  target: RevokeTarget
): Promise<RevokeOutcome & { grantId?: string }> {
  const { remove } = target
  let grantId = target.grantId
  if (!grantId) {
    const learnt = target.since
      ? await learnHcpGrantId(deps.port, { clientVid: target.id, since: target.since, exclude: target.exclude })
      : ({ ok: true, notIssued: true } as const)
    if (!learnt.ok) {
      return onHcpFailure<RevokeOutcome>(learnt, {
        refused: (code) => ({ outcome: 'kept', refused: code }),
        unreachable: () => ({ outcome: 'kept', unreachable: true }),
        off: () => ({ outcome: 'off' }),
      })
    }
    if (!('grantId' in learnt)) {
      if (!target.noGrant) return { outcome: 'kept', refused: HCP_GRANT_NOT_ISSUED }
      await remove()
      return { outcome: 'absent' }
    }
    grantId = learnt.grantId
  }
  return { grantId, ...(await sendRevoke(deps, grantId, remove)) }
}

async function sendRevoke(
  deps: HcpReconcileDeps,
  grantId: string,
  remove: () => Promise<unknown>
): Promise<RevokeOutcome> {
  const outcome = await callHcp<unknown>(deps.port, HCP_GRANTS_REVOKE, { grantId })
  if (outcome.ok) {
    await remove()
    return { outcome: 'revoked' }
  }
  return onHcpFailure<Promise<RevokeOutcome>>(outcome, {
    refused: async (code) => {
      if (code !== HCP_GRANT_NOT_FOUND) return { outcome: 'kept', refused: code }
      await remove()
      return { outcome: 'absent' }
    },
    unreachable: async () => ({ outcome: 'kept', unreachable: true }),
    // Not a failed revoke: the flags went off during the reconcile, which with them off does nothing. The record is
    // left as it is, for the first reconcile with the flags on.
    off: async () => ({ outcome: 'off' }),
  })
}

async function reconcileOne(deps: HcpReconcileDeps, flight: HcpApprovalInFlight): Promise<HcpReconcileOutcome> {
  const { id, threadId } = flight
  const ids = { id, threadId, ...(flight.grantId ? { grantId: flight.grantId } : {}) }
  const existing = await deps.store.get(id)
  if (existing?.threadId === threadId) {
    await deps.store.removeInFlight(id, threadId)
    return { ...ids, outcome: 'completed' }
  }
  // A newer approval for the same client completed after this one started: this grant is never made the connection.
  const superseded = !!existing && Date.parse(existing.approvedAt) >= Date.parse(flight.startedAt)

  const now = deps.clock()
  const approval = deps.source.list().find((a) => a.id === flight.approvalId)
  const requestEnds = Date.parse(flight.approvalExpiresAt)
  if (approval?.status === 'approved' && !superseded) {
    const approvedAt = new Date(Math.min(now.getTime(), Number.isNaN(requestEnds) ? now.getTime() : requestEnds))
    await deps.store.complete(connectionOf(flight, approvedAt), now)
    return { ...ids, outcome: 'completed' }
  }
  const settled = approval?.status === 'approved' || approval?.status === 'denied' || approval?.status === 'expired'
  if (!settled && now.getTime() < requestEnds) return { ...ids, outcome: 'waiting' }

  const revoked = await revokeGrant(deps, {
    id,
    grantId: flight.grantId,
    since: flight.startedAt,
    exclude: existing?.grantId ? [existing.grantId] : [],
    noGrant:
      Date.parse(flight.expiresAt) <= now.getTime() || approval?.status === 'denied' || approval?.status === 'expired',
    remove: () => deps.store.removeInFlight(id, threadId),
  })
  return { ...ids, ...revoked }
}

async function reconcileRetiring(deps: HcpReconcileDeps, retiring: HcpRetiringGrant): Promise<HcpReconcileOutcome> {
  const { id, threadId } = retiring
  const ids = { id, threadId, ...(retiring.grantId ? { grantId: retiring.grantId } : {}) }
  // Read and removed in one locked step: a `complete` between a separate read and remove could retire this grant
  // again and have its record removed while the grant is live.
  if (await deps.store.removeRetiringIfCurrent(id, threadId)) {
    return { ...ids, retiring: true, outcome: 'current' }
  }
  const current = await deps.store.get(id)
  const expiry = retiring.expiresAt ? Date.parse(retiring.expiresAt) : NaN
  const outcome = await revokeGrant(deps, {
    id,
    grantId: retiring.grantId,
    since: retiring.approvedAt,
    exclude: current?.grantId ? [current.grantId] : [],
    noGrant: !Number.isNaN(expiry) && expiry <= deps.clock().getTime(),
    remove: () => deps.store.removeRetiring(id, threadId),
  })
  return { ...ids, retiring: true, ...outcome }
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
  // A revoke answered `off` (the flags went off meanwhile) ends the reconcile there: with the flags off it does nothing.
  const off = () => results[results.length - 1]?.outcome === 'off'
  for (const flight of flights) {
    results.push(await reconcileOne(deps, flight))
    if (off()) return results
  }
  for (const retiring of await deps.store.listRetiring()) {
    results.push(await reconcileRetiring(deps, retiring))
    if (off()) return results
  }
  return results
}
