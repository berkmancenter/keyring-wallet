import { fireEvent, render, waitFor, act } from '@testing-library/react-native'
import React from 'react'

import { container } from 'tsyringe'
import { TOKENS } from '../../src/container-api'
import { MainContainer, defaultConfig } from '../../src/container-impl'
import { StoreProvider, defaultState } from '../../src/contexts/store'
import reducer from '../../src/contexts/reducers/store'
import TogglePushNotifications from '../../src/screens/TogglePushNotifications'
import { testIdWithKey } from '../../src/utils/testable'
import { CustomBasicAppContext } from '../helpers/app'

// Create a stable reducer reference for testing
const stableReducer = reducer

describe('TogglePushNotification Screen', () => {
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
      enablePushNotifications: { status, setup, toggle }
    }
    childContainer.registerInstance(TOKENS.CONFIG, configWithMock)
  })

  test('Push notification screen renders correctly in settings', async () => {
    const tree = render(
      <StoreProvider
        initialState={{
          ...defaultState,
        }}
        reducer={stableReducer}
      >
        <CustomBasicAppContext container={testContainer}>
          <TogglePushNotifications />
        </CustomBasicAppContext>
      </StoreProvider>
    )

    expect(tree).toMatchSnapshot()
    const toggleSwitch = tree.getByTestId(testIdWithKey('PushNotificationSwitch'))
    expect(toggleSwitch).not.toBe(null)
    
    await act(async () => {
      fireEvent(toggleSwitch, 'onValueChange', true)
    })
    
    await waitFor(() => {
      expect(setup).toHaveBeenCalledTimes(1)
      expect(toggle).toHaveBeenCalledTimes(1)
    })
  })
})
