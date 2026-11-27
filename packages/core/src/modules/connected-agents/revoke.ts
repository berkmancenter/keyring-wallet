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
 * **What it writes.** Of the `AgentConnection` record (§3.11), exactly `state`, `lastReconciledAt`, `keyChanged` and
 * `agentDid`, each write one `connections.update(record.id, r => ({ ...r, ...fields }))`: the store reads, changes and
 * writes the record under its lock for that `id`, so a member another writer changed meanwhile (the driver's VDC
 * grant, a rename) is kept. `fields` holds only those four ({@link Written}), and every read that decides a write is
 * taken inside the callback, on the `r` it is given. `keyChanged` and `agentDid` are written by the reconcile alone,
 * when it finds the agent's `deviceId` under a subject other than `agentDid` (§3.9: "it records the new subject, sets
 * `keyChanged`"; the plan's 7.10 acceptance: "the app-start reconcile records a changed key"): `agentDid` becomes the
 * new subject and `keyChanged` becomes `true`, in the same update as `lastReconciledAt`. It also reports it
 * ({@link ReconcileResult}). Nothing here sets `keyChanged` back to `false`. The record's `id` (its first key, and the
 * store's key), `chatDid`, `chatConnectionId` and `handle` are never written: the chat is not moved. They survive
 * because the callback spreads `r`; the store refuses only an `id` change. 7.10 never calls `put` or `remove`.
 *
 * **Keys.** After a key change `id` stays the agent's first key and `agentDid` is its current one. A record is looked
 * up by `id` (`get`, `update`); the VTA is addressed by `agentDid` (with the `deviceId`); a DID that could be either
 * goes through `findByKey`. Revoke always works from the stored `agentDid` as the agent's current key.
 *
 * **The store.** Step 7.7's `AgentConnectionStore` (`list`, `get`, `put`, `update`, `upsert`, `findByKey`, `remove`)
 * is in #1065, not merged yet. Until it is, this module names the members it uses ({@link RevokableConnection}) and
 * that store's calls ({@link RevokeConnectionStore}). 7.7's `AgentConnection` and `AgentConnectionStore` satisfy both
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
 * is, since each write is a store `update` that spreads the record read under the lock and changes only `state`,
 * `lastReconciledAt`, `keyChanged` and `agentDid`. In particular `id`, `chatDid`, `chatConnectionId` and `handle` are
 * never written.
 */
export type RevokableConnection = {
  /** The record's key (7.7 keys it by the agent's first DID). Never changed here, even when `agentDid` is. */
  id: string
  name: string
  /**
   * The agent's current key: the DID it was paired with, until the reconcile finds its `deviceId` under another
   * subject and records that one here (§3.9). Revoke uses it as the current key. The chat is not moved with it.
   */
  agentDid: string
  /** Set by `device/register`, copied by every `acl/swap-key`: what the agent is found by. */
  deviceId: string
  state: RevokableState
  /** Set to `true` by the reconcile when the agent changed its key without Keyring (§3.9); never set back here. */
  keyChanged: boolean
  /** ISO 8601; absent for a persistent agent. */
  expiresAt?: string
  lastReconciledAt?: string
}

/**
 * The calls of step 7.7's `AgentConnectionStore` (#1065 at d8aadd5b5) this step relies on, with that store's
 * signatures. 7.10 writes only through `update`; `put` and `remove` are listed as the store has them, and 7.10 calls
 * neither.
 */
export interface RevokeConnectionStore<C extends RevokableConnection = RevokableConnection> {
  list(): Promise<C[]>
  /** By `id`, the agent's first key. */
  get(id: string): Promise<C | undefined>
  put(record: C): Promise<void>
  /**
   * Read, change and write the record `id` as one step under the store's lock for that `id`: `change` gets the record
   * as it is under the lock and returns the whole record to write. Returning the record it was given writes nothing.
   * A change to `id` is refused (it throws); nothing else is checked, so a caller spreads the record it is given.
   * Resolves to the record afterwards, or undefined when there is none (and `change` is not called).
   */
  update(id: string, change: (record: C) => C): Promise<C | undefined>
  /** The record whose `id` or current key (`agentDid`) is `did`, if any. */
  findByKey(did: string): Promise<C | undefined>
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
  // active or expired -> revoking, before any VTA call: a restart from here on shows "Revoke not confirmed" and
  // retries, and no VDC is re-issued (`shouldReissueVdc` wants `active`). The state that decides it is read inside the
  // update, under the store's lock; a `revoking` or `revoked` record is not written.
  const record = await write(deps.store, id, (r) => {
    if (r.state === 'revoking' || r.state === 'revoked') return undefined
    if (!REVOKABLE_FROM.includes(r.state))
      throw new Error(`[connected-agents] a ${r.state} agent connection cannot be revoked`)
    return { state: 'revoking' }
  })
  if (!record) throw new Error(`[connected-agents] no agent connection ${id}`)
  if (record.state === 'revoked') return { kind: 'revoked' }

