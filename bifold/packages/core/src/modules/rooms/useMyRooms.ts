/**
 * The member's rooms and room offers, as the entry points show them: read from the rooms service once
 * per screen, narrowed to one community when asked. An operation the service says is not available is
 * not called: its status is kept, so the screen shows why instead of an empty list.
 *
 * @module rooms/useMyRooms
 */
import { useCallback, useEffect, useState } from 'react'

import type { RoomOffer, RoomsCapabilities, RoomsService, RoomSummary } from './types'

export interface MyRooms {
  /** Undefined until the first read answers. */
  capabilities?: RoomsCapabilities
  /** Undefined while reading, and when listing rooms is not available (see `capabilities.listMyRooms`). */
  rooms?: RoomSummary[]
  /** Empty when listing offers is not available. */
  offers?: RoomOffer[]
  /** The last read failed; what was read before stays. */
  failed: boolean
  /** A reload asked for by the member (pull to refresh) is under way; the first read is not one. */
  refreshing: boolean
  reload: () => void
}

export function useMyRooms(service: RoomsService | undefined, communityDid?: string): MyRooms {
  const [state, setState] = useState<Omit<MyRooms, 'reload'>>({ failed: false, refreshing: false })
  const [generation, setGeneration] = useState(0)
  const reload = useCallback(() => {
    setState((s) => ({ ...s, refreshing: true }))
    setGeneration((g) => g + 1)
  }, [])

  useEffect(() => {
    if (!service) return
    let live = true
    void (async () => {
      try {
        const capabilities = await service.capabilities({ refresh: generation > 0 })
        const listRooms = capabilities.listMyRooms.status === 'available'
        const listOffers = capabilities.listOffers.status === 'available'
        const [rooms, offers] = await Promise.all([
          listRooms ? service.listMyRooms() : Promise.resolve(undefined),
          listOffers ? service.listOffers(communityDid) : Promise.resolve([]),
        ])
        if (!live) return
        setState({
          capabilities,
          rooms: communityDid ? rooms?.filter((r) => r.communityDid === communityDid) : rooms,
          offers: communityDid ? offers.filter((o) => o.communityDid === communityDid) : offers,
          failed: false,
          refreshing: false,
        })
      } catch {
        if (live) setState((s) => ({ ...s, failed: true, refreshing: false }))
      }
    })()
    return () => {
      live = false
    }
  }, [service, communityDid, generation])

  return { ...state, reload }
}
