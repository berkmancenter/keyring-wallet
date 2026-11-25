/**
 * The switch for trusted approvers (docs/plans/trusted-approver-plan.md):
 * another person's phone approving sensitive actions on this person's agent.
 * Off unless the app turns it on from its developer settings at start-up, like
 * `setSharedConnectEnabled` (sharedConnectFlag.ts). With it off, no offer is
 * sent, an offer that arrives is dropped unread, and an answer that arrives
 * changes nothing.
 *
 * A release turns it off for everyone with {@link TRUSTED_APPROVERS_REMOTE_OFF},
 * whatever was saved, so a switch once flipped on can always be turned off
 * again; it never turns it on.
 *
 * SEDI_KERI_REMOTE_OFF (sediKeriRemoteOff.ts) turns it off too, with every other SEDI/KERI feature.
 *
 * @module trust-tasks/module/trustedApproversFlag
 */
import { SEDI_KERI_REMOTE_OFF } from './sediKeriRemoteOff'

/** Set to true in a release to turn trusted approvers off for everyone, whatever was saved. */
export const TRUSTED_APPROVERS_REMOTE_OFF: { off: boolean } = { off: false }

let trustedApproversEnabled = false

/** Turn trusted approvers on or off (developer setting). */
export function setTrustedApproversEnabled(enabled: boolean): void {
  trustedApproversEnabled = enabled
}

/** Switched on, and turned off neither for this feature nor for SEDI/KERI as a whole. */
export function isTrustedApproversEnabled(): boolean {
  return trustedApproversEnabled && !TRUSTED_APPROVERS_REMOTE_OFF.off && !SEDI_KERI_REMOTE_OFF.off
}
