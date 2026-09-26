/**
 * One generic record per (record type, kind, key) — the rule the VTI stores
 * mean by "keyed", made true.
 *
 * The stores saved with find-then-save: look the key up, save a new record when
 * there is none. Several writers of the same key at once each found none and
 * each saved, so one membership became three rows. That happens on a join
 * through vetting, where the persona inbox, the vetting screen and the join's
 * own inbox all store the same arriving membership concurrently (IN-26,
 * 2026-09-26). Writes to one key now queue behind each other, a write that
 * finds several records keeps the newest and removes the rest, and reads
 * collapse duplicates the same way, so a phone that already has them heals
 * the next time it looks.
 *
 * @module trust-tasks/module/keyedRecords
 */
import type { Agent, GenericRecord } from '@credo-ts/core'

const queues = new Map<string, Promise<unknown>>()

/** Run `work` after every earlier piece of work for the same `lockKey` has settled. */
export function withKeyLock<T>(lockKey: string, work: () => Promise<T>): Promise<T> {
  const previous = queues.get(lockKey) ?? Promise.resolve()
  const next = previous.then(work, work)
  const tail = next.then(
    () => undefined,
    () => undefined
  )
  queues.set(lockKey, tail)
  void tail.then(() => {
    if (queues.get(lockKey) === tail) queues.delete(lockKey)
  })
  return next
}

type Tagged = Pick<GenericRecord, 'content' | 'createdAt' | 'updatedAt'> & {
  getTags?: () => Record<string, unknown>
  tags?: Record<string, unknown>
}

function keyOf(record: Tagged): string | undefined {
  const tags = record.getTags ? record.getTags() : record.tags
  const key = tags?.key
  return typeof key === 'string' ? key : undefined
}

function stamp(record: Tagged): number {
  const at = record.updatedAt ?? record.createdAt
  const time = at instanceof Date ? at.getTime() : typeof at === 'string' ? Date.parse(at) : NaN
  return Number.isNaN(time) ? 0 : time
}

/** The newest record first; ties keep their original order. */
function newestFirst<T extends Tagged>(records: T[]): T[] {
  return records
    .map((record, i) => ({ record, i }))
    .sort((a, b) => stamp(b.record) - stamp(a.record) || a.i - b.i)
    .map(({ record }) => record)
}

/** Save `content` as the one record for (recordType, kind, key). */
export function putKeyed(
  agent: Agent,
  recordType: string,
  kind: string,
  key: string,
  content: Record<string, unknown>
): Promise<void> {
  return withKeyLock(`${recordType}|${kind}|${key}`, async () => {
    const existing = newestFirst(await agent.genericRecords.findAllByQuery({ recordType, kind, key }))
    const [keep, ...extras] = existing
    for (const extra of extras) await agent.genericRecords.delete(extra)
    if (keep) {
      keep.content = content
      await agent.genericRecords.update(keep)
      return
    }
    await agent.genericRecords.save({ content, tags: { recordType, kind, key } })
  })
}

/** The one record's content for (recordType, kind, key): the newest, if several slipped in. */
export async function getKeyed<T>(agent: Agent, recordType: string, kind: string, key: string): Promise<T | undefined> {
  const records = newestFirst(await agent.genericRecords.findAllByQuery({ recordType, kind, key }))
  return records[0]?.content as T | undefined
}

/**
 * Every record of `kind`, one per key (the newest). Duplicates found on the way
 * are removed, each under its key's lock so a write in progress is not undone.
 */
export async function listKeyed<T>(agent: Agent, recordType: string, kind: string): Promise<T[]> {
  const records = await agent.genericRecords.findAllByQuery({ recordType, kind })
  // The newest record of each key wins; the list keeps the store's order.
  const winners = new Map<string, GenericRecord>()
  for (const record of newestFirst(records)) {
    const key = keyOf(record)
    if (key !== undefined && !winners.has(key)) winners.set(key, record)
  }
  const kept: T[] = []
  const extras: { key: string; record: GenericRecord }[] = []
  for (const record of records) {
    const key = keyOf(record)
    if (key === undefined || winners.get(key) === record) kept.push(record.content as unknown as T)
    else extras.push({ key, record })
  }
  for (const { key, record } of extras) {
    await withKeyLock(`${recordType}|${kind}|${key}`, () => agent.genericRecords.delete(record)).catch(() => undefined)
  }
  return kept
}
