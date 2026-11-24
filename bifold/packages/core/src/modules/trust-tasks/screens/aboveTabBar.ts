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
 * Spare room at the foot of a scrolling page. The tab bar does not draw over a
 * page: the page's frame ends where the tabs start, so a page's last line can
 * always scroll into view, and a bar pinned under a scroll needs no clearance.
 * Measured from UI dumps of built apps: on iOS at 402x874 the Vetting frame
 * ends at 785 and the tabs start at 785 (2026-11-04); on Android at 1080x2400 a
 * room's frame ends at 2193 and the tabs start at 2193 (2026-10-29). A child of
 * a scroll can report a frame past that line: that is content, not an overlay.
 *
 * The padding came from one screenshot (gate 235, iOS: "Your identity in this
 * community" sat at the tabs), read then as an overlay. The 90 pt above is a
 * height, for a toast placed at the root, and says nothing about a page.
 *
 * Whether a page still needs this room is unmeasured, so it stays. Taking it out
 * is a layout change on every screen that uses it: it needs renders of those
 * screens, not this comment.
 */
export function useRoomAboveTabBar(): number {
  return useSafeAreaInsets().bottom + TAB_BAR_CLEARANCE
}
