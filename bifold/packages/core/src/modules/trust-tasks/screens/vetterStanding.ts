/**
 * What a vetter's standing means on the desk, as words rather than a state.
 *
 * Kept apart from the screen so the choice can be tested on its own, because
 * the distinctions are the point: revoked and expired lead to the same request
 * of an admin but are not the same thing to read, and "none" is not a fault at
 * all — a phone with no grant here is an applicant, not a broken vetter.
 *
 * Nothing here promises that anything will work afterwards. A re-granted
 * vetter's new grant may never have been delivered (a separate defect), so the
 * app says what is wrong and what to ask for, and stops.
 *
 * @module trust-tasks/screens/vetterStanding
 */

import type { VetterGrantState } from '../module/vtiGrantState'

export interface VetterStandingLine {
  /** The sentence to show. */
  line: string
  /** Whether to add "ask an admin to grant it again" — pointless before it starts. */
  ask: boolean
}

export function vetterStandingLine(standing: VetterGrantState): VetterStandingLine | undefined {
  switch (standing.state) {
    case 'revoked':
      return { line: 'Vetting.StandingRevoked', ask: true }
    case 'expired':
      return { line: 'Vetting.StandingExpired', ask: true }
    case 'notYetValid':
      return { line: 'Vetting.StandingNotYet', ask: false }
    // Working, or not a vetter here at all: the desk says nothing either way.
    default:
      return undefined
  }
}
