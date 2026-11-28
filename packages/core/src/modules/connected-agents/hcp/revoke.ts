/**
 * Revoke an HCP grant, and learn whether the client was told (step 7.27 track C, part 3, "Revoke and the notice state
 * (C6)"). Its own file: the base path's `../revoke.ts` is not this.
 *
 * - {@link revokeHcpGrant} sends `hcp/grants/revoke/0.1` `{ grantId }` once (never retried on its own). On success the
 *   record reads revoked, with the notice `telling`; on a refusal or an unreachable VTA it is unchanged. A record
 *   with no `grantId` (VTI hcp.md §5.1 pre-assigns none) first learns it (`./grantId.ts`) and keeps it; a grant not
 *   yet in the audit log is refused `grantNotIssued`, sending no revoke.
 * - {@link pollHcpNotice} reads the notice by our grant from the audit log (HCP 8.1/8.2; the "Telling…" rule), as
 *   Management Client with `hcp/audit/read`, filtered by `eventType` and `from` and matched on `grantId` here:
 *   - `grant.revoked` for our grant initiated by the `context-client`: it had relinquished the grant, `disconnected`;
 *   - no `grant.revoked` for our grant, the revoke answered at or after `expiresAt`, and the log's 60 s delay past:
 *     the grant had expired, `ended` (an expired grant gets no event and no notice);
 *   - `revocation.notified` for our grant: `delivered` is `told` at the event's `timestamp`; `abandoned` is `notTold`
 *     with `data.lastUseUntil`, else the largest `useUntil` disclosed under the grant;
 *   - no `context.read` for our grant with a non-empty `disclosed`: nothing to tell, `nothingDisclosed`;
 *   - otherwise `telling`, until the stop ({@link HCP_POLL_STOP_AFTER_MS}), which settles `notTold` with that largest
 *     `useUntil`. An unreachable VTA keeps `telling` (and settles the same at the stop).
 * - Where the audit read is refused or malformed (an older VTA), the poll falls back to `hcp/disclosures/summary/0.1`
 *   `{ client }`, best-effort and read by our grant (backlog 2, track 5):
 *   - an OK answer with no `clients` entry for the client, or an entry whose `grants` does not list our `grantId`:
 *     nothing was disclosed under our grant, so `nothingDisclosed` ("Revoked." alone);
 *   - `delivered` is `told` only if its `usableUntil` (the time of delivery) is at or after our `revokedAt`; an
 *     earlier one is a retired grant's notice and keeps `telling`;
 *   - `abandoned` is `notTold` only while `grants` lists our `grantId` as `revoked`, and only once the entry differs
 *     from the first one read after the revoke (`summaryAtRevoke`): until a value changes, it may be an earlier
 *     grant's notice and keeps `telling`;
 *   - `none`, a refusal and an unreachable VTA keep `telling` (no answer is not "nothing disclosed");
 *   - a notice still `telling` {@link HCP_SUMMARY_STOP_AFTER_MS} after the revoke settles as `notTold`.
 * - The HCP flags off leaves the record as it is.
 * - {@link nextHcpPoll} is the schedule: every 5 s for 2 minutes after the revoke, then every minute until 25 hours
 *   after it, then stop. A poll at or after the stop that leaves the notice `telling` settles it as `notTold`.
 * - `told`, `notTold`, `nothingDisclosed`, `ended` and `disconnected` never go back to `telling`.
 * - {@link useHcpNotice} polls on that schedule while mounted. Exported from the hcp folder only; nothing imports it.
 *
 * Nothing here logs a payload or a response.
 *
 * @module connected-agents/hcp/revoke
 */
import { useEffect, useRef, useState } from 'react'

import {
  HCP_AUDIT_SKEW_MS,
  HCP_GRANT_AMBIGUOUS,
  HCP_GRANT_NOT_ISSUED,
  learnHcpGrantId,
  learntGrantFields,
} from './grantId'
import { isHcpEnabled } from './hcpFlag'
import { heldOfConnection, type HcpConnectionReader } from './store'
import { HCP_DISCLOSURES_SUMMARY, HCP_GRANTS_REVOKE, type HcpConnection, type HcpNoticeState } from './types'
import { callHcp, type HcpCallFailure, type HcpVtaPort, onHcpFailure } from './vtaPort'
import { type HcpAuditEvent, isInstant, readHcpAudit } from './whatItSaw/audit'

export interface HcpRevokeDeps {
  port: HcpVtaPort
  store: HcpConnectionReader
  clock: () => Date
}

