/**
 * Revoke an HCP grant, and learn whether the client was told (step 7.27 track C, part 3, "Revoke and the notice state
 * (C6)"). Its own file: the base path's `../revoke.ts` is not this.
 *
 * - {@link revokeHcpGrant} sends `hcp/grants/revoke/0.1` `{ grantId }` once (never retried on its own). On success the
 *   record reads revoked, with the notice `telling`; on a refusal or an unreachable VTA it is unchanged.
 * - {@link pollHcpNotice} sends `hcp/disclosures/summary/0.1` `{ client }` and reads it by our grant (backlog 2,
 *   track 5):
 *   - an OK answer with no `clients` entry for the client, or an entry whose `grants` does not list our `grantId`:
 *     nothing was disclosed under our grant, so `nothingDisclosed` ("Revoked." alone);
 *   - `delivered` is `told` only if its `usableUntil` (the time of delivery) is at or after our `revokedAt`; an
 *     earlier one is a retired grant's notice and keeps `telling`;
 *   - `abandoned` is `notTold` only while `grants` lists our `grantId` as `revoked`; otherwise it keeps `telling`;
 *   - `none`, a refusal and an unreachable VTA keep `telling` (no answer is not "nothing disclosed"); the HCP flags
 *     off leaves the record as it is.
 * - {@link nextHcpPoll} is the schedule: every 5 s for 2 minutes after the revoke, then every minute until 24 hours
 *   after it, then stop. A poll at or after the stop that leaves the notice `telling` settles it as `notTold`.
 * - `told`, `notTold` and `nothingDisclosed` never go back to `telling`.
 * - {@link useHcpNotice} polls on that schedule while mounted. Exported from the hcp folder only; nothing imports it.
 *
 * Nothing here logs a payload or a response.
 *
 * @module connected-agents/hcp/revoke
 */
import { useEffect, useRef, useState } from 'react'

import { isHcpEnabled } from './hcpFlag'
import type { HcpConnectionReader } from './store'
import { HCP_DISCLOSURES_SUMMARY, HCP_GRANTS_REVOKE, type HcpConnection, type HcpNoticeState } from './types'
import { callHcp, type HcpVtaPort, onHcpFailure } from './vtaPort'

export interface HcpRevokeDeps {
  port: HcpVtaPort
  store: HcpConnectionReader
  clock: () => Date
}

export type HcpRevokeResult =
  | { ok: true; connection: HcpConnection }
  | { ok: false; missing: true }
  | { ok: false; refused: string; message: { key: 'RevokeRefused'; params: { name: string } } }
  | { ok: false; unreachable: true; message: { key: 'RevokeUnreachable'; params: { name: string } } }
  /**
   * The HCP flags are off: nothing was sent and the record is unchanged. No copy, on purpose: with the flags off no
   * screen that revokes is reachable, so a string here would only show when something is already wrong.
   */
  | { ok: false; off: true }

/** Poll every 5 s for the first 2 minutes after the revoke. */
export const HCP_POLL_FAST_MS = 5000
/** Then every minute. */
export const HCP_POLL_SLOW_MS = 60000
export const HCP_POLL_FAST_FOR_MS = 2 * 60 * 1000
/** And stop 24 hours after the revoke. */
export const HCP_POLL_STOP_AFTER_MS = 24 * 60 * 60 * 1000

/**
 * Revoke the record's grant. A record already revoked sends nothing and is returned as it is. `revokedAt` is the
 * clock when the VTA's answer arrived.
 */
export async function revokeHcpGrant(deps: HcpRevokeDeps, id: string): Promise<HcpRevokeResult> {
  const c = await deps.store.get(id)
  if (!c) return { ok: false, missing: true }
  if (c.revokedAt) return { ok: true, connection: c }
  const outcome = await callHcp<unknown>(deps.port, HCP_GRANTS_REVOKE, { grantId: c.grantId })
  if (!outcome.ok) {
    return onHcpFailure<HcpRevokeResult>(outcome, {
      refused: (code) => ({ ok: false, refused: code, message: { key: 'RevokeRefused', params: { name: c.name } } }),
      unreachable: () => ({
        ok: false,
        unreachable: true,
        message: { key: 'RevokeUnreachable', params: { name: c.name } },
      }),
      off: () => ({ ok: false, off: true }),
    })
  }
  const revokedAt = deps.clock().toISOString()
  const updated = await deps.store.update(id, (r) =>
    r.revokedAt ? r : { ...r, revokedAt, notice: { state: 'telling' } }
  )
  return updated ? { ok: true, connection: updated } : { ok: false, missing: true }
}

