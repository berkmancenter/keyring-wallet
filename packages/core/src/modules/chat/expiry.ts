/**
 * Disappearing messages, deleted when due (rich-messaging-plan.md §4.6). Each timed message carries its `expiresAt`:
 * set at send for this phone's own messages, and at first display for received ones (shown.ts). The sweep deletes
 * every message whose time has come, with its reactions and media file (history.ts), and remembers the ids so a reply
 * can say its original expired (expired.ts). It deletes for good.
 *
 * The rule for a received message, exactly:
 * 1. Its clock starts when it is first shown (chatEventsShown).
 * 2. Backstop: if it was never reported shown but the chat marked it seen (seen.ts, when the chat was open with it
 *    unread), the sweep starts its clock at that seen time. This covers a lost display report. A message can be
 *    marked seen before its row is on screen, so it may disappear earlier than `expiresIn` after it was first on
 *    screen, never later. It is not the first-display rule; it is the fallback for when that report never arrived.
 * 3. A message neither shown nor seen is never deleted by its timer, however old.
 *
 * @module chat/expiry
 */

import type { Agent } from '@credo-ts/core'
import { useEffect, useRef } from 'react'
import { AppState } from 'react-native'

import { getChatEventRepository } from './ChatModule'
import { recordExpired } from './expired'
import { deleteChatMessages } from './history'
import type { ChatEventRecord } from './records/ChatEventRecord'
import { seenAt } from './seen'
import { effectiveExpiresInMs } from '../../utils/e2eClocks'

/** How often the sweep runs while the app is in the foreground, so an open chat loses its messages on time. */
export const EXPIRY_SWEEP_INTERVAL_MS = 60_000

/**
 * Delete every timed message that is due, in every chat; first start the clock of any received message the chat
 * marked seen but never reported shown (rule 2). Returns how many messages were deleted.
 */
export async function sweepExpired(agent: Agent, now = new Date()): Promise<number> {
  const repository = getChatEventRepository(agent)
  const events = await repository.getAll(agent.context)

  for (const record of events) {
    if (record.role !== 'received' || record.eventType !== 'message' || !record.expiresIn || record.expiresAt) continue
    const seen = seenAt(record)
    if (seen === undefined) continue
    record.expiresAt = new Date(seen + effectiveExpiresInMs(record.expiresIn))
    // The Keep messages sweep (retention.ts) runs at the same moments and may have deleted this record since it was
    // listed: that is what both sweeps want, so it is not a failure, and the rest of this sweep goes on.
    // Detected by the error's name, true of @credo-ts/core 0.7.1 (RecordNotFoundError, error/RecordNotFoundError): a
    // credo upgrade that renames or wraps it would make this sweep stop for a minute again, so re-check it on a bump.
    await repository.update(agent.context, record).catch((error: unknown) => {
      if ((error as Error | undefined)?.name !== 'RecordNotFoundError') throw error
    })
  }

  const due = new Map<string, ChatEventRecord[]>()
  for (const record of events) {
    if (record.eventType !== 'message' || !record.expiresAt || record.expiresAt.getTime() > now.getTime()) continue
    due.set(record.connectionId, [...(due.get(record.connectionId) ?? []), record])
  }

  let deleted = 0
  for (const [connectionId, records] of due) {
    await deleteChatMessages(agent, connectionId, { events: records })
    await recordExpired(
      connectionId,
      records.map((r) => r.eventId)
    )
    deleted += records.length
  }
  return deleted
}

/**
 * Run the expiry sweep once unlocked, on each return to the foreground, and every EXPIRY_SWEEP_INTERVAL_MS while in
 * the foreground; never two at once. Mounted once, where an unlocked agent exists (TabStack).
 */
export function useChatExpirySweep(agent: Agent | undefined, intervalMs = EXPIRY_SWEEP_INTERVAL_MS): void {
  const running = useRef(false)
  useEffect(() => {
    if (!agent) return
    const sweep = () => {
      if (running.current) return
      running.current = true
      sweepExpired(agent)
        .then((n) => {
          if (n > 0) agent.config.logger.info(`[chat] disappearing messages: deleted ${n} expired messages`)
        })
        .catch((error: unknown) => agent.config.logger.warn(`[chat] expiry sweep failed: ${String(error)}`))
        .finally(() => {
          running.current = false
        })
    }
    sweep()
    let timer: ReturnType<typeof setInterval> | undefined = setInterval(sweep, intervalMs)
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        sweep()
        if (!timer) timer = setInterval(sweep, intervalMs)
      } else if (timer) {
        clearInterval(timer)
        timer = undefined
      }
    })
    return () => {
      subscription.remove()
      if (timer) clearInterval(timer)
    }
  }, [agent, intervalMs])
}
