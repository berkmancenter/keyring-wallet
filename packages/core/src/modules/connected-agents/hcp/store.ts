/**
 * The record Keyring keeps of an approved HCP grant (step 7.27 track C, part 3, "The record (C2)"): one
 * `HcpConnection` per client, keyed by the client's VID, as a Credo generic record through `keyedRecords`, so
 * concurrent writers of one key queue and a duplicate heals on the next read.
 *
 * Before an approval, an {@link HcpApprovalInFlight} is written under its own kind, keyed by the request's thread, which
 * names the one grant the approval would create (VTI hcp.md §5.1 pre-assigns no `grantId`) (the pattern of the base path's `../revoke.ts`, where a record moves to `revoking` before the VTA is
 * called). Keyed by thread, not by client, so a second approval for the same client is written beside the first and
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
import type { HcpHeldApproval } from './grantId'
import type { HcpApprovalInFlight, HcpApprovalView, HcpConnection, HcpRetiringGrant } from './types'

export const HCP_CONNECTION_RECORD_TYPE = 'keyring/hcp-connection'
export const HCP_CONNECTION_KIND = 'connection'
/**
 * The kind of an {@link HcpApprovalInFlight}: the same record type, keyed by `threadId`. Every write of one is made under
 * its client's lock, the connection's, so one lock covers all of a client's records.
 */
export const HCP_APPROVAL_IN_FLIGHT_KIND = 'approving'
/** The kind of an {@link HcpRetiringGrant}: the same record type, keyed by `threadId`, written under the client's lock. */
export const HCP_RETIRING_KIND = 'retiring'

/** What `revoke.ts` and the hook need of the store. */
export type HcpConnectionReader = Pick<HcpConnectionStore, 'get' | 'update' | 'heldFor'>

const readable = (t: unknown) => typeof t === 'string' && !Number.isNaN(Date.parse(t))

/**
 * Records written before the §5.1 contract were keyed by `grantId`, an approval in flight with `expiresInSeconds` and
 * no `expiresAt`, a retiring grant with no `expiresAt`. They are ignored (never listed, never revoked or removed):
 * the feature was behind `hcpEnabled=false`, and reading them would key and date them wrongly.
 */
const isCurrentInFlight = (r: HcpApprovalInFlight) =>
  typeof r.threadId === 'string' && readable(r.expiresAt) && readable(r.startedAt) && readable(r.approvalExpiresAt)
const isCurrentRetiring = (r: HcpRetiringGrant) => typeof r.threadId === 'string' && readable(r.expiresAt)

/** A connection's approval, for learning a grant (`./grantId.ts`). */
export const heldOfConnection = (c: HcpConnection): HcpHeldApproval => ({
  threadId: c.threadId,
  ...(c.grantId ? { grantId: c.grantId } : {}),
  since: c.approvalStartedAt ?? c.approvedAt,
  decidedBy: c.approvedAt,
})

/** An approval in flight's approval: it cannot have been decided after the request's own `expiresAt`. */
export const heldOfInFlight = (f: HcpApprovalInFlight): HcpHeldApproval => ({
  threadId: f.threadId,
  ...(f.grantId ? { grantId: f.grantId } : {}),
  since: f.startedAt,
  decidedBy: f.approvalExpiresAt,
})

/** A retiring grant's approval. */
export const heldOfRetiring = (r: HcpRetiringGrant): HcpHeldApproval => ({
  threadId: r.threadId,
  ...(r.grantId ? { grantId: r.grantId } : {}),
  ...(r.approvalStartedAt || r.approvedAt ? { since: r.approvalStartedAt ?? r.approvedAt } : {}),
  ...(r.approvedAt ? { decidedBy: r.approvedAt } : {}),
})

