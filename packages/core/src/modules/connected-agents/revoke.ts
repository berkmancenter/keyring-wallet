/**
 * Revoking a connected agent (docs/plans/agent-connect-plan.md §3.9, §3.10, step 7.10).
 *
 * The agent is found by what it cannot change, its `deviceId`, not by the key it uses today: `acl/swap-key` is
 * self-service and moves the whole entry to a key the agent chooses, so `acl/revoke` on the stored `agentDid` finds
 * nothing after a swap (measured, ref-25 cases `l-revoke-after-1-swap` and `l-revoke-after-2-swaps`:
 * `acl/revoke:subjectNotPresent` on the first key, `ok` on the key the device lists).
 *
 * In order:
 * 1. The record is written `revoking` before any VTA call, so a restart in the middle still shows "Revoke not
 *    confirmed" and retries. Then the ACL entry: every entry whose device has the stored `deviceId`, and any whose
 *    subject is the stored `agentDid`, is revoked through `VtaClient.revokeSubject`. Its answer is never taken as
 *    success (an empty answer means "no entry under that key"); only a full listing (every page, no error) that shows
 *    no such entry confirms it. Up to {@link REVOKE_MAX_ROUNDS} rounds of revoke and re-list.
 * 2. The VDC is no longer re-issued (`shouldReissueVdc` refuses a `revoking` or `revoked` record) and is marked
 *    revoked in the record: `vdcRevokedAt`. There is no status entry in P0, so a copy already shown stays valid.
 * 3. The agent is told over the chat, once, best effort. Not relied on.
 * 4. The record becomes `revoked` only after step 1 is confirmed; otherwise it stays `revoking`.
 *
 * The app-start reconcile ({@link reconcileAgents}) retries every `revoking` record, and for the others records a key
 * the agent changed without Keyring (`keyChanged`) and access that went away on its own.
 *
 * **Isolated dependency.** The `AgentConnection` record and its store are step 7.7's (#1065, a draft whose type is
 * still to be agreed with the Keyring core lane). This module does not import them: it names the members it reads and
 * writes ({@link RevokableConnection}) and the store calls it makes ({@link RevokeConnectionStore}), and 7.7's
 * `AgentConnection` and `AgentConnectionStore` satisfy both structurally. Three members are this step's proposal to
 * that type and are not in §3.11's list: `currentSubject`, `vdcRevokedAt` and `revokeToldAt`.
 *
 * @module connected-agents/revoke
 */

import type { VtaClient } from '../trust-tasks/module/VtaClient'

/** Rounds of revoke and re-list before the record is left `revoking` (§3.9 step 1, "at most three rounds"). */
export const REVOKE_MAX_ROUNDS = 3

/** §3.11's states, as step 7.7 stores them. */
export type RevokableState = 'pairing' | 'active' | 'expired' | 'revoking' | 'revoked' | 'notFinished'

/**
 * The members of step 7.7's `AgentConnection` this step reads and writes. A record carries more; every other member
 * is kept as it is, since each write re-reads the record and changes only these.
 */
export type RevokableConnection = {
  /** The record's key (7.7 keys it by the agent's first DID). */
  id: string
  name: string
  /** The DID the agent was paired with. Never moved by a reconcile: the chat stays on it (§3.9). */
  agentDid: string
  /** Set by `device/register`, copied by every `acl/swap-key`: what the agent is found by. */
  deviceId: string
  state: RevokableState
  keyChanged: boolean
  /** ISO 8601; absent for a persistent agent. */
  expiresAt?: string
  lastReconciledAt?: string
  /** Proposed to 7.7's type: the subject the agent's `deviceId` is under now, when it is not `agentDid` (§3.9). */
  currentSubject?: string
  /** Proposed to 7.7's type: when Revoke stopped the VDC's re-issue (§3.9 step 2). */
  vdcRevokedAt?: string
  /** Proposed to 7.7's type: when the agent was told it is revoked (§3.9 step 3), so it is told once. */
  revokeToldAt?: string
}

