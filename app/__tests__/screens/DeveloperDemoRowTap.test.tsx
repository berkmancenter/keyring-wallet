/**
 * Developer › Demos: "Set up the SEDI demo" takes the tap on its words, not only on its arrow. On 278.16 Alberto
 * needed two taps: the title sat outside the row's Pressable, so a tap on the words did nothing. A switch row keeps
 * its old shape (its title still takes no tap), so a Switch inside a pressable row can never toggle twice.
 *
 * Taps on words use userEvent.press, which presses the HOST element the way a finger does. fireEvent.press would also
 * reach a composite parent's onPress (SectionRow's own prop), so it reads a tap on the words as handled even when the
 * words sit outside the Pressable: these rows passed with it on the old code.
 */
import { AuthProvider, PersistentStorage, SEDI_KERI_REMOTE_OFF, testIdWithKey } from '@bifold/core'
import { act, fireEvent, render, userEvent, within } from '@testing-library/react-native'
import React from 'react'
import { Alert } from 'react-native'

import Developer from '../../src/screens/Developer'
import { BasicAppContext } from '../../__mocks__/helpers/app'

const mockNavigation = jest.fn()
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => mockNavigation,
}))
const mockAgent = { genericRecords: {} }
jest.mock('@bifold/react-hooks', () => ({
  ...jest.requireActual('@bifold/react-hooks'),
  useAgent: () => ({ agent: mockAgent }),
}))
const mockSetUp = jest.fn<Promise<string>, [unknown]>(async () => 'done')
const mockTurnOff = jest.fn<void, []>()
const mockSetConfirm = jest.fn<void, [boolean]>()
jest.mock('@bifold/core', () => ({
  ...jest.requireActual('@bifold/core'),
  setUpSediDemo: (agent: unknown) => mockSetUp(agent),
  turnOffSediDemo: () => mockTurnOff(),
  setConfirmItsYouEnabled: (on: boolean) => mockSetConfirm(on),
}))

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
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined)
  jest.spyOn(PersistentStorage, 'storeValueForKey').mockImplementation(async () => undefined)
  SEDI_KERI_REMOTE_OFF.off = false
})
afterEach(() => {
  jest.restoreAllMocks()
  mockSetUp.mockClear()
  mockTurnOff.mockClear()
  mockSetConfirm.mockClear()
  SEDI_KERI_REMOTE_OFF.off = false
})

describe('Developer › Demos: the whole action row takes the tap', () => {
  test('one tap on the words "Set up the SEDI demo" runs the set-up once', async () => {
    const tree = shown()
    await userEvent.setup().press(tree.getByText('Developer.SetUpSediDemo'))
    expect(mockSetUp).toHaveBeenCalledTimes(1)
  })

  test('the row is one button, under the same test ID, labelled with its words', () => {
    const tree = shown()
    const row = tree.getByTestId(testIdWithKey('SetUpSediDemo'))
    expect(row.props.accessibilityRole).toBe('button')
    expect(row.props.accessibilityLabel).toBe('Developer.SetUpSediDemo')
    // The words are inside it, so the tap above landed on the row itself.
    expect(within(row).getByText('Developer.SetUpSediDemo')).toBeTruthy()
  })

  test('a tap on the words "Turn off the SEDI demo" turns it off (after a set-up shows the row)', async () => {
    const tree = shown()
    await userEvent.setup().press(tree.getByText('Developer.SetUpSediDemo'))
    await userEvent.setup().press(tree.getByText('Developer.TurnOffSediDemo'))
    expect(mockTurnOff).toHaveBeenCalledTimes(1)
  })

  test("control: a switch row's words still take no tap (Confirm it's you stays as it was)", async () => {
    const tree = shown()
    await userEvent.setup().press(tree.getByText('Developer.EnableConfirmItsYou'))
    expect(mockSetConfirm).not.toHaveBeenCalled()
    // ...while its own pressable still toggles it, so the control can fail.
    await act(async () => fireEvent.press(tree.getByTestId(testIdWithKey('ToggleEnableConfirmItsYou'))))
    expect(mockSetConfirm).toHaveBeenCalledTimes(1)
  })
})
