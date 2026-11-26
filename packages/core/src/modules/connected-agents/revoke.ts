/**
 * Revoking a connected agent (docs/plans/agent-connect-plan.md §3.9, §3.10, step 7.10).
 *
 * The agent is found by what it cannot change, its `deviceId`, not by the key it uses today: `acl/swap-key` is
 * self-service and moves the whole entry to a key the agent chooses, so `acl/revoke` on the stored `agentDid` finds
 * nothing after a swap (measured, ref-25 cases `l-revoke-after-1-swap` and `l-revoke-after-2-swaps`:
 * `acl/revoke:subjectNotPresent` on the first key, `ok` on the key the device lists).
 *
 * In order:
 * 1. The record goes from `active` or `expired` to `revoking` before any VTA call, so a restart in the middle still
 *    shows "Revoke not confirmed" and retries. Then the ACL entry: every entry whose device has the stored `deviceId`,
 *    and any whose subject is the stored `agentDid`, is revoked through `VtaClient.revokeSubject`. Its answer is never
 *    taken as success (an empty answer means "no entry under that key"); only a full listing (every page, no error)
 *    that shows no such entry confirms it. Up to {@link REVOKE_MAX_ROUNDS} rounds of revoke and re-list.
 * 2. The VDC is no longer re-issued: `shouldReissueVdc` (vdc.ts) refuses any record that is not `active`, so the
 *    `revoking` state is the mark. There is no status entry in P0, so a copy already shown stays valid.
 * 3. The agent is told over the chat, best effort, on the one run that confirms step 1. Not relied on.
 * 4. The record goes from `revoking` to `revoked` only once a full listing no longer shows the entry.
 *
 * **What it writes.** Of the `AgentConnection` record (§3.11), only `state` and `lastReconciledAt`, always as get,
 * change, put. `keyChanged` is read, never written: the reconcile reports a changed key ({@link ReconcileResult}) and
 * the record's owner, step 7.7, records it.
 *
 * **The store.** Step 7.7's `AgentConnectionStore` (`list`, `get`, `put`, `remove`; no partial update) is in #1065,
 * not merged yet. Until it is, this module names the members it uses ({@link RevokableConnection}) and that store's
 * calls ({@link RevokeConnectionStore}). 7.7's `AgentConnection` and `AgentConnectionStore` satisfy both
 * structurally; once #1065 merges, the local types can become imports.
 *
 * @module connected-agents/revoke
 */

import type { VtaClient } from '../trust-tasks/module/VtaClient'

/** Rounds of revoke and re-list before the record is left `revoking` (§3.9 step 1, "at most three rounds"). */
export const REVOKE_MAX_ROUNDS = 3

/** §3.11's states, as step 7.7's `AgentConnectionState`. */
export type RevokableState = 'pairing' | 'active' | 'expired' | 'revoking' | 'revoked' | 'notFinished'

/** The states a revoke starts from (§3.9). `pairing` and `notFinished` are the pairing's (§3.10). */
export const REVOKABLE_FROM: readonly RevokableState[] = ['active', 'expired']

/**
 * The members of step 7.7's `AgentConnection` this step uses. A record carries more; every other member is kept as it
 * is, since each write re-reads the record and changes only `state` and `lastReconciledAt`.
 */
export type RevokableConnection = {
  /** The record's key (7.7 keys it by the agent's DID). */
  id: string
  name: string
  /** The DID the agent was paired with. Never moved here: the chat stays on it (§3.9). */
  agentDid: string
  /** Set by `device/register`, copied by every `acl/swap-key`: what the agent is found by. */
  deviceId: string
  state: RevokableState
  /** Read-only for this step. */
  readonly keyChanged: boolean
  /** ISO 8601; absent for a persistent agent. */
  expiresAt?: string
  lastReconciledAt?: string
}

/** Step 7.7's `AgentConnectionStore` (#1065): `list`, `get`, `put`, `remove`. There is no partial update. */
export interface RevokeConnectionStore<C extends RevokableConnection = RevokableConnection> {
  list(): Promise<C[]>
  get(id: string): Promise<C | undefined>
  put(record: C): Promise<void>
  remove(id: string): Promise<void>
}

/** The two VTA calls this step makes (step 7.4). */
export type RevokeVta = Pick<VtaClient, 'findAgentEntries' | 'revokeSubject'>

