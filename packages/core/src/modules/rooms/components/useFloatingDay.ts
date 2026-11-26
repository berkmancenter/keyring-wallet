/**
 * The room chat's floating day, as the person-to-person chat has (gifted-chat's `renderDay`): while the member scrolls,
 * the day of the topmost post in view is pinned at the top of the list, and it fades a moment after the scrolling
 * stops. The pills between days stay in the list; this one says which day the posts at the top of the screen are from
 * once their own pill has scrolled away, as "Today" did when a room opened on today's newest posts.
 *
 * @module rooms/components/useFloatingDay
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Animated, type ViewToken } from 'react-native'

/** How long the day stays after scrolling stops, before it fades. */
export const FLOATING_DAY_HOLD_MS = 1000
const FADE_MS = 250

/** The chat's list items as far as this reads them: a post with its time, or anything else. */
type DatedItem = { kind: string; post?: { at?: Date } }

/**
 * The day of the topmost dated post among those in view. The chat's list is drawn bottom up, so the topmost is the
 * one with the highest index. Day pills and posts with no time are passed over.
 */
export function topmostDay(viewable: ReadonlyArray<Pick<ViewToken, 'index' | 'item'>>): Date | undefined {
  let top: { index: number; at: Date } | undefined
  for (const { index, item } of viewable) {
    const at = (item as DatedItem | undefined)?.kind === 'post' ? (item as DatedItem).post?.at : undefined
    if (at && index !== null && (!top || index > top.index)) top = { index, at }
  }
  return top?.at
}

export interface FloatingDay {
  /** The day to float; undefined while nothing is scrolling (or nothing dated is in view). */
  day?: Date
  opacity: Animated.Value
  /** For the list: stable, as FlatList requires of both. */
  onViewableItemsChanged: (info: { viewableItems: ViewToken[] }) => void
  viewabilityConfig: { itemVisiblePercentThreshold: number }
  /** A drag or a fling started. */
  onScrollStart: () => void
  /** A drag or a fling ended: the day fades after a moment, unless scrolling starts again. */
  onScrollStop: () => void
}

export function useFloatingDay(): FloatingDay {
  const [day, setDay] = useState<Date>()
  const [scrolling, setScrolling] = useState(false)
  const opacity = useRef(new Animated.Value(0)).current
  const fade = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) =>
    setDay(topmostDay(viewableItems))
  ).current
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 50 }).current

  const onScrollStart = useCallback(() => {
    if (fade.current) clearTimeout(fade.current)
    fade.current = undefined
    opacity.stopAnimation()
    opacity.setValue(1)
    setScrolling(true)
  }, [opacity])

  const onScrollStop = useCallback(() => {
    if (fade.current) clearTimeout(fade.current)
    fade.current = setTimeout(() => {
      fade.current = undefined
      Animated.timing(opacity, { toValue: 0, duration: FADE_MS, useNativeDriver: true }).start(({ finished }) => {
        if (finished) setScrolling(false)
      })
    }, FLOATING_DAY_HOLD_MS)
  }, [opacity])

  useEffect(
    () => () => {
      if (fade.current) clearTimeout(fade.current)
    },
    []
  )

  return {
    day: scrolling ? day : undefined,
    opacity,
    onViewableItemsChanged,
    viewabilityConfig,
    onScrollStart,
    onScrollStop,
  }
}
