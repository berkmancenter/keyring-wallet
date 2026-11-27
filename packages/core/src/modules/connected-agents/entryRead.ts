/**
 * One read of each connected agent's access-list entry, shared by the drift shown in the details and the VDC re-issue
 * policy (docs/plans/agent-connect-plan.md §3.4, §3.9, §3.11).
 *
 * A read says only what the listing proves. An entry is `notListed` when a complete listing holds nothing for an agent
 * Keyring knows by `deviceId`; without a `deviceId` an absent key proves nothing, since the agent may have rotated its
 * key and its entry sits under a subject Keyring has never seen (the same reason as `actions.ts`'s `goneUnproven`).
 * A partial listing, or one that failed, is `unknown`.
 *
 * @module connected-agents/entryRead
 */

import type { AccessEntry, AgentAccessPort } from './carriage'
import type { AgentConnection } from './types'

/** What one read of an agent's entry proved. */
export type EntryRead = { kind: 'listed'; entry: AccessEntry } | { kind: 'notListed' } | { kind: 'unknown' }

/**
 * Read the entry for one record. A match by `deviceId` wins (it follows a key swap, so its subject may differ from the
 * stored `agentDid`); otherwise the entry whose subject is the stored `agentDid`.
 */
export async function readAgentEntry(
  access: Pick<AgentAccessPort, 'findAgentEntries'>,
  record: Pick<AgentConnection, 'agentDid' | 'deviceId'>
): Promise<EntryRead> {
  try {
    const found = await access.findAgentEntries({
      ...(record.deviceId ? { deviceId: record.deviceId } : {}),
      subject: record.agentDid,
    })
    const match =
      (record.deviceId ? found.matches.find((m) => m.deviceId === record.deviceId) : undefined) ??
      found.matches.find((m) => m.entry.subject === record.agentDid)
    if (match) return { kind: 'listed', entry: match.entry }
    // Without a deviceId a rotated entry cannot be seen by key alone, so a miss proves nothing.
    if (found.complete && record.deviceId) return { kind: 'notListed' }
    return { kind: 'unknown' }
  } catch {
    return { kind: 'unknown' }
  }
}

/** The states whose entry is worth reading: the others have none yet, or are already being removed. */
const READ_STATES: ReadonlySet<AgentConnection['state']> = new Set(['active', 'expired'])

/**
 * Read the entries for every `active` or `expired` record, one at a time so one VTA is never asked many listings at
 * once. The map is keyed by record `id`; a record in any other state has no key in it.
 */
export async function readAgentEntries(
  access: Pick<AgentAccessPort, 'findAgentEntries'>,
  records: readonly AgentConnection[]
): Promise<Map<string, EntryRead>> {
  const reads = new Map<string, EntryRead>()
  for (const record of records) {
    if (!READ_STATES.has(record.state)) continue
    reads.set(record.id, await readAgentEntry(access, record))
  }
  return reads
}

/**
 * The memories a listed entry's `act` names, for the details' drift: the contexts for `act.stated === 'contexts'`,
 * `[]` for any other listed `act`, and `undefined` when nothing was proved (`notListed`, `unknown` or no read). The
 * views show drift only from a defined value.
 */
export function entryContexts(read: EntryRead | undefined): string[] | undefined {
  if (read?.kind !== 'listed') return undefined
  const { act } = read.entry
  return act?.stated === 'contexts' ? [...(act.contexts ?? [])] : []
}
