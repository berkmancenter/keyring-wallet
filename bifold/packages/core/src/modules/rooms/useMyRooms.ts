/**
 * The member's rooms and room offers, as the entry points show them: read from the rooms service once
 * per screen, narrowed to one community when asked. An operation the service says is not available is
 * not called: its status is kept, so the screen shows why instead of an empty list. When a screen reads
 * again is useRereadOnReturn's: this says how the last read went and what the offers poll knows beyond it.
 *
 * The rooms show as soon as they are listed, and the last listing at once when the screen opens again; the offers are
 * read beside them and never hold them back or fail them. A community that left its offers unanswered for minutes
 * (First VTC, a tester's 277.4 log, 11-02) held the whole list for each 30 s wait, and on the community's own screen
 * failed it as "Couldn't reach your agent", whose Try again waited on the same unanswered ask. A read that fails is
 * tried once more after {@link MY_ROOMS_RETRY_MS} while the screen is open, and every failure and retry is logged.
 *
 * @module rooms/useMyRooms
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { DeviceEventEmitter } from 'react-native'

import { WALLET_LOCKED_EVENT } from '../../utils/walletLocked'

import { vtaAgent } from '../trust-tasks/module/vtaAgent'

import { failureCategory, logRef } from './roomsLogWords'
import { RoomsUnavailable } from './types'
import type { OperationStatus, RoomOffer, RoomsCapabilities, RoomsService, RoomSummary } from './types'
import { useRoomOfferIds } from './useRoomOffersCount'

export interface MyRooms {
  /** Undefined until the first read answers. */
  capabilities?: RoomsCapabilities
  /** Undefined while reading, and when listing rooms is not available (see `capabilities.listMyRooms`). */
  rooms?: RoomSummary[]
  /** Empty when listing offers is not available; undefined until they are first read. */
  offers?: RoomOffer[]
  /** The last read of the offers failed: the rooms show anyway, and the screen says the offers couldn't be read. */
  offersFailed: boolean
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

/** How long after a failed read it is tried once more, unasked, while the screen is open. */
export const MY_ROOMS_RETRY_MS = 30_000

type Listing = Pick<MyRooms, 'capabilities' | 'rooms' | 'offers'>
/** Emitted with a community's DID once the phone has left it (roomsLeave): every rooms list drops its rooms now. */
export const ROOMS_LEFT_EVENT = 'keyring.rooms.communityLeft'

// The last listing each screen read, by service and community, so that opening it again shows it at once while it
// is read again (in memory only; another service, another agent, starts with none). Forgotten when the wallet locks,
// as the service forgets the records it opened (agentRoomsService, dropOpenedRecords): room names and offers don't
// outlive a lock either. Nor a leave: a screen opened after it showed the left community's rooms until it read.
let remembered = new WeakMap<RoomsService, Map<string, Listing>>()
DeviceEventEmitter.addListener(WALLET_LOCKED_EVENT, () => {
  remembered = new WeakMap()
})
DeviceEventEmitter.addListener(ROOMS_LEFT_EVENT, () => {
  remembered = new WeakMap()
})
const rememberedOf = (service: RoomsService | undefined, communityDid?: string): Listing | undefined =>
  service ? remembered.get(service)?.get(communityDid ?? '') : undefined
const remember = (service: RoomsService, communityDid: string | undefined, listing: Listing) => {
  const byCommunity = remembered.get(service) ?? new Map<string, Listing>()
  byCommunity.set(communityDid ?? '', { ...rememberedOf(service, communityDid), ...listing })
  remembered.set(service, byCommunity)
}
/** Forget every listing remembered (the wallet locked; tests). */
export const forgetMyRooms = (): void => {
  remembered = new WeakMap()
}

