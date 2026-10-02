import { useEffect, useMemo, useState } from 'react'
import { Linking } from 'react-native'

import { useActivity } from '../contexts/activity'
import { DispatchAction } from '../contexts/reducers/store'
import { useStore } from '../contexts/store'

/**
 * Links the app opens itself, from outside React — a push notification tapped
 * before or after launch. They wait, like any deep link, until the wallet is
 * unlocked; a link opened before the hook mounts is kept for it.
 */
const appLinkListeners = new Set<(url: string) => void>()
let pendingAppLink: string | undefined

export function openAppLink(url: string): void {
  if (appLinkListeners.size === 0) {
    pendingAppLink = url
    return
  }
  appLinkListeners.forEach((listener) => listener(url))
}

export const useDeepLinks = () => {
  const [store, dispatch] = useStore()
  const { appStateStatus } = useActivity()
  const [stashedDeepLink, setStashedDeepLink] = useState('')
  const ready = useMemo(
    () => store.authentication.didAuthenticate && ['active', 'inactive'].includes(appStateStatus),
    [store.authentication.didAuthenticate, appStateStatus]
  )

  // deeplink cold start
  useEffect(() => {
    const getUrlAsync = async () => {
      const initialUrl = await Linking.getInitialURL()
      if (initialUrl) {
        setStashedDeepLink(initialUrl)
      }
    }
    getUrlAsync()
  }, [])

  // a link the app opened itself (openAppLink)
  useEffect(() => {
    const listener = (url: string) => setStashedDeepLink(url)
    appLinkListeners.add(listener)
    if (pendingAppLink) {
      setStashedDeepLink(pendingAppLink)
      pendingAppLink = undefined
    }
    return () => {
      appLinkListeners.delete(listener)
    }
  }, [])

  // deeplink while already open
  useEffect(() => {
    const listener = Linking.addListener('url', ({ url }) => {
      if (url) {
        setStashedDeepLink(url)
      }
    })

    return listener.remove
  })

  // activate stashed deeplink when ready
  useEffect(() => {
    if (stashedDeepLink && ready) {
      dispatch({
        type: DispatchAction.ACTIVE_DEEP_LINK,
        payload: [stashedDeepLink],
      })
      setStashedDeepLink('')
    }
  }, [ready, stashedDeepLink, dispatch])
}
