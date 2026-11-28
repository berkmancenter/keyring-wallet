/**
 * Learning a grant's id after approval. VTI hcp.md §5.1 puts no `grantId` in the consent request (the VTA assigns it
 * when the grant is issued), so Keyring matches its pending grant by the request's thread and learns the id here, when
 * it first needs it (to revoke): from the client's `grant.issued` audit event (HCP 8.1, "Any new grant"), read as
 * Management Client with `hcp/audit/read`.
 *
 * The event names no thread, so the grant is taken as the earliest `grant.issued` for the client at or after the
 * approval started (less {@link HCP_AUDIT_SKEW_MS} for the clocks), whose `grantId` is not one Keyring already holds for
 * that client. An assumption, pending a VTA that sends `grantId` in the `hcpClient` detail (then that is used and
 * nothing is read): two approvals of the same client in flight at once could be told apart only by the order the
 * grants were issued.
 *
 * Nothing here logs a payload or a response.
 *
 * @module connected-agents/hcp/grantId
 */
import { readHcpAudit } from './whatItSaw/audit'
import type { HcpCallFailure, HcpVtaPort } from './vtaPort'

/** HCP 8.1's event for a new grant. */
export const HCP_GRANT_ISSUED_EVENT = 'grant.issued'

/** The refusal given, with nothing sent, when the grant's id is not yet learnt: no `grant.issued` event for it yet. */
export const HCP_GRANT_NOT_ISSUED = 'grantNotIssued'

/** Slack on the phone's and the VTA's clocks when reading events by time. */
export const HCP_AUDIT_SKEW_MS = 60 * 1000

export interface HcpGrantIdQuery {
  /** The client's VID. */
  clientVid: string
  /** When the approval started (the approval in flight's `startedAt`, else the connection's `approvedAt`). */
  since: string
  /** Grant ids Keyring already holds for this client (another connection, a retiring grant): never this one's. */
  exclude?: string[]
}

/** `found`, or `notIssued` when no such event is in the log yet; a failed read gives its failure. */
export type HcpGrantIdOutcome = { ok: true; grantId: string } | { ok: true; notIssued: true } | HcpCallFailure

export async function learnHcpGrantId(port: HcpVtaPort, query: HcpGrantIdQuery): Promise<HcpGrantIdOutcome> {
  const since = Date.parse(query.since)
  if (Number.isNaN(since)) return { ok: true, notIssued: true }
  const read = await readHcpAudit(port, {
    client: query.clientVid,
    eventType: HCP_GRANT_ISSUED_EVENT,
    from: new Date(since - HCP_AUDIT_SKEW_MS).toISOString(),
  })
  if (read.failure) return read.failure
  const exclude = new Set(query.exclude ?? [])
  const issued = read.events
    .filter((e) => e.eventType === HCP_GRANT_ISSUED_EVENT && e.grantId !== null && !exclude.has(e.grantId))
    .filter((e) => Date.parse(e.timestamp) >= since - HCP_AUDIT_SKEW_MS)
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
  const first = issued[0]
  return first?.grantId ? { ok: true, grantId: first.grantId } : { ok: true, notIssued: true }
}
