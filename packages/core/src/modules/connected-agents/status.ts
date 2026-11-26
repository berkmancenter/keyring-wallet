/**
 * What a stored connection shows, as pure functions of the record, the clock and the last reconcile
 * (docs/plans/agent-connect-plan.md §3.11, §3.15, §6, §7.7).
 *
 * @module connected-agents/status
 */

import type { AgentConnection, AgentStatus, AgentView, MemoryRef } from './types'

/** What the last reconcile learned about the agent; absent when none has run since the app started. */
export type Reachability = { reachable: boolean } | undefined

/**
 * The status a record shows at `now`, or undefined for a pairing still in progress (it is not a row).
 *
 * An active temporary entry past its `expiresAt` is "Expired" even before Keyring has written that state, and that
 * wins over "Not connected right now". That is the plan's own rule, not a ranking chosen here: §7 item 24 ("a temporary
 * agent past its expiry is "Expired""), and §3.10's row "ACL entry expires | … The list says "Expired"". "Not connected
 * right now" is about the session not running (§3.12), a separate condition, so where both hold the row says "Expired".
 */
export function statusOf(record: AgentConnection, now: number, reach?: Reachability): AgentStatus | undefined {
  switch (record.state) {
    case 'pairing':
      return undefined
    case 'notFinished':
      return 'notFinished'
    case 'revoked':
      return 'revoked'
    case 'revoking':
      return 'revokeNotConfirmed'
    case 'expired':
      return 'expired'
    case 'active': {
      if (record.grantType === 'temporary' && expiresAtMs(record) <= now) return 'expired'
      if (reach && !reach.reachable) return 'unreachable'
      return record.grantType === 'persistent' ? 'connected' : 'connectedUntil'
    }
  }
}

/** A temporary record's expiry in ms, or +Infinity when it has none (a persistent agent) or it does not parse. */
export function expiresAtMs(record: Pick<AgentConnection, 'expiresAt'>): number {
  const at = record.expiresAt === undefined ? NaN : Date.parse(record.expiresAt)
  return Number.isNaN(at) ? Number.POSITIVE_INFINITY : at
}

/**
 * Whether an agent with this status is listed among the owner's contacts (#1060 finding 10, recommended): only the
 * ones that have, or may still have, access. "Expired", "Revoked" and "Not finished" are listed under "AI agents" only.
 */
export function isContactStatus(status: AgentStatus | undefined): boolean {
  return (
    status === 'connected' || status === 'connectedUntil' || status === 'unreachable' || status === 'revokeNotConfirmed'
  )
}

/**
 * The entry's memory access set against the record (§3.15 step 5): contexts on the entry the owner did not bind
 * (`extra`), and bound memories the entry no longer holds (`missing`). A memory still pending from a one-context grant
 * (§7.5) is not missing: it never arrived. `allowed` adds contexts the entry may hold besides the memories (the
 * agent's own empty context; the rooms' persona contexts, P1).
 */
export function memoryDrift(
  record: Pick<AgentConnection, 'memoryContexts' | 'pendingContexts'>,
  entryContexts: readonly string[],
  allowed: readonly string[] = []
): { extra: string[]; missing: string[] } | undefined {
  const entry = new Set(entryContexts)
  const expected = new Set([...record.memoryContexts, ...allowed])
  const pending = new Set(record.pendingContexts)
  const extra = entryContexts.filter((c) => !expected.has(c))
  const missing = record.memoryContexts.filter((c) => !entry.has(c) && !pending.has(c))
  return extra.length || missing.length ? { extra, missing } : undefined
}

/** The context's name, or a fixed placeholder: a context id is never shown as a label (§6, copy rules for memory). */
export type MemoryNames = (contextId: string) => string | undefined

const named =
  (names: MemoryNames) =>
  (id: string): MemoryRef => ({ id, name: names(id) ?? '' })

/** The view a screen draws for one record; undefined for a pairing still in progress. */
export function viewOf(
  record: AgentConnection,
  opts: {
    now: number
    reach?: Reachability
    names: MemoryNames
    ownerName?: string
    /** The entry's contexts as last read back, when a reconcile has read them. */
    entryContexts?: readonly string[]
  }
): AgentView | undefined {
  const status = statusOf(record, opts.now, opts.reach)
  if (!status) return undefined
  const ref = named(opts.names)
  const allowed = record.contexts.filter((c) => !record.memoryContexts.includes(c))
  const drift = opts.entryContexts ? memoryDrift(record, opts.entryContexts, allowed) : undefined
  const expiresAt = expiresAtMs(record)
  return {
    id: record.id,
    name: record.name,
    handle: record.handle,
    status,
    ...(Number.isFinite(expiresAt) ? { expiresAt } : {}),
    grantType: record.grantType,
    purposes: [...record.purposes],
    keyChanged: record.keyChanged,
    ...(drift ? { drift: { extra: drift.extra.map(ref), missing: drift.missing.map(ref) } } : {}),
    pending: record.pendingContexts.map(ref),
    memories: record.memoryContexts.filter((c) => !record.pendingContexts.includes(c)).map(ref),
    ...(opts.ownerName ? { ownerName: opts.ownerName } : {}),
  }
}

/** The contacts source for `ListContacts` (§3.14, #1060 finding 10): agents with access, sorted by name. */
export function agentContacts(
  records: readonly AgentConnection[],
  now: number,
  reachOf: (agentId: string) => Reachability = () => undefined
): { agentId: string; name: string; handle: string }[] {
  return records
    .filter((r) => isContactStatus(statusOf(r, now, reachOf(r.id))))
    .map((r) => ({ agentId: r.id, name: r.name, handle: r.handle }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.agentId.localeCompare(b.agentId))
}
