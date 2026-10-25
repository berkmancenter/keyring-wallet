/**
 * Which JS this phone is running: the bundle the store build shipped with, or
 * an update. Shown on the Developer screen and carried in problem reports, so a
 * build number alone no longer has to say what code a tester ran.
 */
import { HotUpdater } from '@hot-updater/react-native'

import { isOtaEnabled } from './otaConfig'
import { isRing, Ring } from './rings'

export interface OtaStatus {
  enabled: boolean
  /** The running bundle's id; for the shipped bundle, the loader's build-time minimum id. */
  bundleId: string
  /** True while the store build's own bundle runs. */
  embedded: boolean
  channel: string
  ring: Ring | undefined
  fingerprint: string | null
  /** Bundle ids that crashed before their first screen and were rolled back. */
  rolledBack: string[]
}

export interface OtaClient {
  getBundleId: () => string
  getMinBundleId: () => string
  getChannel: () => string
  getCohort: () => string
  getFingerprintHash: () => string | null
  getCrashHistory: () => string[]
}

export const readOtaStatus = (client: OtaClient = HotUpdater, enabled: boolean = isOtaEnabled()): OtaStatus => {
  const bundleId = client.getBundleId()
  const cohort = client.getCohort()
  return {
    enabled,
    bundleId,
    embedded: bundleId === client.getMinBundleId(),
    channel: client.getChannel(),
    ring: isRing(cohort) ? cohort : undefined,
    fingerprint: client.getFingerprintHash(),
    rolledBack: client.getCrashHistory(),
  }
}

/** One short label: "embedded", or the first eight characters of the update's id. */
export const otaLabel = (status: Pick<OtaStatus, 'enabled' | 'embedded' | 'bundleId'>): string | undefined => {
  if (!status.enabled) return undefined
  return status.embedded ? 'embedded' : status.bundleId.slice(0, 8)
}

/** The label, or undefined when OTA is off or the loader cannot be read (tests, a build without it). */
export const currentOtaLabel = (): string | undefined => {
  if (!isOtaEnabled()) return undefined
  try {
    return otaLabel(readOtaStatus())
  } catch {
    return undefined
  }
}
