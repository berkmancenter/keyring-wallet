/**
 * The Developer screen no longer has a "Confirm it's you" row. It was a switch under Demos while the feature was a
 * demo; the feature is part of the app now and has no setting (Alberto, 2026-11-18), so nothing on this screen can
 * turn it on or off. The Demos section itself stays, for the Guardian and ward demos.
 */
import {
  AuthProvider,
  CONFIRM_ITS_YOU_REMOTE_OFF,
  isConfirmItsYouEnabled,
  setConfirmItsYouEnabled,
  testIdWithKey,
} from '@bifold/core'
import { render } from '@testing-library/react-native'
import React from 'react'

import Developer from '../../src/screens/Developer'
import { BasicAppContext } from '../../__mocks__/helpers/app'

const mockNavigation = jest.fn()
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => mockNavigation,
}))
jest.mock('@bifold/react-hooks', () => ({
  ...jest.requireActual('@bifold/react-hooks'),
  useAgent: () => ({ agent: { genericRecords: {} } }),
}))

const ROW = testIdWithKey('ToggleEnableConfirmItsYou')

const shown = () =>
  render(
    <BasicAppContext>
      <AuthProvider>
        <Developer />
      </AuthProvider>
    </BasicAppContext>
  )

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => null)
  CONFIRM_ITS_YOU_REMOTE_OFF.off = false
})
afterEach(() => {
  jest.restoreAllMocks()
  CONFIRM_ITS_YOU_REMOTE_OFF.off = false
  setConfirmItsYouEnabled(false)
})

describe('Developer: "Confirm it\'s you" is not a setting here', () => {
  test.each([
    ['on', true],
    ['off', false],
  ])('with the feature %s, there is no row for it (control: the Diagnostics section is shown)', (_, on) => {
    setConfirmItsYouEnabled(on)
    const tree = shown()
    expect(tree.queryByTestId(ROW)).toBeNull()
    expect(tree.queryByText('Developer.EnableConfirmItsYou')).toBeNull()
    expect(tree.getByText('Diagnostics')).toBeTruthy()
  })

  test('showing the screen changes nothing about the feature: on stays on, off stays off', () => {
    setConfirmItsYouEnabled(true)
    shown()
    expect(isConfirmItsYouEnabled()).toBe(true)
    setConfirmItsYouEnabled(false)
    shown()
    expect(isConfirmItsYouEnabled()).toBe(false)
  })
})
