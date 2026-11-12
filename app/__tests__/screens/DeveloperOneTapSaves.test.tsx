/**
 * The one-tap "Set up the SEDI demo" and its undo save every switch bifold turns (bifold #1041 added the state card
 * and Confirm it's you to the three): on any result but 'remoteOff' all five are saved on, so a restart matches what
 * bifold holds; 'remoteOff' saves nothing; the undo saves all five off.
 */
import { AuthProvider, PersistentStorage, SEDI_KERI_REMOTE_OFF, testIdWithKey } from '@bifold/core'
import { act, fireEvent, render } from '@testing-library/react-native'
import React from 'react'
import { Alert } from 'react-native'

import Developer from '../../src/screens/Developer'
import { BCLocalStorageKeys } from '../../src/store'
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
jest.mock('@bifold/core', () => ({
  ...jest.requireActual('@bifold/core'),
  setUpSediDemo: (agent: unknown) => mockSetUp(agent),
  turnOffSediDemo: () => mockTurnOff(),
}))

const DEMO = { setUp: testIdWithKey('SetUpSediDemo'), turnOff: testIdWithKey('TurnOffSediDemo') }
const FIVE = [
  BCLocalStorageKeys.EnableTrustedApprovers,
  BCLocalStorageKeys.EnableStateVerifiedApprovers,
  BCLocalStorageKeys.EnableTrustTestState,
  BCLocalStorageKeys.EnableStateCard,
  BCLocalStorageKeys.EnableConfirmItsYou,
]

let saves: jest.SpyInstance
/** What was saved for the five one-tap keys, in key order (undefined: not saved). */
const savedFive = () =>
  FIVE.map((key) => {
    const calls = saves.mock.calls.filter((c) => c[0] === key)
    return calls.length ? calls[calls.length - 1][1] : undefined
  })

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
  saves = jest.spyOn(PersistentStorage, 'storeValueForKey').mockImplementation(async () => undefined)
  SEDI_KERI_REMOTE_OFF.off = false
})
afterEach(() => {
  jest.restoreAllMocks()
  mockSetUp.mockClear()
  mockTurnOff.mockClear()
  SEDI_KERI_REMOTE_OFF.off = false
})

describe('Developer: the one-tap SEDI demo saves all five switches', () => {
  test.each(['done', 'cardNotHeld', 'wardNotSet'])(
    "a set-up that returns %s saves all five on, the state card and Confirm it's you included (control: before it, none)",
    async (result) => {
      mockSetUp.mockResolvedValueOnce(result)
      const tree = shown()
      expect(savedFive()).toEqual([undefined, undefined, undefined, undefined, undefined])
      await act(async () => fireEvent.press(tree.getByTestId(DEMO.setUp)))
      expect(savedFive()).toEqual([true, true, true, true, true])
    }
  )

  test('a set-up bifold refuses (remoteOff) saves none of the five (control: the done row above)', async () => {
    mockSetUp.mockResolvedValueOnce('remoteOff')
    const tree = shown()
    await act(async () => fireEvent.press(tree.getByTestId(DEMO.setUp)))
    expect(savedFive()).toEqual([undefined, undefined, undefined, undefined, undefined])
  })

  test('the undo saves all five off (control: after the set-up, all five on)', async () => {
    const tree = shown()
    await act(async () => fireEvent.press(tree.getByTestId(DEMO.setUp)))
    expect(savedFive()).toEqual([true, true, true, true, true])
    await act(async () => fireEvent.press(tree.getByTestId(DEMO.turnOff)))
    expect(mockTurnOff).toHaveBeenCalledTimes(1)
    expect(savedFive()).toEqual([false, false, false, false, false])
  })
})
