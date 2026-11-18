/**
 * The switch for "Confirm it's you" (confirmItsYou.ts): asking a contact to confirm, with their phone's lock, that a
 * call or message in their name is really them. It starts on (Alberto, 2026-11-18: part of the app, no longer behind
 * developer options). It shipped off, turned on only by the app at start-up from a saved developer setting.
 *
 * Starting on does not by itself reach a phone: the wallet app still applies that saved setting at start-up
 * (app/container-imp.ts, setConfirmItsYouEnabled), and whatever it applies wins. A phone comes out on once the app
 * stops applying the developer setting, or applies a setting of its own that starts on.
 *
 * With it off, nothing is offered on a contact's page or in a chat, no request is sent, and one that arrives is
 * dropped unread (and logged).
 *
 * THE KILLS, for a release (an OTA included): {@link CONFIRM_ITS_YOU_REMOTE_OFF} turns it off for everyone, and
 * SEDI_KERI_REMOTE_OFF turns off every SEDI/KERI feature at once, this one with them. Either beats whatever was set.
 * Neither turns it on. Each is read at every check, so it takes effect at the next start with nothing to migrate.
 *
 * @module trust-tasks/module/confirmItsYouFlag
 */
import { SEDI_KERI_REMOTE_OFF } from './sediKeriRemoteOff'

/** Set to true in a release to turn "Confirm it's you" off for everyone, whatever was saved. */
export const CONFIRM_ITS_YOU_REMOTE_OFF: { off: boolean } = { off: false }

/** What the release ships: on. */
export const CONFIRM_ITS_YOU_ON_BY_DEFAULT = true

let confirmItsYouEnabled: boolean = CONFIRM_ITS_YOU_ON_BY_DEFAULT

/**
 * Turn "Confirm it's you" on or off for this run. The wallet app still calls it at start-up with a saved setting
 * (app/container-imp.ts), which is why starting on has no effect on a phone until that stops or becomes a setting of
 * its own. Tests use it too.
 */
export function setConfirmItsYouEnabled(enabled: boolean): void {
  confirmItsYouEnabled = enabled
}

/** On (as shipped, unless this run turned it off), and turned off neither for this feature nor for SEDI/KERI as a whole. */
export function isConfirmItsYouEnabled(): boolean {
  return confirmItsYouEnabled && !CONFIRM_ITS_YOU_REMOTE_OFF.off && !SEDI_KERI_REMOTE_OFF.off
}
