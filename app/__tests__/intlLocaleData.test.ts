/**
 * Which languages the app's Intl polyfills can speak (index.js). On Android, @formatjs REPLACES the engine's
 * PluralRules and DateTimeFormat (probe on an emulator, 2026-11-06: Intl.PluralRules.polyfilled and
 * Intl.DateTimeFormat.polyfilled both true, supportedLocalesOf [] for fr and pt-BR), so the app formats with the
 * locale data index.js loads and nothing else. With English alone, French and Portuguese took English plural rules
 * (a count of 0 picked the "_other" string, "0 relations") and English month names and AM/PM.
 *
 * What jest can and can't see: Node's own Intl has every language, so this file forces the polyfills in
 * (polyfill-force, the same classes the phone gets), loads exactly the locale-data modules index.js names, and reads
 * the result. That shows the data is named, loads, and answers in French and Portuguese. It does NOT show the phone
 * using it: an Android emulator frame (plural 0 and a French date) is the proof, and it is owed.
 */
import { readFileSync } from 'fs'
import { join } from 'path'

const indexJs = readFileSync(join(__dirname, '..', 'index.js'), 'utf8')
const localeData = (family: string): string[] =>
  [...indexJs.matchAll(new RegExp(`require\\('(@formatjs/${family}/locale-data/[^']+)'\\)`, 'g'))].map((m) => m[1])

const FAMILIES = ['intl-pluralrules', 'intl-relativetimeformat', 'intl-datetimeformat']

// polyfill-force redefines these on the shared Intl and Date.prototype: put them back after, so no other file sees it.
const saved = [
  ...['PluralRules', 'RelativeTimeFormat', 'DateTimeFormat'].map((k) => [Intl, k] as const),
  ...['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString'].map((k) => [Date.prototype, k] as const),
].map(([owner, key]) => ({ owner, key, descriptor: Object.getOwnPropertyDescriptor(owner, key) }))

beforeAll(() => {
  // index.js's order: plural rules first (relative time reads them), then relative time, then dates.
  require('@formatjs/intl-pluralrules/polyfill-force')
  localeData('intl-pluralrules').forEach((m) => require(m))
  require('@formatjs/intl-relativetimeformat/polyfill-force')
  localeData('intl-relativetimeformat').forEach((m) => require(m))
  require('@formatjs/intl-datetimeformat/polyfill-force')
  localeData('intl-datetimeformat').forEach((m) => require(m))
  require('@formatjs/intl-datetimeformat/add-all-tz')
})

afterAll(() => {
  saved.forEach(({ owner, key, descriptor }) => descriptor && Object.defineProperty(owner, key, descriptor))
})

// The polyfill classes carry a `polyfilled` flag and a default locale that Node's built-ins don't have.
type Polyfilled = { polyfilled?: boolean; getDefaultLocale?: () => string }
const polyfill = (name: 'PluralRules' | 'RelativeTimeFormat' | 'DateTimeFormat') =>
  (Intl as unknown as Record<string, Polyfilled>)[name]

describe('the languages the app formats in', () => {
  test.each(FAMILIES)('index.js loads English, French and Portuguese data for %s, English first', (family) => {
    expect(localeData(family)).toEqual([
      `@formatjs/${family}/locale-data/en`,
      `@formatjs/${family}/locale-data/fr`,
      `@formatjs/${family}/locale-data/pt`,
    ])
  })

  test('these rows read the polyfills, not Node, and English stays the default', () => {
    for (const name of ['PluralRules', 'RelativeTimeFormat', 'DateTimeFormat'] as const) {
      expect(polyfill(name).polyfilled).toBe(true)
      expect(polyfill(name).getDefaultLocale?.()).toBe('en')
    }
  })

  test('a count of zero is singular in French and Portuguese, plural in English', () => {
    const forms = (locale: string) => [0, 1, 2].map((n) => new Intl.PluralRules(locale).select(n))
    expect(forms('en')).toEqual(['other', 'one', 'other'])
    expect(forms('fr')).toEqual(['one', 'one', 'other'])
    expect(forms('pt-BR')).toEqual(['one', 'one', 'other'])
  })

  test('month names and the time of day are the language’s own', () => {
    const january = Date.UTC(2026, 0, 1)
    const month = (locale: string) =>
      new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' }).format(january)
    expect([month('en'), month('fr'), month('pt-BR')]).toEqual(['January', 'janvier', 'janeiro'])

    const morning = new Date(Date.UTC(2026, 10, 12, 8, 59))
    const time = (locale: string) =>
      morning.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })
    // English puts a narrow no-break space (U+202F) before AM in this CLDR data, not a plain space.
    expect([time('en'), time('fr'), time('pt-BR')]).toEqual(['08:59 AM', '08:59', '08:59'])
  })

  test('relative times are the language’s own', () => {
    const yesterday = (locale: string) => new Intl.RelativeTimeFormat(locale).format(-1, 'day')
    expect([yesterday('en'), yesterday('fr'), yesterday('pt-BR')]).toEqual(['1 day ago', 'il y a 1 jour', 'há 1 dia'])
  })
})
