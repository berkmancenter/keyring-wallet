/**
 * Chat media on this phone (rich-messaging-plan.md §5, "Media files on disk").
 *
 * A photo is one file in its chat's folder, `chatMediaFolder(connectionId)`
 * from history.ts, named `<eventId>.<ext>`: never by the sender's filename.
 * history.ts deletes a message's file by that stem, so every way a message is
 * deleted (Delete for me, Clear chat, Keep messages, expiry, removing the
 * contact) takes its photo with it, with no second path here.
 *
 * A file is never overwritten. A received photo's eventId is the sender's (a
 * ULID, checked, so it cannot name a path), and a peer knows the eventIds of
 * what this phone sent it: reusing one must not replace this phone's own copy.
 * So a write finds no file with that eventId, under any extension (history.ts
 * deletes by the eventId alone), or it throws and nothing is written.
 *
 * Records keep the file name only, never an absolute path: an iOS app's data
 * container can move on an update or a restore, and a stored path would then
 * point at a folder that no longer exists. The full path is built when the file
 * is read.
 *
 * iOS: the folder is excluded from backups, and each file is written with
 * `NSFileProtectionCompleteUnlessOpen`, so a closed photo is unreadable until
 * the next unlock while one can still arrive with the phone locked. Android:
 * the folder is in app-private storage, which `data_extraction_rules.xml`
 * keeps out of backups and device transfers.
 *
 * @module chat/media/store
 */

import { Platform } from 'react-native'
import RNFS from 'react-native-fs'

import { isUlid } from '../chatEvent'
import { chatMediaFolder } from '../history'
import type { ImageMediaType } from './imageHeader'

const EXTENSIONS: ReadonlyMap<string, string> = new Map<ImageMediaType, string>([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/gif', 'gif'],
  ['image/webp', 'webp'],
])

const FILE_NAME = /^([0-9A-HJKMNP-TV-Z]{26})\.(jpg|png|gif|webp)$/
// Connection ids are Credo record ids (UUIDs); nothing else names a folder.
const CONNECTION_ID = /^[A-Za-z0-9-]{1,64}$/

/** The protection class for a photo's file on iOS, passed by its string value (RNFS.FileProtectionKeys is undefined at runtime in 2.20). */
export const CHAT_MEDIA_FILE_PROTECTION = 'NSFileProtectionCompleteUnlessOpen'

/** `<eventId>.<ext>` for a message's photo, or undefined for an eventId that is not a ULID or a type chat does not take. */
export function chatMediaFileName(eventId: string, mediaType: string): string | undefined {
  const ext = EXTENSIONS.get(mediaType)
  return ext && isUlid(eventId) ? `${eventId}.${ext}` : undefined
}

/** The full path of a stored file name, built now; undefined for a name this module did not make. */
export function chatMediaPath(connectionId: string, fileName: string): string | undefined {
  if (!CONNECTION_ID.test(connectionId) || !FILE_NAME.test(fileName)) return undefined
  return `${chatMediaFolder(connectionId)}/${fileName}`
}

/**
 * A `file://` URI for `<Image>`, or undefined as for {@link chatMediaPath}. Each path segment is percent-encoded: the
 * iOS folder is under "Application Support", and a raw space is not valid in a URI.
 */
export function chatMediaUri(connectionId: string, fileName: string): string | undefined {
  const path = chatMediaPath(connectionId, fileName)
  return path && `file://${path.split('/').map(encodeURIComponent).join('/')}`
}

/**
 * Remove a file this module wrote, by the name it returned: for a photo whose message never came to be stored (its
 * send failed), which no record would ever lead a deletion to. A name this module would not make, or a file already
 * gone, is left alone.
 */
export async function removeChatMedia(connectionId: string, fileName: string): Promise<void> {
  const path = chatMediaPath(connectionId, fileName)
  if (path && (await RNFS.exists(path))) await RNFS.unlink(path)
}

/**
 * Write a checked photo's bytes (as base64) to its chat's folder and return the
 * file name to store on the record. Throws on anything it cannot name or write,
 * so the caller never stores a record for a file that is not there.
 */
export async function writeChatMedia(
  connectionId: string,
  eventId: string,
  mediaType: string,
  base64: string
): Promise<string> {
  const fileName = chatMediaFileName(eventId, mediaType)
  if (!fileName || !CONNECTION_ID.test(connectionId)) throw new Error('chat media: not a name this phone writes')
  const folder = chatMediaFolder(connectionId)
  for (const ext of EXTENSIONS.values()) {
    if (await RNFS.exists(`${folder}/${eventId}.${ext}`))
      throw new Error('chat media: a file for this event is already there')
  }
  if (Platform.OS === 'ios') {
    await RNFS.mkdir(folder, { NSURLIsExcludedFromBackupKey: true })
    await RNFS.writeFile(`${folder}/${fileName}`, base64, {
      encoding: 'base64',
      NSFileProtectionKey: CHAT_MEDIA_FILE_PROTECTION,
    })
  } else {
    await RNFS.mkdir(folder)
    await RNFS.writeFile(`${folder}/${fileName}`, base64, 'base64')
  }
  return fileName
}
