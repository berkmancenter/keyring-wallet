/**
 * How many room offers wait for the member, for the Rooms card's badge on My Agent. Nothing pushes an offer to a
 * phone (rooms member sprint): it is pulled, only while the app is in the foreground, an agent is linked and the
 * rooms flag is on (a service exists). Any of those false, and nothing is asked: no call, and the count already read
 * stays.
 *
 * When it asks:
 * - at once when the badge appears, when the app comes back to the foreground and when My Agent comes into focus;
 * - then after {@link OFFERS_POLL_MS} while offers wait, {@link OFFERS_IDLE_POLL_MS} while none do, and
 *   {@link OFFERS_ERROR_POLL_MS} after a poll that failed;
 * - not at all on a trigger that comes within {@link OFFERS_REFRESH_FLOOR_MS} of the last ask, or while an ask is
 *   still out: what it read is fresh enough. A return to the foreground and a focus usually arrive together, and
 *   moving between screens refocuses My Agent each time.
 *
 * There is one timer at a time: every trigger goes through the same `refresh`, which replaces the pending timer.
 *
 * It runs from the tab navigator (useRoomNotices), from the start, so a new offer is said in a notice wherever the
 * member is, not only once My Agent has been opened. My Agent's badge reads its count ({@link useRoomOffersBadge}),
 * and its coming into focus asks again, as before.
 *
 * @module rooms/useRoomOffersCount
 */
import { useFocusEffect } from '@react-navigation/native'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { AppState } from 'react-native'

import type { RoomOffer, RoomsService } from './types'

/** One minute while offers wait: each poll is one signed request per community. */
export const OFFERS_POLL_MS = 60_000

/** Two minutes while none wait, which is most of the time for most members. */
export const OFFERS_IDLE_POLL_MS = 120_000

/** Five minutes after a poll that failed: the community or the agent is not answering. */
export const OFFERS_ERROR_POLL_MS = 300_000

/**
 * The shortest gap between two asks, however many triggers arrive. Per hook instance: a second instance would bring
 * its own floor and timer, and so twice the asks. Today the tab navigator's (useRoomNotices) is the only one.
 */
export const OFFERS_REFRESH_FLOOR_MS = 10_000

type Outcome = 'waiting' | 'none' | 'failed'

const NEXT: Record<Outcome, number> = {
  waiting: OFFERS_POLL_MS,
  none: OFFERS_IDLE_POLL_MS,
  failed: OFFERS_ERROR_POLL_MS,
}

// What the running poll last read, and how to ask it again, for the badge on My Agent and the offers card in
// Messages. In memory only; not named `*Store`, which tier.mjs reads, with a `.delete(`, as deleting stored records.
const badge: {
  count?: number
  offers?: readonly RoomOffer[]
  refresh?: () => void
  listeners: Set<() => void>
} = { listeners: new Set() }

function publish(offers: readonly RoomOffer[]) {
  badge.count = offers.length
  badge.offers = offers
  badge.listeners.forEach((listener) => listener())
}

const subscribeBadge = (listener: () => void) => {
  badge.listeners.add(listener)
  return () => void badge.listeners.delete(listener)
}

const NO_OFFERS: readonly RoomOffer[] = []

/** The offers the poll last read, for Messages' "Waiting for you" card: all, or one community's. */
export function useRoomOffersWaiting(communityDid?: string): readonly RoomOffer[] {
  const offers = useSyncExternalStore(subscribeBadge, () => badge.offers ?? NO_OFFERS)
  return useMemo(
    () => (communityDid ? offers.filter((o) => o.communityDid === communityDid) : offers),
    [offers, communityDid]
  )
}

/** My Agent's badge: the count the poll last read; coming into focus asks again (within the floor). */
export function useRoomOffersBadge(): number | undefined {
  const count = useSyncExternalStore(subscribeBadge, () => badge.count)
  useFocusEffect(
    useCallback(() => {
      badge.refresh?.()
    }, [])
  )
  return count
}

/**
 * Undefined until the first answer. A failed poll keeps the last count. `onOffers` hears every list read, for the
 * notice of a new one.
 */
export function useRoomOffersCount(
  service: RoomsService | undefined,
  linked: boolean,
  onOffers?: (offers: RoomOffer[]) => void
): number | undefined {
  const [count, setCount] = useState<number>()
  // Only the background stops it: 'inactive' (a passing system sheet) and iOS's 'unknown' at launch are still in use.
  const [active, setActive] = useState(AppState.currentState !== 'background')
  // Across effect runs, so a return to the foreground right after an ask, or an ask still out, is not doubled.
  const lastAsk = useRef(0)
  const asking = useRef(false)
  const refreshRef = useRef<(() => void) | undefined>(undefined)
  const onOffersRef = useRef(onOffers)
  onOffersRef.current = onOffers

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setActive(state !== 'background'))
    return () => subscription?.remove()
  }, [])

  useEffect(() => {
    if (!service || !linked || !active) return
    let live = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const schedule = (ms: number) => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => void poll(), ms)
    }
    const ask = async (): Promise<Outcome> => {
      try {
        const capabilities = await service.capabilities()
        if (capabilities.listOffers.status !== 'available') return 'none'
        const offers = await service.listOffers()
        if (live) {
          setCount(offers.length)
          publish(offers)
          onOffersRef.current?.(offers)
        }
        return offers.length > 0 ? 'waiting' : 'none'
      } catch {
        // The badge keeps what it last knew; the card says when the agent can't be reached.
        return 'failed'
      }
    }
    const poll = async () => {
      if (asking.current) return
      asking.current = true
      lastAsk.current = Date.now()
      const outcome = await ask()
      asking.current = false
      if (live) schedule(NEXT[outcome])
      // Stopped while it was out (the app went to the background and came back): the run now in charge starts its
      // own timer, which it could not while this ask was out.
      else refreshRef.current?.()
    }
    /** Ask now, unless an ask is out or the last one is under the floor old: then what it read is fresh enough. */
    const refresh = () => {
      if (asking.current) return
      const since = Date.now() - lastAsk.current
      if (since >= OFFERS_REFRESH_FLOOR_MS) void poll()
      // The run starting here has no timer yet, so it keeps one for when the floor has passed.
      else if (!timer) schedule(OFFERS_REFRESH_FLOOR_MS - since)
    }
    refreshRef.current = refresh
    badge.refresh = refresh
    // The badge appearing, an agent linked, the app back in the foreground: each starts here.
    refresh()
    return () => {
      live = false
      refreshRef.current = undefined
      if (badge.refresh === refresh) badge.refresh = undefined
      if (timer) clearTimeout(timer)
    }
  }, [service, linked, active])

  useFocusEffect(
    useCallback(() => {
      refreshRef.current?.()
    }, [])
  )

  return count
}