/** Milliseconds to the next poll, or undefined once the polling has stopped (24 hours after the revoke). */
export function nextHcpPoll(revokedAt: Date, now: Date): number | undefined {
  const elapsed = now.getTime() - revokedAt.getTime()
  if (elapsed < HCP_POLL_FAST_FOR_MS) return HCP_POLL_FAST_MS
  if (elapsed < HCP_POLL_STOP_AFTER_MS) return HCP_POLL_SLOW_MS
  return undefined
}

/**
 * A `disclosures/summary` answer read for one client and one grant:
 * - `nothingDisclosed`: the answer has no entry for the client, or the client's entry does not list the grant;
 * - `entry`: the client's entry, with the status its `grants` gives the grant.
 */
type ClientSummary =
  | { kind: 'nothingDisclosed' }
  | {
      kind: 'entry'
      notification: 'delivered' | 'abandoned' | 'none'
      usableUntil: string | null
      grantStatus: 'active' | 'revoked' | 'expired'
    }

/**
 * The answer read for `clientVid` and `grantId`, from the first `clients[]` entry whose `client.id` is `clientVid`.
 * Undefined, so no answer, for anything not of the expected shape: no `clients` array, an entry with no valid
 * `notification` or no `grants` array, and an answer with a `nextCursor` and no entry for the client on this page (the
 * entry may be on the next one, so it does not show that nothing was disclosed).
 */
function readClientSummary(value: unknown, clientVid: string, grantId: string): ClientSummary | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const { clients, nextCursor } = value as { clients?: unknown; nextCursor?: unknown }
  if (!Array.isArray(clients)) return undefined
  for (const entry of clients) {
    if (typeof entry !== 'object' || entry === null) continue
    const client = (entry as { client?: { id?: unknown } }).client
    if (client?.id !== clientVid) continue
    const { notification, usableUntil, grants } = entry as {
      notification?: unknown
      usableUntil?: unknown
      grants?: unknown
    }
    if (notification !== 'delivered' && notification !== 'abandoned' && notification !== 'none') return undefined
    if (!Array.isArray(grants)) return undefined
    const ours = grants.find(
      (g): g is { status: unknown } =>
        typeof g === 'object' && g !== null && (g as { grantId?: unknown }).grantId === grantId
    )
    if (!ours) return { kind: 'nothingDisclosed' }
    const grantStatus = ours.status
    if (grantStatus !== 'active' && grantStatus !== 'revoked' && grantStatus !== 'expired') return undefined
    const until = typeof usableUntil === 'string' && !Number.isNaN(Date.parse(usableUntil)) ? usableUntil : null
    return { kind: 'entry', notification, usableUntil: until, grantStatus }
  }
  return nextCursor === undefined ? { kind: 'nothingDisclosed' } : undefined
}

/** A `delivered` notice is ours only if delivered (its `usableUntil`) at or after our `revokedAt`. */
function deliveredAfter(usableUntil: string | null, revokedAt: string): usableUntil is string {
  return usableUntil !== null && Date.parse(usableUntil) >= Date.parse(revokedAt)
}

export interface HcpPollResult {
  /** The record after the poll, or undefined if there is none. */
  connection?: HcpConnection
  /** The `usableUntil` this poll read, if any (it is also kept on the record, as `lastUsableUntil`). */
  usableUntil?: string
}

/** Whether a record is revoked and still waiting to learn if the client was told. */
export function hcpNoticePending(c: HcpConnection | undefined): c is HcpConnection & { revokedAt: string } {
  return !!c?.revokedAt && (c.notice === undefined || c.notice.state === 'telling')
}

/**
 * Ask the VTA whether the client was told of the revoke, and record the answer. Sends nothing for a record that is not
 * revoked or whose notice is already `told`, `notTold` or `nothingDisclosed`. The answer is read by our grant, as the
 * module comment says.
 *
 * A `usableUntil` the poll reads from our client's entry (not a retired grant's delivery time) is kept on the record as `lastUsableUntil`, so it survives a restart. At or after the
 * stop, a notice still `telling` becomes `notTold` with this poll's `usableUntil`, else the record's
 * `lastUsableUntil`, else `revokedAt`: the same answer whether or not the app restarted in between.
 */
