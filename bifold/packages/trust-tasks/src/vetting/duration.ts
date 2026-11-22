/**
 * ISO 8601 durations, as the published vetting requirements use them.
 *
 * A community writes `maxStatementAge: "P120D"`, `decisionSla: "P14D"`,
 * `requirementsGrace: "P30D"`. Every one of those decides whether something
 * still counts, so the arithmetic has to agree with the community's — a
 * statement the applicant believes is inside the window and the community
 * does not is the worst kind of disagreement, because it surfaces as an
 * unexplained refusal.
 *
 * Years and months are added as calendar arithmetic rather than converted to
 * a fixed number of days. "P1M" after 31 January is 28 February, not 2 or 3
 * March, and a client that approximates will disagree with any server that
 * does not — at the month boundaries, which is exactly where a deadline
 * lands. Days and below are exact.
 *
 * @module vetting/duration
 */

/** The parts of a duration, all optional, all non-negative. */
export interface IsoDuration {
  years: number
  months: number
  weeks: number
  days: number
  hours: number
  minutes: number
  seconds: number
}

// PnYnMnWnD T nHnMnS — fractional values are rejected rather than rounded,
// since a community writing "P0.5D" means something we should not guess at.
const PATTERN = /^P(?!$)(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?!$)(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/

/**
 * Parse an ISO 8601 duration. Returns `undefined` for anything unparseable
 * rather than throwing or guessing — a caller that cannot read the community's
 * limit must say it could not, not silently apply no limit.
 */
export function parseIsoDuration(value: string): IsoDuration | undefined {
  const match = PATTERN.exec(value?.trim() ?? '')
  if (!match) return undefined
  const [, y, mo, w, d, h, mi, s] = match
  const n = (v: string | undefined) => (v === undefined ? 0 : Number(v))
  return {
    years: n(y),
    months: n(mo),
    weeks: n(w),
    days: n(d),
    hours: n(h),
    minutes: n(mi),
    seconds: n(s),
  }
}

/**
 * Add a duration to an instant, using calendar arithmetic for years and
 * months. Where the day of month does not exist in the target month — 31
 * January plus one month — the result is clamped to the last day of that
 * month, which is what every calendar implementation that does not overflow
 * into the next month does.
 */
export function addIsoDuration(from: Date, duration: IsoDuration): Date {
  const d = new Date(from.getTime())
  if (duration.years || duration.months) {
    const day = d.getUTCDate()
    d.setUTCDate(1)
    d.setUTCFullYear(d.getUTCFullYear() + duration.years, d.getUTCMonth() + duration.months)
    const lastOfMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
    d.setUTCDate(Math.min(day, lastOfMonth))
  }
  const ms =
    ((duration.weeks * 7 + duration.days) * 24 * 3600 + duration.hours * 3600 + duration.minutes * 60 + duration.seconds) *
    1000
  return new Date(d.getTime() + ms)
}

/**
 * When something signed at `signedAt` stops counting under `maxAge`.
 *
 * `undefined` means the limit could not be read — the caller decides what to
 * do about that, and must not treat it as "no limit".
 */
export function expiryUnder(signedAt: string | Date, maxAge: string): Date | undefined {
  const from = signedAt instanceof Date ? signedAt : new Date(signedAt)
  if (Number.isNaN(from.getTime())) return undefined
  const duration = parseIsoDuration(maxAge)
  return duration && addIsoDuration(from, duration)
}
