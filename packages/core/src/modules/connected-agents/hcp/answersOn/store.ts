/**
 * What Keyring knows of the "Answers on" directives it set (step 7.29, C5). The provider cannot be asked which
 * directives are set (`directives/list` is P2), so Keyring keeps its own record per connection ("Decided here"):
 * generic keyed records, `recordType: 'keyring/hcp-answers'`, keyed by the connection's `id` (the client's VID). No
 * record means `off`. A record is written only after the provider answered success (`./view.ts`).
 *
 * Its own record type: neither `../store.ts` nor the base path's store lists these, and they list neither.
 *
 * @module connected-agents/hcp/answersOn/store
 */
import type { Agent } from '@credo-ts/core'

import { getKeyed, listKeyed, putKeyed, withKeyLock } from '../../../trust-tasks/module/keyedRecords'

export const HCP_ANSWERS_RECORD_TYPE = 'keyring/hcp-answers'
export const HCP_ANSWERS_KIND = 'answers'

/**
 * The switch's three states. `off`: no directive was ever set (a client that does not recognize the action never
 * treats it as permission, HCP 6.4). `on`: a `permit` was set. `offForGood`: a `deny` was set, which no later `permit`
 * can override until `directives/remove` exists.
 */
export type HcpAnswersState = 'off' | 'on' | 'offForGood'

/** One connection's record. Times are ISO-8601 instants. */
export type HcpAnswersRecord = {
  /** The connection's `id`, the client's VID: the record's key. */
  id: string
  state: 'on' | 'offForGood'
  /** The directive the VTA set, or null if its answer named none (`./directive.ts`). */
  directiveId: string | null
  /** When the VTA's answer arrived. */
  setAt: string
  /**
   * The Client Operator the directive names (`operators`). Kept beside the brief's three members because a directive
   * applies to the operator, not the connection: a `deny` set through one connection holds for every connection of
   * the same operator.
   */
  operatorId: string
}

export class HcpAnswersStore {
  public constructor(private readonly agent: Agent) {}

  public get(id: string): Promise<HcpAnswersRecord | undefined> {
    return getKeyed<HcpAnswersRecord>(this.agent, HCP_ANSWERS_RECORD_TYPE, HCP_ANSWERS_KIND, id)
  }

  public list(): Promise<HcpAnswersRecord[]> {
    return listKeyed<HcpAnswersRecord>(this.agent, HCP_ANSWERS_RECORD_TYPE, HCP_ANSWERS_KIND)
  }

  /** Write a connection's record, replacing any it had. */
  public put(record: HcpAnswersRecord): Promise<void> {
    return putKeyed(
      this.agent,
      HCP_ANSWERS_RECORD_TYPE,
      HCP_ANSWERS_KIND,
      record.id,
      record as unknown as Record<string, unknown>
    )
  }

  /**
   * The switch's state for connection `id` with operator `operatorId`: `offForGood` if any record names a `deny` for
   * that operator (HCP 6.4: it prevails over any `permit`), else `on` if the connection's own record set a `permit`
   * for that operator, else `off`.
   */
  public async state(id: string, operatorId: string): Promise<HcpAnswersState> {
    const records = await this.list()
    if (records.some((r) => r.operatorId === operatorId && r.state === 'offForGood')) return 'offForGood'
    const own = records.find((r) => r.id === id)
    return own?.state === 'on' && own.operatorId === operatorId ? 'on' : 'off'
  }

  /**
   * Run `work` after every earlier change for the same operator has settled. A change reads the state, sends, and
   * writes as one step under it, so no two changes for one operator (through one connection or two) cross: a `permit`
   * can never be sent while a `deny` for the same operator is on its way.
   */
  public locked<T>(operatorId: string, work: () => Promise<T>): Promise<T> {
    return withKeyLock(`${HCP_ANSWERS_RECORD_TYPE}|operator|${operatorId}`, work)
  }
}
