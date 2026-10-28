/**
 * Picking one file to post to a room: the system document picker, copied into the app's caches so the service can
 * read it while it uploads. A file over the room's limit is refused here, before anything is prepared, so the
 * member hears it at once rather than after a long upload.
 *
 * @module rooms/pickRoomFile
 */
import { pick, types } from 'react-native-document-picker'

import type { RoomsAttachment } from './types'

/**
 * The most a post's file may be: 25 MB, just inside the service's own 25 MiB cap, so the limit the member is told
 * ("up to 25 MB") is exactly the one applied.
 */
export const MAX_FILE_BYTES = 25_000_000

export type PickedFile = { ok: true; file: RoomsAttachment } | { ok: false; reason: 'tooLarge' | 'unreadable' }

const isCancel = (e: unknown): boolean => (e as { code?: unknown } | undefined)?.code === 'DOCUMENT_PICKER_CANCELED'

/** One picked file, a refusal, or undefined when the member closed the picker. */
export async function pickRoomFile(): Promise<PickedFile | undefined> {
  let picked: Awaited<ReturnType<typeof pick>>
  try {
    picked = await pick({ type: [types.allFiles], copyTo: 'cachesDirectory', allowMultiSelection: false })
  } catch (e) {
    if (isCancel(e)) return undefined
    return { ok: false, reason: 'unreadable' }
  }
  const chosen = picked[0]
  if (!chosen) return undefined
  const uri = chosen.fileCopyUri ?? undefined
  if (!uri || chosen.copyError || chosen.size === null) return { ok: false, reason: 'unreadable' }
  if (chosen.size > MAX_FILE_BYTES) return { ok: false, reason: 'tooLarge' }
  return {
    ok: true,
    file: { uri, name: chosen.name ?? 'file', mimeType: chosen.type ?? undefined, size: chosen.size },
  }
}
