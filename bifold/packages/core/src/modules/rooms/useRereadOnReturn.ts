/**
 * When a screen that lists rooms reads them again: on coming back into view (an offer accepted or hidden, a room
 * left), and, after a read that failed, on the app coming back to the foreground while the screen is in view. The
 * first focus is the mount's own read. Without the second, a read that failed while the agent was unreachable kept
 * its failure on My Agent until the screen was left and opened again (a tester's run, 10-29).
 *
 * Two more, quietly and only in view, since nothing else would come:
 * - After a read that failed, it reads after each of {@link REREAD_RETRY_MS} with the app open, then waits for the
 *   moments above. A read made while the agent reconnects after a lock fails seconds before it is back, and the card
 *   then said so, and couldn't be tapped, for as long as the member stayed on the screen (a run on 277, 3 min 50 s).
 * - When the offers poll reads an offer this list doesn't show, it reads once for those offers: a list open when an
 *   offer arrives is otherwise behind the badge and the notice. A read that still doesn't show them doesn't ask again.
 *   A read whose offers FAILED is not such a read: it said nothing about them. It is made once more, after
 *   {@link OFFERS_REREAD_RETRY_MS}. Nothing else would: the retries above follow the rooms, which list on their own
 *   and may have answered, and the offers still unshown are the same ones, so nothing here would change to ask again.
 *   The offer then stayed off the open list until the screen was left and opened again (IN-704-7).
 *
 * A screen under the one in view does neither: coming back into view reads anyway.
 *
 * @module rooms/useRereadOnReturn
 */
import { useIsFocused } from '@react-navigation/native'
import { useEffect, useRef } from 'react'
import { AppState } from 'react-native'

import type { MyRooms } from './useMyRooms'

/** After a read that failed: read again after each of these in turn, then wait as usual. As the rows' retries. */
export const REREAD_RETRY_MS = [15_000, 30_000, 60_000] as const

/** How long after the offers of that one read failed they are read once more. As the first of {@link REREAD_RETRY_MS}. */
export const OFFERS_REREAD_RETRY_MS = 15_000

export function useRereadOnReturn({
  reload,
  reread,
  failed,
  failures,
  offersNotShown,
  offersFailed,
}: Pick<MyRooms, 'reload' | 'reread' | 'failed' | 'failures' | 'offersNotShown' | 'offersFailed'>): void {
  const focused = useIsFocused()
  const wasFocused = useRef(focused)
  useEffect(() => {
    if (focused && !wasFocused.current) reload()
    wasFocused.current = focused
  }, [focused, reload])

  // Read when the app comes back, so the listener is not re-added on every read.
  const failedNow = useRef(failed)
  failedNow.current = failed
  useEffect(() => {
    let was = AppState.currentState
    const subscription = AppState.addEventListener('change', (next) => {
      if (was !== 'active' && next === 'active' && failedNow.current && wasFocused.current) reload()
      was = next
    })
    return () => subscription.remove()
  }, [reload])

  useEffect(() => {
    const delay = failures > 0 ? REREAD_RETRY_MS[failures - 1] : undefined
    if (delay === undefined || !focused) return
    // Away, it waits for the app to come back, which reads after a failure.
    const timer = setTimeout(() => {
      if (AppState.currentState === 'active') reread()
    }, delay)
    return () => clearTimeout(timer)
  }, [failures, focused, reread])

  // Read once for these offers, not whenever they stay unshown. Coming back into view reads anyway.
  useEffect(() => {
    if (offersNotShown && wasFocused.current) reread()
  }, [offersNotShown, reread])

  // The offers of that read failed: once more for the same offers, in view and with the app open, and no third time.
  const retriedFor = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!offersFailed || !offersNotShown || !focused || retriedFor.current === offersNotShown) return
    const timer = setTimeout(() => {
      if (AppState.currentState !== 'active') return
      retriedFor.current = offersNotShown
      reread()
    }, OFFERS_REREAD_RETRY_MS)
    return () => clearTimeout(timer)
  }, [offersFailed, offersNotShown, focused, reread])
}
