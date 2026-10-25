// modules/openid/hooks/useExpiredNotifications.ts
import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { credentialRegistry, RegistryStore } from '../refresh/registry'
import { OpenIDCustomNotificationType } from '../refresh/types'
import { TOKENS, useServices } from '../../../container-api'
import { useDeclineReplacement } from './useDeclineReplacement'
import { OpenIDNotificationData } from '../features/notifications/types'

export const useExpiredNotifications = (): OpenIDNotificationData[] => {
  const [logger] = useServices([TOKENS.UTIL_LOGGER])
  const { declineByOldId } = useDeclineReplacement({ logger })

  const build = useCallback(
    (s: RegistryStore): OpenIDNotificationData[] =>
      s.expired
        .filter(
          (oldId) => s.checked.includes(oldId) && !s.replacements[oldId] && !s.notificationRemoved.includes(oldId)
        )
        .map((oldId) => {
          const notification: OpenIDNotificationData = {
            type: OpenIDCustomNotificationType.CredentialExpired,
            createdAt: new Date(),
            onPressAction: () => {},
            onCloseAction: () => {
              s.markNotificationRemoved(oldId)
              declineByOldId(oldId)
            },
            metadata: { oldId },
          }
          return notification
        }),
    [declineByOldId]
  )

  // The registry's state is the snapshot (the store replaces it on every change), so the
  // first frame already lists what it holds; the list is built from it, not copied.
  const state = useSyncExternalStore(credentialRegistry.subscribe, credentialRegistry.getState)
  return useMemo(() => build(state), [build, state])
}
