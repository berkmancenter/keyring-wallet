/**
 * Where the connected-agents logic keeps its state (docs/plans/agent-connect-plan.md §3.11, §3.2 step 5, §7.2):
 * one `AgentConnection` record per agent, the lockout's wrong-number times, and the request ids already used. All are
 * Credo generic records through `keyedRecords`, as the VTI stores keep theirs, so concurrent writers of one key queue
 * and a duplicate heals on the next read.
 *
 * @module connected-agents/store
 */

import type { Agent } from '@credo-ts/core'

import { deleteKeyed, getKeyed, listKeyed, putKeyed, withKeyLock } from '../trust-tasks/module/keyedRecords'
import type { LockoutStore } from './lockout'
import type { SpentRequestStore } from './pairing'
import type { AgentConnection } from './types'

const RECORD_TYPE = 'keyring/agent-connection'
const CONNECTION = 'connection'
const LOCKOUT = 'lockout'
const SPENT = 'spent-request'

/**
 * The `AgentConnection` records, one per agent, keyed by `id`: the agent's FIRST key, stable for the record's life.
 * `agentDid` is its CURRENT key, which step 7.10's reconcile records after a rotation (§3.9); look a record up by `id`,
 * and address the VTA by `agentDid`.
 */
export class AgentConnectionStore {
  public constructor(private readonly agent: Agent) {}

  public list(): Promise<AgentConnection[]> {
    return listKeyed<AgentConnection>(this.agent, RECORD_TYPE, CONNECTION)
  }

  public get(id: string): Promise<AgentConnection | undefined> {
    return getKeyed<AgentConnection>(this.agent, RECORD_TYPE, CONNECTION, id)
  }

  public put(record: AgentConnection): Promise<void> {
    return putKeyed(this.agent, RECORD_TYPE, CONNECTION, record.id, record as unknown as Record<string, unknown>)
  }

  /**
   * Read, change and write one record as a single step, so two writers cannot lose each other's change (the driver's
   * VDC grant and step 7.10's reconcile both write records at app start). `put` alone queues writes per key but does
   * not make a read-modify-write atomic. Every read-modify-write goes through here. Undefined when there is no record.
   */
  public update(
    id: string,
    change: (record: AgentConnection) => AgentConnection
  ): Promise<AgentConnection | undefined> {
    return withKeyLock(`${RECORD_TYPE}|update|${id}`, async () => {
      const record = await this.get(id)
      if (!record) return undefined
      const next = change(record)
      if (next.id !== id) throw new Error('an update cannot change a record id')
      await this.put(next)
      return next
    })
  }

  /** The record whose id or current key (`agentDid`) is `did`, if any. */
  public async findByKey(did: string): Promise<AgentConnection | undefined> {
    return (await this.list()).find((r) => r.id === did || r.agentDid === did)
  }

  public remove(id: string): Promise<void> {
    return deleteKeyed(this.agent, RECORD_TYPE, CONNECTION, id)
  }
}

/** The lockout's wrong-number times (§3.2 step 5), kept apart from any connection record, surviving a restart. */
export class KeyedLockoutStore implements LockoutStore {
  public constructor(private readonly agent: Agent) {}

  public async load(): Promise<number[]> {
    const stored = await getKeyed<{ times?: unknown }>(this.agent, RECORD_TYPE, LOCKOUT, 'times')
    return Array.isArray(stored?.times) ? stored.times.filter((t): t is number => typeof t === 'number') : []
  }

  public save(times: number[]): Promise<void> {
    return putKeyed(this.agent, RECORD_TYPE, LOCKOUT, 'times', { times: [...times] })
  }
}

/**
 * The request ids Keyring has used (§7.2: never claim one twice). An id is kept until a day after its `until`, long
 * after the VTA itself would refuse it, then dropped on the next `add`.
 */
export class KeyedSpentRequestStore implements SpentRequestStore {
  public static readonly KEEP_AFTER_MS = 24 * 60 * 60 * 1000

  public constructor(
    private readonly agent: Agent,
    private readonly clock: () => number = Date.now
  ) {}

  public async has(requestId: string): Promise<boolean> {
    return (await getKeyed(this.agent, RECORD_TYPE, SPENT, requestId)) !== undefined
  }

  public async add(requestId: string, until: number): Promise<void> {
    await putKeyed(this.agent, RECORD_TYPE, SPENT, requestId, { until })
    for (const id of await this.expired(this.clock())) {
      if (id !== requestId) await deleteKeyed(this.agent, RECORD_TYPE, SPENT, id)
    }
  }

  private async expired(now: number): Promise<string[]> {
    const records = await this.agent.genericRecords.findAllByQuery({ recordType: RECORD_TYPE, kind: SPENT })
    return records
      .filter((r) => {
        const until = (r.content as { until?: unknown }).until
        return typeof until === 'number' && until + KeyedSpentRequestStore.KEEP_AFTER_MS < now
      })
      .map((r) => (r.getTags ? r.getTags() : (r as unknown as { tags: Record<string, unknown> }).tags).key)
      .filter((k): k is string => typeof k === 'string')
  }
}
