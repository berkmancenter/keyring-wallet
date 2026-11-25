import { Platform } from 'react-native'

/**
 * The newest emoji version the operating system's own emoji font can draw,
 * so the picker never offers an emoji that shows as an empty box (plan §5,
 * "What the picker offers").
 *
 * The table is deliberately conservative: each row is the emoji version the
 * stock font has at that OS version's first release. Quarterly Android
 * updates (QPRs) and iOS point releases inside a row's range can add a newer
 * emoji version without changing `Platform.Version`; such a device is offered
 * one version less than it could draw, which is the safe direction. Vendor
 * fonts (Samsung, for one) may differ from stock. Sources: Emojipedia's
 * per-version pages (emojipedia.org/apple/ios-<version>,
 * emojipedia.org/google/<emoji-version>), checked 2026-10-24.
 */

/** [major, minor, emoji version]: from iOS major.minor, the font draws this emoji version. Ascending. */
export const IOS_EMOJI_SUPPORT: readonly (readonly [number, number, number])[] = [
  [15, 1, 13.1], // React Native 0.81's minimum iOS; Emoji 13.1 shipped in iOS 14.5
  [15, 4, 14.0],
  [16, 4, 15.0],
  [17, 4, 15.1],
  [18, 4, 16.0],
  [26, 4, 17.0], // iOS 26.4, March 2026
]

/** [API level, emoji version]: from this Android API level, the stock font draws this emoji version. Ascending. */
export const ANDROID_EMOJI_SUPPORT: readonly (readonly [number, number])[] = [
  [24, 3.0], // Android 7.0, the app's minSdk
  [25, 4.0],
  [26, 5.0],
  [28, 11.0],
  [29, 12.0],
  [30, 13.0], // Android 11, the e2e emulator's row
  [31, 13.1],
  [33, 14.0],
  [34, 15.0],
  [35, 15.1],
  [36, 16.0],
  // API 37 (Android 17) stays at 16.0 until a device run shows 17.0: Emoji 17.0
  // reached Pixels in Android 16 QPR3, but reports disagree on whether every
  // Android 17 device has it, and vendor fonts lag stock.
]

/** Below every row, the oldest row applies; above every row, the newest does. */
function lastRowAtOrBelow<T extends readonly number[]>(
  rows: readonly T[],
  meets: (row: T) => boolean,
  value: (row: T) => number
): number {
  let result = value(rows[0])
  for (const row of rows) if (meets(row)) result = value(row)
  return result
}

/**
 * The newest emoji version the OS can draw, from `Platform.OS` and
 * `Platform.Version` (a string like "17.4.1" on iOS, an integer API level on
 * Android). An unknown platform gets the newest version in the iOS table.
 */
export function maxEmojiVersion(os: string, version: string | number): number {
  if (os === 'ios') {
    const [major = 0, minor = 0] = String(version)
      .split('.')
      .map((part) => parseInt(part, 10) || 0)
    return lastRowAtOrBelow(
      IOS_EMOJI_SUPPORT,
      ([m, n]) => major > m || (major === m && minor >= n),
      (row) => row[2]
    )
  }
  if (os === 'android') {
    const api = typeof version === 'number' ? version : parseInt(version, 10) || 0
    return lastRowAtOrBelow(
      ANDROID_EMOJI_SUPPORT,
      ([level]) => api >= level,
      (row) => row[1]
    )
  }
  return IOS_EMOJI_SUPPORT[IOS_EMOJI_SUPPORT.length - 1][2]
}

/** The newest emoji version this device can draw. */
export function deviceMaxEmojiVersion(): number {
  return maxEmojiVersion(Platform.OS, Platform.Version)
}
