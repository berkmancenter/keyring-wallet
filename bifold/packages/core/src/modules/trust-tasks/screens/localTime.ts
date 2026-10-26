/**
 * Dates and times as the person reads them: in the phone's own time zone, with
 * the month named (IN-58), in the app's language (utils/localDay.ts). The agent
 * and the community send UTC timestamps; cutting those to a string showed an
 * approval's "Expires" off by the whole UTC offset, and a date a day out near
 * midnight. The words are our own, not the JS engine's: in a release build
 * Hermes answered toLocaleDateString in English whatever the language.
 *
 * Screens that already say "3 min ago" or a local clock keep doing so; these
 * are for an absolute date or date and time.
 *
 * @module trust-tasks/screens/localTime
 */

import { absoluteDate, appDateWords, dateTime, phoneUses24HourClock } from '../../../utils/localDay'

const readable = (iso: string): Date | undefined => {
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? new Date(ms) : undefined
}

/** "29 Sep 2026": the local day. What cannot be read comes back as it was. */
export function localDate(iso: string): string {
  const at = readable(iso)
  return at ? absoluteDate(at, appDateWords()) : iso
}

/** "29 Sep 2026, 14:30": the local wall clock, by the phone's 12/24-hour setting. What cannot be read comes back as it was. */
export function localDateTime(iso: string): string {
  const at = readable(iso)
  return at ? dateTime(at, appDateWords(), phoneUses24HourClock()) : iso
}
