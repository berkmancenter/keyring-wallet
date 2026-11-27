/**
 * "Keep it connected" (docs/plans/agent-connect-plan.md §7.28, D42): a temporary agent's entry is made permanent, the
 * record becomes persistent, and its VDC grant is re-issued for the full 7 days.
 *
 * Built to the source reading of VTI `97fda9813` (`acl_v0_3.rs:984` maps an explicit `"expiresAt": null` to
 * `clear_expiry`, and `acl.rs:1239-1240` sets `entry.expires_at = None`), and shipped unoffered: §7.28 asks for the lab
 * measurement first, and until {@link KEEP_CONNECTED_MEASURED} is flipped the act is absent and Extend renews (the
 * plan's fallback). "Not now" is the screen closing its sheet, so it has nothing here.
 *
 * Not `narrowOrWidenCapabilities`: its `AgentAccessChange.expiresAt` refuses null by design (#1082).
 *
 * **The intent goes first.** Clearing the expiry cannot be undone from here, and although the entry can be read back,
 * the record cannot be rebuilt from it: nothing else maps "an entry with no expiry" to `grantType: 'persistent'`. A
 * record left temporary after the clear would read Expired once its old `expiresAt` passed, while the agent keeps
 * working, and the act would no longer be offered to fix it. So, as `hcp/answersOn/store.ts` does for a directive, a
 * {@link KeepConnectedIntent} is written under its own record type before `acl/update/0.3` is sent, and completed once
 * the outcome is known: removed after the record is made persistent, or after the read-back proves the expiry still
 * set. Any other end (no answer, a read-back that fails, a record write that throws, the app stopping) leaves it, and
 * {@link settleKeepConnected} finishes it later from a fresh read of the entry.
 *
 * @module connected-agents/keepConnected
 */

import type { Agent } from '@credo-ts/core'

import { deleteKeyed, listKeyed, putKeyed } from '../trust-tasks/module/keyedRecords'
import type { AgentAccessPort } from './carriage'
import { personaSigningKeyId } from './driver'
import { readAgentEntry } from './entryRead'
import { statusOf } from './status'
import type { AgentConnection } from './types'
import { buildVdcGrant, issueVdc, vdcScopeFor, vtaVdcSigner, type VdcSignPort } from './vdc'

/** Whether the lab measured that an explicit null clears an entry's expiry (§7.28). Flipped after d3's measurement. */
export const KEEP_CONNECTED_MEASURED = false

/** `acl/update` at 0.3, the version that clears an expiry with an explicit null. Pinned where it is sent. */
export const ACL_UPDATE_03 = 'https://trusttasks.org/spec/acl/update/0.3'

/** The record's own conditions for the act: an `active` temporary agent that has not expired. */
function recordAllows(record: AgentConnection, now: number): boolean {
  return record.state === 'active' && record.grantType === 'temporary' && statusOf(record, now) !== 'expired'
}

/**
 * Whether the details offer "Keep it connected" for `record` at `now`: only once the act is measured, and only for an
 * `active` temporary agent that has not expired. While this is false the act is absent and Extend renews.
 */
export function keepConnectedOffered(record: AgentConnection, now: number): boolean {
  return KEEP_CONNECTED_MEASURED && recordAllows(record, now)
}

/** The record type of a {@link KeepConnectedIntent}, its own: `./store.ts` does not list it, and it lists no record. */
export const KEEP_CONNECTED_RECORD_TYPE = 'keyring/keep-connected'
export const KEEP_CONNECTED_INTENT_KIND = 'intent'

/**
 * An `acl/update/0.3` clearing an agent's expiry, about to be sent or sent with its outcome not yet recorded. One per
 * record, keyed by the record's `id`; a later attempt replaces it.
 */
export type KeepConnectedIntent = {
  /** The record's `id`: the intent's key. */
  id: string
  /** The entry's subject the update names (the agent's current key, which a rotation may have changed). */
  subject: string
  /** When the intent was written, just before the send; also the record's `persistentElectedAt` once completed. */
  startedAt: string
}

/** The intents, as generic keyed records under {@link KEEP_CONNECTED_RECORD_TYPE}. */
export class KeepConnectedIntentStore {
  public constructor(private readonly agent: Agent) {}

  public list(): Promise<KeepConnectedIntent[]> {
    return listKeyed<KeepConnectedIntent>(this.agent, KEEP_CONNECTED_RECORD_TYPE, KEEP_CONNECTED_INTENT_KIND)
  }

  /** Write a record's intent, before its update is sent. */
  public put(intent: KeepConnectedIntent): Promise<void> {
    return putKeyed(
      this.agent,
      KEEP_CONNECTED_RECORD_TYPE,
      KEEP_CONNECTED_INTENT_KIND,
      intent.id,
      intent as unknown as Record<string, unknown>
    )
  }

