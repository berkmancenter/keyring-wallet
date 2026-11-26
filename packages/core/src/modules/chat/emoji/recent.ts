import { PersistentStorage } from '../../../services/storage'
import { normalizeEmoji } from './validate'

/** Where the picker's recent row is kept, on this device only. */
export const RECENT_EMOJI_KEY = 'chat.emoji.recent'
export const MAX_RECENT = 24

/** Put `emoji` first, drop an earlier copy, and keep at most `max`. */
export function addRecent(list: readonly string[], emoji: string, max = MAX_RECENT): string[] {
  return [emoji, ...list.filter((e) => e !== emoji)].slice(0, max)
}

/** The stored recent emoji, keeping only valid, distinct entries, in their fully-qualified form. */
export async function loadRecent(): Promise<string[]> {
  const stored = await PersistentStorage.fetchValueForKey<unknown>(RECENT_EMOJI_KEY)
  if (!Array.isArray(stored)) return []
  const seen = new Set<string>()
  const result: string[] = []
  for (const item of stored) {
    const emoji = normalizeEmoji(item)
    if (emoji && !seen.has(emoji)) {
      seen.add(emoji)
      result.push(emoji)
    }
  }
  return result.slice(0, MAX_RECENT)
}

export async function saveRecent(list: readonly string[]): Promise<void> {
  await PersistentStorage.storeValueForKey(RECENT_EMOJI_KEY, list.slice(0, MAX_RECENT))
}
