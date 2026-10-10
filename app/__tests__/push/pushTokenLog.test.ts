/**
 * A phone with no push token says which step stopped (push/pushDefaults.ts
 * `platformPushRegistration`). A tester's log on 242 (10-10) showed only
 * `noToken`, which cannot tell "not allowed" from "Apple never answered".
 */
import messaging from '@react-native-firebase/messaging'
import { Platform } from 'react-native'

import { platformPushRegistration } from '@/push/pushDefaults'
import BCLogger from '@/utils/logger'

jest.mock('@/push/pushPlatform', () => ({
  ...jest.requireActual('@/push/pushPlatform'),
  // One look, no waiting: the wait itself is pushPlatform.test.ts's.
  waitForApnsToken: jest.fn(async (getToken: () => Promise<string | null>) => getToken()),
}))

const AuthorizationStatus = { NOT_DETERMINED: -1, DENIED: 0, AUTHORIZED: 1, PROVISIONAL: 2, EPHEMERAL: 3 }
const mockedMessaging = messaging as unknown as jest.Mock & { AuthorizationStatus: typeof AuthorizationStatus }
mockedMessaging.AuthorizationStatus = AuthorizationStatus

function phone(opts: {
  permission: number
  apnsToken?: string | null
  fcmToken?: string | null
  register?: () => Promise<void>
}) {
  mockedMessaging.mockReturnValue({
    hasPermission: jest.fn(async () => opts.permission),
    registerDeviceForRemoteMessages: jest.fn(opts.register ?? (async () => undefined)),
    setAutoInitEnabled: jest.fn(async () => undefined),
    getAPNSToken: jest.fn(async () => opts.apnsToken ?? null),
    getToken: jest.fn(async () => opts.fcmToken ?? null),
    isDeviceRegisteredForRemoteMessages: true,
  })
}

describe('a phone with no push token says why', () => {
  const os = Platform.OS
  let info: jest.SpyInstance
  beforeEach(() => {
    info = jest.spyOn(BCLogger, 'info').mockImplementation(() => undefined)
  })
  afterEach(() => {
    info.mockRestore()
    Platform.OS = os
  })

  it('notifications not allowed: says so, with what iOS answered', async () => {
    Platform.OS = 'ios'
    phone({ permission: AuthorizationStatus.DENIED })
    await expect(platformPushRegistration()).resolves.toBeUndefined()
    expect(info).toHaveBeenCalledWith('push token: none, notifications are not allowed', { os: 'ios', permission: 0 })
  })

  it("allowed, but Apple's token never arrives: says so, whether the app registered, and how long it waited", async () => {
    Platform.OS = 'ios'
    phone({ permission: AuthorizationStatus.AUTHORIZED, apnsToken: null })
    await expect(platformPushRegistration()).resolves.toBeUndefined()
    expect(info).toHaveBeenCalledWith(
      "push token: none, Apple's token did not arrive",
      expect.objectContaining({ os: 'ios', permission: 1, registeredForRemote: true, waitedMs: expect.any(Number) })
    )
  })

  it('registering fails: says so, and the failure still reaches the caller', async () => {
    Platform.OS = 'ios'
    phone({
      permission: AuthorizationStatus.AUTHORIZED,
      register: async () => {
        throw new Error('no valid aps-environment entitlement')
      },
    })
    await expect(platformPushRegistration()).rejects.toThrow('no valid aps-environment entitlement')
    expect(info).toHaveBeenCalledWith('push token: none, registering for remote notifications failed', {
      os: 'ios',
      error: 'no valid aps-environment entitlement',
    })
  })

  it('Android with no Firebase token: says so', async () => {
    Platform.OS = 'android'
    phone({ permission: AuthorizationStatus.AUTHORIZED, fcmToken: null })
    await expect(platformPushRegistration()).resolves.toBeUndefined()
    expect(info).toHaveBeenCalledWith('push token: none, Firebase returned no token', { os: 'android', permission: 1 })
  })

  it('a token is returned, and never logged', async () => {
    Platform.OS = 'ios'
    phone({ permission: AuthorizationStatus.AUTHORIZED, apnsToken: 'apns-secret-token' })
    await expect(platformPushRegistration()).resolves.toMatchObject({ platform: 'apns', token: 'apns-secret-token' })
    expect(JSON.stringify(info.mock.calls)).not.toContain('apns-secret-token')
  })
})
