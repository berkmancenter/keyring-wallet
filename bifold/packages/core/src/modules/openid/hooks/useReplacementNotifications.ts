// modules/openid/ui/useReplacementNotifications.ts
import { useCallback, useMemo, useSyncExternalStore } from 'react'

import { credentialRegistry, RegistryStore } from '../refresh/registry'
import { OpenIDNotificationData } from '../features/notifications/types'
import { OpenIDCustomNotificationType } from '../refresh/types'
import { useOpenIdReplacementNavigation } from './useOpenIdReplacementNavigation'

/**
 * A hook that returns a list of CustomNotifications for credentials that have replacements available
 */

// When each (oldId -> replId) was first seen, for the whole app: every screen
// listing a replacement gives it the same time, and a rebuild keeps it. Never
// forgotten: the same replacement offered again after a decline keeps its first
// time and sorts as older, which is accepted (the same offer, seen before).
const firstSeen: Record<string, string> = {}

/** Tests only: forget the first-seen times, so one test's never depends on another's. */
export const resetReplacementFirstSeen = (): void => {
  for (const key of Object.keys(firstSeen)) delete firstSeen[key]
}

export const useReplacementNotifications = (): OpenIDNotificationData[] => {
  const openReplacementOffer = useOpenIdReplacementNavigation()

  const build = useCallback(
    (s: Pick<RegistryStore, 'expired' | 'replacements'>): OpenIDNotificationData[] => {
      const out: OpenIDNotificationData[] = []

      for (const oldId of s.expired) {
        const repl = s.replacements[oldId]
        if (!repl) continue

        const key = `${oldId}::${repl.id}`
        if (!firstSeen[key]) firstSeen[key] = new Date().toISOString()

        out.push({
          type: OpenIDCustomNotificationType.CredentialReplacementAvailable,
          createdAt: new Date(firstSeen[key]),
          metadata: { oldId },
          onPressAction: () => {
            openReplacementOffer(repl.id)
          },
        })
      }

      // Newest first for consistent UI
      out.sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0))
      return out
    },
    [openReplacementOffer]
  )

  // The registry's state is the snapshot: the first frame already lists the replacements.
  const state = useSyncExternalStore(credentialRegistry.subscribe, credentialRegistry.getState)
  return useMemo(() => build(state), [build, state])
}
