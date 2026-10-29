/**
 * When a screen that lists rooms reads them again: on coming back into view (an offer accepted or hidden, a room
 * left), and, after a read that failed, on the app coming back to the foreground while the screen is in view. The
 * first focus is the mount's own read. Without the second, a read that failed while the agent was unreachable kept
 * its failure on My Agent until the screen was left and opened again (a tester's run, 10-29).
 *
 * @module rooms/useRereadOnReturn
 */
import { useIsFocused } from '@react-navigation/native'
import { useEffect, useRef } from 'react'
import { AppState } from 'react-native'

import type { MyRooms } from './useMyRooms'

export function useRereadOnReturn({ reload, failed }: Pick<MyRooms, 'reload' | 'failed'>): void {
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
}
