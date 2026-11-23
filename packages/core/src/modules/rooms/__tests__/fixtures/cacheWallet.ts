/**
 * The agent's generic records as rooms/messageCache uses them, in memory: by id, and by every tag a query names.
 * Shared by every message-cache suite, so they cannot disagree about how the cache's hashed tags are found.
 *
 * It answers copies, as Askar does: a record changed in hand is written only by an update that succeeds, so a failed
 * write leaves the stored record as it was.
 */
import { MSG_CACHE_JOURNAL_ID } from '../../messageCache'

type Stored = { id: string; content: Record<string, unknown>; tags: Record<string, string> }

export function cacheWallet() {
  const records = new Map<string, Stored>()
  const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
  const genericRecords = {
    findById: jest.fn(async (id: string) => (records.has(id) ? copy(records.get(id)!) : null)),
    findAllByQuery: jest.fn(async (query: Record<string, unknown>) =>
      [...records.values()].filter((r) => Object.entries(query).every(([k, v]) => r.tags[k] === v)).map(copy)
    ),
    save: jest.fn(async (o: { id: string; content: Record<string, unknown>; tags?: Record<string, string> }) => {
      records.set(o.id, { id: o.id, content: copy(o.content), tags: o.tags ?? {} })
    }),
    update: jest.fn(async (r: { id?: string; content: Record<string, unknown> }) => {
      const at = records.get(r.id ?? '')
      if (at) at.content = copy(r.content)
    }),
  }
  /** Every kept copy's content, emptied ones included (never the journal). */
  const copies = () => [...records.values()].filter((r) => r.id !== MSG_CACHE_JOURNAL_ID).map((r) => r.content)
  /** The journal's pending entries. */
  const journal = () => (records.get(MSG_CACHE_JOURNAL_ID)?.content.pending as unknown[] | undefined) ?? []
  return { genericRecords, records, copies, journal }
}
