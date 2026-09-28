/**
 * The words on a device row (new-phone-new-device-plan.md §B): when it was
 * last seen, what it is, and where a removal stands.
 */
import { deviceStatusOf, lastSeenOf, platformKeyOf } from '../screens/deviceWords'

const NOW = new Date('2026-09-28T12:00:00Z')
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString()
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

describe('last seen', () => {
  test('never seen says nothing, rather than a made-up time', () => {
    expect(lastSeenOf(undefined, NOW)).toBeUndefined()
    expect(lastSeenOf('not a date', NOW)).toBeUndefined()
  })

  test('within two minutes is "just now"', () => {
    expect(lastSeenOf(ago(30_000), NOW)).toEqual({ key: 'Devices.SeenNow' })
    // A clock a little ahead of ours is still "just now", never "in the future".
    expect(lastSeenOf(new Date(NOW.getTime() + 20_000).toISOString(), NOW)).toEqual({ key: 'Devices.SeenNow' })
  })

  test('minutes, then hours, then days', () => {
    expect(lastSeenOf(ago(5 * MIN), NOW)).toEqual({ key: 'Devices.SeenMinutes', count: 5 })
    expect(lastSeenOf(ago(3 * HOUR + 10 * MIN), NOW)).toEqual({ key: 'Devices.SeenHours', count: 3 })
    expect(lastSeenOf(ago(2 * DAY + HOUR), NOW)).toEqual({ key: 'Devices.SeenDays', count: 2 })
  })

  test('after a month it gives the date', () => {
    const seen = lastSeenOf(ago(40 * DAY), NOW)
    expect(seen?.key).toBe('Devices.SeenOn')
    expect(seen?.date).toBeInstanceOf(Date)
  })
})

describe('platform', () => {
  test('iPhone and Android by name, anything else says nothing', () => {
    expect(platformKeyOf('ios')).toBe('Devices.PlatformIos')
    expect(platformKeyOf('iOS')).toBe('Devices.PlatformIos')
    expect(platformKeyOf('android')).toBe('Devices.PlatformAndroid')
    expect(platformKeyOf('linux')).toBeUndefined()
    expect(platformKeyOf(undefined)).toBeUndefined()
  })
})

describe('where a removal stands', () => {
  // The agent never sees a wipe happen: wipedAt means "asked", and the device
  // is refused from then on (VTI operations/device.rs, auth/backend.rs). A
  // device only ACL-listed disappears when revoked, so it never shows here.
  test('a device with access is active', () => {
    expect(deviceStatusOf({ accessRevoked: false, wipePending: false })).toBe('active')
  })

  test('a wiped device is removed, and erases its copy when it next connects', () => {
    expect(deviceStatusOf({ accessRevoked: true, wipePending: true, wipedAt: ago(HOUR) })).toBe('removedErasePending')
  })

  test('any one sign of removal is enough: never shown as active', () => {
    expect(deviceStatusOf({ accessRevoked: false, wipePending: true })).toBe('removedErasePending')
    expect(deviceStatusOf({ accessRevoked: false, wipePending: false, wipedAt: ago(HOUR) })).toBe('removedErasePending')
    expect(deviceStatusOf({ accessRevoked: true, wipePending: false })).toBe('removedErasePending')
  })
})
