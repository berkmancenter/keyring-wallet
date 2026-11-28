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
 * - otherwise the grant is revoked by `grantId`, sent once: revoked, or refused as no such grant (`notFound`, or
 *   `permissionDenied`, which is how TT `hcp/grants/revoke` refuses a grantId the VTA does not hold for this
 *   Management Client; either way there is nothing to revoke), removes the approval in flight (`revoked`,
 *   `absent`); any other refusal,
 *   or an unreachable VTA, keeps it for the next reconcile (`kept`). `permissionDenied` is "no such grant" only for a
 *   `grantId` never seen in a `grant.issued` event (one the request pre-assigned): for a grant the log showed issued,
 *   it means Keyring is not (or no longer) recognised as Management Client, so the record is kept. The HCP flags turned off meanwhile (`off`) is not
 *   a failed revoke: the record is kept and the reconcile stops there.
 *
 * A record with no `grantId` learns it before the revoke, from its approval's start and excluding every grant Keyring
 * holds for the client, and keeps it on the record before anything is sent (`./grantId.ts`). When no `grant.issued`
 * event names it yet, or Keyring cannot tell which one does, there may be no grant of ours: if the grant's
 * `expiresAt` has passed, or (approval in flight) the consent request was denied or expired, there is nothing to
 * revoke and the record is removed (`absent`); otherwise it is kept (`kept`, `grantNotIssued` or `grantAmbiguous`).
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
import {
  HCP_GRANT_AMBIGUOUS,
  HCP_GRANT_NOT_ISSUED,
  type HcpHeldApproval,
  learnHcpGrantId,
  learntGrantFields,
} from './grantId'
import {
  HCP_APPROVAL_IN_FLIGHT_KIND,
  HCP_RETIRING_KIND,
  heldOfInFlight,
  heldOfRetiring,
  type HcpConnectionStore,
} from './store'
import { HCP_GRANTS_REVOKE, type HcpApprovalInFlight, type HcpConnection, type HcpRetiringGrant } from './types'
import { callHcp, type HcpVtaPort, onHcpFailure } from './vtaPort'

/** The refusal code of a revoke for a grant the VTA does not hold. */
export const HCP_GRANT_NOT_FOUND = 'notFound'

/**
 * TT `hcp/grants/revoke` refuses an unknown grantId (or one not the Management Client's to revoke) with
 * `permissionDenied`, not `notFound`, so as not to tell which grants exist. For the reconcile, whose record names a
 * grant it may never have been issued, that too means there is nothing to revoke: terminal, like `notFound`.
 */
export const HCP_REVOKE_NO_SUCH_GRANT = 'permissionDenied'

/**
 * Whether a refusal means there is no such grant to revoke: `notFound` always; `permissionDenied` only for a grant
 * never seen issued, since for one the log showed issued it means Keyring's issuer is not (or no longer) recognised
 * as Management Client (VTI hcp.md §4.4), and the grant may well be live.
 */
const noSuchGrant = (code: string, seenIssued: boolean) =>
  code === HCP_GRANT_NOT_FOUND || (code === HCP_REVOKE_NO_SUCH_GRANT && !seenIssued)

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
    | 'heldFor'
    | 'rememberGrant'
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
    ...(flight.grantIssuedAt ? { grantIssuedAt: flight.grantIssuedAt } : {}),
    ...(flight.grantExpiresAt ? { grantExpiresAt: flight.grantExpiresAt } : {}),
    threadId: flight.threadId,
    approvalStartedAt: flight.startedAt,
    approvedAt: approvedAt.toISOString(),
    expiresAt: flight.expiresAt,
    ...(flight.chosenPurpose ? { chosenPurpose: flight.chosenPurpose } : {}),
  }
}

/** What revoking a record's grant needs. `noGrant`: with no `grant.issued` event of ours, there is certainly none. */
interface RevokeTarget {
  id: string
  kind: typeof HCP_APPROVAL_IN_FLIGHT_KIND | typeof HCP_RETIRING_KIND
  record: HcpHeldApproval
  /** Set when the record's `grantId` was seen in a `grant.issued` event. */
  grantIssuedAt?: string
  noGrant: boolean
  remove: () => Promise<unknown>
}

/**
 * Revoke the target's grant, sent once, learning its id first if needed (and keeping it on the record before the
 * revoke is sent); `remove` drops the record when the VTA no longer holds the grant. Gives the grant id it used.
 */
async function revokeGrant(
  deps: HcpReconcileDeps,
  target: RevokeTarget
): Promise<RevokeOutcome & { grantId?: string }> {
  const { id, remove } = target
  let grantId = target.record.grantId
  let seenIssued = !!target.grantIssuedAt
  if (!grantId) {
    const held = await deps.store.heldFor(id)
    const learnt = await learnHcpGrantId(deps.port, { clientVid: id, record: target.record, held })
    if (!learnt.ok) {
      return onHcpFailure<RevokeOutcome>(learnt, {
        refused: (code) => ({ outcome: 'kept', refused: code }),
        unreachable: () => ({ outcome: 'kept', unreachable: true }),
        off: () => ({ outcome: 'off' }),
      })
    }
    if (!('grantId' in learnt)) {
      if (!target.noGrant) {
        return { outcome: 'kept', refused: 'ambiguous' in learnt ? HCP_GRANT_AMBIGUOUS : HCP_GRANT_NOT_ISSUED }
      }
      await remove()
      return { outcome: 'absent' }
    }
    const fields = learntGrantFields(learnt)
    // Kept before the revoke, so a stop or a refusal from here on leaves the same answer for the next reconcile.
    await deps.store.rememberGrant(target.kind, id, target.record.threadId, fields)
    grantId = fields.grantId
    seenIssued = true
  }
  return { grantId, ...(await sendRevoke(deps, grantId, seenIssued, remove)) }
}

async function sendRevoke(
  deps: HcpReconcileDeps,
  grantId: string,
  seenIssued: boolean,
  remove: () => Promise<unknown>
): Promise<RevokeOutcome> {
  const outcome = await callHcp<unknown>(deps.port, HCP_GRANTS_REVOKE, { grantId })
  if (outcome.ok) {
    await remove()
    return { outcome: 'revoked' }
  }
  return onHcpFailure<Promise<RevokeOutcome>>(outcome, {
    refused: async (code) => {
      if (!noSuchGrant(code, seenIssued)) return { outcome: 'kept', refused: code }
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
    kind: HCP_APPROVAL_IN_FLIGHT_KIND,
    record: heldOfInFlight(flight),
    ...(flight.grantIssuedAt ? { grantIssuedAt: flight.grantIssuedAt } : {}),
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
  const expiry = retiring.expiresAt ? Date.parse(retiring.expiresAt) : NaN
  const outcome = await revokeGrant(deps, {
    id,
    kind: HCP_RETIRING_KIND,
    record: heldOfRetiring(retiring),
    ...(retiring.grantIssuedAt ? { grantIssuedAt: retiring.grantIssuedAt } : {}),
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
