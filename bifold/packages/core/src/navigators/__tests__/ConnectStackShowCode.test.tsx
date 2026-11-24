/**
 * "Show a code" is a route of the Connect stack (plan WP9), reached from the QR sheet's button. With the real
 * navigators: the route is registered, and its screen runs the invite hook only while the inviter switch is on.
 */
import { render } from '@testing-library/react-native'
import React from 'react'

import { BasicAppContext } from '../../../__tests__/helpers/app'
import {
  setSharedConnectEnabled,
  setSharedConnectInviteEnabled,
} from '../../modules/trust-tasks/module/sharedConnectFlag'
import { SharedConnectInviteIds as Ids } from '../../modules/trust-tasks/screens/SharedConnect.ids'
import { Screens } from '../../types/navigators'
import { testIdWithKey } from '../../utils/testable'
import ConnectStack from '../ConnectStack'

jest.unmock('@react-navigation/native')
jest.unmock('@react-navigation/core')
jest.unmock('@react-navigation/stack')
jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const mockUseInvite = jest.fn(() => ({
  state: 'waiting' as const,
  link: 'https://link.trustoverip.org/t#_from=did:peer:2.x',
  expiresAt: Math.floor(Date.now() / 1000) + 600,
  cancel: jest.fn(async () => undefined),
  renew: jest.fn(),
}))
jest.mock('../../modules/trust-tasks/module/useSharedConnectInvite', () => ({
  useSharedConnectInvite: () => mockUseInvite(),
}))

const { NavigationContainer } = jest.requireActual('@react-navigation/native')

const open = () =>
  render(
    <BasicAppContext>
      <NavigationContainer initialState={{ routes: [{ name: Screens.SharedConnectInvite }] }}>
        <ConnectStack />
      </NavigationContainer>
    </BasicAppContext>
  )

beforeEach(() => mockUseInvite.mockClear())
afterEach(() => {
  setSharedConnectInviteEnabled(false)
  setSharedConnectEnabled(false)
})

describe('the Show a code route', () => {
  it('with the inviter switch off, opens and starts nothing', async () => {
    const tree = open()
    expect(await tree.findByTestId(testIdWithKey(Ids.off))).toBeTruthy()
    expect(mockUseInvite).not.toHaveBeenCalled()
  })

  it('with it on, runs the invite hook and shows the code', async () => {
    setSharedConnectEnabled(true)
    setSharedConnectInviteEnabled(true)
    const tree = open()
    expect(await tree.findByTestId(testIdWithKey(Ids.qr))).toBeTruthy()
    expect(mockUseInvite).toHaveBeenCalled()
  })
})
