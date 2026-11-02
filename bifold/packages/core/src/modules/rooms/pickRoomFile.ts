/**
 * Picking one file to post to a room: the system document picker, whose copy goes straight under the temporary copies'
 * rule so the service can read it while it uploads. A file over the room's limit is refused here, before anything is
 * prepared, so the member hears it at once rather than after a long upload, and its copy goes with the refusal.
 *
 * @module rooms/pickRoomFile
 */
import { pick, types } from 'react-native-document-picker'

import { FILE_BYTES } from './real/files/upload'

import { adoptRoomFileCopy, removeRoomFileCopy, sweepRoomFileCopiesOnce } from './real/files/tempCopies'
import type { RoomsAttachment } from './types'

/** The most a post's file may be, as the upload takes it (`files/upload.ts`), so the limit the member is told is exact. */
export const MAX_FILE_BYTES = FILE_BYTES

export type PickedFile = { ok: true; file: RoomsAttachment } | { ok: false; reason: 'tooLarge' | 'unreadable' }

const isCancel = (e: unknown): boolean => (e as { code?: unknown } | undefined)?.code === 'DOCUMENT_PICKER_CANCELED'

/** One picked file, a refusal, or undefined when the member closed the picker. */
export async function pickRoomFile(): Promise<PickedFile | undefined> {
  await sweepRoomFileCopiesOnce()
  let picked: Awaited<ReturnType<typeof pick>>
  try {
    picked = await pick({ type: [types.allFiles], copyTo: 'cachesDirectory', allowMultiSelection: false })
  } catch (e) {
    if (isCancel(e)) return undefined
    return { ok: false, reason: 'unreadable' }
  }
  const chosen = picked[0]
  if (!chosen) return undefined
  if (!chosen.fileCopyUri || chosen.copyError) return { ok: false, reason: 'unreadable' }
  let uri: string
  try {
    uri = await adoptRoomFileCopy(chosen.fileCopyUri)
  } catch {
    return { ok: false, reason: 'unreadable' }
  }
  if (chosen.size === null || chosen.size > MAX_FILE_BYTES) {
    await removeRoomFileCopy(uri)
    return { ok: false, reason: chosen.size === null ? 'unreadable' : 'tooLarge' }
  }
  return {
    ok: true,
    file: { uri, name: chosen.name ?? 'file', mimeType: chosen.type ?? undefined, size: chosen.size },
  }
}
