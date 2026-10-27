import { useAgent } from '@bifold/react-hooks'
import { render } from '@testing-library/react-native'
import React from 'react'
import { AppState, AppStateStatus } from 'react-native'

import PickupWindowListener from '@/components/PickupWindowListener'
import { startPickupBoost } from '@/utils/pickupBoost'

jest.mock('@bifold/react-hooks')
jest.mock('@/utils/pickupBoost', () => ({ ...jest.requireActual('@/utils/pickupBoost'), startPickupBoost: jest.fn() }))
// The root navigation, with Home in front: no screen that holds the window open.
const mockUnsubscribeState = jest.fn()
const mockNavigation = {
  getParent: () => undefined,
  getState: () => ({ index: 0, routes: [{ name: 'Home' }] }),
  addListener: jest.fn(() => mockUnsubscribeState),
}
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => mockNavigation,
}))

const mockUseAgent = useAgent as jest.MockedFunction<typeof useAgent>
const mockStartPickupBoost = startPickupBoost as jest.MockedFunction<typeof startPickupBoost>

describe('PickupWindowListener', () => {
  let appStateHandler: ((state: AppStateStatus) => void) | undefined
  const remove = jest.fn()
  const boost = jest.fn()
  const stop = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
    appStateHandler = undefined
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
      appStateHandler = handler as (state: AppStateStatus) => void
      return { remove } as ReturnType<typeof AppState.addEventListener>
    })
    mockStartPickupBoost.mockReturnValue({ boost, stop })
  })

  it('opens the pickup window as soon as the agent is there, and again on each return to the foreground', () => {
    const agent = {} as any
    mockUseAgent.mockReturnValue({ agent } as any)
    const { unmount } = render(<PickupWindowListener />)
    expect(mockStartPickupBoost).toHaveBeenCalledWith(agent, expect.anything())
    expect(boost).toHaveBeenCalledTimes(1)
    appStateHandler?.('background')
    expect(boost).toHaveBeenCalledTimes(1)
    appStateHandler?.('active')
    expect(boost).toHaveBeenCalledTimes(2)
    unmount()
    expect(stop).toHaveBeenCalledTimes(1)
    expect(remove).toHaveBeenCalledTimes(1)
    expect(mockUnsubscribeState).toHaveBeenCalledTimes(1)
  })

  it('does nothing without an agent', () => {
    mockUseAgent.mockReturnValue({ agent: undefined } as any)
    render(<PickupWindowListener />)
    expect(mockStartPickupBoost).not.toHaveBeenCalled()
  })
})
