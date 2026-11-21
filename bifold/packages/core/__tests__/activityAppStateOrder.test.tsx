/**
 * AppState events handled one at a time, in order, each against the state it found. Background and active can arrive
 * in one tick: the active handler used to read the previous state only after the background handler's await, so it
 * saw 'active' and skipped the foreground branch; run side by side, a pickup restart could also finish before the
 * stop it follows.
 */
import { act, render } from '@testing-library/react-native'
import React from 'react'
import { AppState, AppStateStatus } from 'react-native'

import { ActivityProvider, APP_STATE_STEP_WAIT_MS } from '../src/contexts/activity'

const mockLockOutUser = jest.fn()
jest.mock('../src/contexts/auth', () => ({
  useAuth: () => ({ lockOutUser: mockLockOutUser }),
  LockoutReason: { Timeout: 'Timeout' },
}))
const mockAgent = { modules: {} }
jest.mock('../src/utils/agent', () => ({ useAppAgent: () => ({ agent: mockAgent }) }))
jest.mock('../src/contexts/store', () => ({ useStore: () => [{ preferences: { autoLockTime: 5 } }] }))
jest.mock('react-native-config', () => ({ __esModule: true, default: {} }))
const mockCalls: string[] = []
let mockFinishStop: () => void = () => undefined
const mockLifecycle = {
  onBackground: jest.fn(
    () =>
      new Promise<void>((resolve) => {
        mockCalls.push('stop started')
        mockFinishStop = () => {
          mockCalls.push('stop finished')
          resolve()
        }
      })
  ),
  onForeground: jest.fn(async () => {
    mockCalls.push('restart')
  }),
}
// Stable across renders, as the container's are: the provider's listener effect depends on them, and a fresh logger per
// render would re-run it (and restart the inactivity clock) after every event.
const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
const mockConfig = {}
jest.mock('../src/container-api', () => ({
  TOKENS: { UTIL_LOGGER: 'logger', CONFIG: 'config', UTIL_MESSAGE_PICKUP: 'messagePickup' },
  useServices: () => [mockLogger, mockConfig, mockLifecycle],
}))

const MIN = 60_000

/** Lets every queued promise callback run; setImmediate is left real for this. */
const flush = () => new Promise((resolve) => setImmediate(resolve))

describe('ActivityProvider: background and active in one tick', () => {
  let onChange: (state: AppStateStatus) => Promise<void> | void

  beforeAll(() => {
    // jestSetup pins Date.now; the inactivity check reads it, so these tests move a real (faked-timer) clock instead.
    jest.spyOn(Date, 'now').mockRestore()
  })

  beforeEach(() => {
    jest.clearAllMocks()
    mockCalls.length = 0
    jest.useFakeTimers({ now: new Date('2026-10-26T09:00:00Z'), doNotFake: ['setImmediate'] })
    Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true })
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
      onChange = handler as typeof onChange
      return { remove: jest.fn() } as any
    })
    render(<ActivityProvider>{null}</ActivityProvider>)
  })
  afterEach(() => jest.useRealTimers())

  it('away past the auto-lock: the foreground branch still runs', async () => {
    // The phone was away 6.5 min, and both events reach JS together on the way back. No timer runs meanwhile.
    jest.setSystemTime(Date.now() + 6.5 * MIN)
    await act(async () => {
      const background = onChange('background')
      const active = onChange('active')
      await flush()
      mockFinishStop()
      await Promise.all([background, active])
    })
    expect(mockLockOutUser).toHaveBeenCalledWith('Timeout')
    expect(mockLifecycle.onForeground).not.toHaveBeenCalled()
  })

  it('a short absence: pickup is restarted, and only once the stop before it has finished', async () => {
    jest.setSystemTime(Date.now() + 10_000)
    let active: Promise<void> | void
    await act(async () => {
      const background = onChange('background')
      active = onChange('active')
      // The stop is still running: nothing restarts under it.
      await flush()
      expect(mockCalls).toEqual(['stop started'])
      mockFinishStop()
      await Promise.all([background, active])
    })
    expect(mockCalls).toEqual(['stop started', 'stop finished', 'restart'])
    expect(mockLockOutUser).not.toHaveBeenCalled()
  })

  it('a stop that never finishes holds the next change for the bound only, then the return is handled', async () => {
    jest.setSystemTime(Date.now() + 6.5 * MIN)
    let active: Promise<void> | void
    await act(async () => {
      void onChange('background')
      active = onChange('active')
      await flush()
    })
    // Held behind the stalled stop.
    expect(mockCalls).toEqual(['stop started'])
    expect(mockLockOutUser).not.toHaveBeenCalled()
    await act(async () => {
      jest.advanceTimersByTime(APP_STATE_STEP_WAIT_MS)
      await active
    })
    expect(mockLockOutUser).toHaveBeenCalledWith('Timeout')
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('active -> background still running'))
  })

  it('events a moment apart are handled as before (the control for the same-tick cases)', async () => {
    jest.setSystemTime(Date.now() + 6.5 * MIN)
    await act(async () => {
      const background = onChange('background')
      await flush()
      mockFinishStop()
      await background
    })
    await act(async () => {
      await onChange('active')
    })
    expect(mockLockOutUser).toHaveBeenCalledWith('Timeout')
  })
})
