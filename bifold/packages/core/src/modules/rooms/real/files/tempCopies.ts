/**
 * The one place a room file's temporary copies live, and the one rule that clears them. A copy on the way into a room
 * (the picked file) or out of one (the opened file) is the file itself, in the clear, so it never outlasts its use.
 *
 * - Every copy is `<caches>/keyring-room-files/<random id>/<name>`. The random id is what tells copies apart; the name
 *   is there only for the system's share sheet, and is untrusted text.
 * - iOS: the folder is excluded from backups and each file is `NSFileProtectionCompleteUnlessOpen`, as a chat photo is
 *   (`chat/media/store.ts`). Android: app-private storage, as there.
 * - `removeRoomFileCopy` runs in a `finally` on every way out: committed, cancelled, failed, discarded, released.
 * - Locking the wallet stops every transfer holding on here and removes every copy, so nothing is left to read
 *   behind the lock.
 * - `sweepRoomFileCopiesOnce` empties the directory once per launch, before a room can open, for an app killed mid-way.
 *
 * Neither a path nor a name is ever logged.
 */
import { bytesToHex, randomBytes } from '@noble/hashes/utils.js'
import { DeviceEventEmitter, Platform } from 'react-native'
import RNFS from 'react-native-fs'

import { WALLET_LOCKED_EVENT } from '../../../../utils/walletLocked'

const COPIES_DIR = `${RNFS.CachesDirectoryPath}/keyring-room-files`
const MAX_NAME_LENGTH = 120
/** The protection class for a copy on iOS, passed by its string value as `chat/media/store.ts` does. */
const COPY_PROTECTION = 'NSFileProtectionCompleteUnlessOpen'

/** The last segment of `name`, safe as one path segment: a room's file name is whatever its sharer gave it. */
function safeName(name: string): string {
  const last = name.split(/[/\\]/).pop() ?? ''
  // eslint-disable-next-line no-control-regex
  const plain = last.replace(/[\u0000-\u001f\u007f]/g, '').slice(-MAX_NAME_LENGTH)
  return plain === '' || plain === '.' || plain === '..' ? 'file' : plain
}

/** A new path for one copy under `name`, its directory made; nothing is written to it yet. */
export async function roomFileCopyPath(name = 'file'): Promise<string> {
  const dir = `${COPIES_DIR}/${bytesToHex(randomBytes(16))}`
  await (Platform.OS === 'ios' ? RNFS.mkdir(dir, { NSURLIsExcludedFromBackupKey: true }) : RNFS.mkdir(dir))
  return `${dir}/${safeName(name)}`
}

/** A new, empty copy with its protection set, to append to: `RNFS.appendFile` takes no attributes. */
export async function createRoomFileCopy(name = 'file'): Promise<string> {
  const path = await roomFileCopyPath(name)
  await (Platform.OS === 'ios'
    ? RNFS.writeFile(path, '', { encoding: 'utf8', NSFileProtectionKey: COPY_PROTECTION })
    : RNFS.writeFile(path, '', 'utf8'))
  return path
}

/**
 * Takes the system picker's copy of a file in under this rule, and returns where it now is. The picker writes it to
 * the caches on its own, so a copy that cannot be taken in is removed rather than left there.
 */
export async function adoptRoomFileCopy(uri: string): Promise<string> {
  const from = decodeURIComponent(uri.replace(/^file:\/\//, ''))
  let path: string | undefined
  try {
    path = await roomFileCopyPath()
    await (Platform.OS === 'ios'
      ? RNFS.moveFile(from, path, { NSFileProtectionKey: COPY_PROTECTION })
      : RNFS.moveFile(from, path))
    return path
  } catch (e) {
    await RNFS.unlink(from).catch(() => undefined)
    await removeRoomFileCopy(path)
    throw e
  }
}

/**
 * Removes one copy and its directory. Never throws, so it cannot hide what a `finally` is unwinding from; a copy it
 * could not remove goes at the next launch. Touches nothing outside the copies' directory, whatever it is given.
 */
export async function removeRoomFileCopy(path: string | undefined): Promise<void> {
  const inside = path?.startsWith(`${COPIES_DIR}/`) ? path.slice(COPIES_DIR.length + 1).split('/')[0] : undefined
  if (!inside || inside === '.' || inside === '..') return
  await RNFS.unlink(`${COPIES_DIR}/${inside}`).catch(() => undefined)
}

/** Empties the copies' directory. Not while a transfer is running: it reads from here. */
export async function removeAllRoomFileCopies(): Promise<void> {
  await RNFS.unlink(COPIES_DIR).catch(() => undefined)
}

let swept: Promise<void> | undefined
/** `removeAllRoomFileCopies`, the first time this launch: at launch no transfer is running, and only then. */
export function sweepRoomFileCopiesOnce(): Promise<void> {
  swept ??= removeAllRoomFileCopies()
  return swept
}

const transfers = new Set<AbortController>()

/** Stops `controller`'s transfer if the wallet locks, until the function this returns lets go. */
export function holdRoomFileTransfer(controller: AbortController): () => void {
  transfers.add(controller)
  return () => {
    transfers.delete(controller)
  }
}

/** A locked wallet keeps no copy: every transfer stops first, or a sweep would pull its file out from under it. */
export async function leaveRoomFilesOnLock(): Promise<void> {
  for (const controller of transfers) controller.abort()
  transfers.clear()
  await removeAllRoomFileCopies()
}

DeviceEventEmitter.addListener(WALLET_LOCKED_EVENT, () => {
  void leaveRoomFilesOnLock()
})
