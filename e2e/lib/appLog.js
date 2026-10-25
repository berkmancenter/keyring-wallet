/**
 * What the app itself logged, for checks that a secret never reaches the device log (run-pair-ios.mjs: the shared
 * invitation link).
 *
 * One sender is set aside, and only one: iOS's share sheet (subsystem com.apple.ShareSheet). On iOS 26.3 it logs the
 * items it was handed, the link among them, under the app's process, as an entry over several lines, so a leak check
 * over the whole log failed every release build for something the app never wrote (MacBook, 10-25). Every other entry
 * counts, the app's own JavaScript and native lines and any other framework's, so the check is not loosened.
 */

/** A `log show --style compact` entry's first line: date, time, type, process, then the [subsystem:category]. */
const ENTRY_START = /\n(?=\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)/;
const SHARE_SHEET = /^\S+ \S+ +\S+ +\S+ \[com\.apple\.ShareSheet[:\]]/;

/** The log without the share sheet's entries (each a timestamped line and the lines that continue it). */
export function withoutShareSheet(log) {
  return log
    .split(ENTRY_START)
    .filter((entry) => !SHARE_SHEET.test(entry))
    .join("\n");
}

/** Whether `secret` appears anywhere in the log other than the share sheet's own entries. */
export function appLogged(log, secret) {
  return Boolean(secret) && withoutShareSheet(log).includes(secret);
}
