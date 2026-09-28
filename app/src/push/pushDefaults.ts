/**
 * The app's own wiring for {@link enablePushWake}: this phone's token from
 * Firebase messaging, the linked agent from `vtaAgent`, the gateway from the
 * build's `PUSH_GATEWAY_URL`.
 *
 * Nothing here asks for notification permission: the prompt and its words
 * belong to step 1.4 (plan §4.1). Without permission already granted there is
 * no token, and the phone is simply not made wakeable.
 */
import { vtaAgent } from '@bifold/core'
import type { Agent } from '@credo-ts/core'
import messaging from '@react-native-firebase/messaging'
import { Platform } from 'react-native'
import { Config } from 'react-native-config'
import { getBundleId } from 'react-native-device-info'

import type { PushRegistration } from './pushGateway'
import type { PushWakeDeps } from './pushWake'

/** Whether an APNs token is for the sandbox or production service: a development-signed build is sandbox. */
function apnsEnvironment(): 'sandbox' | 'production' {
  return Config.PUSH_APNS_ENVIRONMENT === 'production' ? 'production' : 'sandbox'
}

/** This phone's platform push token, or undefined without permission or a token. */
export async function platformPushRegistration(): Promise<PushRegistration | undefined> {
  const m = messaging()
  const status = await m.hasPermission()
  if (status !== messaging.AuthorizationStatus.AUTHORIZED && status !== messaging.AuthorizationStatus.PROVISIONAL) {
    return undefined
  }
  if (Platform.OS === 'ios') {
    // The gateway sends to APNs directly with Keyring's own key, so it needs
    // the APNs device token, not Firebase's.
    await m.registerDeviceForRemoteMessages()
    const token = await m.getAPNSToken()
    return token ? { platform: 'apns', token, topic: getBundleId(), environment: apnsEnvironment() } : undefined
  }
  const token = await m.getToken()
  return token ? { platform: 'fcm', token } : undefined
}

/** {@link PushWakeDeps} for the running app. */
export function appPushWakeDeps(agent: Agent): PushWakeDeps {
  return {
    gatewayUrl: Config.PUSH_GATEWAY_URL,
    agentDid: () => vtaAgent.agentAddress(),
    pushRegistration: platformPushRegistration,
    setWake: (wake, opts) => vtaAgent.setThisDeviceWake(agent, wake, opts),
  }
}
