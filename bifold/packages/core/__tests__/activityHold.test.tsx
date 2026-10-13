/**
 * CREATE-WAIT-LOCK: a person waiting on Create for their agent, without
 * touching the phone, was locked out after 5 minutes and lost the screen. A
 * screen can hold the auto-lock off, for a bounded time only.
 */
import { act, render } from '@testing-library/react-native'
import React, { useContext } from 'react'

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
jest.mock('../src/contexts/store', () => ({ useStore: () => [{ preferences: { autoLockTime: 5 } }] }))
jest.mock('../src/container-api', () => ({
  TOKENS: { UTIL_LOGGER: 'logger', CONFIG: 'config' },
  useServices: () => [{ info: jest.fn(), error: jest.fn() }, {}],
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

beforeEach(() => {
  jest.useFakeTimers()
  mockLockOutUser.mockClear()
})
afterEach(() => jest.useRealTimers())

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
