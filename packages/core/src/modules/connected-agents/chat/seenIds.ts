/**
 * The envelope ids a receiver has seen, and the last applied `issuedAt` of each state type (plan §7.9; the vectors'
 * `rules.seenIds` and `rules.state`, `connected-agents/vectors/control-messages.json`).
 *
 * Kept as keyed records (`trust-tasks/module/keyedRecords`), one per (receiver, id), so a restart does not forget
 * them: a replay after a restart is still refused. An id is claimed and recorded in one step, under a lock of its own,
 * so two deliveries of one document at once cannot both find it unseen.
 *
 * An id is kept only while its document could still be accepted: once its `issuedAt` is more than the 7-day window
 * behind the receiver's clock, the document is refused as `stale` on its own, so the record is dropped. A claim never
 * relies on that pruning having run: a record already past the window counts as unseen.
 *
 * @module connected-agents/chat/seenIds
 */
import type { Agent } from '@credo-ts/core'

import { deleteKeyed, getKeyed, listKeyed, putKeyed, withKeyLock } from '../../trust-tasks/module/keyedRecords'

/** How far behind the receiver's clock a document may be issued: 604 800 s, the vectors' `rules.freshness`. */
export const ENVELOPE_MAX_AGE_MS = 604_800 * 1000

/** How far ahead of the receiver's clock a document may be issued: 300 s, the vectors' `rules.freshness`. */
export const ENVELOPE_MAX_AHEAD_MS = 300 * 1000

/** Pruning runs at most this often from {@link SeenIdStore.claim}; {@link SeenIdStore.prune} runs it at once. */
const PRUNE_EVERY_MS = 60 * 60 * 1000

const RECORD_TYPE = 'keyring/agent-chat'
const SEEN_KIND = 'seen-id'
const APPLIED_KIND = 'last-applied'

interface SeenIdContent extends Record<string, unknown> {
  receiver: string
  id: string
  /** The document's own `issuedAt`, as an ISO instant: the window is measured from it. */
  issuedAt: string
}

interface AppliedContent extends Record<string, unknown> {
  receiver: string
  type: string
  issuedAt: string
}

/** One receiver's seen ids and applied state. `receiver` is that receiver's own chat identity. */
export interface SeenIdStore {
  /**
   * Record `id` as seen, issued at `issuedAt`, unless it is already recorded within the window: `true` when it was
   * recorded now (the caller may act on the document), `false` when it had been seen (a replay).
   */
  claim(receiver: string, id: string, issuedAt: string, now: Date): Promise<boolean>
  /** Whether `id` is recorded within the window, without recording it. */
  seen(receiver: string, id: string, now: Date): Promise<boolean>
  /** Drop every id whose document is past the window; returns how many were dropped. */
  prune(now: Date): Promise<number>
  /** The `issuedAt` of the last document of `type` applied by `receiver`, if any. */
  lastApplied(receiver: string, type: string): Promise<string | undefined>
  /** Record that a document of `type` issued at `issuedAt` was applied; an older one never replaces a newer. */
  markApplied(receiver: string, type: string, issuedAt: string): Promise<void>
}

const seenKey = (receiver: string, id: string) => `${receiver} ${id}`
const appliedKey = (receiver: string, type: string) => `${receiver} ${type}`

/** Whether a document issued at `issuedAt` is still inside the window at `now` (and so its id must be kept). */
export function insideWindow(issuedAt: string, now: Date): boolean {
  const at = Date.parse(issuedAt)
  return Number.isFinite(at) && at >= now.getTime() - ENVELOPE_MAX_AGE_MS
}

/** The seen ids in the app's storage, as keyed records. */
export class KeyedSeenIdStore implements SeenIdStore {
  private lastPruned = 0

  public constructor(private readonly agent: Agent) {}

