/**
 * Mounted with the main tabs (bifold's app-global listener slot), where the
 * agent exists: runs {@link watchLinkForPush} for this agent. It renders
 * nothing, and does nothing in a build that names no push gateway.
 */
import { useStore, vtaAgent } from '@bifold/core'
import { useAgent } from '@bifold/react-hooks'
import React, { useEffect, useRef } from 'react'
import { Config } from 'react-native-config'

import BCLogger from '@/utils/logger'

import { watchLinkForPush } from './pushAfterLink'
import { appPushWakeDeps } from './pushDefaults'
import { enablePushWake } from './pushWake'

const PushLinkListener: React.FC = () => {
  const { agent } = useAgent()
  const [store] = useStore()
  // Read when a link is made, not when this mounts: the person may turn
  // notifications on in between.
  const optedIn = useRef(store.preferences.usePushNotifications)
  optedIn.current = store.preferences.usePushNotifications

  useEffect(() => {
    if (!agent || !Config.PUSH_GATEWAY_URL?.trim()) return
    return watchLinkForPush({
      source: vtaAgent,
      since: Date.now(),
      optedIn: () => optedIn.current,
      enableWake: () => enablePushWake(appPushWakeDeps(agent)),
      log: (message, data) => BCLogger.info(message, data),
    })
  }, [agent])

  return null
}

export default PushLinkListener