/** What a record keeps once its grant is learnt. */
export type HcpLearntGrant = Pick<HcpConnection, 'grantIssuedAt' | 'grantExpiresAt'> & { grantId: string }

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

  /** Every approval in flight, one per grant (a client can have several). Pre-§5.1 records are left out. */
  public async listInFlight(): Promise<HcpApprovalInFlight[]> {
    const all = await listKeyed<HcpApprovalInFlight>(
      this.agent,
      HCP_CONNECTION_RECORD_TYPE,
      HCP_APPROVAL_IN_FLIGHT_KIND
    )
    return all.filter(isCurrentInFlight)
  }

  /**
   * Every approval Keyring holds for client `id`: its connection, its approvals in flight and its retiring grants.
   * Learning a grant excludes their grant ids and compares their windows (`./grantId.ts`).
   */
  public async heldFor(id: string): Promise<HcpHeldApproval[]> {
    const [connection, flights, retiring] = await Promise.all([this.get(id), this.listInFlight(), this.listRetiring()])
    return [
      ...(connection ? [heldOfConnection(connection)] : []),
      ...flights.filter((f) => f.id === id).map(heldOfInFlight),
      ...retiring.filter((r) => r.id === id).map(heldOfRetiring),
    ]
  }

  /**
   * Keep a grant learnt for the approval in flight or retiring grant of thread `threadId`, if it is client `id`'s and
   * names no grant yet, before anything is sent for it. Returns whether it was written.
   */
  public rememberGrant(
    kind: typeof HCP_APPROVAL_IN_FLIGHT_KIND | typeof HCP_RETIRING_KIND,
    id: string,
    threadId: string,
    learnt: HcpLearntGrant
  ): Promise<boolean> {
    return this.locked(id, async () => {
      const current = await getKeyed<{ id: string; grantId?: string }>(
        this.agent,
        HCP_CONNECTION_RECORD_TYPE,
        kind,
        threadId
      )
      if (!current || current.id !== id || current.grantId) return false
      await putKeyed(this.agent, HCP_CONNECTION_RECORD_TYPE, kind, threadId, { ...current, ...learnt })
      return true
    })
  }

  /** The approval in flight for a request's thread. */
  public getInFlight(threadId: string): Promise<HcpApprovalInFlight | undefined> {
    return getKeyed<HcpApprovalInFlight>(this.agent, HCP_CONNECTION_RECORD_TYPE, HCP_APPROVAL_IN_FLIGHT_KIND, threadId)
  }

  /**
   * Write the approval in flight for its thread (so for its grant). Rewriting it with the same thread (to add a
   * `grantId` learnt later) replaces it. An earlier approval in flight for the same client, for another grant,
   * is kept beside it, and the client's connection is not touched.
   */
  public putInFlight(record: HcpApprovalInFlight): Promise<void> {
    return this.locked(record.id, () =>
      putKeyed(
        this.agent,
        HCP_CONNECTION_RECORD_TYPE,
        HCP_APPROVAL_IN_FLIGHT_KIND,
        record.threadId,
        record as unknown as Record<string, unknown>
      )
    )
  }

  /** Remove the approval in flight for `threadId` if it is client `id`'s. Returns whether one was removed. */
  public removeInFlight(id: string, threadId: string): Promise<boolean> {
    return this.locked(id, () => this.drop(HCP_APPROVAL_IN_FLIGHT_KIND, id, threadId))
  }

  /**
   * Every retiring grant: one whose connection a newer one replaced while the grant may still be live. Pre-§5.1
   * records are left out.
   */
  public async listRetiring(): Promise<HcpRetiringGrant[]> {
    const all = await listKeyed<HcpRetiringGrant>(this.agent, HCP_CONNECTION_RECORD_TYPE, HCP_RETIRING_KIND)
    return all.filter(isCurrentRetiring)
  }

  /** Remove the retiring grant of thread `threadId` if it is client `id`'s. Returns whether one was removed. */
  public removeRetiring(id: string, threadId: string): Promise<boolean> {
    return this.locked(id, () => this.drop(HCP_RETIRING_KIND, id, threadId))
  }

  /**
   * If client `id`'s connection still names thread `threadId` (the app stopped inside {@link complete}, between writing
   * the retiring grant and the new connection), remove that retiring grant and return true: the grant is the
   * connection, not retiring. Otherwise remove nothing and return false. Decided and done as one step under the
   * client's lock, so a `complete` that retires the grant again in between cannot have its record removed.
   */
  public removeRetiringIfCurrent(id: string, threadId: string): Promise<boolean> {
    return this.locked(id, async () => {
      if ((await this.get(id))?.threadId !== threadId) return false
      await this.drop(HCP_RETIRING_KIND, id, threadId)
      return true
    })
  }

  /**
   * Make a confirmed approval the client's connection, as one step under the client's lock: write `connection`, then
   * remove the approval in flight for its thread. Stopping between the two leaves both, which the reconcile resolves
   * by removing the approval in flight (the connection already names its grant).
   *
   * The client's connection for another grant is never dropped while that grant may be live:
   * - if it is not revoked, its grant is first written as an {@link HcpRetiringGrant}, which the reconcile revokes;
   * - if it was approved after this one (a later `approvedAt`), it stays the connection, and this grant is the one
   *   written as retiring.
   *
   * A connection with no `approvalStartedAt` takes its approval in flight's `startedAt`.
   */
  public complete(record: HcpConnection, now: Date = new Date()): Promise<void> {
    return this.locked(record.id, async () => {
      const flight = record.approvalStartedAt
        ? undefined
        : await getKeyed<HcpApprovalInFlight>(
            this.agent,
            HCP_CONNECTION_RECORD_TYPE,
            HCP_APPROVAL_IN_FLIGHT_KIND,
            record.threadId
          )
      const connection: HcpConnection =
        flight?.id === record.id && readable(flight.startedAt)
          ? { ...record, approvalStartedAt: flight.startedAt }
          : record
      const existing = await this.get(connection.id)
      if (existing && existing.threadId !== connection.threadId) {
        if (Date.parse(existing.approvedAt) > Date.parse(connection.approvedAt)) {
          await this.retire(connection, now)
          await this.drop(HCP_APPROVAL_IN_FLIGHT_KIND, connection.id, connection.threadId)
          return
        }
        if (!existing.revokedAt) await this.retire(existing, now)
      }
      await this.write(connection)
      await this.drop(HCP_APPROVAL_IN_FLIGHT_KIND, connection.id, connection.threadId)
    })
  }

  private retire(c: HcpConnection, at: Date): Promise<void> {
    const record: HcpRetiringGrant = {
      id: c.id,
      name: c.name,
      ...(c.grantId ? { grantId: c.grantId } : {}),
      ...(c.grantIssuedAt ? { grantIssuedAt: c.grantIssuedAt } : {}),
      ...(c.grantExpiresAt ? { grantExpiresAt: c.grantExpiresAt } : {}),
      threadId: c.threadId,
      expiresAt: c.expiresAt,
      ...(c.approvalStartedAt ? { approvalStartedAt: c.approvalStartedAt } : {}),
      approvedAt: c.approvedAt,
      retiredAt: at.toISOString(),
    }
    return putKeyed(
      this.agent,
      HCP_CONNECTION_RECORD_TYPE,
      HCP_RETIRING_KIND,
      record.threadId,
      record as unknown as Record<string, unknown>
    )
  }

  private async drop(kind: string, id: string, threadId: string): Promise<boolean> {
    const current = await getKeyed<{ id: string }>(this.agent, HCP_CONNECTION_RECORD_TYPE, kind, threadId)
    if (!current || current.id !== id) return false
    await deleteKeyed(this.agent, HCP_CONNECTION_RECORD_TYPE, kind, threadId)
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
 * The record for an approval: `approvedAt` is when `decide(approve)` resolved, `expiresAt` the `hcpGrantTerm`
 * effect's, `grantId` only if the request carried one, and the name is the one the person gave (the view's title), never the request's.
 */
export function hcpConnectionFromApproval(view: HcpApprovalView, approvedAt: Date): HcpConnection {
  return {
    id: view.clientVid,
    name: view.title.params.name,
    ...(view.grantId ? { grantId: view.grantId } : {}),
    threadId: view.threadId,
    approvedAt: approvedAt.toISOString(),
    expiresAt: view.expiresAt,
    ...(view.chosenPurpose ? { chosenPurpose: view.chosenPurpose } : {}),
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
    ...(view.grantId ? { grantId: view.grantId } : {}),
    threadId: view.threadId,
    approvalId: approval.id,
    approvalExpiresAt: approval.expiresAt,
    expiresAt: view.expiresAt,
    ...(view.chosenPurpose ? { chosenPurpose: view.chosenPurpose } : {}),
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