export function useMyRooms(service: RoomsService | undefined, communityDid?: string): MyRooms {
  const [state, setState] = useState<Omit<MyRooms, 'reload' | 'reread' | 'offersNotShown'>>(() => ({
    ...rememberedOf(service, communityDid),
    failed: false,
    offersFailed: false,
    failures: 0,
    refreshing: false,
  }))
  const [generation, setGeneration] = useState(0)
  const reload = useCallback(() => {
    if (state.failed) service?.note?.(`[Rooms:list] the member asked to try the rooms again`)
    setState((s) => ({ ...s, refreshing: true }))
    setGeneration((g) => g + 1)
  }, [service, state.failed])
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
  // A community left: its rooms and offers go from the list at once, and the read after says what else changed.
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(ROOMS_LEFT_EVENT, (left: string) => {
      setState((s) => ({
        ...s,
        rooms: s.rooms?.filter((room) => room.communityDid !== left),
        offers: s.offers?.filter((offer) => offer.communityDid !== left),
      }))
      reread()
    })
    return () => sub.remove()
  }, [reread])

  useEffect(() => {
    if (!service) return
    let live = true
    const where = communityDid ? `rooms of ${logRef(communityDid)}` : 'rooms'
    const began = Date.now()
    void (async () => {
      try {
        const refresh = generation !== lastGeneration.current || agentKey !== lastAgent.current
        lastGeneration.current = generation
        lastAgent.current = agentKey
        const capabilities = await service.capabilities({ refresh })
        const listRooms = capabilities.listMyRooms.status === 'available'
        const listOffers = capabilities.listOffers.status === 'available'
        // The offers on their own: answered or not, they never hold the rooms back or fail them.
        const offersRead = listOffers ? service.listOffers(communityDid) : Promise.resolve([])
        offersRead.then(
          (offers) => {
            if (!live) return
            const mine = communityDid ? offers.filter((o) => o.communityDid === communityDid) : offers
            remember(service, communityDid, { offers: mine })
            setState((s) => ({ ...s, offers: mine, offersFailed: false }))
          },
          (e: unknown) => {
            service.note?.(
              `[Rooms:list] the offers for the ${where} were not read (${Date.now() - began} ms): ${failureCategory(e)}`
            )
            if (live) setState((s) => ({ ...s, offersFailed: true }))
          }
        )
        const rooms = listRooms ? await service.listMyRooms() : undefined
        if (!live) return
        const mine = communityDid ? rooms?.filter((r) => r.communityDid === communityDid) : rooms
        remember(service, communityDid, { capabilities, rooms: mine })
        setState((s) => ({
          ...s,
          capabilities,
          rooms: mine,
          failed: false,
          failure: undefined,
          failures: 0,
          refreshing: false,
        }))
      } catch (e) {
        const failure: OperationStatus | undefined =
          e instanceof RoomsUnavailable ? { status: 'unavailable', reason: e.reason, detail: e.message } : undefined
        service.note?.(`[Rooms:list] the ${where} were not read (${Date.now() - began} ms): ${failureCategory(e)}`)
        if (live) setState((s) => ({ ...s, failed: true, failure, failures: s.failures + 1, refreshing: false }))
      }
    })()
    return () => {
      live = false
    }
  }, [service, communityDid, generation, agentKey, rereads])

  // A failed read is tried once more while the screen is open, as Messages tries its rows again: the member need not
  // find Try again. Only after the first failure in a row; one that fails again waits for the member or a return.
  useEffect(() => {
    if (!service || !state.failed || state.failures !== 1) return
    const timer = setTimeout(() => {
      service.note?.(`[Rooms:list] trying the ${communityDid ? `rooms of ${logRef(communityDid)}` : 'rooms'} again`)
      // Said on the screen as the member's Try again is: "Trying again…", not a still failure.
      setState((s) => ({ ...s, refreshing: true }))
      reread()
    }, MY_ROOMS_RETRY_MS)
    return () => clearTimeout(timer)
  }, [service, communityDid, state.failed, state.failures, reread])

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
