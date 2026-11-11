/**
 * The switch for "Confirm it's you" (confirmItsYou.ts): asking a contact to confirm, with their phone's lock, that a
 * call or message in their name is really them. Off unless the app turns it on from its developer settings at
 * start-up, like setTrustedApproversEnabled (trustedApproversFlag.ts). With it off, nothing is offered on a contact's
 * page, no request is sent, and one that arrives is dropped unread (and logged).
 *
 * A release turns it off for everyone with {@link CONFIRM_ITS_YOU_REMOTE_OFF}, or every SEDI/KERI feature at once with
 * SEDI_KERI_REMOTE_OFF; either beats a saved "on". Neither turns it on.
 *
 * @module trust-tasks/module/confirmItsYouFlag
 */
import { SEDI_KERI_REMOTE_OFF } from './sediKeriRemoteOff'

/** Set to true in a release to turn "Confirm it's you" off for everyone, whatever was saved. */
export const CONFIRM_ITS_YOU_REMOTE_OFF: { off: boolean } = { off: false }

let confirmItsYouEnabled = false

/** Turn "Confirm it's you" on or off (developer setting). */
export function setConfirmItsYouEnabled(enabled: boolean): void {
  confirmItsYouEnabled = enabled
}

/** Switched on, and turned off neither for this feature nor for SEDI/KERI as a whole. */
export function isConfirmItsYouEnabled(): boolean {
  return confirmItsYouEnabled && !CONFIRM_ITS_YOU_REMOTE_OFF.off && !SEDI_KERI_REMOTE_OFF.off
}
