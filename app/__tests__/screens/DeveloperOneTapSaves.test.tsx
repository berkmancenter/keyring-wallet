/**
 * The two demo set-ups ("Set up as the guardian" / "Set up as the person", C1) and the undo save every switch bifold
 * turns, so a restart matches what bifold holds: the guardian saves all five on; the person saves four on and the
 * state card OFF (bifold turns it off there: the person holds no card); 'remoteOff' saves nothing; the undo saves all
 * five off.
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
const mockSetUp = jest.fn<Promise<string>, [unknown, string]>(async () => 'done')
const mockTurnOff = jest.fn<void, []>()
jest.mock('@bifold/core', () => ({
  ...jest.requireActual('@bifold/core'),
  setUpSediDemoAsGuardian: (agent: unknown) => mockSetUp(agent, 'guardian'),
  setUpSediDemoAsPerson: (agent: unknown) => mockSetUp(agent, 'person'),
  turnOffSediDemo: () => mockTurnOff(),
}))

const DEMO = {
  guardian: testIdWithKey('SetUpSediDemoGuardian'),
  person: testIdWithKey('SetUpSediDemoPerson'),
  turnOff: testIdWithKey('TurnOffSediDemo'),
}
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

describe('Developer: each demo set-up saves the switches bifold turned', () => {
  // [side, what the five keys are saved as]: the state card is the fourth key.
  const SAVED = {
    guardian: [true, true, true, true, true],
    person: [true, true, true, false, true],
  } as const

  test.each([
    ['guardian', 'done'],
    ['guardian', 'cardNotHeld'],
    ['guardian', 'wardNotCleared'],
    ['person', 'done'],
    ['person', 'wardNotSet'],
    ['person', 'cardNotRemoved'],
  ] as const)('the %s set-up returning %s saves its switches (control: before it, none)', async (side, result) => {
    mockSetUp.mockResolvedValueOnce(result)
    const tree = shown()
    expect(savedFive()).toEqual([undefined, undefined, undefined, undefined, undefined])
    await act(async () => fireEvent.press(tree.getByTestId(DEMO[side])))
    expect(mockSetUp).toHaveBeenCalledWith(mockAgent, side)
    expect(savedFive()).toEqual(SAVED[side])
  })

  test("the person after the guardian on one phone saves the state card OFF (a restart can't bring it back)", async () => {
    const tree = shown()
    await act(async () => fireEvent.press(tree.getByTestId(DEMO.guardian)))
    expect(savedFive()[3]).toBe(true)
    await act(async () => fireEvent.press(tree.getByTestId(DEMO.person)))
    expect(savedFive()).toEqual(SAVED.person)
  })

  test.each(['guardian', 'person'] as const)(
    'a %s set-up bifold refuses (remoteOff) saves none of the five (control: the done rows above)',
    async (side) => {
      mockSetUp.mockResolvedValueOnce('remoteOff')
      const tree = shown()
      await act(async () => fireEvent.press(tree.getByTestId(DEMO[side])))
      expect(savedFive()).toEqual([undefined, undefined, undefined, undefined, undefined])
    }
  )

  test('the undo saves all five off (control: after the set-up, all five on)', async () => {
    const tree = shown()
    await act(async () => fireEvent.press(tree.getByTestId(DEMO.guardian)))
    expect(savedFive()).toEqual(SAVED.guardian)
    await act(async () => fireEvent.press(tree.getByTestId(DEMO.turnOff)))
    expect(mockTurnOff).toHaveBeenCalledTimes(1)
    expect(savedFive()).toEqual([false, false, false, false, false])
  })
})
