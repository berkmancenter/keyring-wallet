import { Platform } from 'react-native'

import { getEmojiSet } from '../data'
import { ANDROID_EMOJI_SUPPORT, IOS_EMOJI_SUPPORT, deviceMaxEmojiVersion, maxEmojiVersion } from '../osSupport'

describe('maxEmojiVersion on iOS', () => {
  it.each([
    ['15.1', 13.1],
    ['15.3.1', 13.1],
    ['15.4', 14.0],
    ['16.3', 14.0],
    ['16.4', 15.0],
    ['17.4.1', 15.1],
    ['18.3', 15.1],
    ['18.4', 16.0],
    ['26.3', 16.0],
    ['26.4', 17.0],
  ])('iOS %s draws up to emoji %d', (version, expected) => {
    expect(maxEmojiVersion('ios', version)).toBe(expected)
  })

  it('uses the oldest row below the table and the newest row above it', () => {
    expect(maxEmojiVersion('ios', '14.0')).toBe(13.1)
    expect(maxEmojiVersion('ios', '27.0')).toBe(17.0)
  })

  it('treats an unparseable version as below the table', () => {
    expect(maxEmojiVersion('ios', 'beta')).toBe(13.1)
  })
})

describe('maxEmojiVersion on Android', () => {
  it.each([
    [24, 3.0],
    [27, 5.0],
    [29, 12.0],
    [30, 13.0],
    [32, 13.1],
    [33, 14.0],
    [34, 15.0],
    [35, 15.1],
    [36, 16.0],
    [37, 16.0],
  ])('API %d draws up to emoji %d', (api, expected) => {
    expect(maxEmojiVersion('android', api)).toBe(expected)
  })

  it('accepts the API level as a string', () => {
    expect(maxEmojiVersion('android', '30')).toBe(13.0)
  })

  it('uses the oldest row below the table', () => {
    expect(maxEmojiVersion('android', 21)).toBe(3.0)
  })
})

describe('the tables', () => {
  it('are ascending in OS version and in emoji version', () => {
    for (let i = 1; i < IOS_EMOJI_SUPPORT.length; i++) {
      const [a, b] = [IOS_EMOJI_SUPPORT[i - 1], IOS_EMOJI_SUPPORT[i]]
      expect(b[0] * 100 + b[1]).toBeGreaterThan(a[0] * 100 + a[1])
      expect(b[2]).toBeGreaterThan(a[2])
    }
    for (let i = 1; i < ANDROID_EMOJI_SUPPORT.length; i++) {
      expect(ANDROID_EMOJI_SUPPORT[i][0]).toBeGreaterThan(ANDROID_EMOJI_SUPPORT[i - 1][0])
      expect(ANDROID_EMOJI_SUPPORT[i][1]).toBeGreaterThan(ANDROID_EMOJI_SUPPORT[i - 1][1])
    }
  })

  it('never name an emoji version newer than the pinned set', () => {
    const newest = Math.max(...[...getEmojiSet().byEmoji.values()].map((e) => e.version))
    for (const row of IOS_EMOJI_SUPPORT) expect(row[2]).toBeLessThanOrEqual(newest)
    for (const row of ANDROID_EMOJI_SUPPORT) expect(row[1]).toBeLessThanOrEqual(newest)
  })

  it('leave an Android 11 device without any emoji newer than 13.0', () => {
    const limit = maxEmojiVersion('android', 30)
    const offered = [...getEmojiSet().byEmoji.values()].filter((e) => e.version <= limit)
    expect(offered.length).toBeGreaterThan(0)
    expect(offered.every((e) => e.version <= 13.0)).toBe(true)
    expect(getEmojiSet().byEmoji.get('🫠')?.version).toBeGreaterThan(limit) // melting face, Emoji 14.0
  })
})

describe('deviceMaxEmojiVersion', () => {
  const original = { os: Platform.OS, version: Platform.Version }
  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { value: original.os, configurable: true })
    Object.defineProperty(Platform, 'Version', { value: original.version, configurable: true })
  })

  it('reads Platform.OS and Platform.Version', () => {
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true })
    Object.defineProperty(Platform, 'Version', { value: 30, configurable: true })
    expect(deviceMaxEmojiVersion()).toBe(13.0)
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true })
    Object.defineProperty(Platform, 'Version', { value: '18.4', configurable: true })
    expect(deviceMaxEmojiVersion()).toBe(16.0)
  })
})