export interface RevokeDeps<C extends RevokableConnection = RevokableConnection> {
  store: RevokeConnectionStore<C>
  vta: RevokeVta
  /** Sends the chat's `revoked` message (§3.9 step 3, step 7.9's chat). Left out until the chat exists. */
  tellAgent?: (record: C) => Promise<void>
  now?: () => number
}

/**
 * Why a revoke is not confirmed. `listingFailed`: a listing was refused or broke off; `partialListing`: the listings
 * never reached their end; `entryRemains`: a full listing still shows the agent after the last round.
 */
export type NotConfirmedReason = 'listingFailed' | 'partialListing' | 'entryRemains'

/**
 * What a revoke came to. Only `revoked` is success.
 * - `notConfirmed`: "Revoke not confirmed" and, in the details, `ConnectedAgents.RevokeNotConfirmedBody` with "Try
 *   again" (§6).
 * - `unreachable`: no VTA call got any answer: `ConnectedAgents.RevokeUnreachable`, "We couldn't reach your VTA, so
 *   "<name>" is still connected." (§6, Revoke incomplete). The record is `revoking` all the same and is retried.
 */
export type RevokeOutcome =
  | { kind: 'revoked' }
  | { kind: 'notConfirmed'; reason: NotConfirmedReason }
  | { kind: 'unreachable' }

/** A VTA's answer that refuses: it reached the VTA, unlike a timeout or a dropped send. */
const isRefusal = (error: unknown): boolean => error instanceof Error && error.name === 'VtiRefusal'

const iso = (ms: number) => new Date(ms).toISOString()

/**
 * Step 1 alone: revoke every entry that is the agent's, re-list, and repeat, until a full listing shows none or the
 * rounds run out. Answers how it ended; writes nothing.
 */
export async function removeAgentEntries(
  vta: RevokeVta,
  agent: Pick<RevokableConnection, 'agentDid' | 'deviceId'>,
  maxRounds: number = REVOKE_MAX_ROUNDS
): Promise<RevokeOutcome> {
  let answered = false
  for (let round = 0; ; round++) {
    let found: Awaited<ReturnType<RevokeVta['findAgentEntries']>>
    try {
      found = await vta.findAgentEntries({ deviceId: agent.deviceId, subject: agent.agentDid })
      answered = true
    } catch (error) {
      if (isRefusal(error)) answered = true
      return answered ? { kind: 'notConfirmed', reason: 'listingFailed' } : { kind: 'unreachable' }
    }
    if (found.complete && found.matches.length === 0) return { kind: 'revoked' }
    if (round >= maxRounds)
      return { kind: 'notConfirmed', reason: found.matches.length > 0 ? 'entryRemains' : 'partialListing' }
    const subjects = new Set(found.matches.map((m) => m.entry.subject))
    for (const subject of subjects) {
      try {
        // The answer is not read: empty means "no entry under that key", and the re-list is the only proof.
        await vta.revokeSubject(subject)
      } catch {
        // A refusal (`subjectNotPresent` when the agent swapped meanwhile) or a lost call: the re-list decides.
      }
    }
  }
}

/** One revoke per record at a time: a second caller (app start and the list opening together) joins the first. */
const inFlight = new WeakMap<object, Map<string, Promise<RevokeOutcome>>>()

/**
 * Revoke the agent of record `id` (§3.9). Safe to call again on a `revoking` record ("Try again", app start, opening
 * the list); a `revoked` record answers `revoked` without a VTA call. A `pairing` or `notFinished` record has no
 * revoke (§3.10 ends it) and is refused with an error.
 */
export function revokeAgentConnection<C extends RevokableConnection>(
  deps: RevokeDeps<C>,
  id: string
): Promise<RevokeOutcome> {
  let mine = inFlight.get(deps.store)
  if (!mine) inFlight.set(deps.store, (mine = new Map()))
  const running = mine.get(id)
  if (running) return running
  const job = runRevoke(deps, id).finally(() => mine?.delete(id))
  mine.set(id, job)
  return job
}

