/**
 * The notifications switch in Settings exists only when the app supplies a push
 * configuration (`enablePushNotifications`). Keyring supplies one only in a
 * build that names a push gateway, so a tester's build never shows it.
 */
import { useNavigation } from '@react-navigation/native'
import { act, render } from '@testing-library/react-native'
import React from 'react'

import { StoreContext } from '../../src'
import { TOKENS } from '../../src/container-api'
import { defaultConfig } from '../../src/container-impl'
import { AuthContext } from '../../src/contexts/auth'
import Settings from '../../src/screens/Settings'
import { testIdWithKey } from '../../src/utils/testable'
import authContext from '../contexts/auth'
import { testDefaultState } from '../contexts/store'
import { BasicAppContext } from '../helpers/app'

async function renderSettings(config: typeof defaultConfig) {
  const tree = render(
    <StoreContext.Provider value={[testDefaultState, () => undefined]}>
      <BasicAppContext configure={(c) => c.container.registerInstance(TOKENS.CONFIG, config)}>
        <AuthContext.Provider value={authContext}>
          <Settings navigation={useNavigation()} route={{} as any} />
        </AuthContext.Provider>
      </BasicAppContext>
    </StoreContext.Provider>
  )
  await act(async () => {})
  return tree
}

describe('the notifications switch in Settings', () => {
  it('is absent without a push configuration', async () => {
    const tree = await renderSettings({ ...defaultConfig, enablePushNotifications: undefined })
    expect(tree.queryByTestId(testIdWithKey('Notifications'))).toBeNull()
  })

  it('is listed once when the app supplies one', async () => {
    const enablePushNotifications = {
      status: jest.fn().mockResolvedValue('unknown' as const),
      setup: jest.fn().mockResolvedValue('granted' as const),
      toggle: jest.fn(),
    }
    const tree = await renderSettings({ ...defaultConfig, enablePushNotifications })
    expect(tree.getAllByTestId(testIdWithKey('Notifications'))).toHaveLength(1)
    expect(enablePushNotifications.setup).not.toHaveBeenCalled()
  })
})