export type HcpRevokeResult =
  | { ok: true; connection: HcpConnection }
  | { ok: false; missing: true }
  | {
      ok: false
      refused: string
      /**
       * `RevokeRefused` for the VTA's refusal. With nothing sent: `RevokeNotYetIssued` while the grant is not yet in
       * the audit log (`grantNotIssued`), `RevokeGrantAmbiguous` when Keyring cannot tell which grant is this
       * connection's (`grantAmbiguous`); both can be tried again later.
       */
      message: { key: 'RevokeRefused' | 'RevokeNotYetIssued' | 'RevokeGrantAmbiguous'; params: { name: string } }
    }
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
/**
 * And stop 25 hours after the revoke: the carriage tries a notice for up to 24 hours after its first attempt (TT
 * grants/revoked), plus a margin for when the first attempt starts and the audit log's 60 s delay.
 */
export const HCP_POLL_STOP_AFTER_MS = 25 * 60 * 60 * 1000
/** The summary fallback settles a notice still `telling` 24 hours after the revoke, as before. */
export const HCP_SUMMARY_STOP_AFTER_MS = 24 * 60 * 60 * 1000

/** HCP 8.1's events the notice is read from. */
export const HCP_GRANT_REVOKED_EVENT = 'grant.revoked'
export const HCP_REVOCATION_NOTIFIED_EVENT = 'revocation.notified'
export const HCP_CONTEXT_READ_EVENT = 'context.read'

/**
 * Revoke the record's grant. A record already revoked sends nothing and is returned as it is. `revokedAt` is the
 * clock when the VTA's answer arrived.
 */
export async function revokeHcpGrant(deps: HcpRevokeDeps, id: string): Promise<HcpRevokeResult> {
  const c = await deps.store.get(id)
  if (!c) return { ok: false, missing: true }
  if (c.revokedAt) return { ok: true, connection: c }
  const refusedFor = (
    code: string,
    key: 'RevokeRefused' | 'RevokeNotYetIssued' | 'RevokeGrantAmbiguous' = 'RevokeRefused'
  ): HcpRevokeResult => ({
    ok: false,
    refused: code,
    message: { key, params: { name: c.name } },
  })
  let grantId = c.grantId
  if (!grantId) {
    // From the approval's start, excluding every grant Keyring holds for the client (`./grantId.ts`).
    const held = await deps.store.heldFor(c.id)
    const learnt = await learnHcpGrantId(deps.port, { clientVid: c.id, record: heldOfConnection(c), held })
    if (!learnt.ok) {
      return onHcpFailure<HcpRevokeResult>(learnt, {
        refused: (code) => refusedFor(code),
        unreachable: () => ({
          ok: false,
          unreachable: true,
          message: { key: 'RevokeUnreachable', params: { name: c.name } },
        }),
        off: () => ({ ok: false, off: true }),
      })
    }
    if ('ambiguous' in learnt) return refusedFor(HCP_GRANT_AMBIGUOUS, 'RevokeGrantAmbiguous')
    if (!('grantId' in learnt)) return refusedFor(HCP_GRANT_NOT_ISSUED, 'RevokeNotYetIssued')
    const known = learntGrantFields(learnt)
    grantId = known.grantId
    // Kept before the revoke is sent, so the answer cannot change from one try to the next.
    await deps.store.update(id, (r) => (r.grantId || r.threadId !== c.threadId ? r : { ...r, ...known }))
  }
  const outcome = await callHcp<unknown>(deps.port, HCP_GRANTS_REVOKE, { grantId })
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

type Revoked = HcpConnection & { revokedAt: string; grantId: string }

/** What the audit log says of our grant's notice: a settled state, or `telling` with the largest `useUntil` read. */
type AuditNotice =
  | { settled: HcpNoticeState; usableUntil?: string }
  | { telling: true; usableUntil?: string }
  | { failure: HcpCallFailure }

const ofGrant = (events: HcpAuditEvent[], eventType: string, grantId: string) =>
  events
    .filter((e) => e.eventType === eventType && e.grantId === grantId)
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))

const latest = (times: string[]) =>
  times.reduce<string | undefined>(
    (max, t) => (max === undefined || Date.parse(t) > Date.parse(max) ? t : max),
    undefined
  )

