/**
 * Disappearing messages: a chat's timer (rich-messaging-plan.md §4.6). Either person sets it with a `timer` event
 * carrying `expiresIn` (seconds, 0 = off) and a `version`. The highest version wins, ties broken by eventId, so two
 * phones that changed it at once agree on the outcome. A timer applies to messages sent after it; each message
 * carries the `expiresIn` it was sent with.
 *
 * @module chat/timer
 */

import type { Agent } from '@credo-ts/core'

import { getChatEventRepository } from './ChatModule'
import type { ChatEventRecord, ChatEventRole } from './records/ChatEventRecord'

/** The choices the setting offers, in seconds: off, 1 hour, 1 day, 1 week, 4 weeks. */
export const TIMER_CHOICES: readonly number[] = [0, 3600, 86400, 604800, 2419200]

export interface ChatTimer {
  /** Seconds; 0 means off. */
  expiresIn: number
  version: number
  /** The timer event that set it. */
  eventId: string
  /** Who set it: this phone ('sent') or the other ('received'). */
  setBy: ChatEventRole
}

/**
 * The chat's timer from its events, or null if it was never set. Pure, so the screens can derive it in render from
 * the events they already hold; currentTimer uses the same rule.
 */
export function timerOf(events: readonly ChatEventRecord[]): ChatTimer | null {
  let best: ChatEventRecord | undefined
  for (const e of events) {
    if (e.eventType !== 'timer' || !e.timer) continue
    if (
      !best ||
      e.timer.version > best.timer!.version ||
      (e.timer.version === best.timer!.version && e.eventId > best.eventId)
    ) {
      best = e
    }
  }
  return best
    ? { expiresIn: best.timer!.expiresIn, version: best.timer!.version, eventId: best.eventId, setBy: best.role }
    : null
}

/** The chat's timer as stored on this phone. */
export async function currentTimer(agent: Agent, connectionId: string): Promise<ChatTimer | null> {
  return timerOf(await getChatEventRepository(agent).findByConnection(agent.context, connectionId))
}

/** The version a new timer change carries: one past the highest either phone has used. */
export function nextTimerVersion(events: readonly ChatEventRecord[]): number {
  return events.reduce((max, e) => (e.eventType === 'timer' && e.timer ? Math.max(max, e.timer.version) : max), 0) + 1
}
