/**
 * The openvtc vetting desk's three views, and moving between them by what the
 * TUI says is selected.
 *
 * The desk draws its views as one line, "Requests (n)  Tickets (n)  Issued (n)
 * ←/→", and marks the selected one only by style: bold, in the accent colour
 * (openvtc `ui/pages/main/components/vetting_panel.rs` `desk_views`, ed13d29).
 * `deskView` used to recognise a view by what its rows said. On a desk that
 * had kept earlier runs' requests, none of the visible Requests rows said one
 * of the words it looked for, so it pressed → past Requests and stopped on
 * Tickets (P1-final3-android, 2026-09-26 16:22Z). Reading the selection does
 * not depend on the rows.
 */

/** In the order the TUI draws them, which is the order ←/→ walks. */
export const DESK_VIEWS = ['Requests', 'Tickets', 'Issued'];

/**
 * Move the desk to `view`: read the selected view, press ← or → toward the
 * wanted one, read again. `tui.deskSelection()` returns the selected view's
 * label, or undefined when it cannot tell (no desk on screen, or no single
 * view drawn differently).
 *
 * Returns true once `view` is selected, false when the selection cannot be
 * read or does not reach `view`, so the caller can fall back.
 * @param {{ deskSelection(): string | undefined, pressEach(keys: string[], gapMs?: number): Promise<unknown> }} tui
 * @param {string} view
 */
export async function moveDeskTo(tui, view, { gapMs = 700, maxSteps = 4 } = {}) {
  const target = DESK_VIEWS.indexOf(view);
  if (target < 0) throw new Error(`deskTabs: no desk view called ${view}`);
  for (let step = 0; step <= maxSteps; step++) {
    const current = DESK_VIEWS.indexOf(tui.deskSelection() ?? '');
    if (current === target) return true;
    if (current < 0) return false;
    await tui.pressEach([target > current ? 'Right' : 'Left'], gapMs);
  }
  return DESK_VIEWS.indexOf(tui.deskSelection() ?? '') === target;
}

/**
 * Of the desk's views as drawn, the one styled apart: the single bold one, or
 * else the single one in a colour none of the others has.
 * @param {{ label: string, bold: boolean, colour: string }[]} tabs
 */
export function selectedTab(tabs) {
  const bold = tabs.filter((t) => t.bold);
  if (bold.length === 1) return bold[0].label;
  const counts = new Map();
  for (const t of tabs) counts.set(t.colour, (counts.get(t.colour) ?? 0) + 1);
  const odd = tabs.filter((t) => counts.get(t.colour) === 1);
  return odd.length === 1 ? odd[0].label : undefined;
}
