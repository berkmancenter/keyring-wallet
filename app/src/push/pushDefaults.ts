/**
 * The app's own wiring for {@link enablePushWake}: this phone's token from
 * Firebase messaging, the linked agent from `vtaAgent`, the gateway from the
 * build's `PUSH_GATEWAY_URL`.
 *
 * Reading the token never asks for permission; asking is `setup` in
 * bifold's push framework ({@link appPushNotificationsConfig}), which a
 * build shows only when it names a gateway. Without permission there is no
 * token, and the phone is simply not made wakeable.
 */
import { vtaAgent } from '@bifold/core'
import type { Agent } from '@credo-ts/core'
import messaging from '@react-native-firebase/messaging'
import { Platform } from 'react-native'
import { Config } from 'react-native-config'
import { getBundleId } from 'react-native-device-info'
import { checkNotifications, requestNotifications, RESULTS, type PermissionStatus } from 'react-native-permissions'

import BCLogger from '@/utils/logger'

import { pushNotificationsConfig, type PermissionState, type PushNotificationsConfig } from './pushConfig'
import type { PushRegistration } from './pushGateway'
import { startPlatformPush, stopPlatformPush } from './pushPlatform'
import { enablePushWake, type PushWakeDeps } from './pushWake'

/** Whether an APNs token is for the sandbox or production service: a development-signed build is sandbox. */
function apnsEnvironment(): 'sandbox' | 'production' {
  return Config.PUSH_APNS_ENVIRONMENT === 'production' ? 'production' : 'sandbox'
}

/**
 * This phone's platform push token, or undefined without permission or a token.
 * Reached only when the person turns notifications on: it is what first lets
 * the platform push service issue this install a token (pushPlatform.ts).
 */
export async function platformPushRegistration(): Promise<PushRegistration | undefined> {
  const m = messaging()
  const status = await m.hasPermission()
  if (status !== messaging.AuthorizationStatus.AUTHORIZED && status !== messaging.AuthorizationStatus.PROVISIONAL) {
    return undefined
  }
  await startPlatformPush(Platform.OS, m)
  if (Platform.OS === 'ios') {
    // The gateway sends to APNs directly with Keyring's own key, so it needs
    // the APNs device token, not Firebase's.
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

function fromIos(status: number): PermissionState {
  if (status === messaging.AuthorizationStatus.AUTHORIZED || status === messaging.AuthorizationStatus.PROVISIONAL) {
    return 'granted'
  }
  return status === messaging.AuthorizationStatus.DENIED ? 'denied' : 'unknown'
}

// react-native-permissions: DENIED means "not asked yet, can ask"; BLOCKED means refused.
function fromAndroid(status: PermissionStatus): PermissionState {
  if (status === RESULTS.GRANTED || status === RESULTS.LIMITED) return 'granted'
  return status === RESULTS.BLOCKED ? 'denied' : 'unknown'
}

/** The notification permission, without asking. */
export async function notificationPermissionStatus(): Promise<PermissionState> {
  if (Platform.OS === 'ios') return fromIos(await messaging().hasPermission())
  return fromAndroid((await checkNotifications()).status)
}

/** Ask for the notification permission (Android 13+ and iOS show the system prompt). */
export async function requestNotificationPermission(): Promise<PermissionState> {
  if (Platform.OS === 'ios') return fromIos(await messaging().requestPermission())
  return fromAndroid((await requestNotifications(['alert', 'sound'])).status)
}

/**
 * The app's `enablePushNotifications`, or undefined when the build names no
 * push gateway. Undefined is what a tester's build gets: bifold then shows no
 * prompt and no Settings switch, and nothing registers.
 */
export function appPushNotificationsConfig(): PushNotificationsConfig | undefined {
  return pushNotificationsConfig({
    gatewayUrl: Config.PUSH_GATEWAY_URL,
    permissionStatus: notificationPermissionStatus,
    requestPermission: requestNotificationPermission,
    enableWake: (agent) => enablePushWake(appPushWakeDeps(agent)),
    clearWake: (agent) => vtaAgent.clearThisDeviceWake(agent),
    stopPlatformPush: () => stopPlatformPush(Platform.OS, messaging()),
    log: (message, data) => BCLogger.info(message, data),
  })
}
