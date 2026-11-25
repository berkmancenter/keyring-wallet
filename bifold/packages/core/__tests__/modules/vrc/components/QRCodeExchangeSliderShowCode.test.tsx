/**
 * The QR Code Exchange sheet's third button, "Show a code for any wallet app"
 * (plan WP9): there only while the inviter switch is on, and it opens the Show a
 * code screen in the Connect stack.
 */
import { act, fireEvent, render } from '@testing-library/react-native'
import React from 'react'

import QRCodeExchangeSlider from '../../../../src/modules/vrc/components/QRCodeExchangeSlider'
import {
  setSharedConnectEnabled,
  setSharedConnectInviteEnabled,
} from '../../../../src/modules/trust-tasks/module/sharedConnectFlag'
import { Screens, Stacks } from '../../../../src/types/navigators'
import { testIdWithKey } from '../../../../src/utils/testable'
import { BasicAppContext } from '../../../helpers/app'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const BUTTON = testIdWithKey('ShowSharedConnectCode')
const navigation = { navigate: jest.fn() }
const show = () =>
  render(
    <BasicAppContext>
      <QRCodeExchangeSlider visible={true} onDismiss={jest.fn()} navigation={navigation as never} />
    </BasicAppContext>
  )

beforeEach(() => navigation.navigate.mockReset())
afterEach(() => {
  setSharedConnectEnabled(false)
  setSharedConnectInviteEnabled(false)
  jest.useRealTimers()
})

describe('the Show a code button in the QR sheet', () => {
  it.each([
    ['both switches off', false, false],
    ['shared-connect on, the inviter off (the default)', true, false],
    ['the inviter on, shared-connect off', false, true],
  ])('is not there with %s', (_, sharedConnect, invite) => {
    setSharedConnectEnabled(sharedConnect)
    setSharedConnectInviteEnabled(invite)
    const tree = show()
    expect(tree.queryByTestId(BUTTON)).toBeNull()
    // The two settled ways to connect are untouched.
    expect(tree.getByTestId(testIdWithKey('ScanQRCode'))).toBeTruthy()
    expect(tree.getByTestId(testIdWithKey('GenerateRelationshipQRCode'))).toBeTruthy()
  })

  it('is there with both on, marked experimental, and opens the Show a code screen', () => {
    jest.useFakeTimers()
    setSharedConnectEnabled(true)
    setSharedConnectInviteEnabled(true)
    const tree = show()
    expect(tree.getByText('SharedConnectInvite.Button')).toBeTruthy()
    expect(tree.getByText('SharedConnectInvite.ButtonNote')).toBeTruthy()
    fireEvent.press(tree.getByTestId(BUTTON))
    act(() => {
      jest.advanceTimersByTime(500)
    })
    expect(navigation.navigate).toHaveBeenCalledWith(Stacks.ConnectStack, { screen: Screens.SharedConnectInvite })
  })
})
