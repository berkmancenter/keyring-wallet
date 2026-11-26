/**
 * Whether the screen is in view and the app is in the foreground: the only time a room's posts are refreshed on
 * their own (see `useRoomPosts`). False while another screen is on top, and while the app is in the background or
 * inactive (a call, the app switcher).
 *
 * @module rooms/useInViewAndActive
 */
import { useIsFocused } from '@react-navigation/native'
import { useEffect, useState } from 'react'
import { AppState } from 'react-native'

export function useInViewAndActive(): boolean {
  const focused = useIsFocused()
  // 'unknown' is iOS at launch, before the first change: the app is starting in the foreground.
  const [active, setActive] = useState(AppState.currentState !== 'background' && AppState.currentState !== 'inactive')
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => setActive(next === 'active'))
    return () => subscription.remove()
  }, [])
  return focused && active
}
