// modules/openid/ui/useReplacementNotifications.ts
import { useCallback, useMemo, useSyncExternalStore } from 'react'

import { credentialRegistry, RegistryStore } from '../refresh/registry'
import { OpenIDNotificationData } from '../features/notifications/types'
import { OpenIDCustomNotificationType } from '../refresh/types'
import { firstSeenAt } from './notificationFirstSeen'
import { useOpenIdReplacementNavigation } from './useOpenIdReplacementNavigation'

/**
 * A hook that returns a list of CustomNotifications for credentials that have replacements available
 */

export const useReplacementNotifications = (): OpenIDNotificationData[] => {
  const openReplacementOffer = useOpenIdReplacementNavigation()

  const build = useCallback(
    (s: Pick<RegistryStore, 'expired' | 'replacements'>): OpenIDNotificationData[] => {
      const out: OpenIDNotificationData[] = []

      for (const oldId of s.expired) {
        const repl = s.replacements[oldId]
        if (!repl) continue

        out.push({
          type: OpenIDCustomNotificationType.CredentialReplacementAvailable,
          createdAt: firstSeenAt(`replacement:${oldId}::${repl.id}`),
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
