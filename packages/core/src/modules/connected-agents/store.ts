/**
 * Where the connected-agents logic keeps its state (docs/plans/agent-connect-plan.md §3.11, §3.2 step 5, §7.2):
 * one `AgentConnection` record per agent, the lockout's wrong-number times, and the request ids already used. All are
 * Credo generic records through `keyedRecords`, as the VTI stores keep theirs, so concurrent writers of one key queue
 * and a duplicate heals on the next read.
 *
 * @module connected-agents/store
 */

import type { Agent } from '@credo-ts/core'

import { deleteKeyed, getKeyed, listKeyed, putKeyed } from '../trust-tasks/module/keyedRecords'
import type { LockoutStore } from './lockout'
import type { SpentRequestStore } from './pairing'
import type { AgentConnection } from './types'

const RECORD_TYPE = 'keyring/agent-connection'
const CONNECTION = 'connection'
const LOCKOUT = 'lockout'
const SPENT = 'spent-request'

/** The `AgentConnection` records, one per agent (keyed by the agent's DID). */
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
