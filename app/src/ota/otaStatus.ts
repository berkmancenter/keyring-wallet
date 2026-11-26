/**
 * Which JS this phone is running: the bundle the store build shipped with, or
 * an update. Shown on the Developer screen and carried in problem reports, so a
 * build number alone no longer has to say what code a tester ran.
 */
import { HotUpdater } from '@hot-updater/react-native'

import { isOtaEnabled } from './otaConfig'
import { OTA_RELEASE } from './otaRelease'
import { isRing, Ring } from './rings'

export interface OtaStatus {
  enabled: boolean
  /** The running bundle's id; for the shipped bundle, the loader's build-time minimum id. */
  bundleId: string
  /** True while the store build's own bundle runs. */
  embedded: boolean
  /** The release the running update was published as ("276.10"); null for the shipped bundle and older updates. */
  release: string | null
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

export const readOtaStatus = (
  client: OtaClient = HotUpdater,
  enabled: boolean = isOtaEnabled(),
  release: string | null = OTA_RELEASE
): OtaStatus => {
  const bundleId = client.getBundleId()
  const cohort = client.getCohort()
  const embedded = bundleId === client.getMinBundleId()
  return {
    enabled,
    bundleId,
    embedded,
    release: embedded ? null : release,
    channel: client.getChannel(),
    ring: isRing(cohort) ? cohort : undefined,
    fingerprint: client.getFingerprintHash(),
    rolledBack: client.getCrashHistory(),
  }
}

/** One short label: "embedded", or the update's release and the first eight characters of its id ("276.10 · 0192f3a4"). */
export const otaLabel = (
  status: Pick<OtaStatus, 'enabled' | 'embedded' | 'bundleId' | 'release'>
): string | undefined => {
  if (!status.enabled) return undefined
  if (status.embedded) return 'embedded'
  const id = status.bundleId.slice(0, 8)
  return status.release ? `${status.release} · ${id}` : id
}

/** The Developer screen's Release line: the update's release, or the store build when its own bundle runs. */
export const releaseText = (status: Pick<OtaStatus, 'embedded' | 'release'>, storeBuild: string): string => {
  if (status.embedded) return `store build ${storeBuild}`
  return status.release ?? 'not named in this update'
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
