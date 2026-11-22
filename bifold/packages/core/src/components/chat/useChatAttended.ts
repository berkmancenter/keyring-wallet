import { useIsFocused } from '@react-navigation/native'
import { useEffect, useState } from 'react'
import { AppState } from 'react-native'

// The app states in which nobody is looking at it. Any other, including 'unknown' before the first report, is
// taken as in use: an app starts in the foreground.
const AWAY = new Set<unknown>(['background', 'inactive', 'extension'])
const inUse = (state: unknown) => !AWAY.has(state)

/**
 * Whether the person is looking at this chat: its screen is the focused one and the app is in the foreground.
 *
 * A chat screen stays mounted under a screen pushed over it, and while the app is in the background, and messages
 * keep arriving there. So being mounted is not being seen. Marking a chat's messages seen (the unread counts) and
 * reporting a received message's first display (a disappearing message's clock, rich-messaging-plan.md §4.6, D4)
 * both wait for this one answer, so the two cannot disagree.
 */
export function useChatAttended(): boolean {
  const focused = useIsFocused()
  const [active, setActive] = useState(() => inUse(AppState.currentState))
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => setActive(inUse(next)))
    // A change between the first render and this subscription would otherwise be missed.
    setActive(inUse(AppState.currentState))
    return () => subscription.remove()
  }, [])
  return focused && active
}
