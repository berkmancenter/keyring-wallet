/**
 * The words on a device row (new-phone-new-device-plan.md §B): when it was
 * last seen, what it is, and where a removal stands. Pure, so the screen and
 * its tests share one reading.
 *
 * @module trust-tasks/screens/deviceWords
 */

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export type LastSeen =
  | { key: 'Devices.SeenNow' }
  | { key: 'Devices.SeenMinutes' | 'Devices.SeenHours' | 'Devices.SeenDays'; count: number }
  | { key: 'Devices.SeenOn'; date: Date }

/**
 * "Seen 5 min ago" and the like, or nothing when the agent has no time for it:
 * a device that never checked in says nothing rather than a made-up time. A
 * clock a little ahead of ours reads as "just now".
 */
export const lastSeenOf = (lastSeenAt: string | undefined, now: Date = new Date()): LastSeen | undefined => {
  if (!lastSeenAt) return undefined
  const seen = new Date(lastSeenAt)
  if (Number.isNaN(seen.getTime())) return undefined
  const ago = Math.max(0, now.getTime() - seen.getTime())
  if (ago < 2 * MINUTE) return { key: 'Devices.SeenNow' }
  if (ago < HOUR) return { key: 'Devices.SeenMinutes', count: Math.floor(ago / MINUTE) }
  if (ago < DAY) return { key: 'Devices.SeenHours', count: Math.floor(ago / HOUR) }
  if (ago < 30 * DAY) return { key: 'Devices.SeenDays', count: Math.floor(ago / DAY) }
  return { key: 'Devices.SeenOn', date: seen }
}

/** iPhone or Android by name; any other platform says nothing. */
export const platformKeyOf = (platform: string | undefined): string | undefined => {
  switch (platform?.toLowerCase()) {
    case 'ios':
      return 'Devices.PlatformIos'
    case 'android':
      return 'Devices.PlatformAndroid'
    default:
      return undefined
  }
}

export type DeviceStatus = 'active' | 'removedErasePending'

/**
 * Where a removal stands. The agent never sees a wipe happen: once asked, the
 * device is refused and can't report back, so a removed device stays "erases
 * its copy when it next connects". Any one sign of removal is enough; a
 * removed device is never shown as active.
 */
export const deviceStatusOf = (device: {
  accessRevoked: boolean
  wipePending: boolean
  wipedAt?: string
}): DeviceStatus => (device.accessRevoked || device.wipePending || device.wipedAt ? 'removedErasePending' : 'active')
