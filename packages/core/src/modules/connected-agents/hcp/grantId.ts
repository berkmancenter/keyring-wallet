/**
 * Learning a grant's id after approval. VTI hcp.md §5.1 puts no `grantId` in the consent request (the VTA assigns it
 * when the grant is issued), so Keyring matches its pending grant by the request's thread and learns the id here, when
 * it first needs it (to revoke): from the client's `grant.issued` audit event (HCP 8.1, "Any new grant"), read as
 * Management Client with `hcp/audit/read`.
 *
 * The event names no thread, so Keyring refuses to guess rather than risk revoking another grant:
 * - an event whose `data.threadId` is the record's thread is taken at once (not in HCP or VTI today; see the TODO);
 * - otherwise the grant is the one `grant.issued` for the client inside the record's issue window ({@link
 *   hcpIssueWindow}: from the approval's start to the latest it can have been decided, plus
 *   {@link HCP_GRANT_ISSUE_WINDOW_MS}, each widened by {@link HCP_AUDIT_SKEW_MS}), whose `grantId` is not one Keyring
 *   already holds for the client (connection, approval in flight, retiring grant);
 * - more than one such event (two approvals answered at once, or a grant another Management Client approved for the
 *   same client), or another record of the client with no `grantId` whose window overlaps this one, is `ambiguous`:
 *   nothing is learnt, so nothing is revoked, and the caller keeps the record and tries later.
 *
 * Residual risk, pending the TODO: a grant another Management Client approved for the same client inside the window,
 * issued before Keyring's own and alone in the log at the time, is taken as Keyring's.
 *
 * TODO(vti): ask the VTA maintainer to put the held request's `threadId` in `grant.issued`'s `data` (HCP 8.2 lets an
 * implementation add `data` members); matching on it removes this heuristic.
 *
 * Nothing here logs a payload or a response.
 *
 * @module connected-agents/hcp/grantId
 */
import { isInstant, readHcpAudit } from './whatItSaw/audit'
import type { HcpCallFailure, HcpVtaPort } from './vtaPort'

/** HCP 8.1's event for a new grant. */
export const HCP_GRANT_ISSUED_EVENT = 'grant.issued'

/** The refusal given, with nothing sent, when the grant's id is not yet learnt: no `grant.issued` event for it yet. */
export const HCP_GRANT_NOT_ISSUED = 'grantNotIssued'

/** The refusal given, with nothing sent, when Keyring cannot tell which `grant.issued` is this record's. */
export const HCP_GRANT_AMBIGUOUS = 'grantAmbiguous'

/** Slack on the phone's and the VTA's clocks when reading events by time. */
export const HCP_AUDIT_SKEW_MS = 60 * 1000

/**
 * How long after the consent decision the grant can still be issued: the client resubmits within the consent grant
 * (600 s), plus a margin. An assumption pending VTA confirmation.
 */
export const HCP_GRANT_ISSUE_WINDOW_MS = 15 * 60 * 1000

/** A record's approval, as far as learning its grant needs. Times are ISO-8601 instants. */
export interface HcpHeldApproval {
  threadId: string
  grantId?: string
  /** When the approval started. */
  since?: string
  /** The latest the approval can have been decided: `approvedAt`, or the consent request's own `expiresAt`. */
  decidedBy?: string
}

export interface HcpGrantIdQuery {
  /** The client's VID. */
  clientVid: string
  /** The record whose grant is looked for. */
  record: HcpHeldApproval
  /** Every other record Keyring holds for the client: their grant ids are excluded, and their windows compared. */
  held?: HcpHeldApproval[]
}

/** The learnt grant, `notIssued` when no event for it is in the log yet, or `ambiguous`; a failed read gives its failure. */
export type HcpGrantIdOutcome =
  | { ok: true; grantId: string; issuedAt: string; expiresAt?: string }
  | { ok: true; notIssued: true }
  | { ok: true; ambiguous: true }
  | HcpCallFailure

/** The window in which a record's `grant.issued` can fall, in ms, or undefined when its times are unreadable. */
export function hcpIssueWindow(record: HcpHeldApproval): { from: number; to: number } | undefined {
  const since = record.since ? Date.parse(record.since) : NaN
  const decidedBy = record.decidedBy ? Date.parse(record.decidedBy) : NaN
  if (Number.isNaN(since) || Number.isNaN(decidedBy)) return undefined
  return {
    from: since - HCP_AUDIT_SKEW_MS,
    to: Math.max(since, decidedBy) + HCP_GRANT_ISSUE_WINDOW_MS + HCP_AUDIT_SKEW_MS,
  }
}

export async function learnHcpGrantId(port: HcpVtaPort, query: HcpGrantIdQuery): Promise<HcpGrantIdOutcome> {
  const window = hcpIssueWindow(query.record)
  if (!window) return { ok: true, notIssued: true }
  const others = (query.held ?? []).filter((h) => h.threadId !== query.record.threadId)
  const exclude = new Set(others.flatMap((h) => (h.grantId ? [h.grantId] : [])))
  // Another unlearnt approval of the client whose window overlaps: either could own either grant.
  const overlapping = others.some((h) => {
    if (h.grantId) return false
    const w = hcpIssueWindow(h)
    return !w || (w.from <= window.to && window.from <= w.to)
  })
  if (overlapping) return { ok: true, ambiguous: true }
  const read = await readHcpAudit(port, {
    client: query.clientVid,
    eventType: HCP_GRANT_ISSUED_EVENT,
    from: new Date(window.from).toISOString(),
  })
  if (read.failure) return read.failure
  const issued = read.events.filter(
    (e) => e.eventType === HCP_GRANT_ISSUED_EVENT && e.grantId !== null && !exclude.has(e.grantId)
  )
  const threadOf = (e: (typeof issued)[number]) => (typeof e.data?.threadId === 'string' ? e.data.threadId : undefined)
  const byThread = issued.find((e) => threadOf(e) === query.record.threadId)
  const inWindow = issued.filter((e) => {
    const at = Date.parse(e.timestamp)
    return at >= window.from && at <= window.to && threadOf(e) === undefined
  })
  const found = byThread ?? (inWindow.length === 1 ? inWindow[0] : undefined)
  if (!found) return inWindow.length > 1 || read.cut ? { ok: true, ambiguous: true } : { ok: true, notIssued: true }
  const expiresAt = found.data?.expiresAt
  return {
    ok: true,
    grantId: found.grantId as string,
    issuedAt: found.timestamp,
    ...(isInstant(expiresAt) ? { expiresAt } : {}),
  }
}

/** The fields a record keeps once its grant is learnt. */
export function learntGrantFields(learnt: { grantId: string; issuedAt: string; expiresAt?: string }): {
  grantId: string
  grantIssuedAt: string
  grantExpiresAt?: string
} {
  return {
    grantId: learnt.grantId,
    grantIssuedAt: learnt.issuedAt,
    ...(learnt.expiresAt ? { grantExpiresAt: learnt.expiresAt } : {}),
  }
}
