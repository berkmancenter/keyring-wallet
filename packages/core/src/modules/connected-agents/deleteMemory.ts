/**
 * Deleting a memory (docs/plans/agent-connect-plan.md §3.15 "Deleting a memory", step 7.16), the logic only.
 *
 * `vta/contexts/delete/1.2` removes the context and everything in it, the items too, and removes or narrows every ACL
 * entry that names it. Its confirmation counter and preview count sub-contexts, keys, DIDs, ACL entries and templates
 * but **not memory items** (VTI-Q40), so a context holding only items would delete without `force`. Keyring therefore
 * never relies on the VTA's counts: {@link previewDelete} counts the items itself (`countMemory`, `vta/memory/list/0.3`
 * with `includeValues: false`, every page) and names the agents whose entry's `act` names the memory, and only
 * {@link deleteMemory}, called with the owner's confirmation, sends the delete, always with `force: true`.
 *
 * **What it writes.** After a delete the VTA confirmed, each `AgentConnection` record bound to the memory loses the id
 * from `memoryContexts` and `contexts`, each write one `store.update(record.id, r => ({ ...r, ... }))` that spreads the
 * record read under the store's lock and changes only those two members. No record is removed: step 7.10's reconcile
 * owns that, for an agent whose only context it was.
 *
 * **Held, never waited on.** An approval rule on `vta/contexts/delete` can hold the call; a held call throws, and the
 * `isHeld` port classifies it, as `createMemory` does (#1060 finding 20). The phone never waits on its own approval.
 *
 * The ports are declared here; Keyring wires them into `services.ts` later.
 *
 * @module connected-agents/deleteMemory
 */

import { countMemory, countNotice, MemoryCount, MemoryPort } from './memories'
import type { AgentConnectionStore } from './store'

/** One ACL entry as `VtaClient.listAcl` reads it: its subject, its label and its `act` as stated. */
export type DeleteMemoryAclEntry = {
  subject: string
  label?: string
  act?: { stated: string; contexts?: string[] }
}

/** What deleting a memory needs. */
export interface DeleteMemoryPorts {
  /** Every ACL entry on the owner's VTA (wraps `VtaClient.listAcl`). */
  listEntries(): Promise<DeleteMemoryAclEntry[]>
  /** `vta/contexts/delete` for one context. Throws when refused, or when an approval rule holds it. */
  deleteContext(id: string, force: boolean): Promise<void>
  /** Whether a thrown `deleteContext` was held for consent (`VtaClient`'s `consentPendingOf`); never retried. */
  isHeld(error: unknown): boolean
  /** `vta/memory/list/0.3`, for the item count. */
  task: MemoryPort['task']
  /** The agents' records: a subject's record, and the one write this step makes. */
  store: Pick<AgentConnectionStore, 'findByKey' | 'update'>
}

/** An agent the delete removes the memory from: its subject and the name to show ('' when there is none). */
export type DeleteMemoryAgent = { subject: string; name: string }

/** What the confirmation shows (§3.15): the item count, whether it is above the warning, and the agents bound to it. */
export type DeletePreview =
  | { ok: true; count: MemoryCount; overWarning: boolean; agents: DeleteMemoryAgent[] }
  | { ok: false; code: 'unreachable' }

/** The delete's answer. `heldForApproval`: an approval rule holds it; its words name the rule, never "Try again". */
export type DeleteMemoryResult = { ok: true } | { ok: false; code: 'heldForApproval' | 'unreachable' }

/**
 * Whether an entry names the memory: only an `act` stated as `contexts`, or implied by a 0.1 entry's shape
 * (`byShape`), whose contexts include the exact id. `all` and `none` name nothing, and nothing is read from the label.
 */
function entryNamesMemory(entry: DeleteMemoryAclEntry, memoryId: string): boolean {
  const act = entry.act
  if (!act || (act.stated !== 'contexts' && act.stated !== 'byShape')) return false
  return Array.isArray(act.contexts) && act.contexts.includes(memoryId)
}

/**
 * The confirmation's facts (§3.15, step 7.16): the memory's live items, counted here because the VTA's preview does
 * not count them; whether the count is above memories' `MEMORY_COUNT_WARNING`, as `countNotice` decides it; and the
 * agents whose entry's `act` names the id, each by its record's name, else the entry's label, else ''. Sends no delete.
 * A listing or a count that fails is `unreachable`.
 */
export async function previewDelete(ports: DeleteMemoryPorts, memoryId: string): Promise<DeletePreview> {
  let entries: DeleteMemoryAclEntry[]
  try {
    entries = await ports.listEntries()
  } catch {
    return { ok: false, code: 'unreachable' }
  }
  const count = await countMemory(ports, memoryId)
  if (!count.ok) return { ok: false, code: 'unreachable' }
  const agents: DeleteMemoryAgent[] = []
  for (const entry of entries.filter((e) => entryNamesMemory(e, memoryId))) {
    const record = await ports.store.findByKey(entry.subject)
    agents.push({ subject: entry.subject, name: record?.name || entry.label || '' })
  }
  return { ok: true, count, overWarning: countNotice(count.count, undefined).overWarning, agents }
}

/**
 * Delete the memory, after the owner confirmed the preview (§3.15: `force` only after that confirmation). `confirmed`
 * is the literal `true`, so no caller can pass an unconfirmed delete; a value that is not `true` at run time throws
 * before anything is sent. The bound entries are listed first (the delete removes what names the memory), then
 * `deleteContext(memoryId, true)`. A held call is `heldForApproval`, any other failure `unreachable`, and either way
 * no record is written.
 *
 * Once the VTA has deleted it, each bound record loses the id from `memoryContexts` and `contexts`. A record that
 * cannot be written is left for the reconcile (§3.9 step 5, "Lost access"): the memory is gone, so the answer stays
 * `ok`.
 */
export async function deleteMemory(
  ports: DeleteMemoryPorts,
  memoryId: string,
  confirmed: true
): Promise<DeleteMemoryResult> {
  if (confirmed !== true) throw new Error('a memory is deleted only after the owner confirms')
  let entries: DeleteMemoryAclEntry[]
  try {
    entries = await ports.listEntries()
  } catch {
    return { ok: false, code: 'unreachable' }
  }
  try {
    await ports.deleteContext(memoryId, true)
  } catch (error) {
    return { ok: false, code: ports.isHeld(error) ? 'heldForApproval' : 'unreachable' }
  }
  const done = new Set<string>()
  for (const entry of entries.filter((e) => entryNamesMemory(e, memoryId))) {
    try {
      const record = await ports.store.findByKey(entry.subject)
      if (!record || done.has(record.id)) continue
      done.add(record.id)
      await ports.store.update(record.id, (r) =>
        r.memoryContexts.includes(memoryId) || r.contexts.includes(memoryId)
          ? {
              ...r,
              memoryContexts: r.memoryContexts.filter((c) => c !== memoryId),
              contexts: r.contexts.filter((c) => c !== memoryId),
            }
          : r
      )
    } catch {
      // Left for the reconcile: the memory is already deleted.
    }
  }
  return { ok: true }
}
