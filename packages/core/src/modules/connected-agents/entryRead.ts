/**
 * One read of each connected agent's access-list entry, shared by the drift shown in the details and the VDC re-issue
 * policy (docs/plans/agent-connect-plan.md §3.4, §3.9, §3.11).
 *
 * A read says only what the listing proves. Presence is proof whatever the listing's completeness, so a match in a
 * partial listing is `listed`. An entry is `notListed` only when a complete listing returned no rows at all for an
 * agent Keyring knows by `deviceId`; without a `deviceId` an absent key proves nothing, since the agent may have
 * rotated its key and its entry sits under a subject Keyring has never seen (the same reason as `actions.ts`'s
 * `goneUnproven`). A row that comes back but matches neither the `deviceId` nor the subject is a contradiction: the
 * port returned it as this agent's, yet it cannot be placed (two devices sharing a key can make it echo another
 * device's `deviceId`). A contradiction proves nothing, so it is `unknown`, as is a partial listing with no match or a
 * listing that failed.
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
    // Without a deviceId a rotated entry cannot be seen by key alone, so a miss proves nothing; and a row that could
    // not be placed may be this agent's, so only an empty listing proves absence.
    if (found.complete && record.deviceId && found.matches.length === 0) return { kind: 'notListed' }
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
 * The memories a listed entry's `act` names, for the details' drift. Only two stated acts can be given as contexts:
 * `contexts` gives a copy of its contexts, and `none` gives `[]`, a true statement that the agent may read no memory.
 *
 * Everything else is `undefined`, the value for "nothing was proved", and the views show drift only from a defined
 * value: `all` (it cannot be listed as contexts), `byShape` (0.1's empty list means different things for different
 * roles, as `VtaClient.ts`'s `actFrom` notes), an entry with no `act` (`actFrom` leaves it out only when it could not
 * read one), and any read that is not `listed` (`notListed`, `unknown` or no read).
 */
export function entryContexts(read: EntryRead | undefined): string[] | undefined {
  if (read?.kind !== 'listed') return undefined
  const { act } = read.entry
  if (act?.stated === 'contexts') return [...(act.contexts ?? [])]
  if (act?.stated === 'none') return []
  return undefined
}
