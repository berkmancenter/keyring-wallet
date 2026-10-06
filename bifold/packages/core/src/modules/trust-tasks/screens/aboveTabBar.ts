/**
 * Where a bottom toast sits so it clears the tab bar. The toast library's own
 * offset (40) put the membership notice on the tab bar for its 8 seconds: on
 * an iPhone 17 the bar is about 90 pt tall, on a Pixel 6 about 78 dp
 * (measured on the built app, 2026-10-03). The bar is the safe area's bottom
 * plus its own height, so the offset is that plus room for the bar.
 *
 * @module trust-tasks/screens/aboveTabBar
 */
import { useSafeAreaInsets } from 'react-native-safe-area-context'

/** The tab bar's own height and a little air, above the safe area. */
export const TAB_BAR_CLEARANCE = 96

/** The bottom offset for a toast shown over the tabs. */
export function useToastAboveTabBar(): number {
  return useSafeAreaInsets().bottom + TAB_BAR_CLEARANCE
}

/**
 * Room at the foot of a scrolling page so its last line can scroll clear of
 * the tab bar, which draws over the page (gate 235 persona shots, iOS: the
 * applicant's "Your identity in this community" sat under the tabs).
 */
export function useRoomAboveTabBar(): number {
  return useSafeAreaInsets().bottom + TAB_BAR_CLEARANCE
}
