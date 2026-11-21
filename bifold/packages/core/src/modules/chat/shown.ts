/**
 * The chat screen reports here which received chat messages have just been
 * shown (rich-messaging-plan.md §4.6, D4: a disappearing message's clock
 * starts on the recipient's phone at first display).
 *
 * A failure rejects, never resolves: the screen un-marks the ids and reports
 * them again on the next scroll. A swallowed failure would leave a timed
 * message whose clock never starts, so it would outlive the sender's window
 * with neither person told. The expiry sweep also starts the clock of a
 * message the chat has marked seen but never reported shown, as a backstop
 * (expiry.ts), but this is the rule.
 *
 * @module chat/shown
 */

import type { Agent } from '@credo-ts/core'

import { getChatEventRepository } from './ChatModule'
import { effectiveExpiresInMs } from '../../utils/e2eClocks'

/**
 * Received chat messages that became visible, each reported once per screen. Each timed message among them starts
 * its clock now, unless it already has: a repeat report changes nothing.
 */
export async function chatEventsShown(agent: Agent, connectionId: string, eventIds: string[]): Promise<void> {
  const repository = getChatEventRepository(agent)
  const now = Date.now()
  for (const eventId of eventIds) {
    const record = await repository.findEvent(agent.context, connectionId, 'received', eventId)
    if (!record || record.eventType !== 'message' || !record.expiresIn || record.expiresAt) continue
    record.expiresAt = new Date(now + effectiveExpiresInMs(record.expiresIn))
    await repository.update(agent.context, record)
  }
}
