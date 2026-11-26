/**
 * ActivityProvider restarts mediator pickup through TOKENS.UTIL_MESSAGE_PICKUP,
 * never with a strategy of its own: a hard-coded PickUpV2 here would move a
 * live-mode app back to polling on every return to the foreground.
 */
import { act, render } from '@testing-library/react-native'
import React from 'react'
import { AppState, AppStateStatus } from 'react-native'

import { ActivityProvider } from '../src/contexts/activity'

const mockLockOutUser = jest.fn()
jest.mock('../src/contexts/auth', () => ({
  useAuth: () => ({ lockOutUser: mockLockOutUser }),
  LockoutReason: { Timeout: 'Timeout' },
}))
const mockRecipient = { stopMessagePickup: jest.fn(), initiateMessagePickup: jest.fn() }
const mockAgent = { modules: { didcomm: { mediationRecipient: mockRecipient } } }
jest.mock('../src/utils/agent', () => ({ useAppAgent: () => ({ agent: mockAgent }) }))
jest.mock('../src/contexts/store', () => ({ useStore: () => [{ preferences: { autoLockTime: 5 } }] }))
jest.mock('react-native-config', () => ({ __esModule: true, default: {} }))
const mockLifecycle = { onBackground: jest.fn(async () => undefined), onForeground: jest.fn(async () => undefined) }
jest.mock('../src/container-api', () => ({
  TOKENS: { UTIL_LOGGER: 'logger', CONFIG: 'config', UTIL_MESSAGE_PICKUP: 'messagePickup' },
  useServices: () => [{ info: jest.fn(), error: jest.fn() }, {}, mockLifecycle],
}))

describe('ActivityProvider message pickup', () => {
  let onChange: (state: AppStateStatus) => Promise<void>

  beforeEach(() => {
    jest.clearAllMocks()
    // The provider reads the starting state; background only counts when leaving the foreground.
    Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true })
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
      onChange = handler as typeof onChange
      return { remove: jest.fn() } as any
    })
    render(<ActivityProvider>{null}</ActivityProvider>)
  })

  it('hands background and foreground to the registered lifecycle', async () => {
    await act(async () => {
      await onChange('background')
    })
    expect(mockLifecycle.onBackground).toHaveBeenCalledWith(mockAgent)

    await act(async () => {
      await onChange('active')
    })
    expect(mockLifecycle.onForeground).toHaveBeenCalledWith(mockAgent)
    expect(mockLockOutUser).not.toHaveBeenCalled()
  })

  it('never calls credo pickup itself', async () => {
    await act(async () => {
      await onChange('background')
      await onChange('active')
    })
    // Positive control: both transitions reached the provider's pickup branches.
    expect(mockLifecycle.onBackground).toHaveBeenCalledTimes(1)
    expect(mockLifecycle.onForeground).toHaveBeenCalledTimes(1)
    expect(mockRecipient.stopMessagePickup).not.toHaveBeenCalled()
    expect(mockRecipient.initiateMessagePickup).not.toHaveBeenCalled()
  })
})
