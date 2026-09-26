/**
 * How the segments of "Your agent" are laid out: side by side, or stacked.
 *
 * Side by side, each label stays on one line and shrinks to fit its pill, down
 * to {@link SEGMENT_MIN_SCALE}. A label that would wrap made its pill twice as
 * tall as the others, and the selected one is the most visible thing on the
 * screen: "Communitie / s" (IN-37, 225 on a 6.1" iPhone). Where one line
 * would need a smaller scale than that — a narrow phone, or a large
 * accessibility text size — the segments stack, full width, one per line, so
 * the text keeps the size the person chose.
 *
 * The width of a label is estimated, not measured: a first layout that wraps
 * and then re-flows is the flicker this avoids. The estimate errs wide.
 *
 * @module trust-tasks/screens/segmentLayout
 */

/** Below this, shrunk text in a pill is harder to read than a stacked list. */
export const SEGMENT_MIN_SCALE = 0.7

/** Average advance of a bold glyph, as a share of the font size (errs wide). */
const BOLD_CHAR_WIDTH = 0.62

export interface SegmentLayoutInput {
  /** Window width, pt. */
  width: number
  /** The person's text size (PixelRatio / useWindowDimensions fontScale). */
  fontScale: number
  /** The labels as shown, in the person's language. */
  labels: string[]
  /** The label's font size at a text size of 1, pt. */
  fontSize: number
  /** Everything across the row that is not a pill: page padding, row padding, gaps. */
  chrome: number
  /** A pill's own horizontal padding, both sides, pt. */
  pillPadding: number
}

export type SegmentLayout = 'row' | 'stacked'

/** The width a label needs on one line, pt. */
export const labelWidth = (label: string, fontSize: number, fontScale: number): number =>
  label.length * fontSize * fontScale * BOLD_CHAR_WIDTH

export function segmentLayout(input: SegmentLayoutInput): SegmentLayout {
  const { width, fontScale, labels, fontSize, chrome, pillPadding } = input
  const pill = (width - chrome) / labels.length - pillPadding
  const widest = Math.max(...labels.map((l) => labelWidth(l, fontSize, fontScale)))
  return widest * SEGMENT_MIN_SCALE <= pill ? 'row' : 'stacked'
}
