/**
 * How many room offers wait for the member, for the Rooms card's badge. Nothing pushes an offer to a phone
 * (rooms member sprint): it is pulled, every {@link OFFERS_POLL_MS} while the app is in the foreground, an agent is
 * linked and the rooms flag is on (a service exists). Any of those false, and nothing is asked: no call, and the
 * count already read stays.
 *
 * @module rooms/useRoomOffersCount
 */
import { useEffect, useState } from 'react'
import { AppState } from 'react-native'

import type { RoomsService } from './types'

/** One minute: offers change rarely, and each poll is one signed request per community. */
export const OFFERS_POLL_MS = 60_000

/** Undefined until the first answer. A failed poll keeps the last count. */
export function useRoomOffersCount(service: RoomsService | undefined, linked: boolean): number | undefined {
  const [count, setCount] = useState<number>()
  // Only the background stops it: 'inactive' (a passing system sheet) and iOS's 'unknown' at launch are still in use.
  const [active, setActive] = useState(AppState.currentState !== 'background')

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setActive(state !== 'background'))
    return () => subscription?.remove()
  }, [])

  useEffect(() => {
    if (!service || !linked || !active) return
    let live = true
    const poll = async () => {
      try {
        const capabilities = await service.capabilities()
        if (capabilities.listOffers.status !== 'available') return
        const offers = await service.listOffers()
        if (live) setCount(offers.length)
      } catch {
        // The badge keeps what it last knew; the card says when the agent can't be reached.
      }
    }
    void poll()
    const timer = setInterval(() => void poll(), OFFERS_POLL_MS)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [service, linked, active])

  return count
}
