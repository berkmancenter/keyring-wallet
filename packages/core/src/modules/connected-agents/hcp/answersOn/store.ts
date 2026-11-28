/**
 * What Keyring knows of the "Answers on" directives it set (step 7.29, C5). The provider cannot be asked which
 * directives are set (`directives/list` is P2), so Keyring keeps its own record per connection ("Decided here"):
 * generic keyed records, `recordType: 'keyring/hcp-answers'`, keyed by the connection's `id` (the client's VID). No
 * record means `off`. A record is written only after the provider answered success (`./view.ts`).
 *
 * A `directives/set` can be neither undone (`directives/remove` is P2) nor read back (`directives/list` is P2) in P1,
 * so, as `../store.ts` does for an approval, an {@link HcpAnswersIntent} is written under its own kind *before* the
 * directive is sent, and settled once its answer is known: a success writes the record and then removes the intent
 * ({@link HcpAnswersStore.complete}), a refusal removes it, and an unreachable VTA keeps it (the directive may have
 * been set). While an intent stands, the state reads as if its directive had been set: an Off as `offForGood`, so no
 * `permit` can follow a `deny` the VTA may hold, and an On as `on`, so the switch still offers the Off that overrides
 * a `permit` the VTA may hold. The app stopping between the send and the record, or a record write that fails, leaves
 * the intent, so the switch never reads less locked than the VTA may be.
 *
 * Its own record type: neither `../store.ts` nor the base path's store lists these, and they list neither.
 *
 * @module connected-agents/hcp/answersOn/store
 */
import type { Agent } from '@credo-ts/core'

import { deleteKeyed, getKeyed, listKeyed, putKeyed, withKeyLock } from '../../../trust-tasks/module/keyedRecords'

export const HCP_ANSWERS_RECORD_TYPE = 'keyring/hcp-answers'
export const HCP_ANSWERS_KIND = 'answers'
/**
 * The kind of an {@link HcpAnswersIntent}: the same record type, keyed by the connection's `id`. Written, completed
 * and removed only under the operator's lock ({@link HcpAnswersStore.locked}).
 */
export const HCP_ANSWERS_INTENT_KIND = 'answers-setting'

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

/**
 * A directive about to be sent, or sent with no answer known: written before `directives/set`, settled when its answer
 * is known. One per connection: a later change through the same connection replaces it.
 */
export type HcpAnswersIntent = {
  /** The connection's `id`, the client's VID: the intent's key. */
  id: string
  /** The directive's operator, as in {@link HcpAnswersRecord}. */
  operatorId: string
  /** True for a `permit`, false for a `deny`. */
  on: boolean
  /** When the intent was written, just before the send. */
  startedAt: string
}

/** The switch's state, and this connection's intent for the operator if it has one (sent, or about to be). */
export type HcpAnswersReading = { state: HcpAnswersState; intent?: HcpAnswersIntent }

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

  public listIntents(): Promise<HcpAnswersIntent[]> {
    return listKeyed<HcpAnswersIntent>(this.agent, HCP_ANSWERS_RECORD_TYPE, HCP_ANSWERS_INTENT_KIND)
  }

  /** Write a connection's intent, before its directive is sent. Call under the operator's lock. */
  public putIntent(intent: HcpAnswersIntent): Promise<void> {
    return putKeyed(
      this.agent,
      HCP_ANSWERS_RECORD_TYPE,
      HCP_ANSWERS_INTENT_KIND,
      intent.id,
      intent as unknown as Record<string, unknown>
    )
  }

  /** Remove a connection's intent: its directive was refused, or never sent. Call under the operator's lock. */
  public removeIntent(id: string): Promise<void> {
    return deleteKeyed(this.agent, HCP_ANSWERS_RECORD_TYPE, HCP_ANSWERS_INTENT_KIND, id)
  }

  /**
   * Record a directive the VTA set: write `record`, then remove the connection's intent. Stopping between the two
   * leaves both, which read the same state. Call under the operator's lock.
   */
  public async complete(record: HcpAnswersRecord): Promise<void> {
    await this.put(record)
    await this.removeIntent(record.id)
  }

  /**
   * The switch's state for connection `id` with operator `operatorId`: `offForGood` if any record or intent names a
   * `deny` for that operator (HCP 6.4: it prevails over any `permit`; an intent's `deny` may have been set), else `on`
   * if the connection's own record or intent is a `permit` for that operator, else `off`.
   */
  public async state(id: string, operatorId: string): Promise<HcpAnswersState> {
    return (await this.read(id, operatorId)).state
  }

  /** {@link HcpAnswersStore.state}, with the connection's own intent for that operator, if any. */
  public async read(id: string, operatorId: string): Promise<HcpAnswersReading> {
    const [records, intents] = await Promise.all([this.list(), this.listIntents()])
    const own = intents.find((i) => i.id === id && i.operatorId === operatorId)
    const intent: Pick<HcpAnswersReading, 'intent'> = own ? { intent: own } : {}
    const denied =
      records.some((r) => r.operatorId === operatorId && r.state === 'offForGood') ||
      intents.some((i) => i.operatorId === operatorId && !i.on)
    if (denied) return { state: 'offForGood', ...intent }
    const ownRecord = records.find((r) => r.id === id)
    const on = (ownRecord?.state === 'on' && ownRecord.operatorId === operatorId) || own?.on === true
    return { state: on ? 'on' : 'off', ...intent }
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