/** The "Telling…" rule over the audit log (module comment). Three filtered reads; any failure ends it. */
async function readNoticeFromAudit(port: HcpVtaPort, c: Revoked, now: Date): Promise<AuditNotice> {
  const revokedAt = Date.parse(c.revokedAt)
  // From the approval's start, never `approvedAt`, which the reconcile can date as late as the request's expiry.
  const sinceApproval = new Date(Date.parse(c.approvalStartedAt ?? c.approvedAt) - HCP_AUDIT_SKEW_MS).toISOString()

  const revokes = await readHcpAudit(port, { client: c.id, eventType: HCP_GRANT_REVOKED_EVENT, from: sinceApproval })
  if (revokes.failure) return { failure: revokes.failure }
  const revokeEvent = ofGrant(revokes.events, HCP_GRANT_REVOKED_EVENT, c.grantId)[0]
  if (revokeEvent?.initiatorRole === 'context-client') return { settled: { state: 'disconnected' } }
  if (!revokeEvent && revokedAt >= Date.parse(c.expiresAt) && now.getTime() - revokedAt >= HCP_AUDIT_SKEW_MS) {
    return { settled: { state: 'ended' } }
  }

  // R, the revoke instant: the provider's `grant.revoked`, else (until it is seen) our own `revokedAt`.
  const r = revokeEvent ? Math.min(Date.parse(revokeEvent.timestamp), revokedAt) : revokedAt
  const notices = await readHcpAudit(port, {
    client: c.id,
    eventType: HCP_REVOCATION_NOTIFIED_EVENT,
    from: new Date(r - HCP_AUDIT_SKEW_MS).toISOString(),
  })
  if (notices.failure) return { failure: notices.failure }
  const notified = ofGrant(notices.events, HCP_REVOCATION_NOTIFIED_EVENT, c.grantId).find(
    (e) => e.data?.outcome === 'delivered' || e.data?.outcome === 'abandoned'
  )
  if (notified?.data?.outcome === 'delivered') return { settled: { state: 'told', at: notified.timestamp } }

  const reads = await readHcpAudit(port, { client: c.id, eventType: HCP_CONTEXT_READ_EVENT, from: sinceApproval })
  if (reads.failure) return { failure: reads.failure }
  const maxUseUntil = latest(
    ofGrant(reads.events, HCP_CONTEXT_READ_EVENT, c.grantId).flatMap((e) => (e.disclosed ?? []).map((d) => d.useUntil))
  )
  const fallbackUntil = maxUseUntil ?? c.lastUsableUntil ?? c.revokedAt
  if (notified) {
    const lastUseUntil = notified.data?.lastUseUntil
    return {
      settled: { state: 'notTold', usableUntil: isInstant(lastUseUntil) ? lastUseUntil : fallbackUntil },
      usableUntil: maxUseUntil,
    }
  }
  // A read cut at the maximum cannot show that nothing was disclosed.
  if (maxUseUntil === undefined && !reads.cut) return { settled: { state: 'nothingDisclosed' } }
  if (nextHcpPoll(new Date(c.revokedAt), now) === undefined) {
    return { settled: { state: 'notTold', usableUntil: fallbackUntil }, usableUntil: maxUseUntil }
  }
  return { telling: true, usableUntil: maxUseUntil }
}

/** Whether the audit read failed in a way the summary may stand in for: refused, or an answer of the wrong shape. */
const summaryMayStandIn = (failure: HcpCallFailure) =>
  onHcpFailure(failure, { refused: () => true, unreachable: () => false, off: () => false })

const isOff = (failure: HcpCallFailure) =>
  onHcpFailure(failure, { refused: () => false, unreachable: () => false, off: () => true })

/**
 * Ask the VTA whether the client was told of the revoke, and record the answer. Sends nothing for a record that is not
 * revoked or whose notice is already settled. The audit log is read first; the summary only where the audit read is
 * refused or malformed (`malformedAnswer`), as the module comment says.
 *
 * A `usableUntil` the poll reads for our grant (the largest `useUntil` disclosed under it, or, from the summary, never
 * a retired grant's delivery time) is kept on the record as `lastUsableUntil`, so it survives a restart: a stop
 * settles a notice still `telling` as `notTold` with this poll's `usableUntil`, else the record's `lastUsableUntil`,
 * else `revokedAt`, the same answer whether or not the app restarted in between.
 */
