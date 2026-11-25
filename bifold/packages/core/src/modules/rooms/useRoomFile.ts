/**
 * Downloading one of a room's files for the attachment sheet: the protected local copy `openFile` makes, its
 * progress, and a cancel. The copy is released when the sheet closes (or the file changes), so nothing a room
 * shared stays on the phone after it is looked at. A cancelled download keeps nothing: the service deletes the
 * partial copy before it rejects.
 *
 * @module rooms/useRoomFile
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import type { OpenedFile, RoomFile, RoomsService, RoomsTransferProgress } from './types'

export type RoomFileState =
  | { step: 'idle' }
  | { step: 'downloading'; progress?: RoomsTransferProgress }
  | { step: 'ready'; opened: OpenedFile }
  | { step: 'failed' }

export interface RoomFileDownload {
  state: RoomFileState
  download: () => void
  cancel: () => void
}

const isAbort = (e: unknown): boolean => e instanceof Error && e.name === 'AbortError'

export function useRoomFile(
  service: RoomsService | undefined,
  roomId: string,
  file: RoomFile | undefined
): RoomFileDownload {
  const [state, setState] = useState<RoomFileState>({ step: 'idle' })
  const controller = useRef<AbortController | undefined>(undefined)
  const opened = useRef<string | undefined>(undefined)

  // A new file (or none: the sheet closed) cancels what is under way and releases what was opened.
  useEffect(() => {
    setState({ step: 'idle' })
    return () => {
      controller.current?.abort()
      controller.current = undefined
      if (opened.current && service) void service.releaseFile(opened.current).catch(() => undefined)
      opened.current = undefined
    }
  }, [service, roomId, file?.fileId])

  const download = useCallback(() => {
    if (!service || !file) return
    const abort = new AbortController()
    controller.current = abort
    setState({ step: 'downloading' })
    service
      .openFile(roomId, file.fileId, {
        signal: abort.signal,
        onProgress: (progress) => {
          if (!abort.signal.aborted) setState({ step: 'downloading', progress })
        },
      })
      .then(
        (copy) => {
          if (abort.signal.aborted) {
            void service.releaseFile(copy.localUri).catch(() => undefined)
            return
          }
          opened.current = copy.localUri
          setState({ step: 'ready', opened: copy })
        },
        (e) => {
          if (controller.current !== abort) return
          setState(isAbort(e) ? { step: 'idle' } : { step: 'failed' })
        }
      )
  }, [service, roomId, file])

  const cancel = useCallback(() => {
    controller.current?.abort()
    setState({ step: 'idle' })
  }, [])

  return { state, download, cancel }
}
