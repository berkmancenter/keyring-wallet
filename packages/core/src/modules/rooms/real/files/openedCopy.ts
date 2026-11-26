/**
 * The local copy of a file being opened (`tempCopies.ts` holds the rule for every copy). It is written under a blank
 * name, and only a file that passed every check (`open.ts`) is moved to the name the share sheet shows: a killed app
 * or a failed check leaves no file that looks like the real one. The URI is what `<Image>` and the share sheet take,
 * so a name's spaces and `#` stay part of it.
 */
import { TypedArrayEncoder } from '@credo-ts/core'
import RNFS from 'react-native-fs'

import type { OpenFileCopy } from './open'
import { createRoomFileCopy, removeRoomFileCopy, roomFileCopyPath } from './tempCopies'

const toUri = (path: string) => `file://${path.split('/').map(encodeURIComponent).join('/')}`
const toPath = (uri: string) => decodeURIComponent(uri.replace(/^file:\/\//, ''))

/** A new, empty copy of a file named `name`, which is untrusted. */
export async function createOpenedCopy(name: string): Promise<OpenFileCopy> {
  const partial = await createRoomFileCopy()
  let final: string | undefined
  return {
    append: (plain) => RNFS.appendFile(partial, TypedArrayEncoder.toBase64(plain), 'base64'),
    finish: async () => {
      final = await roomFileCopyPath(name)
      await RNFS.moveFile(partial, final)
      await removeRoomFileCopy(partial)
      return toUri(final)
    },
    discard: async () => {
      await removeRoomFileCopy(partial)
      await removeRoomFileCopy(final)
    },
  }
}

/** Deletes a finished copy, by the URI `finish` gave. Never rejects. */
export const releaseOpenedCopy = (localUri: string): Promise<void> => removeRoomFileCopy(toPath(localUri))
