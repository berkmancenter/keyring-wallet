/**
 * The switch for state-verified approvers (trusted-approver plan, stage 2, S1): an approver's Guardian credential,
 * issued by a state, checked on the phone of the person they approve for. Off unless the app turns it on from its
 * developer settings at start-up, like setTrustedApproversEnabled (trustedApproversFlag.ts).
 *
 * A release turns it off for everyone with {@link STATE_VERIFIED_APPROVERS_REMOTE_OFF}, or every SEDI/KERI feature at
 * once with SEDI_KERI_REMOTE_OFF; either beats a saved "on". Neither turns it on.
 *
 * @module trust-tasks/module/stateVerifiedApproversFlag
 */
import { SEDI_KERI_REMOTE_OFF } from './sediKeriRemoteOff'

/** Set to true in a release to turn state-verified approvers off for everyone, whatever was saved. */
export const STATE_VERIFIED_APPROVERS_REMOTE_OFF: { off: boolean } = { off: false }

let stateVerifiedApproversEnabled = false

/** Turn state-verified approvers on or off (developer setting). */
export function setStateVerifiedApproversEnabled(enabled: boolean): void {
  stateVerifiedApproversEnabled = enabled
}

/** Switched on, and turned off neither for this feature nor for SEDI/KERI as a whole. */
export function isStateVerifiedApproversEnabled(): boolean {
  return stateVerifiedApproversEnabled && !STATE_VERIFIED_APPROVERS_REMOTE_OFF.off && !SEDI_KERI_REMOTE_OFF.off
}
