/**
 * Days and dates as the person reads them, in the app's language, for every screen: the one shared helper.
 *
 * - Which calendar day a moment is on, in the phone's time zone (`startOfLocalDay`, `localDayKey`, `daysAgo`).
 * - A chat's day words (`dayLabel`): "Today", "Yesterday", the weekday within the past week, then "Wed 15 Oct",
 *   with the year once it is not this year.
 * - An absolute date (`absoluteDate`): "15 Oct 2026"; a short one with the year as asked (`shortDate`): "15 Oct".
 * - A time of day (`timeLabel`): "16:01" or "4:01 PM", by the phone's 12/24-hour setting, never by the language
 *   (`useUses24HourClock`); and a date with its time (`dateTime`).
 *
 * The words come from our own locale files (`Chat.Dates`), never from the JS engine's Intl. Hermes in a release build
 * honours toLocaleDateString's OPTIONS but IGNORES its LOCALE, the one passed and the device's alike, so French and
 * Portuguese screens printed English weekdays and months (simulator check on #606, 2026-10-26). Jest, on Node's full
 * ICU, could not see it. Hermes has Intl; it is not a polyfill that is missing.
 *
 * One rule for every place a day is named, so no two places say the same day differently (272 showed "15 October"
 * over "October 15, 2026 4:01 PM").
 *
 * @module utils/localDay
 */
import type { TFunction } from 'i18next'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import * as RNLocalize from 'react-native-localize'

/** The words and patterns a language names days with (locale files, `Chat.Dates`). */
export interface DateWords {
  today: string
  yesterday: string
  /** Sunday first, as Date.getDay(). */
  weekdaysLong: readonly string[]
  weekdaysShort: readonly string[]
  /** January first, as Date.getMonth(). */
  monthsShort: readonly string[]
  /** With {{weekday}}, {{day}}, {{month}}. */
  thisYear: string
  /** With {{day}}, {{month}}, {{year}}. */
  otherYear: string
  /** With {{day}}, {{month}}: a date without its year. */
  dayMonth: string
  /** With {{date}}, {{time}}. */
  dateTime: string
  /** With {{hour}}, {{minute}}, {{period}}: the 12-hour clock, when the phone is set to it. */
  time12: string
  /** With {{hour}}, {{minute}}: the 24-hour clock. Which clock is the phone's setting, never the language's. */
  time24: string
  am: string
  pm: string
}

const list = (t: TFunction, key: string, length: number): string[] => {
  const value = t(key, { returnObjects: true }) as unknown
  return Array.isArray(value) && value.length === length ? value.map(String) : []
}

/** The date words of the app's language, as `t` gives them. */
export function dateWords(t: TFunction): DateWords {
  return {
    today: t('Chat.Today') as string,
    yesterday: t('Chat.Yesterday') as string,
    weekdaysLong: list(t, 'Chat.Dates.WeekdaysLong', 7),
    weekdaysShort: list(t, 'Chat.Dates.WeekdaysShort', 7),
    monthsShort: list(t, 'Chat.Dates.MonthsShort', 12),
    thisYear: t('Chat.Dates.ThisYear') as string,
    otherYear: t('Chat.Dates.OtherYear') as string,
    dayMonth: t('Chat.Dates.DayMonth') as string,
    dateTime: t('Chat.Dates.DateTime') as string,
    time12: t('Chat.Dates.Time12') as string,
    time24: t('Chat.Dates.Time24') as string,
    am: t('Chat.Dates.Am') as string,
    pm: t('Chat.Dates.Pm') as string,
  }
}

/** The app language's date words, read again when the language changes. */
export function useDateWords(): DateWords {
  const { t, i18n } = useTranslation()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => dateWords(t), [t, i18n.language])
}

/** `pattern` with each {{name}} replaced by its value. */
const fill = (pattern: string, values: Record<string, string>): string =>
  pattern.replace(/\{\{(\w+)\}\}/g, (whole, name: string) => values[name] ?? whole)

/** Midnight at the start of `date`'s day in the phone's time zone, in ms. */
export const startOfLocalDay = (date: Date): number =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()

/** `date`'s calendar day in the phone's time zone, as "2026-10-15": a key for grouping by day. */
export const localDayKey = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

/**
 * Whole local days from `date` to `now` (0 today, 1 yesterday). Counted on calendar days, not 24-hour spans: the
 * difference of two local midnights, rounded, so a day of 23 or 25 hours (a clock change) still counts as one.
 */
export const daysAgo = (date: Date, now: Date): number =>
  Math.round((startOfLocalDay(now) - startOfLocalDay(date)) / 86_400_000)

/** An absolute date with its year: "15 Oct 2026", "15 oct. 2026", "15 de out. de 2026". */
export function absoluteDate(date: Date, words: DateWords): string {
  const month = words.monthsShort[date.getMonth()] ?? String(date.getMonth() + 1)
  return fill(words.otherYear, { day: String(date.getDate()), month, year: String(date.getFullYear()) })
}

export function dayLabel(date: Date, words: DateWords, now: Date = new Date()): string {
  const ago = daysAgo(date, now)
  if (ago === 0) return words.today
  if (ago === 1) return words.yesterday
  const weekday = date.getDay()
  if (ago > 1 && ago < 7 && words.weekdaysLong[weekday]) return words.weekdaysLong[weekday]
  if (date.getFullYear() !== now.getFullYear()) return absoluteDate(date, words)
  const month = words.monthsShort[date.getMonth()] ?? String(date.getMonth() + 1)
  return fill(words.thisYear, {
    weekday: words.weekdaysShort[weekday] ?? '',
    day: String(date.getDate()),
    month,
  }).trim()
}

/** Which year a short date says: always, only when it is not this year, or never. */
export type YearShown = 'always' | 'auto' | 'never'

/** A date without a weekday: "15 Oct", or with its year as `year` asks ("15 Oct 2026"). */
export function shortDate(date: Date, words: DateWords, year: YearShown = 'auto', now: Date = new Date()): string {
  if (year === 'always' || (year === 'auto' && date.getFullYear() !== now.getFullYear()))
    return absoluteDate(date, words)
  const month = words.monthsShort[date.getMonth()] ?? String(date.getMonth() + 1)
  return fill(words.dayMonth, { day: String(date.getDate()), month })
}

/**
 * The time of day: "16:01" on a 24-hour phone, "4:01 PM" on a 12-hour one (the words of the app's language). Which
 * clock is the phone's setting (`useUses24HourClock`), passed in so a test can set it.
 */
export function timeLabel(date: Date, words: DateWords, use24h: boolean): string {
  const minute = String(date.getMinutes()).padStart(2, '0')
  if (use24h) return fill(words.time24, { hour: String(date.getHours()).padStart(2, '0'), minute })
  const hour = String(date.getHours() % 12 || 12)
  return fill(words.time12, { hour, minute, period: date.getHours() < 12 ? words.am : words.pm })
}

/** A date with its time: "15 Oct 2026, 16:01", "15 oct. 2026 à 16:01", "15 de out. de 2026 às 16:01". */
export function dateTime(
  date: Date,
  words: DateWords,
  use24h: boolean,
  year: YearShown = 'always',
  now: Date = new Date()
): string {
  return fill(words.dateTime, { date: shortDate(date, words, year, now), time: timeLabel(date, words, use24h) })
}

/** Whether the phone is set to the 24-hour clock (its own setting, whatever the app's language). */
export function useUses24HourClock(): boolean {
  return useMemo(() => RNLocalize.uses24HourClock(), [])
}
