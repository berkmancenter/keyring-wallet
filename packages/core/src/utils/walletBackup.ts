import RNFS from 'react-native-fs'

/** Folders Export Wallet makes under the caches on iOS: `wallet-backup-<epoch ms>`. */
const BACKUP_FOLDER = /^wallet-backup-(\d+)$/

/** A shared backup is left for its share target to read; this is how long it may stay when nothing sweeps it sooner. */
export const WALLET_BACKUP_MAX_AGE_MS = 24 * 60 * 60 * 1000

/**
 * Removes the backup folders an earlier export left under the caches: all of them (`olderThanMs` unset, as a new
 * export does before it makes its own), or those made more than `olderThanMs` before `now` (as app start does, so a
 * shared backup does not linger when no export follows). Age is read from the folder's name, not the file system's
 * times. Nothing else under the caches is touched, and a failure to read or remove is not an error.
 */
export const removeWalletBackups = async ({
  olderThanMs,
  now = Date.now(),
}: { olderThanMs?: number; now?: number } = {}) => {
  const entries = await RNFS.readDir(RNFS.CachesDirectoryPath).catch(() => [])
  await Promise.all(
    entries
      .filter((e) => {
        const made = e.isDirectory() ? BACKUP_FOLDER.exec(e.name)?.[1] : undefined
        return made !== undefined && (olderThanMs === undefined || now - Number(made) > olderThanMs)
      })
      .map((e) => RNFS.unlink(e.path).catch(() => undefined))
  )
}

/** At app start: shared backups older than a day go. */
export const sweepStaleWalletBackups = (now = Date.now()) =>
  removeWalletBackups({ olderThanMs: WALLET_BACKUP_MAX_AGE_MS, now })

let sweptAtStart = false

/**
 * Once per app run: called from MainContainer.init(), which every app built on bifold runs at start (the wallet builds
 * its own App but still makes its container there, once per render, hence the guard), so the bound holds without each
 * app wiring it.
 */
export const sweepStaleWalletBackupsAtStart = () => {
  if (sweptAtStart) return
  sweptAtStart = true
  sweepStaleWalletBackups().catch(() => undefined)
}
