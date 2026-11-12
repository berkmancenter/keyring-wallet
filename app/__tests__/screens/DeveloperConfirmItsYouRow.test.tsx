/**
 * The Developer row "Confirm it's you", under Demos: off by default, shown unless its own remote off or the SEDI/KERI
 * umbrella is set (a saved "on" can't bring it back), and toggling it turns bifold's switch on, read live.
 */
import {
  AuthProvider,
  CONFIRM_ITS_YOU_REMOTE_OFF,
  SEDI_KERI_REMOTE_OFF,
  isConfirmItsYouEnabled,
  setConfirmItsYouEnabled,
  testIdWithKey,
} from '@bifold/core'
import { act, fireEvent, render } from '@testing-library/react-native'
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
  SEDI_KERI_REMOTE_OFF.off = false
  setConfirmItsYouEnabled(false)
})
afterEach(() => {
  jest.restoreAllMocks()
  CONFIRM_ITS_YOU_REMOTE_OFF.off = false
  SEDI_KERI_REMOTE_OFF.off = false
  setConfirmItsYouEnabled(false)
})

describe('Developer: the "Confirm it\'s you" row', () => {
  test('shows under Demos with everything off, and is off (control: the kills below hide it)', () => {
    const tree = shown()
    expect(tree.queryByTestId(ROW)).not.toBeNull()
    expect(isConfirmItsYouEnabled()).toBe(false)
  })

  test.each([
    ['its own remote off', () => (CONFIRM_ITS_YOU_REMOTE_OFF.off = true)],
    ['the SEDI/KERI umbrella', () => (SEDI_KERI_REMOTE_OFF.off = true)],
  ])('%s hides the row, even with the switch saved on, and the feature reads off', (_, off) => {
    setConfirmItsYouEnabled(true)
    off()
    expect(shown().queryByTestId(ROW)).toBeNull()
    expect(isConfirmItsYouEnabled()).toBe(false)
  })

  test("tapping the row turns bifold's switch on, and again turns it off (control: before the tap, off)", async () => {
    const tree = shown()
    expect(isConfirmItsYouEnabled()).toBe(false)
    await act(async () => fireEvent.press(tree.getByTestId(ROW)))
    expect(isConfirmItsYouEnabled()).toBe(true)
    await act(async () => fireEvent.press(tree.getByTestId(ROW)))
    expect(isConfirmItsYouEnabled()).toBe(false)
  })
})
