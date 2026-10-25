/**
 * Dates show in the phone's time zone (IN-58, 227 gate U12). The formatjs
 * DateTimeFormat polyfill the app loads defaults to UTC unless told the zone,
 * and it also stands behind Date#toLocaleString; so "Expires" read 11:13 AM on
 * a phone in New York for 11:13 UTC. The app tells it the phone's zone at
 * start, and again whenever it comes back to the foreground.
 */
import { applyDeviceTimeZone, followDeviceTimeZone } from './deviceTimeZone'

function polyfilled() {
  const set: string[] = []
  return { intl: { DateTimeFormat: { __setDefaultTimeZone: (tz: string) => set.push(tz) } }, set }
}

describe("the phone's time zone", () => {
  it('is given to the polyfill', () => {
    const p = polyfilled()
    expect(applyDeviceTimeZone(p.intl, () => 'America/New_York')).toBe('America/New_York')
    expect(p.set).toEqual(['America/New_York'])
  })

  it('leaves a native DateTimeFormat alone: it knows the zone itself', () => {
    expect(applyDeviceTimeZone({ DateTimeFormat: {} }, () => 'America/New_York')).toBeUndefined()
  })

  it('never breaks start-up: a zone the polyfill refuses, or none, leaves its default', () => {
    const refusing = {
      DateTimeFormat: {
        __setDefaultTimeZone: () => {
          throw new RangeError('Invalid timeZone')
        },
      },
    }
    expect(applyDeviceTimeZone(refusing, () => 'Mars/Olympus')).toBeUndefined()
    const p = polyfilled()
    expect(applyDeviceTimeZone(p.intl, () => '')).toBeUndefined()
    expect(p.set).toEqual([])
  })

  it('is read again when the app comes back to the foreground', () => {
    const p = polyfilled()
    let zone = 'America/New_York'
    let onChange: ((state: string) => void) | undefined
    followDeviceTimeZone(p.intl, () => zone, {
      addEventListener: (_type, listener) => {
        onChange = listener
        return { remove: () => undefined }
      },
    })
    zone = 'Europe/Prague'
    onChange?.('background')
    onChange?.('active')
    expect(p.set).toEqual(['America/New_York', 'Europe/Prague'])
  })
})

describe('with the polyfill the app loads, forced as a phone gets it', () => {
  // As app/index.js loads it; forced, since Node's own Intl would not need it.
  require('@formatjs/intl-datetimeformat/polyfill-force')
  require('@formatjs/intl-datetimeformat/locale-data/en')
  require('@formatjs/intl-datetimeformat/add-all-tz')
  // As bifold's localTime.localDateTime formats: Date#toLocaleString, which the polyfill patches.
  const localDateTime = (iso: string) =>
    new Date(iso).toLocaleString(undefined, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  const EXPIRES = '2026-09-30T11:13:00.000Z'

  it('reads UTC until told the zone: the bug the gate caught', () => {
    expect(localDateTime(EXPIRES)).toMatch(/11:13/)
  })

  it("reads the phone's wall clock once told it", () => {
    applyDeviceTimeZone(Intl as never, () => 'America/New_York')
    expect(localDateTime(EXPIRES)).toMatch(/7:13/)
    expect(localDateTime(EXPIRES)).toMatch(/Sep/)
  })
})
