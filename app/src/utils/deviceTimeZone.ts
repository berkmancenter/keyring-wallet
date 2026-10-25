/**
 * The phone's time zone, for dates (IN-58).
 *
 * The app loads the formatjs DateTimeFormat polyfill (index.js), which also
 * stands behind Date#toLocaleString, and it formats in UTC until it is told
 * the zone: formatjs cannot read the device's. So a date meant as the phone's
 * wall clock ("Expires 7:13 AM" in New York) read as UTC ("11:13 AM"). This
 * gives it the zone at start and again whenever the app comes back to the
 * foreground, since the phone may have moved zones meanwhile.
 *
 * A native DateTimeFormat (no polyfill installed) knows the zone already and
 * is left alone. Nothing here may break start-up.
 */

interface IntlWithPolyfill {
  DateTimeFormat: { __setDefaultTimeZone?: (tz: string) => void }
}

interface AppStateLike {
  addEventListener: (type: 'change', listener: (state: string) => void) => { remove: () => void }
}

/** Tell the polyfill the phone's zone. The zone it was given, or undefined when it was not. */
export function applyDeviceTimeZone(intl: IntlWithPolyfill, zone: () => string | undefined): string | undefined {
  const set = intl.DateTimeFormat.__setDefaultTimeZone
  if (typeof set !== 'function') return undefined
  try {
    const tz = zone()
    if (!tz) return undefined
    set.call(intl.DateTimeFormat, tz)
    return tz
  } catch {
    return undefined
  }
}

/** Apply the phone's zone now, and each time the app becomes active. */
export function followDeviceTimeZone(
  intl: IntlWithPolyfill,
  zone: () => string | undefined,
  appState: AppStateLike
): { remove: () => void } {
  applyDeviceTimeZone(intl, zone)
  return appState.addEventListener('change', (state) => {
    if (state === 'active') applyDeviceTimeZone(intl, zone)
  })
}
