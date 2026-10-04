/**
 * On Android, react-native-permissions' `checkNotifications` never answers
 * BLOCKED: notifications switched off in the phone's settings read as DENIED.
 * The permission check behind push/pushPermissionWatch.ts must read that as
 * denied, or it never clears the wake channel on Android.
 */
import { Platform } from 'react-native'
import { checkNotifications, RESULTS } from 'react-native-permissions'

import { notificationsAllowedNow } from '@/push/pushDefaults'

const check = checkNotifications as jest.MockedFunction<typeof checkNotifications>

describe('notifications allowed now, on Android', () => {
  const os = Platform.OS
  beforeAll(() => {
    Platform.OS = 'android'
  })
  afterAll(() => {
    Platform.OS = os
  })

  it('switched off in the phone settings (DENIED) is denied', async () => {
    check.mockResolvedValueOnce({ status: RESULTS.DENIED, settings: {} })
    await expect(notificationsAllowedNow()).resolves.toBe('denied')
  })

  it('on (GRANTED) is granted', async () => {
    check.mockResolvedValueOnce({ status: RESULTS.GRANTED, settings: {} })
    await expect(notificationsAllowedNow()).resolves.toBe('granted')
  })
})
