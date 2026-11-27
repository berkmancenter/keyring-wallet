/**
 * The record Keyring keeps of an approved HCP grant (step 7.27 track C, part 3, "The record (C2)"): one
 * `HcpConnection` per client, keyed by the client's VID, as a Credo generic record through `keyedRecords`, so
 * concurrent writers of one key queue and a duplicate heals on the next read.
 *
 * Before an approval, an {@link HcpApprovalInFlight} is written under its own kind, keyed by the grant the approval
 * would create (the pattern of the base path's `../revoke.ts`, where a record moves to `revoking` before the VTA is
 * called). Keyed by grant, not by client, so a second approval for the same client is written beside the first and
 * never over it. It becomes the connection once the approval is confirmed; if the approval fails, or the app stops in
 * between, it stays, and `./reconcile.ts` completes it or revokes its grant.
 *
 * A connection replaced by a newer one for the same client while its grant may still be live (not revoked) becomes an
 * {@link HcpRetiringGrant}, written in the same step as the new connection, and the reconcile revokes it. So there is
 * no moment when the VTA can hold a grant Keyring's approval created while Keyring holds no record of it: every such
 * grant is named by a connection, an approval in flight or a retiring grant, and the reconcile reads the last two.
 *
 * Its own record type: the base path's `AgentConnectionStore` (`../store.ts`) is not this, and neither store lists the
 * other's records.
 *
 * @module connected-agents/hcp/store
 */
import type { Agent } from '@credo-ts/core'

import { deleteKeyed, getKeyed, listKeyed, putKeyed, withKeyLock } from '../../trust-tasks/module/keyedRecords'
import type { HcpApprovalInFlight, HcpApprovalView, HcpConnection, HcpRetiringGrant } from './types'

export const HCP_CONNECTION_RECORD_TYPE = 'keyring/hcp-connection'
export const HCP_CONNECTION_KIND = 'connection'
/**
 * The kind of an {@link HcpApprovalInFlight}: the same record type, keyed by `grantId`. Every write of one is made under
 * its client's lock, the connection's, so one lock covers all of a client's records.
 */
export const HCP_APPROVAL_IN_FLIGHT_KIND = 'approving'
/** The kind of an {@link HcpRetiringGrant}: the same record type, keyed by `grantId`, written under the client's lock. */
export const HCP_RETIRING_KIND = 'retiring'

/** What `revoke.ts` and the hook need of the store. */
export type HcpConnectionReader = Pick<HcpConnectionStore, 'get' | 'update'>

export class HcpConnectionStore {
  public constructor(private readonly agent: Agent) {}

  public list(): Promise<HcpConnection[]> {
    return listKeyed<HcpConnection>(this.agent, HCP_CONNECTION_RECORD_TYPE, HCP_CONNECTION_KIND)
  }

  public get(id: string): Promise<HcpConnection | undefined> {
    return getKeyed<HcpConnection>(this.agent, HCP_CONNECTION_RECORD_TYPE, HCP_CONNECTION_KIND, id)
  }

  /** Write a whole record, after any write of the same record in progress. */
  public put(record: HcpConnection): Promise<void> {
    return this.locked(record.id, () => this.write(record))
  }

  /**
   * Read, change and write one record as a single step, so a revoke and a poll of the same record cannot lose each
   * other's change. Undefined when there is no record. A change that returns the very record it was given writes
   * nothing. A change cannot change the record's `id` (it throws).
   */
  public update(id: string, change: (record: HcpConnection) => HcpConnection): Promise<HcpConnection | undefined> {
    return this.locked(id, async () => {
      const current = await this.get(id)
      if (!current) return undefined
      const next = change(current)
      if (next === current) return current
      if (next.id !== id) throw new Error('an update cannot change a record id')
      await this.write(next)
      return next
    })
  }

  /** Every approval in flight, one per grant (a client can have several). */
  public listInFlight(): Promise<HcpApprovalInFlight[]> {
    return listKeyed<HcpApprovalInFlight>(this.agent, HCP_CONNECTION_RECORD_TYPE, HCP_APPROVAL_IN_FLIGHT_KIND)
  }

  /** The approval in flight for a grant. */
  public getInFlight(grantId: string): Promise<HcpApprovalInFlight | undefined> {
    return getKeyed<HcpApprovalInFlight>(this.agent, HCP_CONNECTION_RECORD_TYPE, HCP_APPROVAL_IN_FLIGHT_KIND, grantId)
  }

  /**
   * Write the approval in flight for its grant. An earlier approval in flight for the same client, for another grant,
   * is kept beside it, and the client's connection is not touched.
   */
  public putInFlight(record: HcpApprovalInFlight): Promise<void> {
    return this.locked(record.id, () =>
      putKeyed(
        this.agent,
        HCP_CONNECTION_RECORD_TYPE,
        HCP_APPROVAL_IN_FLIGHT_KIND,
        record.grantId,
        record as unknown as Record<string, unknown>
      )
    )
  }

  /** Remove the approval in flight for `grantId` if it is client `id`'s. Returns whether one was removed. */
  public removeInFlight(id: string, grantId: string): Promise<boolean> {
    return this.locked(id, () => this.drop(HCP_APPROVAL_IN_FLIGHT_KIND, id, grantId))
  }

