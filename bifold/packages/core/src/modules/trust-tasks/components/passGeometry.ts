/**
 * Where a pass sits in the Wallet, stacked and open, so a pass opened in place lifts from exactly where it was to
 * exactly where it lands. The stack (PassStack) and the open card (CommunityPassDetails) lay themselves out from
 * these, and the lift is measured between them.
 *
 * @module trust-tasks/components/passGeometry
 */
import { PASS_STRIP } from './CommunityPass'

/** The Wallet list's side margin, so a pass is as wide as the cards around it. */
export const PASS_MARGIN = 15
/** The stack's distance from the top of the Wallet list. */
export const STACK_TOP = 15
/** The open card's padding above the "All cards" row. */
export const OPEN_PAGE_TOP = 16
/** The "All cards" row above an open pass: a full touch target. */
export const CLOSE_ROW_HEIGHT = 44
/** The gap between the open card's parts. */
export const OPEN_GAP = 14
/** The open pass's distance from the top of the Wallet list. */
export const OPEN_PASS_TOP = OPEN_PAGE_TOP + CLOSE_ROW_HEIGHT + OPEN_GAP

/**
 * How far below its open place a pass starts its lift: where it sat in the stack (a strip for each pass behind it,
 * `index` counting from the back), less how far the Wallet had scrolled. Negative when it sat above (it moves down).
 */
export function liftFrom(index: number, scrollY: number): number {
  return STACK_TOP + index * PASS_STRIP - scrollY - OPEN_PASS_TOP
}
