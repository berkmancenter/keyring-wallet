/**
 * The one place a room file's temporary copies live, and the one rule that clears them. A copy on the way into a room
 * (the picked file) or out of one (the opened file) is the file itself, in the clear, so it never outlasts its use.
 *
 * - Every copy is `<caches>/keyring-room-files/<random id>/<name>`. The random id is what tells copies apart; the name
 *   is there only for the system's share sheet, and is untrusted text.
 * - iOS: the folder is excluded from backups and each file is `NSFileProtectionCompleteUnlessOpen`, as a chat photo is
 *   (`chat/media/store.ts`). Android: app-private storage, as there.
 * - `removeRoomFileCopy` runs in a `finally` on every way out: committed, cancelled, failed, discarded, released.
 * - Locking the wallet stops every transfer holding on here and removes every copy at once, then again once those
 *   transfers have let go, for a write that was already on its way. Importing this module listens for the lock, for
 *   the life of the app.
 * - `sweepRoomFileCopiesOnce` empties the directory once per launch, before a room can open, for an app killed mid-way.
 * - iOS also keeps its own copy of a picked file, under its real name, in the app's `tmp/<bundle>-Inbox`, and leaves it
 *   for the app to delete. It goes as soon as the file is picked, and the Inbox goes with every sweep.
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

/**
 * The last segment of `name`, safe as one path segment and as text on the share sheet: a room's file name is whatever
 * its sharer gave it. Direction marks go with the control characters, or `invoice<RLO>gnp.exe` reads as a picture.
 * The length keeps the end, where the extension is, and never starts on half a character, which a path may refuse.
 */
function safeName(name: string): string {
  const last = name.split(/[/\\]/).pop() ?? ''
  const plain = last
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .slice(-MAX_NAME_LENGTH)
    .replace(/^[\udc00-\udfff]/, '')
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

/** Removes `path`, whatever is or is not there. Never throws. */
async function remove(path: string): Promise<void> {
  try {
    await RNFS.unlink(path)
  } catch {
    // Already gone, or going at the next launch.
  }
}

/** iOS names one directory both with and without `/private`: the comparison here must not depend on which. */
const realPath = (path: string) => path.replace(/^\/private\/var\//, '/var/')

/** Whether `path` is in iOS's Inbox for this app (`tmp/<bundle>-Inbox/`). Nothing else is the system's leftover. */
const inSystemInbox = (path: string) =>
  realPath(path).startsWith(realPath(RNFS.TemporaryDirectoryPath).replace(/\/*$/, '/')) && /-Inbox\/[^/]+$/.test(path)


/** Whether `path` is the picker's own copy in the app's caches, and so the app's to move or remove. */
const inCaches = (path: string) => realPath(path).startsWith(`${realPath(RNFS.CachesDirectoryPath)}/`)

/**
 * Takes the system picker's copy of a file in under this rule, and returns where it now is. The picker writes it to
 * the caches on its own, so a copy that cannot be taken in is removed rather than left there. A path anywhere else is
 * not the picker's copy but the member's own file, which is only ever read: copied in, never moved, never removed.
 */
export async function adoptRoomFileCopy(uri: string): Promise<string> {
  let from: string | undefined
  let path: string | undefined
  try {
    from = decodeURIComponent(uri.replace(/^file:\/\//, ''))
    path = await roomFileCopyPath()
    const options = { NSFileProtectionKey: COPY_PROTECTION }
    const take = inCaches(from) ? RNFS.moveFile : RNFS.copyFile
    await (Platform.OS === 'ios' ? take(from, path, options) : take(from, path))
    return path
  } catch (e) {
    if (from && inCaches(from)) await remove(from)
    await removeRoomFileCopy(path)
    throw e
  }
}

/** Removes the picked file's copy from iOS's Inbox, if `uri` is that. Touches nothing else, and never throws. */
export async function removeSystemInboxCopy(uri: string | null | undefined): Promise<void> {
  try {
    const path = decodeURIComponent((uri ?? '').replace(/^file:\/\//, ''))
    if (inSystemInbox(path)) await remove(path)
  } catch {
    // A name that cannot be read goes with the Inbox at the next sweep.
  }
}

/**
 * Removes one copy and its directory. Never throws, so it cannot hide what a `finally` is unwinding from; a copy it
 * could not remove goes at the next launch. Touches nothing outside the copies' directory, whatever it is given.
 */
export async function removeRoomFileCopy(path: string | undefined): Promise<void> {
  const inside = path?.startsWith(`${COPIES_DIR}/`) ? path.slice(COPIES_DIR.length + 1).split('/')[0] : undefined
  if (!inside || inside === '.' || inside === '..') return
  await remove(`${COPIES_DIR}/${inside}`)
}

/** Empties the copies' directory. Not while a transfer is running: it reads from here. */
export async function removeAllRoomFileCopies(): Promise<void> {
  await remove(COPIES_DIR)
  if (Platform.OS !== 'ios') return
  try {
    const inboxes = (await RNFS.readDir(RNFS.TemporaryDirectoryPath)).filter((item) => item.name.endsWith('-Inbox'))
    for (const inbox of inboxes) await remove(inbox.path)
  } catch {
    // Nothing there to read.
  }
}

let swept: Promise<void> | undefined
/** `removeAllRoomFileCopies`, the first time this launch: at launch no transfer is running, and only then. */
export function sweepRoomFileCopiesOnce(): Promise<void> {
  // Set in the same turn as the read: an `await` between them would let two sweeps race a transfer already running.
  swept ??= removeAllRoomFileCopies()
  return swept
}

// Each transfer, and what settles once it has stopped touching its copy.
const transfers = new Map<AbortController, Promise<void>>()

/**
 * Stops `controller`'s transfer if the wallet locks, until the function this returns lets go. Let go in a `finally`,
 * once the transfer can no longer write: a lock waits for that to clear what it wrote last.
 */
export function holdRoomFileTransfer(controller: AbortController): () => void {
  let stopped: () => void = () => undefined
  transfers.set(controller, new Promise<void>((resolve) => (stopped = resolve)))
  return () => {
    transfers.delete(controller)
    stopped()
  }
}

/**
 * A locked wallet keeps no copy. `abort` only asks, and a write already on its way can land after that, so the copies
 * go at once and go again when every transfer has let go. Then only if none has started since, whose copy that would
 * be; what is left then goes with that transfer or at the next launch.
 */
export async function leaveRoomFilesOnLock(): Promise<void> {
  const stopping = [...transfers.values()]
  for (const controller of transfers.keys()) controller.abort()
  await removeAllRoomFileCopies()
  if (stopping.length === 0) return
  await Promise.all(stopping)
  if (transfers.size === 0) await removeAllRoomFileCopies()
}

DeviceEventEmitter.addListener(WALLET_LOCKED_EVENT, () => {
  void leaveRoomFilesOnLock()
})
