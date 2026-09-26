// The one-filled-button rule itself, with no device: which buttons are judged,
// and what share of a button's pixels counts as filled. filledButtons.js feeds
// it from a live screen; scripts/replay-filled.mjs feeds it from a saved
// screenshot and page source, which is how a change to the rule is re-proved
// against the known-bad evidence without the build that produced it.
//
// THE RULE, from the Keyring theme's button variants (app/src/keyring-theme/
// theme.ts, Buttons): only two variants are filled — Primary (brand purple
// #622C62; disabled, the same at 70% over the page, luminance ≈ 0.45) and
// Critical (red #D8292F, ≈ 0.31). Secondary is outlined (a 2 pt border on the
// page), Tertiary is text. There is no grey-filled variant: a grey fill is a
// one-off style override, and it is itself the defect the one-primary change
// removed (e.g. Withdraw, "Clear finished requests"). So "filled" here means
// "more than 40% of the button is darker than luminance 0.6" — true of both
// filled variants in every state, of any off-design fill, and of no outlined
// or text button (0.08 measured on an outlined one).

/** A button more than this much dark fill is drawn filled. */
export const FILLED_SHARE = 0.4;

/**
 * Share of a BMP's pixels (or of `rect` within it, in pixels) that are a
 * button's fill: any dark pixel, of any hue — a grey-filled button is as
 * filled as a purple one. (A first version counted only saturated pixels and
 * read a grey-filled "Clear finished requests" as outlined, passing a screen
 * with two filled buttons: found by running it on a known-bad build before
 * trusting it.)
 */
export function fillShareOfBmp(buf, rect) {
  const offset = buf.readUInt32LE(10);
  const width = buf.readInt32LE(18);
  const rawHeight = buf.readInt32LE(22);
  const height = Math.abs(rawHeight);
  // A positive height stores the rows bottom-up.
  const bottomUp = rawHeight > 0;
  const bpp = buf.readUInt16LE(28);
  if (bpp !== 24 && bpp !== 32) throw new Error(`BMP with ${bpp} bits per pixel`);
  const step = bpp / 8;
  const rowBytes = Math.ceil((width * bpp) / 32) * 4;
  const x0 = Math.max(0, Math.round(rect?.x ?? 0));
  const y0 = Math.max(0, Math.round(rect?.y ?? 0));
  const x1 = Math.min(width, Math.round(rect ? rect.x + rect.width : width));
  const y1 = Math.min(height, Math.round(rect ? rect.y + rect.height : height));
  let fill = 0;
  let total = 0;
  for (let y = y0; y < y1; y += 2) {
    const row = bottomUp ? height - 1 - y : y;
    for (let x = x0; x < x1; x += 2) {
      const i = offset + row * rowBytes + x * step;
      const b = buf[i] / 255;
      const g = buf[i + 1] / 255;
      const r = buf[i + 2] / 255;
      const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (luminance < 0.6) fill++;
      total++;
    }
  }
  return total ? fill / total : 0;
}

/**
 * Which buttons are judged, and how. `buttons` are {id, x, y, width, height}
 * in screen points; `tabTop` is where the tab bar starts (or the window's
 * height when there is none); `shareOf(button)` measures one button.
 *
 * - Rows and icons are not a step's buttons: a button is wide and short.
 * - A button only partly on screen is judged by whatever covers the rest of
 *   it: a card cut off by the tab bar read as filled from the bar's black
 *   (225 gate, "I want to join" under the fold). Only buttons drawn whole
 *   between the top of the window and the top of the tab bar are judged.
 *   A step whose button is below the fold therefore shows none filled, and
 *   fails the check — which is right: the step's action is not on screen.
 */
export async function judgeButtons(buttons, tabTop, shareOf) {
  const seen = new Map();
  for (const b of buttons) {
    if (!b.id || seen.has(b.id)) continue;
    if (b.width < 120 || b.height < 30 || b.height > 200) continue;
    if (b.y < 0 || b.y + b.height > tabTop) continue;
    seen.set(b.id, await shareOf(b));
  }
  return [...seen.entries()].map(([id, share]) => ({ id, filled: share > FILLED_SHARE, share: Number(share.toFixed(3)) }));
}
