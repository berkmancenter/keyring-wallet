/**
 * One room as its screen shows it: the room, its per-room statuses, the service-wide ones (for what no
 * room can change, like group chat), and its notes and files when those can be listed. Each part fails on
 * its own, so a notes list the host would not give does not hide the room.
 *
 * @module rooms/useRoom
 */
import { useCallback, useEffect, useState } from 'react'

import type { NoteList, Room, RoomCapabilities, RoomFile, RoomsCapabilities, RoomsService } from './types'

export interface RoomState {
  room?: Room
  roomCapabilities?: RoomCapabilities
  capabilities?: RoomsCapabilities
  /** Undefined while reading, or when notes cannot be listed (see `roomCapabilities.listNotes`). */
  notes?: NoteList
  files?: RoomFile[]
  /** The room itself could not be read. */
  failed: boolean
  notesFailed: boolean
  filesFailed: boolean
  reload: () => void
}

export function useRoom(service: RoomsService | undefined, roomId: string): RoomState {
  const [state, setState] = useState<Omit<RoomState, 'reload'>>({
    failed: false,
    notesFailed: false,
    filesFailed: false,
  })
  const [generation, setGeneration] = useState(0)
  const reload = useCallback(() => setGeneration((g) => g + 1), [])

  useEffect(() => {
    if (!service) return
    let live = true
    const set = (next: Partial<Omit<RoomState, 'reload'>>) => {
      if (live) setState((s) => ({ ...s, ...next }))
    }
    void (async () => {
      let roomCapabilities: RoomCapabilities
      try {
        const [room, perRoom, capabilities] = await Promise.all([
          service.getRoom(roomId),
          service.roomCapabilities(roomId),
          service.capabilities({ refresh: generation > 0 }),
        ])
        roomCapabilities = perRoom
        set({ room, roomCapabilities, capabilities, failed: false })
      } catch {
        set({ failed: true })
        return
      }
      const listing: Promise<void>[] = []
      if (roomCapabilities.listNotes.status === 'available')
        listing.push(
          service.listNotes(roomId).then(
            (notes) => set({ notes, notesFailed: false }),
            () => set({ notesFailed: true })
          )
        )
      if (roomCapabilities.listFiles.status === 'available')
        listing.push(
          service.listFiles(roomId).then(
            (files) => set({ files, filesFailed: false }),
            () => set({ filesFailed: true })
          )
        )
      await Promise.all(listing)
    })()
    return () => {
      live = false
    }
  }, [service, roomId, generation])

  return { ...state, reload }
}
