/**
 * Revoke an HCP grant, and learn whether the client was told (step 7.27 track C, part 3, "Revoke and the notice state
 * (C6)"). Its own file: the base path's `../revoke.ts` is not this.
 *
 * - {@link revokeHcpGrant} sends `hcp/grants/revoke/0.1` `{ grantId }` once (never retried on its own). On success the
 *   record reads revoked, with the notice `telling`; on a refusal or an unreachable VTA it is unchanged.
 * - {@link pollHcpNotice} sends `hcp/disclosures/summary/0.1` `{ client }` and reads the client's `notification`:
 *   `delivered` is `told`, `abandoned` is `notTold`, anything else keeps `telling`.
 * - {@link nextHcpPoll} is the schedule: every 5 s for 2 minutes after the revoke, then every minute until 24 hours
 *   after it, then stop. A poll at or after the stop that leaves the notice `telling` settles it as `notTold`.
 * - `told` and `notTold` never go back to `telling`.
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
import { callHcp, type HcpVtaPort } from './vtaPort'

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
    if ('refused' in outcome) {
      return { ok: false, refused: outcome.refused, message: { key: 'RevokeRefused', params: { name: c.name } } }
    }
    return { ok: false, unreachable: true, message: { key: 'RevokeUnreachable', params: { name: c.name } } }
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

/** One client's entry in a `disclosures/summary` answer, as far as the poll reads it. */
interface ClientSummary {
  notification: 'delivered' | 'abandoned' | 'none'
  usableUntil: string | null
}

/** The first `clients[]` entry whose `client.id` is `clientVid`, if the answer has one of the expected shape. */
function readClientSummary(value: unknown, clientVid: string): ClientSummary | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const clients = (value as { clients?: unknown }).clients
  if (!Array.isArray(clients)) return undefined
  for (const entry of clients) {
    if (typeof entry !== 'object' || entry === null) continue
    const client = (entry as { client?: { id?: unknown } }).client
    if (client?.id !== clientVid) continue
    const { notification, usableUntil } = entry as { notification?: unknown; usableUntil?: unknown }
    if (notification !== 'delivered' && notification !== 'abandoned' && notification !== 'none') return undefined
    const until = typeof usableUntil === 'string' && !Number.isNaN(Date.parse(usableUntil)) ? usableUntil : null
    return { notification, usableUntil: until }
  }
  return undefined
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
 * revoked or whose notice is already `told` or `notTold`.
 *
 * A `usableUntil` the poll reads is kept on the record as `lastUsableUntil`, so it survives a restart. At or after the
 * stop, a notice still `telling` becomes `notTold` with this poll's `usableUntil`, else the record's
 * `lastUsableUntil`, else `revokedAt`: the same answer whether or not the app restarted in between.
 */
export async function pollHcpNotice(deps: HcpRevokeDeps, id: string): Promise<HcpPollResult> {
  const c = await deps.store.get(id)
  if (!hcpNoticePending(c)) return { connection: c }
  const outcome = await callHcp<unknown>(deps.port, HCP_DISCLOSURES_SUMMARY, { client: c.id })
  const now = deps.clock()
  const summary = outcome.ok ? readClientSummary(outcome.value, c.id) : undefined
  const read = summary?.usableUntil ?? undefined
  const stopped = nextHcpPoll(new Date(c.revokedAt), now) === undefined

  const noticeFor = (r: HcpConnection & { revokedAt: string }): HcpNoticeState => {
    const lastRead = read ?? r.lastUsableUntil
    if (summary?.notification === 'delivered') {
      // `usableUntil` is the time of delivery. Delivered with no time: the poll's own time, the first Keyring knew.
      return { state: 'told', at: read ?? now.toISOString() }
    }
    if (summary?.notification === 'abandoned' || stopped) {
      return { state: 'notTold', usableUntil: lastRead ?? r.revokedAt }
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
