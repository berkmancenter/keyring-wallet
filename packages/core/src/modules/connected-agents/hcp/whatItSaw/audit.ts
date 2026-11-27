/**
 * The audit read of "What my agent saw" (C4; backlog brief, section B part 3, "The reads"): Keyring, as Management
 * Client, sends `hcp/audit/read/0.1` `{ client, limit }` through the HCP port and follows `nextCursor` until it is
 * absent or {@link HCP_AUDIT_MAX_EVENTS} events have been read.
 *
 * Nothing here logs a payload or a response.
 *
 * @module connected-agents/hcp/whatItSaw/audit
 */
import { callHcp, type HcpCallFailure, type HcpVtaPort } from '../vtaPort'

// version-pinned: the hcp suite is pinned at 0.1 (suite 4e2dd42fa); the VTA serves this version only
export const HCP_AUDIT_READ = 'https://trusttasks.org/spec/hcp/audit/read/0.1'

/** The page size asked for. */
export const HCP_AUDIT_PAGE_LIMIT = 100

/** Decided in the brief: the most events one view reads. Beyond it the view says the list is cut. */
export const HCP_AUDIT_MAX_EVENTS = 500

/** The `refused` code given when the VTA answers with no `events` list: the same read would get the same answer. */
export const HCP_AUDIT_MALFORMED = 'malformedAnswer'

/** One audit event (HCP 8.2), as far as the view reads it. Times are ISO-8601 instants. */
export interface HcpAuditEvent {
  eventId: string
  eventType: string
  timestamp: string
  grantId: string | null
  categories: string[]
  purpose: string | null
}

/**
 * What the read gives: the events it read, in the log's order (oldest first), and whether it stopped at the
 * maximum with more left. A failure on any page ends the read; `events` then holds the pages read before it, and
 * `failure` says why.
 */
export interface HcpAuditRead {
  events: HcpAuditEvent[]
  cut: boolean
  failure?: HcpCallFailure
}

export interface HcpAuditQuery {
  /** The client's VID: only events it took part in. */
  client: string
  /** The page size, {@link HCP_AUDIT_PAGE_LIMIT} unless given. */
  limit?: number
  /** Where to start: a `nextCursor` from an earlier read. */
  cursor?: string
}

const isString = (v: unknown): v is string => typeof v === 'string'

/** An event of the expected shape, or undefined: one malformed event is left out, not the whole page. */
function readEvent(value: unknown): HcpAuditEvent | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const e = value as Record<string, unknown>
  if (!isString(e.eventId) || !isString(e.eventType) || !isString(e.timestamp)) return undefined
  if (Number.isNaN(Date.parse(e.timestamp))) return undefined
  return {
    eventId: e.eventId,
    eventType: e.eventType,
    timestamp: e.timestamp,
    grantId: isString(e.grantId) ? e.grantId : null,
    categories: Array.isArray(e.categories) ? e.categories.filter(isString) : [],
    purpose: isString(e.purpose) ? e.purpose : null,
  }
}

/** One page's events and cursor, or undefined if the answer has no `events` list. */
function readPage(value: unknown): { events: HcpAuditEvent[]; nextCursor?: string } | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const { events, nextCursor } = value as { events?: unknown; nextCursor?: unknown }
  if (!Array.isArray(events)) return undefined
  const read = events.map(readEvent).filter((e): e is HcpAuditEvent => e !== undefined)
  return { events: read, nextCursor: isString(nextCursor) && nextCursor !== '' ? nextCursor : undefined }
}

/**
 * Read the audit log for one client, page by page. Each page asks for no more than the maximum still allows, so the
 * read never holds more than {@link HCP_AUDIT_MAX_EVENTS} events. It stops when `nextCursor` is absent, when a page
 * comes back empty or repeats the cursor it was sent (so a VTA that keeps answering a cursor cannot hold it), or at
 * the maximum, where `cut` is true if the VTA still offered a `nextCursor`.
 */
export async function readHcpAudit(port: HcpVtaPort, query: HcpAuditQuery): Promise<HcpAuditRead> {
  const pageLimit = query.limit ?? HCP_AUDIT_PAGE_LIMIT
  const events: HcpAuditEvent[] = []
  let cursor = query.cursor
  for (;;) {
    const limit = Math.min(pageLimit, HCP_AUDIT_MAX_EVENTS - events.length)
    const payload: Record<string, unknown> = { client: query.client, limit }
    if (cursor !== undefined) payload.cursor = cursor
    const outcome = await callHcp<unknown>(port, HCP_AUDIT_READ, payload)
    if (!outcome.ok) return { events, cut: false, failure: outcome }
    const page = readPage(outcome.value)
    if (!page) return { events, cut: false, failure: { ok: false, refused: HCP_AUDIT_MALFORMED } }
    const room = HCP_AUDIT_MAX_EVENTS - events.length
    events.push(...page.events.slice(0, room))
    // A VTA that ignores `limit` and sends more than the room left is cut here too.
    const overflow = page.events.length > room
    if (overflow || events.length >= HCP_AUDIT_MAX_EVENTS) {
      return { events, cut: overflow || page.nextCursor !== undefined }
    }
    if (page.nextCursor === undefined || page.events.length === 0 || page.nextCursor === cursor) {
      return { events, cut: false }
    }
    cursor = page.nextCursor
  }
}