  // 1. The ACL entry, first: by the record's `deviceId` and its current key, `agentDid` (never by its `id`).
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
  await write(deps.store, id, (r) =>
    r.state === 'revoking' ? { state: 'revoked', lastReconciledAt: iso(now()) } : undefined
  )
  return outcome
}

/**
 * The only members this step writes. `keyChanged` only ever to `true`: nothing in 7.10 clears it; clearing it (for
 * example once the owner has seen the change) is left to the record's owner (step 7.7).
 */
type Written = { state?: RevokableState; lastReconciledAt?: string; keyChanged?: true; agentDid?: string }

/**
 * Every write of this step: `store.update(id, r => ({ ...r, ...fields }))`. `decide` runs inside the update, on the
 * record `r` as the store holds it under its lock, and answers the {@link Written} fields to set, or undefined to write
 * nothing (the update then returns `r` itself). Every other member of `r` (the grant, the chat, `handle`, `id`) is
 * kept as `r` has it. Answers the record `decide` saw, before the change, or undefined when there is no record.
 */
async function write<C extends RevokableConnection>(
  store: RevokeConnectionStore<C>,
  id: string,
  decide: (r: C) => Written | undefined
): Promise<C | undefined> {
  const seen: { record?: C } = {}
  await store.update(id, (r) => {
    seen.record = r
    const fields = decide(r)
    return fields ? { ...r, ...fields } : r
  })
  return seen.record
}

/**
 * What the reconcile found for one record. A `keyChanged` result is also written to the record (`agentDid` is
 * the new subject, `keyChanged: true`).
 * `gone` is reported, not written: it would be a state change outside Revoke's two (§3.9), so the record's owner
 * (step 7.7) decides what it shows.
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
 *   other than `agentDid` is recorded as the new `agentDid` and `keyChanged: true`, in the same update as the
 *   stamp, and reported as `keyChanged` (""<name>" changed its key. Revoke it if you did not expect that."). The
 *   record's `id` and the chat (`chatDid`, `chatConnectionId`, `handle`) are not moved, since a rotation Keyring did
 *   not witness proves nothing about who holds the new key. No entry at all is reported as `gone`.
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
    const listing = found
    let result: ReconcileResult = { id: record.id, kind: 'unknown' }
    // One update, decided on the record under the store's lock: the stamp and, when the key changed, the new subject
    // as `agentDid` and `keyChanged: true`. If the record moved on while the VTA was asked (it left active or expired,
    // or its `agentDid` or `deviceId` is no longer the one the listing asked about), nothing is concluded or written.
    await write(deps.store, record.id, (r) => {
      if (!REVOKABLE_FROM.includes(r.state) || r.agentDid !== record.agentDid || r.deviceId !== record.deviceId)
        return undefined
      const lastReconciledAt = iso(now())
      const moved = listing.matches.find((m) => m.deviceId === r.deviceId && m.entry.subject !== r.agentDid)
      if (moved) {
        result = { id: r.id, kind: 'keyChanged', subject: moved.entry.subject }
        // Set-only in 7.10: nothing in 7.10 clears `keyChanged`; clearing it is left to the record's owner (step 7.7).
        return { lastReconciledAt, agentDid: moved.entry.subject, keyChanged: true }
      }
      result = { id: r.id, kind: listing.matches.length === 0 ? 'gone' : 'unchanged' }
      return { lastReconciledAt }
    })
    results.push(result)
  }
  return results
}