export async function pollHcpNotice(deps: HcpRevokeDeps, id: string): Promise<HcpPollResult> {
  const c = await deps.store.get(id)
  if (!hcpNoticePending(c)) return { connection: c }
  const now = deps.clock()
  const audit = c.grantId ? await readNoticeFromAudit(deps.port, { ...c, grantId: c.grantId }, now) : undefined
  if (audit && 'failure' in audit && isOff(audit.failure)) return { connection: c }
  if (audit && !('failure' in audit && summaryMayStandIn(audit.failure))) {
    const read = 'failure' in audit ? undefined : audit.usableUntil
    const stopped = nextHcpPoll(new Date(c.revokedAt), now) === undefined
    const noticeFor = (r: HcpConnection & { revokedAt: string }): HcpNoticeState => {
      if ('settled' in audit) return audit.settled
      // Unreachable: no answer. At the stop it settles as the audit rule would with nothing more read.
      if (stopped) return { state: 'notTold', usableUntil: r.lastUsableUntil ?? r.revokedAt }
      return { state: 'telling', lastPolledAt: now.toISOString() }
    }
    const connection = await deps.store.update(id, (r) =>
      hcpNoticePending(r) ? { ...r, notice: noticeFor(r), ...(read !== undefined ? { lastUsableUntil: read } : {}) } : r
    )
    return { connection, usableUntil: read }
  }
  return pollHcpSummary(deps, c, now)
}

/** The best-effort fallback: the client's `disclosures/summary`, read by our grant (module comment). */
async function pollHcpSummary(
  deps: HcpRevokeDeps,
  c: HcpConnection & { revokedAt: string },
  now: Date
): Promise<HcpPollResult> {
  const id = c.id
  const outcome = await callHcp<unknown>(deps.port, HCP_DISCLOSURES_SUMMARY, { client: c.id })
  // The HCP flags off is no answer about the notice, not even a missed one: the record is left as it is (an
  // unanswered poll past the stop would settle it `notTold`). A refusal or an unreachable VTA reads no summary.
  if (!outcome.ok && isOff(outcome)) return { connection: c }
  const summary = outcome.ok && c.grantId ? readClientSummary(outcome.value, c.id, c.grantId) : undefined
  const entry = summary?.kind === 'entry' ? summary : undefined
  // Where a notice was delivered, `usableUntil` is its time of delivery, not a time anything stops being usable: one
  // before our revoke (a retired grant's notice) is not kept for the stop's "stops being usable at".
  const staleDelivery = entry?.notification === 'delivered' && !deliveredAfter(entry.usableUntil, c.revokedAt)
  const read = staleDelivery ? undefined : (entry?.usableUntil ?? undefined)
  const stopped = now.getTime() - Date.parse(c.revokedAt) >= HCP_SUMMARY_STOP_AFTER_MS

  const noticeFor = (r: HcpConnection & { revokedAt: string }): HcpNoticeState => {
    // An answer showing nothing disclosed under our grant settles the notice, at the stop as before it.
    if (summary?.kind === 'nothingDisclosed') return { state: 'nothingDisclosed' }
    if (entry?.notification === 'delivered' && deliveredAfter(entry.usableUntil, r.revokedAt)) {
      // `usableUntil` is the time of delivery.
      return { state: 'told', at: entry.usableUntil }
    }
    // An abandoned notice is ours only while the summary lists our grant revoked (Option 1), and only once the entry
    // has changed since the first one read after the revoke: an unchanged one may be an earlier grant's notice.
    const baseline =
      r.summaryAtRevoke ?? (entry ? { notification: entry.notification, usableUntil: entry.usableUntil } : undefined)
    const changed =
      !!entry && (baseline?.notification !== entry.notification || baseline?.usableUntil !== entry.usableUntil)
    if ((entry?.notification === 'abandoned' && entry.grantStatus === 'revoked' && changed) || stopped) {
      return { state: 'notTold', usableUntil: read ?? r.lastUsableUntil ?? r.revokedAt }
    }
    return { state: 'telling', lastPolledAt: now.toISOString() }
  }
  // Decided on the record as it is under the lock: a notice settled meanwhile (another poll) is never put back to
  // `telling`, nor overwritten, and the fallback reads the `lastUsableUntil` the poll before this one stored.
  const connection = await deps.store.update(id, (r) =>
    hcpNoticePending(r)
      ? {
          ...r,
          notice: noticeFor(r),
          ...(read !== undefined ? { lastUsableUntil: read } : {}),
          ...(!r.summaryAtRevoke && entry
            ? { summaryAtRevoke: { notification: entry.notification, usableUntil: entry.usableUntil } }
            : {}),
        }
      : r
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
