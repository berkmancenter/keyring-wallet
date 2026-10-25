/**
 * At launch, for a person who already has notifications turned on: register
 * with the platform push service again (pushPlatform.ts, `resumePlatformPush`).
 * It renders nothing. A build that names no push gateway, and a person who
 * never turned notifications on, make no call here.
 */
import { useStore } from '@bifold/core'
import messaging from '@react-native-firebase/messaging'
import React, { useEffect } from 'react'
import { Platform } from 'react-native'
import { Config } from 'react-native-config'

import BCLogger from '@/utils/logger'

import { resumePlatformPush } from './pushPlatform'

const PushStartup: React.FC = () => {
  const [store] = useStore()
  const loaded = store.stateLoaded
  const optedIn = store.preferences.usePushNotifications

  useEffect(() => {
    // The switch's state is read from storage; before it is loaded nobody is
    // known to have opted in.
    if (!loaded || !optedIn) return
    resumePlatformPush({ gatewayUrl: Config.PUSH_GATEWAY_URL, optedIn, os: Platform.OS }, messaging()).catch((e) =>
      BCLogger.info('push platform: resume failed', { error: e instanceof Error ? e.message : String(e) })
    )
  }, [loaded, optedIn])

  return null
}

export default PushStartup
