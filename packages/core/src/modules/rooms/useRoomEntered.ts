/**
 * Tells the rooms service when the person navigates to a room's screen: at its first showing, and each time they come
 * back to it from another screen.
 *
 * A room marked unread on another of the person's devices is held unread on this phone until then
 * (`real/readMarkers.ts`). Navigation focus alone decides, never the app's own state: a screen left open on the room
 * while the app was in the background is "in view" again the moment the phone is picked up
 * ({@link useInViewAndActive}), and that is exactly when a room the person just marked unread on their laptop must not
 * be counted as seen.
 *
 * @module rooms/useRoomEntered
 */
import { useIsFocused } from '@react-navigation/native'
import { useEffect, useRef } from 'react'

import type { RoomsService } from './types'

export function useRoomEntered(service: RoomsService | undefined, roomId: string): void {
  const focused = useIsFocused()
  // Read at the moment of entering: a service that changes under an open screen is not the person coming back to it.
  const serviceNow = useRef(service)
  serviceNow.current = service
  // A service that was not there yet when the screen first showed is told once it is; one that replaces another is not.
  const linked = service !== undefined
  useEffect(() => {
    if (focused && linked) serviceNow.current?.roomEntered?.(roomId)
  }, [focused, linked, roomId])
}
