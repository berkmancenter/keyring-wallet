/**
 * The chat screen reports here which received chat messages have just been
 * shown (rich-messaging-plan.md §4.6, D4: a disappearing message's clock
 * starts on the recipient's phone at first display).
 *
 * It does nothing yet. The disappearing-messages work fills it in, so the
 * screen never changes for that.
 *
 * @module chat/shown
 */

import type { Agent } from '@credo-ts/core'

/** Received chat messages that became visible, each reported once per screen. */
export async function chatEventsShown(_agent: Agent, _connectionId: string, _eventIds: string[]): Promise<void> {
  return
}
