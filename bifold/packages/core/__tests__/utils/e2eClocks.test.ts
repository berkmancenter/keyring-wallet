/**
 * Gate efficiency item 3: test builds carry `E2E_CLOCKS=short` so a gate row
 * waits a minute, not ten. These pin the real clocks the store build keeps, and
 * that only the exact value `short` changes anything.
 */
import Config from 'react-native-config'

import { defaultAutoLockTime } from '../../src/constants'
import { GRANT_POLL_WINDOW_MS, PHONE_GRANT_POLL_WINDOW_MS } from '../../src/modules/trust-tasks/clocks'
import {
  SHORT_AUTO_LOCK_MINUTES,
  SHORT_GRANT_POLL_WINDOW_MS,
  effectiveDefaultAutoLockMinutes,
  e2eClocksSet,
  effectiveGrantPollWindowMs,
  shortClocks,
} from '../../src/utils/e2eClocks'

jest.mock('react-native-config', () => ({ __esModule: true, default: {} }))

const config = Config as Record<string, string | undefined>

afterEach(() => {
  delete config.E2E_CLOCKS
})

describe('the real clocks', () => {
  it('are ten minutes for both grant windows and five minutes for the auto-lock', () => {
    expect(GRANT_POLL_WINDOW_MS).toBe(600_000)
    expect(PHONE_GRANT_POLL_WINDOW_MS).toBe(600_000)
    expect(defaultAutoLockTime).toBe(5)
  })

  it('are the ones in force when the switch is not set, as in the store build', () => {
    expect(shortClocks()).toBe(false)
    expect(effectiveGrantPollWindowMs(GRANT_POLL_WINDOW_MS)).toBe(600_000)
    expect(effectiveGrantPollWindowMs(PHONE_GRANT_POLL_WINDOW_MS)).toBe(600_000)
    expect(effectiveDefaultAutoLockMinutes(defaultAutoLockTime)).toBe(5)
  })

  it.each(['', 'SHORT', 'true', '1', 'real', ' short'])('stay in force for E2E_CLOCKS=%j', (value) => {
    config.E2E_CLOCKS = value
    expect(shortClocks()).toBe(false)
    expect(effectiveGrantPollWindowMs(GRANT_POLL_WINDOW_MS)).toBe(600_000)
    expect(effectiveDefaultAutoLockMinutes(defaultAutoLockTime)).toBe(5)
  })
})

describe('E2E_CLOCKS=short', () => {
  beforeEach(() => {
    config.E2E_CLOCKS = 'short'
  })

  it('makes both grant windows 60 s and the auto-lock default half a minute', () => {
    expect(SHORT_GRANT_POLL_WINDOW_MS).toBe(60_000)
    expect(SHORT_AUTO_LOCK_MINUTES).toBe(0.5)
    expect(shortClocks()).toBe(true)
    expect(effectiveGrantPollWindowMs(GRANT_POLL_WINDOW_MS)).toBe(60_000)
    expect(effectiveGrantPollWindowMs(PHONE_GRANT_POLL_WINDOW_MS)).toBe(60_000)
    expect(effectiveDefaultAutoLockMinutes(defaultAutoLockTime)).toBe(0.5)
    // Shorter than the window, so the window can outlast the lock.
    expect(SHORT_AUTO_LOCK_MINUTES * 60_000).toBeLessThan(SHORT_GRANT_POLL_WINDOW_MS)
  })

  it('is read on every call, so it cannot stick once unset', () => {
    expect(shortClocks()).toBe(true)
    delete config.E2E_CLOCKS
    expect(shortClocks()).toBe(false)
  })
})

describe('whether the build is a test build at all', () => {
  afterEach(() => {
    delete config.E2E_CLOCKS
  })

  it('is false with E2E_CLOCKS unset or blank, as in a store build', () => {
    expect(e2eClocksSet()).toBe(false)
    config.E2E_CLOCKS = '  '
    expect(e2eClocksSet()).toBe(false)
  })

  it('is true for short and for real; only short shortens the clocks', () => {
    config.E2E_CLOCKS = 'real'
    expect(e2eClocksSet()).toBe(true)
    expect(shortClocks()).toBe(false)
    config.E2E_CLOCKS = 'short'
    expect(e2eClocksSet()).toBe(true)
    expect(shortClocks()).toBe(true)
  })
})