async function runRevoke<C extends RevokableConnection>(deps: RevokeDeps<C>, id: string): Promise<RevokeOutcome> {
  const now = deps.now ?? Date.now
  const record = await deps.store.get(id)
  if (!record) throw new Error(`[connected-agents] no agent connection ${id}`)
  if (record.state === 'revoked') return { kind: 'revoked' }
  if (record.state !== 'revoking' && !REVOKABLE_FROM.includes(record.state))
    throw new Error(`[connected-agents] a ${record.state} agent connection cannot be revoked`)

  // active or expired -> revoking, before any VTA call: a restart from here on shows "Revoke not confirmed" and
  // retries, and no VDC is re-issued (`shouldReissueVdc` wants `active`).
  if (record.state !== 'revoking') await write(deps.store, id, { state: 'revoking' })

  // 1. The ACL entry, first.
  const outcome = await removeAgentEntries(deps.vta, record)
  if (outcome.kind !== 'revoked') return outcome

  // 3. Tell the agent. Only the run that confirms step 1 gets here, and it then leaves `revoking`, so this happens
  // once. A failure changes nothing: it is not relied on.
  if (deps.tellAgent) {
    try {
      await deps.tellAgent((await deps.store.get(id)) ?? record)
    } catch {
      // Best effort.
    }
  }

  // 4. revoking -> revoked: a full listing no longer shows the entry.
  await write(deps.store, id, { state: 'revoked', lastReconciledAt: iso(now()) })
  return outcome
}

/** The only members this step writes. */
type Written = { state?: RevokableState; lastReconciledAt?: string }

/** Get, change `state` and `lastReconciledAt` only, put: a member another step wrote meanwhile is kept. */
async function write<C extends RevokableConnection>(
  store: RevokeConnectionStore<C>,
  id: string,
  changes: Written
): Promise<void> {
  const current = await store.get(id)
  if (!current) return
  const next: C = { ...current }
  if (changes.state !== undefined) next.state = changes.state
  if (changes.lastReconciledAt !== undefined) next.lastReconciledAt = changes.lastReconciledAt
  await store.put(next)
}

/**
 * What the reconcile found for one record. `keyChanged` and `gone` are reported, not written: the first is
 * `keyChanged`, which this step only reads; the second would be a state change outside Revoke's two (§3.9), so the
 * record's owner (step 7.7) decides what it shows.
 */
export type ReconcileResult =
  | { id: string; kind: 'revoke'; outcome: RevokeOutcome }
  /** The agent's `deviceId` is under `subject`, not `agentDid`: it changed its key without Keyring. */
  | { id: string; kind: 'keyChanged'; subject: string }
  /** A full listing shows no entry with the `deviceId` or under `agentDid`: access went away without a revoke. */
  | { id: string; kind: 'gone' }
  | { id: string; kind: 'unchanged' }
  /** The listing failed or was partial: nothing is concluded, nothing written. */
  | { id: string; kind: 'unknown' }

/**
 * The reconcile at app start, and on opening the list or the details (§3.9), for every record not `revoked`:
 * - `revoking`: the revoke runs again, and the record becomes `revoked` once a full listing shows no entry;
 * - `active` or `expired`: one full listing, stamped as `lastReconciledAt`. The agent's `deviceId` under a subject
 *   other than `agentDid` is reported as `keyChanged` (""<name>" changed its key. Revoke it if you did not expect
 *   that."); `agentDid` and the chat are not moved, since a rotation Keyring did not witness proves nothing about who
 *   holds the new key. No entry at all is reported as `gone`.
 * `pairing` and `notFinished` records are the pairing's (§3.10) and are left alone. One record at a time.
 */
export async function reconcileAgents<C extends RevokableConnection>(
  deps: RevokeDeps<C>,
  ids?: readonly string[]
): Promise<ReconcileResult[]> {
  const now = deps.now ?? Date.now
  const records = (await deps.store.list()).filter((r) => !ids || ids.includes(r.id))
  const results: ReconcileResult[] = []
  for (const record of records) {
    if (record.state === 'revoking') {
      results.push({ id: record.id, kind: 'revoke', outcome: await revokeAgentConnection(deps, record.id) })
      continue
    }
    if (!REVOKABLE_FROM.includes(record.state)) continue
    let found: Awaited<ReturnType<RevokeVta['findAgentEntries']>>
    try {
      found = await deps.vta.findAgentEntries({ deviceId: record.deviceId, subject: record.agentDid })
    } catch {
      results.push({ id: record.id, kind: 'unknown' })
      continue
    }
    if (!found.complete) {
      results.push({ id: record.id, kind: 'unknown' })
      continue
    }
    await write(deps.store, record.id, { lastReconciledAt: iso(now()) })
    const moved = found.matches.find((m) => m.deviceId === record.deviceId && m.entry.subject !== record.agentDid)
    if (moved) results.push({ id: record.id, kind: 'keyChanged', subject: moved.entry.subject })
    else if (found.matches.length === 0) results.push({ id: record.id, kind: 'gone' })
    else results.push({ id: record.id, kind: 'unchanged' })
  }
  return results
}
