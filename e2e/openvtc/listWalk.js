// Walking a TUI list to the row a step needs, with no fixed number of key
// presses. The lists the harness walks grow with every run (the vetting desk,
// the tickets, the personas): on 2026-09-25 a walk of six Downs stopped one
// short of an eighth desk row, twice. A walk here ends when the wanted row is
// selected, or when the selection wraps round or stops moving, so it covers
// any length.

/** The selected row: the first line carrying the ▸ marker, trimmed. */
export function selectedLine(screen) {
  return screen.split('\n').find((l) => l.includes('▸'))?.trim();
}

/** Whether the row carrying the ▸ cursor names `text` (a ticket code, say). */
export function rowSelected(screen, text) {
  return screen.split('\n').some((l) => l.includes('▸') && l.includes(text));
}

/**
 * Press each of `keys` in turn (default Down, then Up) until `isWanted(screen)`.
 * Each key is pressed until the selection comes back to a row already seen
 * (the list wrapped) or does not move (its end), then the next key is tried.
 * `state(screen)` names the current position (default: the selected line).
 * `max` bounds a list that never repeats a position (a ticking screen), far
 * above any real list. True once wanted.
 * `reveal` ({ Down: 'PageDown', Up: 'PageUp' }) is for a list whose pane scrolls
 * apart from its cursor (openvtc's content panel: the ▸ moves, the view does not
 * follow). When a key takes the ▸ off screen, the pane is paged after it until
 * the ▸ shows again. Without it, a cursor below the fold reads as "no position"
 * twice running and the walk ends there (1012-2223 rerun: ticket 28 of 28 was
 * never reached).
 */
export async function walkTo(tui, isWanted, { keys = ['Down', 'Up'], pace = 400, state = selectedLine, max = 500, reveal } = {}) {
  if (isWanted(tui.screen())) return true;
  for (const key of keys) {
    const seen = new Set([state(tui.screen())]);
    for (let i = 0; i < max; i++) {
      await tui.pressEach([key], pace);
      if (reveal?.[key]) await revealCursor(tui, reveal[key], pace);
      const screen = tui.screen();
      if (isWanted(screen)) return true;
      const at = state(screen);
      if (seen.has(at)) break;
      seen.add(at);
    }
  }
  return isWanted(tui.screen());
}

/**
 * The content pane's lines, for "did the page move?": openvtc's content panel rows carry ║, while the Activity Log
 * below it ticks a clock, so a whole-screen comparison would never see a stop. Falls back to the whole screen.
 */
function paneOf(screen) {
  const lines = screen.split('\n').filter((l) => l.includes('║'));
  return lines.length ? lines.join('\n') : screen;
}

const OTHER_WAY = { PageDown: 'PageUp', PageUp: 'PageDown' };

/**
 * Page the pane with `pageKey` until the ▸ cursor is on screen again, or the pane stops moving (its end); if it
 * ends without the ▸ (a page longer than the cursor's step, or the cursor above the view), page the other way the
 * same. At most `maxPages` presses each way.
 */
export async function revealCursor(tui, pageKey, pace = 400, maxPages = 50) {
  for (const key of [pageKey, OTHER_WAY[pageKey]].filter(Boolean)) {
    for (let i = 0; i < maxPages && !selectedLine(tui.screen()); i++) {
      const before = paneOf(tui.screen());
      await tui.pressEach([key], pace);
      if (paneOf(tui.screen()) === before) break;
    }
    if (selectedLine(tui.screen())) return;
  }
}