  /** Remove a record's intent: its outcome is recorded, or proved not to have happened. Absent is a no-op. */
  public remove(id: string): Promise<void> {
    return deleteKeyed(this.agent, KEEP_CONNECTED_RECORD_TYPE, KEEP_CONNECTED_INTENT_KIND, id)
  }
}

export type KeepConnectedPorts = {
  clock: () => number
  access: Pick<AgentAccessPort, 'findAgentEntries'>
  /** A Trust Task on the owner's VTA; the services send it without waiting on an approval (backlog fb-5). */
  task(type: string, payload: Record<string, unknown>): Promise<unknown>
  /** `keys/sign-document/0.1` on the owner's VTA. */
  vdcSign: VdcSignPort
  /** The persona's signing key id; `personaSigningKeyId` when absent. */
  signingKeyIdOf?: (persona: string) => string
  connections: {
    get(id: string): Promise<AgentConnection | undefined>
    update(id: string, change: (r: AgentConnection) => AgentConnection): Promise<AgentConnection | undefined>
  }
  /** Where the intent is written before the send ({@link KeepConnectedIntentStore}). */
  intents: Pick<KeepConnectedIntentStore, 'put' | 'remove'>
}

/**
 * Why the act did not finish. The screens word each code (`KeepConnected*` keys); none carries copy.
 * - `noRecord`: no record by that id.
 * - `notOffered`: the record is not an `active` temporary agent that has not expired (also when it left that state
 *   while the entry was being changed).
 * - `notListed`: a complete read found no entry for the agent.
 * - `notSaved`: the intent could not be written, so nothing was sent.
 * - `unreachable`: the entry could not be read, or the update was not answered. After a send with no answer the
 *   intent stays, since the expiry may have been cleared.
 * - `notApplied`: the update was answered but the read-back does not show the entry listed without an expiry. The record
 *   is left as it was. The intent is removed when the read-back shows the expiry still set, and stays when the
 *   read-back itself proved nothing.
 * - `notRecorded`: the entry no longer expires, but the record could not be made persistent. The intent stays, and
 *   {@link settleKeepConnected} makes the record persistent later.
 * - `vdc`: the entry and the record are persistent, but the new grant could not be issued or stored. The record stays
 *   persistent; the re-issue policy replaces the grant later.
 */
export type KeepConnectedResult =
  | { ok: true }
  | {
      ok: false
      code: 'noRecord' | 'notOffered' | 'notListed' | 'notSaved' | 'unreachable' | 'notApplied' | 'notRecorded' | 'vdc'
    }

const fail = (code: Extract<KeepConnectedResult, { ok: false }>['code']): KeepConnectedResult => ({ ok: false, code })

/** Remove an intent whose outcome is settled. A failure leaves it for {@link settleKeepConnected}, which is harmless. */
async function removeIntent(ports: { intents: Pick<KeepConnectedIntentStore, 'remove'> }, id: string): Promise<void> {
  await ports.intents.remove(id).catch(() => undefined)
}

/**
 * Make an `active` temporary record persistent, elected at `electedAt`, with its `expiresAt` member removed. Any other
 * record is returned as it is, so the store writes nothing.
 */
function makePersistent(electedAt: string): (r: AgentConnection) => AgentConnection {
  return (r) => {
    if (r.state !== 'active' || r.grantType !== 'temporary') return r
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { expiresAt: _expiresAt, ...rest } = r
    return { ...rest, grantType: 'persistent', persistentElectedAt: electedAt }
  }
}

/**
 * Keep the agent `id` connected. It does not check {@link KEEP_CONNECTED_MEASURED}: the screen asks
 * {@link keepConnectedOffered} first. It does check the record's own conditions.
 *
 * 1. Read the entry (`readAgentEntry`): not listed is `notListed`, an unknown read `unreachable`.
 * 2. Write the intent; if that fails nothing is sent (`notSaved`).
 * 3. `acl/update/0.3` with exactly `{ subject, expiresAt: null }`; a throw is `unreachable`, and the intent stays.
 * 4. Read back: the entry must be listed with no `expiresAt`, else `notApplied`.
 * 5. The record becomes persistent, with `persistentElectedAt` and no `expiresAt`; a write that throws is
 *    `notRecorded`, and the intent stays. Otherwise the intent is removed.
 * 6. A new grant with no entry expiry (7 days) is issued and stored; a failure is `vdc`.
 */
