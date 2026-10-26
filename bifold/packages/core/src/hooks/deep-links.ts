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

/**
 * Links already made active in this process. The hook below mounts again after
 * every unlock and asks for the link that opened the app, which stays the same
 * for the life of the process. On Android it is even the latest link the app
 * was opened with (MainActivity.onNewIntent calls setIntent). Without this,
 * every unlock handled that link again: a used invitation failed with "Unable
 * to handle deeplink", and a link that acts (a join, an enrolment) could act
 * twice. Only that mount-time lookup is checked against it. A link that
 * arrives (a tap, a notification) is always handled, even one handled before.
 */
const activatedLinks = new Set<string>()

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
      if (initialUrl && !activatedLinks.has(initialUrl)) {
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
      activatedLinks.add(stashedDeepLink)
      dispatch({
        type: DispatchAction.ACTIVE_DEEP_LINK,
        payload: [stashedDeepLink],
      })
      setStashedDeepLink('')
    }
  }, [ready, stashedDeepLink, dispatch])
}
