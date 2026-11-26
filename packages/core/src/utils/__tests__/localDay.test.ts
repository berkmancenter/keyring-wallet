/**
 * A chat day's words: Today, Yesterday, the weekday within the week, then the date with the year only when it is not
 * this year; counted on calendar days in the phone's zone, in the app's language.
 *
 * The words come from our own locale files (`Chat.Dates`), read here through a real i18next instance per language,
 * so these assertions are the strings a phone shows, on any engine. They used to come from Intl, which Hermes in a
 * release build answered in English whatever the locale (simulator check on #606): tests on Node's full ICU passed
 * while the phone was wrong. Nothing here touches Intl.
 */
import i18next, { type TFunction } from 'i18next'

import en from '../../localization/en/en.json'
import fr from '../../localization/fr/fr.json'
import ptBr from '../../localization/pt-br/pt-br.json'
import {
  absoluteDate,
  dateTime,
  dateWords,
  dayLabel,
  daysAgo,
  localDayKey,
  shortDate,
  timeLabel,
  type DateWords,
} from '../localDay'

function wordsIn(language: string, translation: object): DateWords {
  const i18n = i18next.createInstance()
  i18n.init({ lng: language, resources: { [language]: { translation } }, initImmediate: false })
  return dateWords(i18n.t.bind(i18n) as TFunction)
}
const EN = wordsIn('en', en)
const FR = wordsIn('fr', fr)
const PT = wordsIn('pt-BR', ptBr)

// Saturday 25 October 2026, 09:00 local.
const now = new Date(2026, 9, 25, 9, 0)

describe('a chat day', () => {
  test('today and yesterday are words, counted on calendar days, not 24-hour spans', () => {
    expect(dayLabel(new Date(2026, 9, 25, 0, 5), EN, now)).toBe('Today')
    // 23:50 the day before is 9 hours ago, and still yesterday.
    expect(dayLabel(new Date(2026, 9, 24, 23, 50), EN, now)).toBe('Yesterday')
    expect(dayLabel(new Date(2026, 9, 24, 23, 50), FR, now)).toBe('Hier')
    expect(dayLabel(new Date(2026, 9, 24, 23, 50), PT, now)).toBe('Ontem')
    expect(daysAgo(new Date(2026, 9, 24, 23, 50), now)).toBe(1)
  })

  test('within the past week: the weekday, in each language', () => {
    const wednesday = new Date(2026, 9, 21, 15, 0)
    expect(dayLabel(wednesday, EN, now)).toBe('Wednesday')
    expect(dayLabel(wednesday, FR, now)).toBe('mercredi')
    expect(dayLabel(wednesday, PT, now)).toBe('quarta-feira')
  })

  test('earlier this year: weekday, day and month, no year and no time', () => {
    const thursday = new Date(2026, 9, 15, 16, 1)
    expect(dayLabel(thursday, EN, now)).toBe('Thu 15 Oct')
    expect(dayLabel(thursday, FR, now)).toBe('jeu. 15 oct.')
    expect(dayLabel(thursday, PT, now)).toBe('qui., 15 de out.')
  })

  test('another year: the year is said', () => {
    const lastYear = new Date(2025, 11, 31, 10, 0)
    expect(dayLabel(lastYear, EN, now)).toBe('31 Dec 2025')
    expect(dayLabel(lastYear, FR, now)).toBe('31 déc. 2025')
    expect(dayLabel(lastYear, PT, now)).toBe('31 de dez. de 2025')
  })

  test('a day ahead (a sender clock up to a day fast is accepted) is a date, never "Today"', () => {
    expect(dayLabel(new Date(2026, 9, 26, 10, 0), EN, now)).toBe('Mon 26 Oct')
  })

  test('a week ago exactly is a date, not a weekday (which would name today)', () => {
    expect(dayLabel(new Date(2026, 9, 18, 9, 0), EN, now)).toBe('Sun 18 Oct')
  })

  test('every language has a full week and year of names', () => {
    for (const words of [EN, FR, PT]) {
      expect(words.weekdaysLong).toHaveLength(7)
      expect(words.weekdaysShort).toHaveLength(7)
      expect(words.monthsShort).toHaveLength(12)
    }
  })

  test("the shared pieces: a day key in the phone's zone, and an absolute date in each language", () => {
    expect(localDayKey(new Date(2026, 9, 5, 23, 59))).toBe('2026-10-05')
    expect(localDayKey(new Date(2026, 9, 6, 0, 1))).toBe('2026-10-06')
    const d = new Date(2026, 9, 15, 16, 1)
    expect(absoluteDate(d, EN)).toBe('15 Oct 2026')
    expect(absoluteDate(d, FR)).toBe('15 oct. 2026')
    expect(absoluteDate(d, PT)).toBe('15 de out. de 2026')
  })
})

describe('dates and times for every screen', () => {
  const thisYear = new Date(2026, 9, 15, 16, 1)
  const lastYear = new Date(2025, 9, 15, 9, 5)

  test('a short date: no weekday; the year always, only when not this year, or never', () => {
    expect(shortDate(thisYear, EN, 'auto', now)).toBe('15 Oct')
    expect(shortDate(thisYear, FR, 'auto', now)).toBe('15 oct.')
    expect(shortDate(thisYear, PT, 'auto', now)).toBe('15 de out.')
    expect(shortDate(lastYear, EN, 'auto', now)).toBe('15 Oct 2025')
    expect(shortDate(thisYear, EN, 'always', now)).toBe('15 Oct 2026')
    expect(shortDate(lastYear, FR, 'never', now)).toBe('15 oct.')
  })

  // The clock is the phone's setting, passed in: the language gives only the words.
  test('the time of day by the phone’s clock, in each language’s words', () => {
    for (const words of [EN, FR, PT]) {
      expect(timeLabel(thisYear, words, true)).toBe('16:01')
      expect(timeLabel(lastYear, words, true)).toBe('09:05')
    }
    expect(timeLabel(thisYear, EN, false)).toBe('4:01 PM')
    expect(timeLabel(lastYear, EN, false)).toBe('9:05 AM')
    expect(timeLabel(new Date(2026, 0, 1, 0, 7), EN, false)).toBe('12:07 AM')
    expect(timeLabel(new Date(2026, 0, 1, 12, 7), FR, false)).toBe('12:07 PM')
  })

  test('a date with its time', () => {
    expect(dateTime(thisYear, EN, true, 'always', now)).toBe('15 Oct 2026, 16:01')
    expect(dateTime(thisYear, FR, true, 'always', now)).toBe('15 oct. 2026 à 16:01')
    expect(dateTime(thisYear, PT, true, 'always', now)).toBe('15 de out. de 2026 às 16:01')
    expect(dateTime(thisYear, EN, false, 'auto', now)).toBe('15 Oct, 4:01 PM')
  })
})
