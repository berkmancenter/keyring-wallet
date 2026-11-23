/**
 * "Keep messages" (rich-messaging-plan.md §4.6): a global limit on how long chat messages stay on this phone, as in
 * Signal. Forever is the default, so nothing is deleted unless the person chooses a shorter period. A sweep deletes
 * older messages for good, each with its reactions and media file (history.ts).
 *
 * @module chat/retention
 */

import type { Agent } from '@credo-ts/core'
import { DidCommBasicMessageRepository } from '@credo-ts/didcomm'
import { useEffect, useRef } from 'react'
import { AppState } from 'react-native'

import { getChatEventRepository } from './ChatModule'
import { type ChatEventKey, deleteChatMessages } from './history'

export type KeepMessages = 'forever' | '1y' | '6m' | '30d'

/** Nothing is deleted until the person chooses a shorter period. */
export const KEEP_MESSAGES_DEFAULT: KeepMessages = 'forever'

/** The choices, in the order Settings shows them. */
export const KEEP_MESSAGES_OPTIONS: readonly KeepMessages[] = ['forever', '1y', '6m', '30d']

const DAY_MS = 24 * 60 * 60 * 1000
const KEEP_DAYS: Record<Exclude<KeepMessages, 'forever'>, number> = { '1y': 365, '6m': 183, '30d': 30 }

/** Messages made before this moment are deleted; none for Forever (or an unknown stored value). */
export function keepCutoff(keep: KeepMessages | undefined, now: Date): Date | null {
  if (!keep || keep === 'forever' || !(keep in KEEP_DAYS)) return null
  return new Date(now.getTime() - KEEP_DAYS[keep as keyof typeof KEEP_DAYS] * DAY_MS)
}

/**
 * Delete every chat message made on this phone before the cutoff, in every chat. Age is the record's local
 * creation time, never the sender's clock. Timer and other non-message events stay: they are a chat's state, not
 * its history. Returns how many messages were deleted.
 */
export async function sweepOldMessages(
  agent: Agent,
  keep: KeepMessages | undefined,
  now = new Date()
): Promise<number> {
  const cutoff = keepCutoff(keep, now)
  if (!cutoff) return 0

  const byConnection = new Map<string, { events: ChatEventKey[]; basicMessageIds: string[] }>()
  const entry = (connectionId: string) => {
    let e = byConnection.get(connectionId)
    if (!e) byConnection.set(connectionId, (e = { events: [], basicMessageIds: [] }))
    return e
  }

  const basicMessages = agent.dependencyManager.resolve(DidCommBasicMessageRepository)
  for (const record of await basicMessages.getAll(agent.context)) {
    if (record.createdAt < cutoff) entry(record.connectionId).basicMessageIds.push(record.id)
  }
  for (const record of await getChatEventRepository(agent).getAll(agent.context)) {
    if (record.eventType === 'message' && record.createdAt < cutoff)
      entry(record.connectionId).events.push({ role: record.role, eventId: record.eventId })
  }

  let deleted = 0
  for (const [connectionId, ids] of byConnection) {
    await deleteChatMessages(agent, connectionId, ids)
    deleted += ids.events.length + ids.basicMessageIds.length
  }
  return deleted
}

/**
 * Run the Keep messages sweep when the app is unlocked and again each time it comes to the foreground, never two at
 * once. Mounted once, where an unlocked agent exists (TabStack).
 */
export function useChatRetentionSweep(agent: Agent | undefined, keep: KeepMessages | undefined): void {
  const running = useRef(false)
  useEffect(() => {
    if (!agent) return
    const sweep = () => {
      if (running.current || !keepCutoff(keep, new Date())) return
      running.current = true
      sweepOldMessages(agent, keep)
        .then((n) => {
          if (n > 0) agent.config.logger.info(`[chat] Keep messages (${keep}): deleted ${n} older messages`)
        })
        .catch((error: unknown) => agent.config.logger.warn(`[chat] Keep messages sweep failed: ${String(error)}`))
        .finally(() => {
          running.current = false
        })
    }
    sweep()
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') sweep()
    })
    return () => subscription.remove()
  }, [agent, keep])
}
