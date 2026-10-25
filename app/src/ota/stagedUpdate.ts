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
 * The staged update's id, or undefined: a staged bundle awaits its first launch
 * (verification pending) under this build's isolation key. The key embeds the
 * native fingerprint, so metadata another build wrote never counts. A rollback
 * stages nothing: it clears staging, and applies at the next cold start.
 */
export const stagedUpdateIdOf = (metadataJson: string | undefined, fingerprint: string | null): string | undefined => {
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
  if (typeof key !== 'string' || !fingerprint || !key.includes(fingerprint)) return undefined
  return staged
}

export const readStagedUpdateId = async (fingerprint: string | null): Promise<string | undefined> => {
  if (!(await exists(OTA_METADATA_PATH))) return undefined
  return stagedUpdateIdOf(await readFile(OTA_METADATA_PATH, 'utf8'), fingerprint)
}
