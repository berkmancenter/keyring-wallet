/**
 * The record Keyring keeps of an approved HCP grant (step 7.27 track C, part 3, "The record (C2)"): one
 * `HcpConnection` per client, keyed by the client's VID, as a Credo generic record through `keyedRecords`, so
 * concurrent writers of one key queue and a duplicate heals on the next read.
 *
 * Its own record type: the base path's `AgentConnectionStore` (`../store.ts`) is not this, and neither store lists the
 * other's records.
 *
 * @module connected-agents/hcp/store
 */
import type { Agent } from '@credo-ts/core'

import { getKeyed, listKeyed, putKeyed, withKeyLock } from '../../trust-tasks/module/keyedRecords'
import type { HcpApprovalView, HcpConnection } from './types'

export const HCP_CONNECTION_RECORD_TYPE = 'keyring/hcp-connection'
export const HCP_CONNECTION_KIND = 'connection'

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

  // The record's own lock, distinct from `putKeyed`'s inner one, so taking both never waits on itself.
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

/**
 * Part 2's `onApproved`: writes the record. A new approval for a client already recorded replaces its record (one per
 * client VID, as the brief keys it).
 */
export function recordHcpApproval(
  store: Pick<HcpConnectionStore, 'put'>
): (view: HcpApprovalView, approvedAt: Date) => Promise<void> {
  return (view, approvedAt) => store.put(hcpConnectionFromApproval(view, approvedAt))
}