export async function pollHcpNotice(deps: HcpRevokeDeps, id: string): Promise<HcpPollResult> {
  const c = await deps.store.get(id)
  if (!hcpNoticePending(c)) return { connection: c }
  const outcome = await callHcp<unknown>(deps.port, HCP_DISCLOSURES_SUMMARY, { client: c.id })
  // The HCP flags off is no answer about the notice, not even a missed one: the record is left as it is (an
  // unanswered poll past the stop would settle it `notTold`). A refusal or an unreachable VTA reads no summary.
  const off = !outcome.ok && onHcpFailure(outcome, { refused: () => false, unreachable: () => false, off: () => true })
  if (off) return { connection: c }
  const now = deps.clock()
  const summary = outcome.ok ? readClientSummary(outcome.value, c.id, c.grantId) : undefined
  const entry = summary?.kind === 'entry' ? summary : undefined
  // Where a notice was delivered, `usableUntil` is its time of delivery, not a time anything stops being usable: one
  // before our revoke (a retired grant's notice) is not kept for the stop's "stops being usable at".
  const staleDelivery = entry?.notification === 'delivered' && !deliveredAfter(entry.usableUntil, c.revokedAt)
  const read = staleDelivery ? undefined : (entry?.usableUntil ?? undefined)
  const stopped = nextHcpPoll(new Date(c.revokedAt), now) === undefined

  const noticeFor = (r: HcpConnection & { revokedAt: string }): HcpNoticeState => {
    // An answer showing nothing disclosed under our grant settles the notice, at the stop as before it.
    if (summary?.kind === 'nothingDisclosed') return { state: 'nothingDisclosed' }
    if (entry?.notification === 'delivered' && deliveredAfter(entry.usableUntil, r.revokedAt)) {
      // `usableUntil` is the time of delivery.
      return { state: 'told', at: entry.usableUntil }
    }
    // An abandoned notice is ours only while the summary lists our grant revoked (Option 1).
    if ((entry?.notification === 'abandoned' && entry.grantStatus === 'revoked') || stopped) {
      return { state: 'notTold', usableUntil: read ?? r.lastUsableUntil ?? r.revokedAt }
    }
    return { state: 'telling', lastPolledAt: now.toISOString() }
  }
  // Decided on the record as it is under the lock: a notice settled meanwhile (another poll) is never put back to
  // `telling`, nor overwritten, and the fallback reads the `lastUsableUntil` the poll before this one stored.
  const connection = await deps.store.update(id, (r) =>
    hcpNoticePending(r) ? { ...r, notice: noticeFor(r), ...(read !== undefined ? { lastUsableUntil: read } : {}) } : r
  )
  return { connection, usableUntil: read }
}

const defaultClock = () => new Date()

/**
 * Poll the notice of record `id` on the {@link nextHcpPoll} schedule while mounted, for a revoked record whose notice
 * is `telling`. Returns the record as last read (undefined until it is read, and when there is none). Does nothing
 * unless both HCP flags are on.
 */
export function useHcpNotice(
  deps: { port: HcpVtaPort; store: HcpConnectionReader; clock?: () => Date },
  id: string
): HcpConnection | undefined {
  const [connection, setConnection] = useState<HcpConnection | undefined>(undefined)
  const depsRef = useRef(deps)
  depsRef.current = deps

  useEffect(() => {
    if (!isHcpEnabled()) return undefined
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const current = (): HcpRevokeDeps => ({
      port: depsRef.current.port,
      store: depsRef.current.store,
      clock: depsRef.current.clock ?? defaultClock,
    })

    const schedule = (c: HcpConnection | undefined, afterError = false) => {
      if (stopped || !hcpNoticePending(c)) return
      const delay = nextHcpPoll(new Date(c.revokedAt), current().clock())
      // Past the stop: one last poll settles the notice (after an error, not at once again).
      timer = setTimeout(tick, delay ?? (afterError ? HCP_POLL_SLOW_MS : 0))
    }

    async function tick(): Promise<void> {
      timer = undefined
      if (stopped) return
      try {
        const result = await pollHcpNotice(current(), id)
        if (stopped) return
        setConnection(result.connection)
        schedule(result.connection)
      } catch {
        // A store error: try again on the schedule, from the record as last read.
        if (!stopped)
          schedule(
            await current()
              .store.get(id)
              .catch(() => undefined),
            true
          )
      }
    }

    void current()
      .store.get(id)
      .then((c) => {
        if (stopped) return
        setConnection(c)
        schedule(c)
      })
      .catch(() => undefined)

    return () => {
      stopped = true
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [id])

  return connection
}
