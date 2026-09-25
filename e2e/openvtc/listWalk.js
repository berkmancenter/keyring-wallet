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

/**
 * Press each of `keys` in turn (default Down, then Up) until `isWanted(screen)`.
 * Each key is pressed until the selection comes back to a row already seen
 * (the list wrapped) or does not move (its end), then the next key is tried.
 * `state(screen)` names the current position (default: the selected line).
 * `max` bounds a list that never repeats a position (a ticking screen), far
 * above any real list. True once wanted.
 */
export async function walkTo(tui, isWanted, { keys = ['Down', 'Up'], pace = 400, state = selectedLine, max = 500 } = {}) {
  if (isWanted(tui.screen())) return true;
  for (const key of keys) {
    const seen = new Set([state(tui.screen())]);
    for (let i = 0; i < max; i++) {
      await tui.pressEach([key], pace);
      const screen = tui.screen();
      if (isWanted(screen)) return true;
      const at = state(screen);
      if (seen.has(at)) break;
      seen.add(at);
    }
  }
  return isWanted(tui.screen());
}
