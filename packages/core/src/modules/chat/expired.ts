/**
 * Which messages of a chat disappeared on their timer (rich-messaging-plan.md §4.6). A reply whose original
 * disappeared shows "Original message expired"; one whose original was never on this phone, or was deleted by hand,
 * shows it as unavailable. The record itself is gone, so the expiry sweep leaves the eventId here.
 *
 * Bounded: the newest MAX_EXPIRED_KEPT ids per chat. An older expired original reads as unavailable, which is
 * still true.
 *
 * @module chat/expired
 */

import type { Agent } from '@credo-ts/core'

import { PersistentStorage } from '../../services/storage'

export const MAX_EXPIRED_KEPT = 1000

const keyOf = (connectionId: string) => `chat/expired/${connectionId}`

/** The eventIds of this chat's messages that disappeared on their timer. */
export async function expiredIds(_agent: Agent, connectionId: string): Promise<Set<string>> {
  return new Set((await PersistentStorage.fetchValueForKey<string[]>(keyOf(connectionId))) ?? [])
}

/** Remember that these messages disappeared on their timer. Called by the expiry sweep. */
export async function recordExpired(connectionId: string, eventIds: string[]): Promise<void> {
  if (eventIds.length === 0) return
  const kept = (await PersistentStorage.fetchValueForKey<string[]>(keyOf(connectionId))) ?? []
  const merged = [...kept.filter((id) => !eventIds.includes(id)), ...eventIds].slice(-MAX_EXPIRED_KEPT)
  await PersistentStorage.storeValueForKey(keyOf(connectionId), merged)
}

/** Forget a chat's expired ids, when the chat itself is cleared or its contact removed. */
export async function forgetExpired(connectionId: string): Promise<void> {
  await PersistentStorage.removeValueForKey(keyOf(connectionId))
}