  public async claim(receiver: string, id: string, issuedAt: string, now: Date): Promise<boolean> {
    const key = seenKey(receiver, id)
    // A lock of its own: `putKeyed` takes the key's record lock, so taking that one here would wait on itself.
    const claimed = await withKeyLock(`${RECORD_TYPE}|${SEEN_KIND}-claim|${key}`, async () => {
      const existing = await getKeyed<SeenIdContent>(this.agent, RECORD_TYPE, SEEN_KIND, key)
      if (existing && insideWindow(existing.issuedAt, now)) return false
      const content: SeenIdContent = { receiver, id, issuedAt }
      await putKeyed(this.agent, RECORD_TYPE, SEEN_KIND, key, content)
      return true
    })
    if (now.getTime() - this.lastPruned >= PRUNE_EVERY_MS) await this.prune(now).catch(() => 0)
    return claimed
  }

  public async seen(receiver: string, id: string, now: Date): Promise<boolean> {
    const existing = await getKeyed<SeenIdContent>(this.agent, RECORD_TYPE, SEEN_KIND, seenKey(receiver, id))
    return !!existing && insideWindow(existing.issuedAt, now)
  }

  public async prune(now: Date): Promise<number> {
    this.lastPruned = now.getTime()
    const all = await listKeyed<SeenIdContent>(this.agent, RECORD_TYPE, SEEN_KIND)
    let dropped = 0
    for (const record of all) {
      if (insideWindow(record.issuedAt, now)) continue
      await deleteKeyed(this.agent, RECORD_TYPE, SEEN_KIND, seenKey(record.receiver, record.id))
      dropped++
    }
    return dropped
  }

  public async lastApplied(receiver: string, type: string): Promise<string | undefined> {
    const record = await getKeyed<AppliedContent>(this.agent, RECORD_TYPE, APPLIED_KIND, appliedKey(receiver, type))
    return record?.issuedAt
  }

  public async markApplied(receiver: string, type: string, issuedAt: string): Promise<void> {
    const key = appliedKey(receiver, type)
    await withKeyLock(`${RECORD_TYPE}|${APPLIED_KIND}-mark|${key}`, async () => {
      const existing = await getKeyed<AppliedContent>(this.agent, RECORD_TYPE, APPLIED_KIND, key)
      if (existing && Date.parse(existing.issuedAt) >= Date.parse(issuedAt)) return
      const content: AppliedContent = { receiver, type, issuedAt }
      await putKeyed(this.agent, RECORD_TYPE, APPLIED_KIND, key, content)
    })
  }
}

/** The same rules in memory: for tests, and for a receiver with nothing to keep across restarts. */
export class MemorySeenIdStore implements SeenIdStore {
  public readonly ids = new Map<string, SeenIdContent>()
  public readonly applied = new Map<string, string>()

  public async claim(receiver: string, id: string, issuedAt: string, now: Date): Promise<boolean> {
    const existing = this.ids.get(seenKey(receiver, id))
    if (existing && insideWindow(existing.issuedAt, now)) return false
    this.ids.set(seenKey(receiver, id), { receiver, id, issuedAt })
    return true
  }

  public async seen(receiver: string, id: string, now: Date): Promise<boolean> {
    const existing = this.ids.get(seenKey(receiver, id))
    return !!existing && insideWindow(existing.issuedAt, now)
  }

  public async prune(now: Date): Promise<number> {
    let dropped = 0
    for (const [key, record] of this.ids) {
      if (insideWindow(record.issuedAt, now)) continue
      this.ids.delete(key)
      dropped++
    }
    return dropped
  }

  public async lastApplied(receiver: string, type: string): Promise<string | undefined> {
    return this.applied.get(appliedKey(receiver, type))
  }

  public async markApplied(receiver: string, type: string, issuedAt: string): Promise<void> {
    const key = appliedKey(receiver, type)
    const existing = this.applied.get(key)
    if (existing && Date.parse(existing) >= Date.parse(issuedAt)) return
    this.applied.set(key, issuedAt)
  }
}
