/**
 * CREATE-WAIT-LOCK: a person waiting on Create for their agent, without
 * touching the phone, was locked out after 5 minutes and lost the screen. A
 * screen can hold the auto-lock off, for a bounded time only.
 */
import { act, render } from '@testing-library/react-native'
import React, { useContext } from 'react'
import Config from 'react-native-config'

import { ActivityContext, ActivityProvider } from '../src/contexts/activity'

const mockLockOutUser = jest.fn()
jest.mock('../src/contexts/auth', () => ({
  useAuth: () => ({ lockOutUser: mockLockOutUser }),
  LockoutReason: { Timeout: 'Timeout' },
}))
jest.mock('../src/utils/agent', () => ({
  useAppAgent: () => ({
    agent: {
      modules: { didcomm: { mediationRecipient: { stopMessagePickup: jest.fn(), initiateMessagePickup: jest.fn() } } },
    },
  }),
}))
// The lock time the person saved in Settings; undefined is a wallet that never chose.
let mockSavedAutoLock: number | undefined = 5
jest.mock('../src/contexts/store', () => ({ useStore: () => [{ preferences: { autoLockTime: mockSavedAutoLock } }] }))
jest.mock('react-native-config', () => ({ __esModule: true, default: {} }))
jest.mock('../src/container-api', () => ({
  TOKENS: { UTIL_LOGGER: 'logger', CONFIG: 'config', UTIL_MESSAGE_PICKUP: 'messagePickup' },
  useServices: () => [{ info: jest.fn(), error: jest.fn() }, {}, { onBackground: jest.fn(), onForeground: jest.fn() }],
}))

const MIN = 60_000

function mount() {
  let ctx: ActivityContext | undefined
  const Probe = () => {
    ctx = useContext(ActivityContext)
    return null
  }
  render(
    <ActivityProvider>
      <Probe />
    </ActivityProvider>
  )
  return () => ctx as ActivityContext
}

const config = Config as Record<string, string | undefined>

beforeEach(() => {
  jest.useFakeTimers()
  mockLockOutUser.mockClear()
  mockSavedAutoLock = 5
})
afterEach(() => {
  jest.useRealTimers()
  delete config.E2E_CLOCKS
})

describe('holding the auto-lock off', () => {
  it('without a hold, locks after the inactivity timeout, as before', () => {
    mount()
    act(() => jest.advanceTimersByTime(5 * MIN))
    expect(mockLockOutUser).toHaveBeenCalledWith('Timeout')
  })

  it('a hold keeps it unlocked past the timeout; its release starts a fresh full timeout', () => {
    const ctx = mount()
    let release = () => undefined as void
    act(() => {
      release = ctx().holdLock(10 * MIN)
    })
    act(() => jest.advanceTimersByTime(7 * MIN))
    expect(mockLockOutUser).not.toHaveBeenCalled()
    act(() => release())
    act(() => jest.advanceTimersByTime(5 * MIN - 1))
    expect(mockLockOutUser).not.toHaveBeenCalled()
    act(() => jest.advanceTimersByTime(1))
    expect(mockLockOutUser).toHaveBeenCalledTimes(1)
  })

  it('a hold never released still locks, by its end plus one timeout at most', () => {
    const ctx = mount()
    act(() => {
      ctx().holdLock(10 * MIN)
    })
    act(() => jest.advanceTimersByTime(10 * MIN - 1))
    expect(mockLockOutUser).not.toHaveBeenCalled()
    act(() => jest.advanceTimersByTime(5 * MIN + 1))
    expect(mockLockOutUser).toHaveBeenCalledTimes(1)
  })
})

// Gate efficiency item 3: a test build with E2E_CLOCKS=short locks after a
// minute, so a gate row can see the lock (and the hold keeping it off) quickly.
describe('the auto-lock default', () => {
  it('is five minutes for a wallet that never chose one', () => {
    mockSavedAutoLock = undefined
    mount()
    act(() => jest.advanceTimersByTime(5 * MIN - 1))
    expect(mockLockOutUser).not.toHaveBeenCalled()
    act(() => jest.advanceTimersByTime(1))
    expect(mockLockOutUser).toHaveBeenCalledWith('Timeout')
  })

  describe('in a test build with E2E_CLOCKS=short', () => {
    beforeEach(() => {
      config.E2E_CLOCKS = 'short'
    })

    it('is half a minute for a wallet that never chose one', () => {
      mockSavedAutoLock = undefined
      mount()
      act(() => jest.advanceTimersByTime(30_000 - 1))
      expect(mockLockOutUser).not.toHaveBeenCalled()
      act(() => jest.advanceTimersByTime(1))
      expect(mockLockOutUser).toHaveBeenCalledWith('Timeout')
    })

    it('gives way to a time the person saved', () => {
      mount()
      act(() => jest.advanceTimersByTime(5 * MIN - 1))
      expect(mockLockOutUser).not.toHaveBeenCalled()
      act(() => jest.advanceTimersByTime(1))
      expect(mockLockOutUser).toHaveBeenCalledTimes(1)
    })

    it('a hold for the 60 s grant window keeps the 30 s lock off until the hold ends', () => {
      mockSavedAutoLock = undefined
      const ctx = mount()
      act(() => jest.advanceTimersByTime(10_000))
      act(() => {
        ctx().holdLock(60_000)
      })
      // The lock fell due at 30 s and at 60 s, both inside the hold, and was re-armed each time.
      act(() => jest.advanceTimersByTime(60_000))
      expect(mockLockOutUser).not.toHaveBeenCalled()
      // Never released: it still locks, by the hold's end plus one timeout at most.
      act(() => jest.advanceTimersByTime(30_000))
      expect(mockLockOutUser).toHaveBeenCalledTimes(1)
    })
  })
})