export async function keepConnected(ports: KeepConnectedPorts, id: string): Promise<KeepConnectedResult> {
  const now = ports.clock()
  const record = await ports.connections.get(id)
  if (!record) return fail('noRecord')
  if (!recordAllows(record, now)) return fail('notOffered')

  const read = await readAgentEntry(ports.access, record)
  if (read.kind === 'unknown') return fail('unreachable')
  if (read.kind === 'notListed') return fail('notListed')

  const electedAt = new Date(now).toISOString()
  try {
    await ports.intents.put({ id, subject: read.entry.subject, startedAt: electedAt })
  } catch {
    return fail('notSaved')
  }

  try {
    // version-pinned: an agent's entry is written at acl 0.3 only, and an explicit null is 0.3's form
    await ports.task(ACL_UPDATE_03, { subject: read.entry.subject, expiresAt: null })
  } catch {
    // No answer: the expiry may have been cleared, so the intent stays for settleKeepConnected.
    return fail('unreachable')
  }

  const after = await readAgentEntry(ports.access, record)
  if (after.kind !== 'listed' || after.entry.expiresAt !== undefined) {
    // An entry still listed with an expiry proves the update did not take; any other read proves nothing.
    if (after.kind === 'listed') await removeIntent(ports, id)
    return fail('notApplied')
  }

  let persistent: AgentConnection | undefined
  try {
    persistent = await ports.connections.update(id, makePersistent(electedAt))
  } catch {
    return fail('notRecorded')
  }
  // Made persistent, removed, or no longer active (a revoke started meanwhile): either way the intent is settled.
  await removeIntent(ports, id)
  if (!persistent) return fail('noRecord')
  if (persistent.grantType !== 'persistent' || persistent.persistentElectedAt !== electedAt) return fail('notOffered')

  try {
    const keyId = (ports.signingKeyIdOf ?? personaSigningKeyId)(persistent.ownerPersonaDid)
    const unsigned = buildVdcGrant({
      personaDid: persistent.ownerPersonaDid,
      agentDid: persistent.agentDid,
      scope: vdcScopeFor({ memory: persistent.memoryContexts.length > 0, roomAdded: false }),
      now,
    })
    const grant = (await issueVdc(unsigned, vtaVdcSigner(ports.vdcSign, keyId))) as unknown as Record<string, unknown>
    const written = await ports.connections.update(id, (r) => (r.state === 'active' ? { ...r, vdcGrant: grant } : r))
    if (written?.vdcGrant !== grant) return fail('vdc')
  } catch {
    return fail('vdc')
  }
  return { ok: true }
}

export type KeepConnectedSettlePorts = Pick<KeepConnectedPorts, 'access'> & {
  connections: Pick<KeepConnectedPorts['connections'], 'get' | 'update'>
  intents: Pick<KeepConnectedIntentStore, 'list' | 'remove'>
}

/**
 * What {@link settleKeepConnected} did, as record ids: `completed`, records made persistent; `dropped`, intents removed
 * with nothing to make persistent; `kept`, intents left because the entry could not be read or the record written.
 */
export type KeepConnectedSettleResult = { completed: string[]; dropped: string[]; kept: string[] }

/**
 * Finish every intent {@link keepConnected} left, one at a time, from a fresh read of each entry. When to run it (at the
 * reconcile, before the entries are read for the views) is the services' (backlog fb-5). It sends nothing.
 *
 * - No record, or a record no longer an `active` temporary one: the intent is dropped. (A temporary record whose old
 *   `expiresAt` has passed is still settled: that is the record this exists to heal.)
 * - The entry listed with no expiry: the record is made persistent, elected at the intent's `startedAt`, and the intent
 *   removed. Its grant is left to the re-issue policy, which replaces one with 48 hours or less left.
 * - The entry listed with an expiry, or proved not listed: the update did not take, or the entry is gone, so the intent
 *   is dropped and the record left as it is.
 * - The entry unknown, or a record read or write that throws: the intent is kept for the next run, and the next intent
 *   is still settled.
 */
export async function settleKeepConnected(ports: KeepConnectedSettlePorts): Promise<KeepConnectedSettleResult> {
  const result: KeepConnectedSettleResult = { completed: [], dropped: [], kept: [] }
  for (const intent of await ports.intents.list()) {
    let record: AgentConnection | undefined
    try {
      record = await ports.connections.get(intent.id)
    } catch {
      result.kept.push(intent.id)
      continue
    }
    const read =
      record?.state === 'active' && record.grantType === 'temporary'
        ? await readAgentEntry(ports.access, record)
        : undefined
    if (read?.kind === 'unknown') {
      result.kept.push(intent.id)
      continue
    }
    if (read?.kind === 'listed' && read.entry.expiresAt === undefined) {
      let written: AgentConnection | undefined
      try {
        written = await ports.connections.update(intent.id, makePersistent(intent.startedAt))
      } catch {
        result.kept.push(intent.id)
        continue
      }
      await removeIntent(ports, intent.id)
      const made = written?.grantType === 'persistent' && written.persistentElectedAt === intent.startedAt
      result[made ? 'completed' : 'dropped'].push(intent.id)
      continue
    }
    await removeIntent(ports, intent.id)
    result.dropped.push(intent.id)
  }
  return result
}
