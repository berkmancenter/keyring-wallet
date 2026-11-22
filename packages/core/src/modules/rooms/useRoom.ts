/**
 * One room as its screen shows it: the room, its per-room statuses, the service-wide ones (for what no
 * room can change, like group chat), and its notes and files when those can be listed. Each part fails on
 * its own, so a notes list the host would not give does not hide the room.
 *
 * A room that could not be read waits while the agent is being reached again (an unlock reopens its session behind
 * a link shown online), and is read again the moment a session opens, rather than saying the agent is unreachable
 * until a retry (#772, 276.9: 10–20 s after the PIN). `unreachable` is the failure a screen says.
 *
 * @module rooms/useRoom
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import { useAgentSession } from './agentSession'
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
  /** It could not be read, and nothing is reaching the agent or reading it again now: what a screen says, with Try again. */
  unreachable: boolean
  /** The room's own read is out (not its notes or files). */
  reading: boolean
  notesFailed: boolean
  filesFailed: boolean
  /** A reload asked for by the member (pull to refresh) is under way; the first read is not one. */
  refreshing: boolean
  reload: () => void
}

type ReadState = Omit<RoomState, 'reload' | 'unreachable'>

/** The room's listings a screen shows: each is a task for the agent, so a screen reads only those it shows. */
export type RoomListing = 'notes' | 'files'
const BOTH: readonly RoomListing[] = ['notes', 'files']

export function useRoom(
  service: RoomsService | undefined,
  roomId: string,
  lists: readonly RoomListing[] = BOTH
): RoomState {
  const [state, setState] = useState<ReadState>({
    failed: false,
    reading: false,
    notesFailed: false,
    filesFailed: false,
    refreshing: false,
  })
  const [generation, setGeneration] = useState(0)
  const wants = lists.join()
  const reload = useCallback(() => {
    setState((s) => ({ ...s, refreshing: true }))
    setGeneration((g) => g + 1)
  }, [])
  const session = useAgentSession()
  // The agent session a read was sent on, and the one the failed read was: a session opened since is a re-read.
  const openedAt = useRef(session.openedAt)
  openedAt.current = session.openedAt
  const failedOn = useRef<number | undefined>(undefined)

  useEffect(() => {
    if (!service) return
    let live = true
    const set = (next: Partial<ReadState>) => {
      if (live) setState((s) => ({ ...s, ...next }))
    }
    const sentOn = openedAt.current
    set({ reading: true })
    void (async () => {
      let roomCapabilities: RoomCapabilities
      try {
        const [room, perRoom, capabilities] = await Promise.all([
          service.getRoom(roomId),
          service.roomCapabilities(roomId),
          service.capabilities({ refresh: generation > 0 }),
        ])
        roomCapabilities = perRoom
        set({ room, roomCapabilities, capabilities, failed: false, reading: false })
      } catch {
        if (live) failedOn.current = sentOn
        set({ failed: true, reading: false, refreshing: false })
        return
      }
      const listing: Promise<void>[] = []
      if (wants.includes('notes') && roomCapabilities.listNotes.status === 'available')
        listing.push(
          service.listNotes(roomId).then(
            (notes) => set({ notes, notesFailed: false }),
            () => set({ notesFailed: true })
          )
        )
      if (wants.includes('files') && roomCapabilities.listFiles.status === 'available')
        listing.push(
          service.listFiles(roomId).then(
            (files) => set({ files, filesFailed: false }),
            () => set({ filesFailed: true })
          )
        )
      await Promise.all(listing)
      set({ refreshing: false })
    })()
    return () => {
      live = false
    }
  }, [service, roomId, generation, wants])

  // Once per session opened after the failed read was sent: a read failing on that session stays failed.
  const { failed, reading } = state
  useEffect(() => {
    if (failed && !reading && session.openedAt !== undefined && session.openedAt !== failedOn.current) reload()
  }, [failed, reading, session.openedAt, reload])

  return { ...state, unreachable: failed && !reading && !session.reconnecting, reload }
}
