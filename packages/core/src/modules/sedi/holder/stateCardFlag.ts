/**
 * The Developer switch "State card (demo)": the person holding a state Guardian card sees it in Credentials (SEDI/KERI
 * holder card). Off unless the app turns it on from its developer settings at start-up, like
 * setStateVerifiedApproversEnabled (trust-tasks/module/stateVerifiedApproversFlag.ts).
 *
 * A release turns it off for everyone with {@link STATE_CARD_REMOTE_OFF}, or every SEDI/KERI feature at once with
 * SEDI_KERI_REMOTE_OFF; either beats a saved "on". Neither turns it on.
 *
 * It does not need trusted approvers or state-verified approvers: showing a card this phone holds needs neither. The
 * card's check does (verifyGuardian refuses while state-verified approvers is off, and a tester build trusts no root
 * without "Trust the test state (K0)"), so with those off the card says it can't be checked yet (./stateCard.ts).
 *
 * @module sedi/holder/stateCardFlag
 */
import { SEDI_KERI_REMOTE_OFF } from '../../trust-tasks/module/sediKeriRemoteOff'

/** Set to true in a release to turn the state card off for everyone, whatever was saved. */
export const STATE_CARD_REMOTE_OFF: { off: boolean } = { off: false }

let stateCardEnabled = false

/** Turn "State card (demo)" on or off (developer setting). */
export function setStateCardEnabled(enabled: boolean): void {
  stateCardEnabled = enabled
}

/** Switched on, and turned off neither for this feature nor for SEDI/KERI as a whole (each read at the call). */
export function isStateCardEnabled(): boolean {
  return stateCardEnabled && !STATE_CARD_REMOTE_OFF.off && !SEDI_KERI_REMOTE_OFF.off
}