  /** Every retiring grant: one whose connection a newer one replaced while the grant may still be live. */
  public listRetiring(): Promise<HcpRetiringGrant[]> {
    return listKeyed<HcpRetiringGrant>(this.agent, HCP_CONNECTION_RECORD_TYPE, HCP_RETIRING_KIND)
  }

  /** Remove the retiring grant `grantId` if it is client `id`'s. Returns whether one was removed. */
  public removeRetiring(id: string, grantId: string): Promise<boolean> {
    return this.locked(id, () => this.drop(HCP_RETIRING_KIND, id, grantId))
  }

  /**
   * Make a confirmed approval the client's connection, as one step under the client's lock: write `connection`, then
   * remove the approval in flight for its grant. Stopping between the two leaves both, which the reconcile resolves
   * by removing the approval in flight (the connection already names its grant).
   *
   * The client's connection for another grant is never dropped while that grant may be live:
   * - if it is not revoked, its grant is first written as an {@link HcpRetiringGrant}, which the reconcile revokes;
   * - if it was approved after this one (a later `approvedAt`), it stays the connection, and this grant is the one
   *   written as retiring.
   */
  public complete(connection: HcpConnection, now: Date = new Date()): Promise<void> {
    return this.locked(connection.id, async () => {
      const existing = await this.get(connection.id)
      if (existing && existing.grantId !== connection.grantId) {
        if (Date.parse(existing.approvedAt) > Date.parse(connection.approvedAt)) {
          await this.retire(connection, now)
          await this.drop(HCP_APPROVAL_IN_FLIGHT_KIND, connection.id, connection.grantId)
          return
        }
        if (!existing.revokedAt) await this.retire(existing, now)
      }
      await this.write(connection)
      await this.drop(HCP_APPROVAL_IN_FLIGHT_KIND, connection.id, connection.grantId)
    })
  }

  private retire(c: HcpConnection, at: Date): Promise<void> {
    const record: HcpRetiringGrant = {
      id: c.id,
      name: c.name,
      grantId: c.grantId,
      threadId: c.threadId,
      retiredAt: at.toISOString(),
    }
    return putKeyed(
      this.agent,
      HCP_CONNECTION_RECORD_TYPE,
      HCP_RETIRING_KIND,
      record.grantId,
      record as unknown as Record<string, unknown>
    )
  }

  private async drop(kind: string, id: string, grantId: string): Promise<boolean> {
    const current = await getKeyed<{ id: string }>(this.agent, HCP_CONNECTION_RECORD_TYPE, kind, grantId)
    if (!current || current.id !== id) return false
    await deleteKeyed(this.agent, HCP_CONNECTION_RECORD_TYPE, kind, grantId)
    return true
  }

  // The client's own lock, distinct from `putKeyed`'s inner one, so taking both never waits on itself.
  private locked<T>(id: string, work: () => Promise<T>): Promise<T> {
    return withKeyLock(`${HCP_CONNECTION_RECORD_TYPE}|record|${id}`, work)
  }

  private write(record: HcpConnection): Promise<void> {
    return putKeyed(
      this.agent,
      HCP_CONNECTION_RECORD_TYPE,
      HCP_CONNECTION_KIND,
      record.id,
      record as unknown as Record<string, unknown>
    )
  }
}

/**
 * The record for an approval: `approvedAt` is when `decide(approve)` resolved, `expiresAt` that plus the view's
 * `expiresInSeconds`, and the name is the one the person gave (the view's title), never the request's.
 */
export function hcpConnectionFromApproval(view: HcpApprovalView, approvedAt: Date): HcpConnection {
  return {
    id: view.clientVid,
    name: view.title.params.name,
    grantId: view.grantId,
    threadId: view.threadId,
    approvedAt: approvedAt.toISOString(),
    expiresAt: new Date(approvedAt.getTime() + view.expiresInSeconds * 1000).toISOString(),
  }
}

/** The approval in flight for `view`, written at `startedAt`, just before `decide(approve)`. */
export function hcpApprovalInFlight(
  view: HcpApprovalView,
  approval: { id: string; expiresAt: string },
  startedAt: Date
): HcpApprovalInFlight {
  return {
    id: view.clientVid,
    name: view.title.params.name,
    grantId: view.grantId,
    threadId: view.threadId,
    approvalId: approval.id,
    approvalExpiresAt: approval.expiresAt,
    expiresInSeconds: view.expiresInSeconds,
    startedAt: startedAt.toISOString(),
  }
}

/**
 * Part 2's `beforeApprove`: writes the approval in flight, before the VTA is asked to approve. If this write fails, the
 * flow does not approve.
 */
export function beginHcpApproval(
  store: Pick<HcpConnectionStore, 'putInFlight'>
): (view: HcpApprovalView, approval: { id: string; expiresAt: string }, startedAt: Date) => Promise<void> {
  return (view, approval, startedAt) => store.putInFlight(hcpApprovalInFlight(view, approval, startedAt))
}

/**
 * Part 2's `onApproved`: makes the approval in flight the client's connection. A new approval for a client already
 * recorded replaces its connection (one per client VID, as the brief keys it); the grant it replaced, unless revoked,
 * is kept as a retiring grant for the reconcile to revoke (see {@link HcpConnectionStore.complete}).
 */
export function recordHcpApproval(
  store: Pick<HcpConnectionStore, 'complete'>
): (view: HcpApprovalView, approvedAt: Date) => Promise<void> {
  return (view, approvedAt) => store.complete(hcpConnectionFromApproval(view, approvedAt), approvedAt)
}
