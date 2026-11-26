// modules/openid/hooks/notificationFirstSeen.ts

/**
 * When each notification was first seen, for the whole app. Every screen listing it gives it the same time, and
 * a rebuild (any registry change) keeps it: two kinds of notification in one list sort by when they arrived,
 * not by when the list was last built. Never forgotten: the same notification shown again later (an offer
 * declined and offered again, a credential that expires again) keeps its first time and sorts as older, which
 * is accepted (it was seen before).
 */
const firstSeen: Record<string, string> = {}

/** When `key` was first seen: now, the first time it is asked. */
export function firstSeenAt(key: string): Date {
  if (!firstSeen[key]) firstSeen[key] = new Date().toISOString()
  return new Date(firstSeen[key])
}

/** Tests only: forget the first-seen times, so one test's never depends on another's. */
export const resetNotificationFirstSeen = (): void => {
  for (const key of Object.keys(firstSeen)) delete firstSeen[key]
}