/** The store calls this step makes; 7.7's `AgentConnectionStore` has them. */
export interface RevokeConnectionStore<C extends RevokableConnection = RevokableConnection> {
  list(): Promise<C[]>
  get(id: string): Promise<C | undefined>
  put(record: C): Promise<void>
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
 *   "<name>" is still connected." (§3.9). The record is `revoking` all the same and is retried.
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
 * the list): the agent is told once, and a `revoked` record answers `revoked` without a VTA call.
 */
export function revokeAgent<C extends RevokableConnection>(deps: RevokeDeps<C>, id: string): Promise<RevokeOutcome> {
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

  // Written before any VTA call: a restart from here on shows "Revoke not confirmed" and retries.
  if (record.state !== 'revoking') await update(deps.store, id, { state: 'revoking' } as Partial<C>)

  // 1. The ACL entry, first.
  const outcome = await removeAgentEntries(deps.vta, record)

  // 2. No more VDCs, whatever step 1 came to: the owner's decision stands.
  const after = (await deps.store.get(id)) ?? record
  if (!after.vdcRevokedAt) await update(deps.store, id, { vdcRevokedAt: iso(now()) } as Partial<C>)

  // 3. Tell the agent, once. A failure changes nothing: it is not relied on.
  if (deps.tellAgent && !after.revokeToldAt) {
    try {
      await deps.tellAgent((await deps.store.get(id)) ?? after)
      await update(deps.store, id, { revokeToldAt: iso(now()) } as Partial<C>)
    } catch {
      // Told again on the next run.
    }
  }

  // 4. `revoked` only on step 1's confirmation.
  if (outcome.kind === 'revoked')
    await update(deps.store, id, { state: 'revoked', lastReconciledAt: iso(now()) } as Partial<C>)
  return outcome
}

/** Re-read and write only `changes`, so a member another step wrote meanwhile is kept. */
async function update<C extends RevokableConnection>(
  store: RevokeConnectionStore<C>,
  id: string,
  changes: Partial<C>
): Promise<void> {
  const current = await store.get(id)
  if (!current) return
  await store.put({ ...current, ...changes })
}

/** What the reconcile found for one record. */
export type ReconcileResult =
  | { id: string; kind: 'revoke'; outcome: RevokeOutcome }
  | { id: string; kind: 'keyChanged'; subject: string }
  | { id: string; kind: 'gone'; state: 'expired' | 'revoked' }
  | { id: string; kind: 'unchanged' }
  /** The listing failed or was partial: nothing is concluded, nothing written. */
  | { id: string; kind: 'unknown' }

/**
 * The reconcile at app start, and on opening the list or the details (§3.9), for every record not `revoked`:
 * - `revoking`: the revoke runs again;
 * - the agent's `deviceId` under a subject other than `agentDid`: that subject is recorded as `currentSubject` and
 *   `keyChanged` set (""<name>" changed its key. Revoke it if you did not expect that."). `agentDid` and the chat are
 *   not moved: a rotation Keyring did not witness proves nothing about who holds the new key;
 * - no entry with the `deviceId` or under `agentDid`, on a full listing: access is gone, `expired` when `expiresAt`
 *   has passed and `revoked` otherwise (removed elsewhere).
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
    if (record.state === 'revoked' || record.state === 'pairing' || record.state === 'notFinished') continue
    if (record.state === 'revoking') {
      results.push({ id: record.id, kind: 'revoke', outcome: await revokeAgent(deps, record.id) })
      continue
    }
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
    const stamp = { lastReconciledAt: iso(now()) }
    const moved = found.matches.find((m) => m.deviceId === record.deviceId && m.entry.subject !== record.agentDid)
    if (moved) {
      await update(deps.store, record.id, {
        ...stamp,
        currentSubject: moved.entry.subject,
        keyChanged: true,
      } as Partial<C>)
      results.push({ id: record.id, kind: 'keyChanged', subject: moved.entry.subject })
    } else if (found.matches.length === 0) {
      const expired = record.expiresAt !== undefined && Date.parse(record.expiresAt) <= now()
      const state = expired ? 'expired' : 'revoked'
      await update(deps.store, record.id, { ...stamp, state } as Partial<C>)
      results.push({ id: record.id, kind: 'gone', state })
    } else {
      await update(deps.store, record.id, stamp as Partial<C>)
      results.push({ id: record.id, kind: 'unchanged' })
    }
  }
  return results
}
