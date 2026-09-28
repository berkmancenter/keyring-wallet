/**
 * The words on a device row (new-phone-new-device-plan.md §B): when it was
 * last seen, what it is, and where a removal stands.
 */
import { defaultNameOf, deviceStatusOf, deviceViewOf, lastSeenOf, platformKeyOf } from '../screens/deviceWords'

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

describe('a device as its row shows it', () => {
  const t = (key: string, opts?: Record<string, unknown>) => (opts ? `${key} ${JSON.stringify(opts)}` : key)
  const base = { accessRevoked: false, wipePending: false, isThisPhone: false }

  test('a registered phone: its registered name, platform, last seen', () => {
    const view = deviceViewOf(
      {
        ...base,
        did: 'did:peer:2.Vz6MkA',
        source: 'registered',
        kind: 'keyring',
        displayName: 'Sam’s iPhone',
        label: 'Keyring — old label',
        platform: 'ios',
        lastSeenAt: '2026-09-28T11:00:00Z',
      },
      t
    )
    expect(view).toEqual({
      did: 'did:peer:2.Vz6MkA',
      name: 'Sam’s iPhone',
      platform: 'ios',
      lastSeenAt: '2026-09-28T11:00:00Z',
      status: 'active',
      thisPhone: false,
      phone: true,
    })
  })

  test('an admin that never registered keeps today’s plain names', () => {
    expect(
      deviceViewOf({ ...base, did: 'did:key:z6Mk1', source: 'aclOnly', label: 'browser-plugin x' }, t)
    ).toMatchObject({
      name: 'Devices.BrowserPlugin',
      phone: false,
    })
    expect(deviceViewOf({ ...base, did: 'did:key:z6Mk1', source: 'aclOnly' }, t).name).toBe('Devices.AComputer')
    // A Keyring phone from before registration is still a phone.
    expect(deviceViewOf({ ...base, did: 'did:peer:2.Vz6MkOld', source: 'aclOnly' }, t)).toMatchObject({
      name: 'Devices.AKeyringPhone',
      phone: true,
    })
  })

  test('this phone and a removed phone', () => {
    expect(deviceViewOf({ ...base, did: 'did:peer:2.X', source: 'registered', isThisPhone: true }, t).thisPhone).toBe(
      true
    )
    expect(
      deviceViewOf({ ...base, did: 'did:peer:2.Y', source: 'registered', accessRevoked: true, wipePending: true }, t)
        .status
    ).toBe('removedErasePending')
  })
})

describe('the default name', () => {
  const t = (key: string, opts?: Record<string, unknown>) => (opts ? `${key} ${JSON.stringify(opts)}` : key)

  test('short and dated, in the person’s language: the platform and the day it was added', () => {
    const name = defaultNameOf('ios', new Date('2026-09-28T12:00:00Z'), t)
    expect(name).toMatch(/^Devices\.DefaultName /)
    expect(name).toContain('"platform":"Devices.ShortIos"')
    expect(name).toMatch(/"date":"[^"]*28[^"]*"/)
  })

  test('an unknown platform is just a phone', () => {
    expect(defaultNameOf('linux', new Date('2026-09-28T12:00:00Z'), t)).toContain('"platform":"Devices.ShortPhone"')
  })
})
