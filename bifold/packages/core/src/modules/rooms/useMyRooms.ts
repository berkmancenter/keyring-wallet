/**
 * The member's rooms and room offers, as the entry points show them: read from the rooms service once
 * per screen, narrowed to one community when asked. An operation the service says is not available is
 * not called: its status is kept, so the screen shows why instead of an empty list. When a screen reads
 * again is useRereadOnReturn's: this says how the last read went and what the offers poll knows beyond it.
 *
 * @module rooms/useMyRooms
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'

import { vtaAgent } from '../trust-tasks/module/vtaAgent'

import { RoomsUnavailable } from './types'
import type { OperationStatus, RoomOffer, RoomsCapabilities, RoomsService, RoomSummary } from './types'
import { useRoomOfferIds } from './useRoomOffersCount'

export interface MyRooms {
  /** Undefined until the first read answers. */
  capabilities?: RoomsCapabilities
  /** Undefined while reading, and when listing rooms is not available (see `capabilities.listMyRooms`). */
  rooms?: RoomSummary[]
  /** Empty when listing offers is not available. */
  offers?: RoomOffer[]
  /** The last read failed; what was read before stays. */
  failed: boolean
  /** Why, when the service said (a community that did not answer); undefined for anything else. */
  failure?: OperationStatus
  /** Reads failed in a row; none since the last that answered. */
  failures: number
  /** Offers the poll has read that this list doesn't show, as one string; empty when it shows them all. */
  offersNotShown: string
  /** A reload asked for by the member (pull to refresh) is under way; the first read is not one. */
  refreshing: boolean
  reload: () => void
  /** The same read again, unasked: no pull spinner, and the agent's services are not asked again. */
  reread: () => void
}

export function useMyRooms(service: RoomsService | undefined, communityDid?: string): MyRooms {
  const [state, setState] = useState<Omit<MyRooms, 'reload' | 'reread' | 'offersNotShown'>>({
    failed: false,
    failures: 0,
    refreshing: false,
  })
  const [generation, setGeneration] = useState(0)
  const reload = useCallback(() => {
    setState((s) => ({ ...s, refreshing: true }))
    setGeneration((g) => g + 1)
  }, [])
  // The agent the reads are for. An Add given up passes through "no agent": coming back to the screen read the rooms
  // then, and the agent came back after (it signs in again), so the card said "Link your agent first" until the
  // screen was left (nightly, 10-30). A read is made again whenever the agent changes, and one for another agent than
  // the last read's asks its services afresh: the service keeps one agent's answer (A, then B, then A read B's).
  const agentKey = useSyncExternalStore(vtaAgent.subscribe, () => vtaAgent.agentAddress())
  const lastAgent = useRef(agentKey)
  const lastGeneration = useRef(generation)
  // Not a refresh (no pull spinner, the services not asked again), just the same read.
  const [rereads, setRereads] = useState(0)
  const reread = useCallback(() => setRereads((n) => n + 1), [])
  // A community skipped because a step kept the community session is read again once it is free (onReadable).
  useEffect(() => service?.onReadable?.(reread), [service, reread])

  useEffect(() => {
    if (!service) return
    let live = true
    void (async () => {
      try {
        const refresh = generation !== lastGeneration.current || agentKey !== lastAgent.current
        lastGeneration.current = generation
        lastAgent.current = agentKey
        const capabilities = await service.capabilities({ refresh })
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
          failure: undefined,
          failures: 0,
          refreshing: false,
        })
      } catch (e) {
        const failure: OperationStatus | undefined =
          e instanceof RoomsUnavailable ? { status: 'unavailable', reason: e.reason, detail: e.message } : undefined
        if (live) setState((s) => ({ ...s, failed: true, failure, failures: s.failures + 1, refreshing: false }))
      }
    })()
    return () => {
      live = false
    }
  }, [service, communityDid, generation, agentKey, rereads])

  const polled = useRoomOfferIds(communityDid)
  const { offers } = state
  // Before a first read there is no list to compare: that read brings them.
  const offersNotShown = offers
    ? polled
        .split('\n')
        .filter((id) => id && !offers.some((offer) => offer.offerId === id))
        .join('\n')
    : ''

  return { ...state, offersNotShown, reload, reread }
}
