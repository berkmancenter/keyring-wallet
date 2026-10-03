import { fireEvent, render, waitFor, act } from '@testing-library/react-native'
import React from 'react'

import { container } from 'tsyringe'
import { TOKENS } from '../../src/container-api'
import { MainContainer, defaultConfig } from '../../src/container-impl'
import { StoreProvider, defaultState, useStore } from '../../src/contexts/store'
import reducer from '../../src/contexts/reducers/store'
import PushNotifications from '../../src/screens/PushNotifications'
import { testIdWithKey } from '../../src/utils/testable'
import { CustomBasicAppContext } from '../helpers/app'

// Create a stable reducer reference for testing
const stableReducer = reducer

describe('PushNotifications Screen', () => {
  let setup: jest.Mock
  let toggle: jest.Mock
  let status: jest.Mock
  let testContainer: ReturnType<typeof MainContainer.prototype.init>

  beforeEach(() => {
    jest.clearAllMocks()
    setup = jest.fn().mockResolvedValue('granted')
    toggle = jest.fn()
    status = jest.fn().mockResolvedValue('denied')

    // Create a fresh child container for each test
    const childContainer = container.createChildContainer()

    // Init the container first
    testContainer = new MainContainer(childContainer).init()

    // Override CONFIG AFTER init (like BasicAppContext does with UTIL_LOGGER)
    const configWithMock = {
      ...defaultConfig,
      enablePushNotifications: { status, setup, toggle },
    }
    childContainer.registerInstance(TOKENS.CONFIG, configWithMock)
  })

  test('Push notification screen renders correctly in onboarding', async () => {
    const tree = render(
      <StoreProvider
        initialState={{
          ...defaultState,
        }}
        reducer={stableReducer}
      >
        <CustomBasicAppContext container={testContainer}>
          <PushNotifications />
        </CustomBasicAppContext>
      </StoreProvider>
    )

    expect(tree).toMatchSnapshot()
    const continueButton = tree.getByTestId(testIdWithKey('PushNotificationContinue'))
    expect(continueButton).not.toBe(null)

    await act(async () => {
      fireEvent.press(continueButton)
    })

    await waitFor(() => {
      expect(setup).toHaveBeenCalledTimes(1)
    })
  })

  // "Not now" answers the step with notifications off and never asks the
  // system, so its once-per-install prompt stays for Settings later.
  test('"Not now" records the step as answered, notifications off, without the system prompt', async () => {
    const seen: Array<{ considered: boolean; use: boolean }> = []
    const Spy: React.FC = () => {
      const [state] = useStore()
      seen.push({
        considered: state.onboarding.didConsiderPushNotifications,
        use: state.preferences.usePushNotifications,
      })
      return null
    }
    const tree = render(
      <StoreProvider initialState={{ ...defaultState }} reducer={stableReducer}>
        <CustomBasicAppContext container={testContainer}>
          <PushNotifications />
          <Spy />
        </CustomBasicAppContext>
      </StoreProvider>
    )
    expect(tree.getByTestId(testIdWithKey('PushNotificationContinue'))).toHaveTextContent('PushNotifications.TurnOn')
    await act(async () => {
      fireEvent.press(tree.getByTestId(testIdWithKey('PushNotificationNotNow')))
    })
    expect(setup).not.toHaveBeenCalled()
    expect(seen[seen.length - 1]).toEqual({ considered: true, use: false })
  })

  test('says what a notification shows, and that the choice can change later', () => {
    const tree = render(
      <StoreProvider initialState={{ ...defaultState }} reducer={stableReducer}>
        <CustomBasicAppContext container={testContainer}>
          <PushNotifications />
        </CustomBasicAppContext>
      </StoreProvider>
    )
    expect(tree.getByTestId(testIdWithKey('PushNotificationWhatItSays'))).toHaveTextContent(
      'PushNotifications.WhatItSays'
    )
    expect(tree.getByTestId(testIdWithKey('PushNotificationChangeLater'))).toHaveTextContent(
      'PushNotifications.ChangeLater'
    )
  })
})
