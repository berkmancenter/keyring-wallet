import { DocumentDirectoryPath, exists, readFile } from 'react-native-fs'

/**
 * The update hot-updater has downloaded, verified and staged for its next
 * launch, read from its own bundle-store/metadata.json at the moment it is
 * needed. hot-updater has no API for it in 0.36.18, and its update-check
 * callback can't stand in: for an update that isn't forced it reports UPDATE
 * as soon as one is offered, while the download runs unawaited (wrap.tsx), so
 * an offer that fails or is still downloading would read as staged.
 *
 * The same file the launch-time watchdogs read natively (AppDelegate.mm
 * KeyringOtaTrialBundleId, OtaTrial.kt): Documents/bundle-store on iOS, the
 * app's files/bundle-store on Android, both DocumentDirectoryPath here. Its
 * fields are snake_case on iOS and camelCase on Android. A hot-updater bump
 * re-checks this (deploy/keyring-ota/README.md, "Upgrading hot-updater").
 */
export const OTA_METADATA_PATH = `${DocumentDirectoryPath}/bundle-store/metadata.json`

/**
 * This build's isolation key, composed exactly as AppDelegate.mm
 * (KeyringOtaIsolationKey) and MainApplication.kt (otaIsolationKey) set it:
 * hot-updater's default with the version read as {version}+{build}. hot-updater
 * keeps a staged update only under an equal key, and so must this reader: a store
 * build with only JavaScript changes keeps the fingerprint and changes the build
 * number, so the previous build's metadata has the same fingerprint, another key.
 */
export const isolationKeyFor = ({
  platform,
  fingerprint,
  appVersion,
  buildNumber,
  channel,
}: {
  platform: string
  fingerprint: string | null
  appVersion: string | null
  buildNumber: string
  channel: string
}): string => {
  const version = `${appVersion ?? 'unknown'}+${buildNumber}`
  const base = fingerprint ? `${fingerprint}_${version}` : version
  return platform === 'android' ? `HotUpdaterPrefs_${base}_${channel}` : `hotupdater_${base}_${channel}_`
}

/**
 * The staged update's id, or undefined: a staged bundle awaits its first launch
 * (verification pending) under exactly this build's isolation key. A rollback
 * stages nothing: it clears staging, and applies at the next cold start.
 */
export const stagedUpdateIdOf = (metadataJson: string | undefined, isolationKey: string): string | undefined => {
  if (!metadataJson) return undefined
  let metadata: Record<string, unknown>
  try {
    metadata = JSON.parse(metadataJson)
  } catch {
    return undefined
  }
  const pending = metadata.verification_pending ?? metadata.verificationPending
  const staged = metadata.staging_bundle_id ?? metadata.stagingBundleId
  const key = metadata.isolation_key ?? metadata.isolationKey
  if (pending !== true || typeof staged !== 'string' || staged === '') return undefined
  if (key !== isolationKey) return undefined
  return staged
}

export const readStagedUpdateId = async (isolationKey: string): Promise<string | undefined> => {
  if (!(await exists(OTA_METADATA_PATH))) return undefined
  return stagedUpdateIdOf(await readFile(OTA_METADATA_PATH, 'utf8'), isolationKey)
}
