/**
 * Which side of the SEDI demo this phone took: the guardian (holds the card) or the ward (the person the card names),
 * or none. Set by "Set up as the guardian" / "Set up as the ward" and cleared by "Turn off the SEDI demo"
 * (developerTestState). The codes for a state office show only this side's code; with none set, both.
 *
 * In memory only, and NOT saved here: after a restart it is none (both codes show, as before) until the app sets it
 * again. The app must keep the side as a setting of its own and call setSediDemoSide at start-up: it cannot be
 * worked out from the other switches (the two sides differ only in the state card, which is also off on a phone that
 * took no side).
 *
 * @module trust-tasks/module/sediDemoSide
 */
export type SediDemoSide = 'guardian' | 'ward'

let side: SediDemoSide | null = null

/** Set this phone's demo side (null: none). */
export function setSediDemoSide(next: SediDemoSide | null): void {
  side = next
}

/** This phone's demo side, or null when none is set. */
export function sediDemoSide(): SediDemoSide | null {
  return side
}
