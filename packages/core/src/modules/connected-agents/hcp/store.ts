/**
 * The record Keyring keeps of an approved HCP grant (step 7.27 track C, part 3, "The record (C2)"): one
 * `HcpConnection` per client, keyed by the client's VID, as a Credo generic record through `keyedRecords`, so
 * concurrent writers of one key queue and a duplicate heals on the next read.
 *
 * Before an approval, an {@link HcpApprovalInFlight} is written under its own kind, with the same key, naming the
 * grant the approval would create (the pattern of the base path's `../revoke.ts`, where a record moves to `revoking`
 * before the VTA is called). It becomes the connection once the approval is confirmed; if the approval fails, or the
 * app stops in between, it stays, and `./reconcile.ts` completes it or revokes its grant. So there is no moment when
 * the VTA can hold a grant Keyring's approval created while Keyring holds no record of it.
 *
 * Its own record type: the base path's `AgentConnectionStore` (`../store.ts`) is not this, and neither store lists the
 * other's records.
 *
 * @module connected-agents/hcp/store
 */
import type { Agent } from '@credo-ts/core'

import { deleteKeyed, getKeyed, listKeyed, putKeyed, withKeyLock } from '../../trust-tasks/module/keyedRecords'
import type { HcpApprovalInFlight, HcpApprovalView, HcpConnection } from './types'

export const HCP_CONNECTION_RECORD_TYPE = 'keyring/hcp-connection'
export const HCP_CONNECTION_KIND = 'connection'
/** The kind of an {@link HcpApprovalInFlight}: the same record type and key, so one lock covers a client's two records. */
export const HCP_APPROVAL_IN_FLIGHT_KIND = 'approving'

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

  /** Every approval in flight, one per client VID. */
  public listInFlight(): Promise<HcpApprovalInFlight[]> {
    return listKeyed<HcpApprovalInFlight>(this.agent, HCP_CONNECTION_RECORD_TYPE, HCP_APPROVAL_IN_FLIGHT_KIND)
  }

  public getInFlight(id: string): Promise<HcpApprovalInFlight | undefined> {
    return getKeyed<HcpApprovalInFlight>(this.agent, HCP_CONNECTION_RECORD_TYPE, HCP_APPROVAL_IN_FLIGHT_KIND, id)
  }

  /** Write the approval in flight for its client, replacing an earlier one. The client's connection is not touched. */
  public putInFlight(record: HcpApprovalInFlight): Promise<void> {
    return this.locked(record.id, () =>
      putKeyed(
        this.agent,
        HCP_CONNECTION_RECORD_TYPE,
        HCP_APPROVAL_IN_FLIGHT_KIND,
        record.id,
        record as unknown as Record<string, unknown>
      )
    )
  }

  /**
   * Remove the client's approval in flight if it is still the one for `grantId` (a newer approval's is kept). Returns
   * whether one was removed.
   */
  public removeInFlight(id: string, grantId: string): Promise<boolean> {
    return this.locked(id, () => this.dropInFlight(id, grantId))
  }

  /**
   * Make a confirmed approval the client's connection, as one step under the client's lock: write `connection`, then
   * remove the approval in flight for its grant. Stopping between the two leaves both, which the reconcile resolves
   * by removing the approval in flight (the connection already names its grant).
   */
  public complete(connection: HcpConnection): Promise<void> {
    return this.locked(connection.id, async () => {
      await this.write(connection)
      await this.dropInFlight(connection.id, connection.grantId)
    })
  }

  private async dropInFlight(id: string, grantId: string): Promise<boolean> {
    const current = await this.getInFlight(id)
    if (!current || current.grantId !== grantId) return false
    await deleteKeyed(this.agent, HCP_CONNECTION_RECORD_TYPE, HCP_APPROVAL_IN_FLIGHT_KIND, id)
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
 * recorded replaces its record (one per client VID, as the brief keys it).
 */
export function recordHcpApproval(
  store: Pick<HcpConnectionStore, 'complete'>
): (view: HcpApprovalView, approvedAt: Date) => Promise<void> {
  return (view, approvedAt) => store.complete(hcpConnectionFromApproval(view, approvedAt))
}
