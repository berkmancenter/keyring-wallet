/**
 * Mounted with the main tabs (bifold's app-global listener slot), where the
 * agent exists: runs {@link watchLinkForPush} and {@link watchPushPermission}
 * for this agent. It renders nothing, and does nothing in a build that names no
 * push gateway.
 */
import { useStore, vtaAgent } from '@bifold/core'
import { useAgent } from '@bifold/react-hooks'
import AsyncStorage from '@react-native-async-storage/async-storage'
import React, { useEffect, useRef } from 'react'
import { AppState } from 'react-native'
import { Config } from 'react-native-config'

import BCLogger from '@/utils/logger'

import { watchLinkForPush } from './pushAfterLink'
import { appPushWakeDeps, notificationsAllowedNow } from './pushDefaults'
import { watchPushPermission } from './pushPermissionWatch'
import { enablePushWake } from './pushWake'

/** Whether the wake channel was cleared because notifications were blocked in the phone's settings. */
const CLEARED_FOR_DENIAL_KEY = 'keyring.push.clearedForDenial'
const clearedForDenial = {
  get: async () => (await AsyncStorage.getItem(CLEARED_FOR_DENIAL_KEY)) === 'true',
  set: async (cleared: boolean) =>
    cleared ? AsyncStorage.setItem(CLEARED_FOR_DENIAL_KEY, 'true') : AsyncStorage.removeItem(CLEARED_FOR_DENIAL_KEY),
}

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

  useEffect(() => {
    if (!agent || !Config.PUSH_GATEWAY_URL?.trim()) return
    return watchPushPermission(
      {
        optedIn: () => optedIn.current,
        linked: () => Boolean(vtaAgent.agentAddress()),
        permission: notificationsAllowedNow,
        clearedForDenial,
        clearWake: () => vtaAgent.clearThisDeviceWake(agent),
        enableWake: () => enablePushWake(appPushWakeDeps(agent)),
        log: (message, data) => BCLogger.info(message, data),
      },
      AppState
    )
  }, [agent])

  return null
}

export default PushLinkListener
