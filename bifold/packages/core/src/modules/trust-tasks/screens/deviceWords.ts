/**
 * The words on a device row (new-phone-new-device-plan.md §B): when it was
 * last seen, what it is, and where a removal stands. Pure, so the screen and
 * its tests share one reading.
 *
 * @module trust-tasks/screens/deviceWords
 */

import type { DeviceView } from './DeviceRow'

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
 * Where a removal stands. Removing revokes a device, so the agent rarely
 * lists one as removed; when it does (a wipe recorded, access refused), any
 * one sign of removal is enough, and a removed device is never shown as
 * active.
 */
export const deviceStatusOf = (device: {
  accessRevoked: boolean
  wipePending: boolean
  wipedAt?: string
}): DeviceStatus => (device.accessRevoked || device.wipePending || device.wipedAt ? 'removedErasePending' : 'active')

/**
 * What a person calls an admin of their agent. Every admin is listed, not
 * only Keyring phones: the label when there is one (Keyring's own rows read
 * "Keyring — <device name>"; the browser plugin's "browser-plugin …" reads as
 * "Browser plugin"), otherwise a plain fallback by the kind of key. Never the
 * DID: that sits behind Details.
 */
export const deviceNameKey = (device: { did: string; label?: string }): { key?: string; label?: string } => {
  const label = device.label?.trim()
  if (label && /browser[- ]plugin/i.test(label)) return { key: 'Devices.BrowserPlugin' }
  if (label) return { label }
  if (device.did.startsWith('did:key:')) return { key: 'Devices.AComputer' }
  if (device.did.startsWith('did:peer:')) return { key: 'Devices.AKeyringPhone' }
  return { key: 'Devices.Unnamed' }
}

/**
 * A name a person can read: one with a letter or a digit in it, in any
 * script. A lone icon glyph (a plugin's displayName seen on a lab agent)
 * falls back to the plain names.
 */
const readable = (name: string | undefined): string | undefined => {
  const trimmed = name?.trim()
  return trimmed && /[\p{L}\p{N}]/u.test(trimmed) ? trimmed : undefined
}

/** What the row needs from the agent's device record (vtaDevices.ts `AgentDevice`). */
export interface AgentDeviceLike {
  did: string
  source: 'registered' | 'aclOnly'
  isThisPhone: boolean
  label?: string
  displayName?: string
  platform?: string
  lastSeenAt?: string
  wipedAt?: string
  accessRevoked: boolean
  wipePending: boolean
  kind?: 'keyring'
}

type Translate = (key: string, options?: Record<string, unknown>) => string

/**
 * A device as its row shows it: the name it registered, else today's plain
 * names ({@link deviceNameKey}); a phone when it registered as Keyring, or is
 * a Keyring phone from before registration (a did:peer key).
 */
export const deviceViewOf = (device: AgentDeviceLike, t: Translate): DeviceView => {
  const { key, label } = deviceNameKey(device)
  return {
    did: device.did,
    name: readable(device.displayName) ?? label ?? t(key ?? 'Devices.Unnamed'),
    ...(device.platform ? { platform: device.platform } : {}),
    ...(device.lastSeenAt ? { lastSeenAt: device.lastSeenAt } : {}),
    status: deviceStatusOf(device),
    thisPhone: device.isThisPhone,
    phone: device.kind === 'keyring' || device.did.startsWith('did:peer:'),
    // A device that registered a name shows it whatever its label says, so
    // only one that does not is renamed from here (IN-123).
    namesItself: Boolean(readable(device.displayName)),
  }
}

/** The short dated default name, "iPhone · added 28 Sep", in the person's language. */
export const defaultNameOf = (platform: string | undefined, addedAt: Date, t: Translate): string => {
  const kind = platform?.toLowerCase()
  return t('Devices.DefaultName', {
    platform: t(
      kind === 'ios' ? 'Devices.ShortIos' : kind === 'android' ? 'Devices.ShortAndroid' : 'Devices.ShortPhone'
    ),
    date: addedAt.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
    interpolation: { escapeValue: false },
  })
}
