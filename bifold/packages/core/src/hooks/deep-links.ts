import { useEffect, useMemo, useRef, useState } from 'react'
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

/**
 * A link that reaches a running app while the wallet is locked. The hook below
 * lives in the main stack, which renders only when the wallet is unlocked, so
 * while it is locked nothing is listening and the system's `url` event would be
 * dropped: the app opens, the person unlocks, and lands where they were. That
 * is every link opened from outside while locked, and a tapped notification in
 * particular, since a backgrounded wallet locks. This listener is registered
 * once, for the life of the app, and keeps such a link for the hook's next
 * mount, like a link the app opens itself. With the hook mounted it does
 * nothing: the hook's own listener has the link.
 */
if (typeof Linking?.addEventListener === 'function') {
  Linking.addEventListener('url', ({ url }) => {
    if (url && appLinkListeners.size === 0) {
      pendingAppLink = url
    }
  })
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

  // A link still waiting when the hook unmounts (the wallet locked before it
  // could be activated) is kept for the next mount instead of being lost.
  const stashedRef = useRef('')
  stashedRef.current = stashedDeepLink
  useEffect(
    () => () => {
      if (stashedRef.current) {
        pendingAppLink = stashedRef.current
      }
    },
    []
  )

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
