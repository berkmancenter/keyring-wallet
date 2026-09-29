/**
 * Dates and times as the person reads them: in the phone's own time zone, with
 * the month named (IN-58). The agent and the community send UTC timestamps;
 * cutting those to a string showed an approval's "Expires" off by the whole
 * UTC offset, and a date a day out near midnight.
 *
 * Screens that already say "3 min ago" or a local clock keep doing so; these
 * are for an absolute date or date and time.
 *
 * @module trust-tasks/screens/localTime
 */

/** For tests: a fixed zone; the app always uses the phone's. */
export interface LocalTimeOptions {
  timeZone?: string
}

const readable = (iso: string): Date | undefined => {
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? new Date(ms) : undefined
}

/** "29 Sep 2026" — the local day. What cannot be read comes back as it was. */
export function localDate(iso: string, options: LocalTimeOptions = {}): string {
  const at = readable(iso)
  if (!at) return iso
  return at.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(options.timeZone ? { timeZone: options.timeZone } : {}),
  })
}

/** "29 Sep 2026, 14:30" — the local wall clock. What cannot be read comes back as it was. */
export function localDateTime(iso: string, options: LocalTimeOptions = {}): string {
  const at = readable(iso)
  if (!at) return iso
  return at.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    ...(options.timeZone ? { timeZone: options.timeZone } : {}),
  })
}
