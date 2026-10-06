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
import { ToastType, vtaAgent } from '@bifold/core'
import type { Agent } from '@credo-ts/core'
import AsyncStorage from '@react-native-async-storage/async-storage'
import i18n from 'i18next'
import Toast from 'react-native-toast-message'
import messaging from '@react-native-firebase/messaging'
import { Platform } from 'react-native'
import { Config } from 'react-native-config'
import { getBundleId } from 'react-native-device-info'
import { checkNotifications, requestNotifications, RESULTS, type PermissionStatus } from 'react-native-permissions'

import BCLogger from '@/utils/logger'

import { pushNotificationsConfig, type PermissionState, type PushNotificationsConfig } from './pushConfig'
import type { PushRegistration } from './pushGateway'
import { startPlatformPush, stopPlatformPush, waitForApnsToken } from './pushPlatform'
import { enablePushWake, type KeptWakeHandle, type PushWakeDeps, type WakeHandleStore } from './pushWake'

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
    // the APNs device token, not Firebase's. On a first registration it can
    // arrive just after registering returns: wait for it.
    const token = await waitForApnsToken(() => m.getAPNSToken())
    return token ? { platform: 'apns', token, topic: getBundleId(), environment: apnsEnvironment() } : undefined
  }
  const token = await m.getToken()
  return token ? { platform: 'fcm', token } : undefined
}

const HANDLE_KEY_PREFIX = 'keyring.push.handle.'

/** Each agent's wake handle, kept on this phone (see {@link WakeHandleStore}). */
export const appWakeHandles: WakeHandleStore & { count(): Promise<number> } = {
  get: async (agentDid) => {
    const raw = await AsyncStorage.getItem(HANDLE_KEY_PREFIX + agentDid)
    return raw ? (JSON.parse(raw) as KeptWakeHandle) : undefined
  },
  set: async (agentDid, kept) => {
    await AsyncStorage.setItem(HANDLE_KEY_PREFIX + agentDid, JSON.stringify(kept))
  },
  count: async () => (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(HANDLE_KEY_PREFIX)).length,
}

/**
 * The gateway refused a new handle: this phone's token is at its limit. Said
 * in plain words, and logged with how many agents hold a handle here.
 */
export function showHandleLimit(): void {
  void appWakeHandles
    .count()
    .catch(() => -1)
    .then((agentsWithHandles) =>
      BCLogger.info('push wake: too many handles for this push token', { agentsWithHandles })
    )
  Toast.show({
    type: ToastType.Warn,
    text1: i18n.t('PushNotifications.HandleLimitTitle'),
    text2: i18n.t('PushNotifications.HandleLimitBody'),
    visibilityTime: 10000,
  })
}

/** {@link PushWakeDeps} for the running app. */
export function appPushWakeDeps(agent: Agent): PushWakeDeps {
  return {
    gatewayUrl: Config.PUSH_GATEWAY_URL,
    agentDid: () => vtaAgent.agentAddress(),
    pushRegistration: platformPushRegistration,
    setWake: (wake, opts) => vtaAgent.setThisDeviceWake(agent, wake, opts),
    handles: appWakeHandles,
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

/**
 * Whether the phone lets Keyring show notifications right now, for a person
 * who has already turned them on. Not {@link notificationPermissionStatus}:
 * on Android, react-native-permissions' `checkNotifications` never answers
 * BLOCKED — it reads `areNotificationsEnabled()` and answers GRANTED or DENIED
 * (RNPermissionsModuleImpl.checkNotifications) — and that function reads DENIED
 * as "not asked yet". For someone who turned notifications on, DENIED can only
 * mean they were switched off since.
 */
export async function notificationsAllowedNow(): Promise<PermissionState> {
  if (Platform.OS === 'ios') return fromIos(await messaging().hasPermission())
  return (await checkNotifications()).status === RESULTS.GRANTED ? 'granted' : 'denied'
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
    onHandleLimit: showHandleLimit,
  })
}
