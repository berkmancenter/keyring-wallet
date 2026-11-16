/**
 * The two demo switches ("Guardian demo" / "Ward demo", 278.19) save every switch bifold turns, and the side, so a
 * restart matches what bifold holds: the guardian saves all four on; the ward saves three on and the state card OFF
 * (bifold turns it off there: the ward holds no card); 'remoteOff' saves nothing; turning the side off saves all four
 * off and no side. Confirm it's you is its own switch (278.19): the demo never saves it, either way.
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
  setUpSediDemoAsWard: (agent: unknown) => mockSetUp(agent, 'ward'),
  turnOffSediDemo: () => mockTurnOff(),
}))

const DEMO = {
  guardian: testIdWithKey('SediDemoGuardian'),
  ward: testIdWithKey('SediDemoWard'),
}
const FOUR = [
  BCLocalStorageKeys.EnableTrustedApprovers,
  BCLocalStorageKeys.EnableStateVerifiedApprovers,
  BCLocalStorageKeys.EnableTrustTestState,
  BCLocalStorageKeys.EnableStateCard,
]

let saves: jest.SpyInstance
/** The last value saved for `key` (undefined: never saved). */
const savedAt = (key: string) => {
  const calls = saves.mock.calls.filter((c) => c[0] === key)
  return calls.length ? calls[calls.length - 1][1] : undefined
}
/** What was saved for the four demo keys, in key order. */
const savedFour = () => FOUR.map(savedAt)
const savedSide = () => savedAt(BCLocalStorageKeys.SediDemoSide)
const savedConfirm = () => savedAt(BCLocalStorageKeys.EnableConfirmItsYou)

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

describe('Developer: each demo switch saves the switches bifold turned, and its side', () => {
  // [side, what the four keys are saved as]: the state card is the fourth key.
  const SAVED = {
    guardian: [true, true, true, true],
    ward: [true, true, true, false],
  } as const

  test.each([
    ['guardian', 'done'],
    ['guardian', 'cardNotHeld'],
    ['guardian', 'wardNotCleared'],
    ['ward', 'done'],
    ['ward', 'wardNotSet'],
    ['ward', 'cardNotRemoved'],
  ] as const)(
    'the %s side returning %s saves its switches and its side (control: before it, none)',
    async (side, result) => {
      mockSetUp.mockResolvedValueOnce(result)
      const tree = shown()
      expect(savedFour()).toEqual([undefined, undefined, undefined, undefined])
      expect(savedSide()).toBeUndefined()
      await act(async () => fireEvent.press(tree.getByTestId(DEMO[side])))
      expect(mockSetUp).toHaveBeenCalledWith(mockAgent, side)
      expect(savedFour()).toEqual(SAVED[side])
      expect(savedSide()).toBe(side)
    }
  )

  test("Confirm it's you is never saved by the demo, on or off (it is its own switch)", async () => {
    const tree = shown()
    await act(async () => fireEvent.press(tree.getByTestId(DEMO.guardian)))
    await act(async () => fireEvent.press(tree.getByTestId(DEMO.ward)))
    await act(async () => fireEvent.press(tree.getByTestId(DEMO.ward)))
    expect(savedConfirm()).toBeUndefined()
    // Control: its own row does save it.
    await act(async () => fireEvent.press(tree.getByTestId(testIdWithKey('ToggleEnableConfirmItsYou'))))
    expect(savedConfirm()).toBe(true)
  })

  test("the ward after the guardian on one phone saves the state card OFF and the side ward (a restart can't bring either back)", async () => {
    const tree = shown()
    await act(async () => fireEvent.press(tree.getByTestId(DEMO.guardian)))
    expect(savedFour()[3]).toBe(true)
    await act(async () => fireEvent.press(tree.getByTestId(DEMO.ward)))
    expect(savedFour()).toEqual(SAVED.ward)
    expect(savedSide()).toBe('ward')
  })

  test.each(['guardian', 'ward'] as const)(
    'a %s side bifold refuses (remoteOff) saves none of the four, and no side (control: the done rows above)',
    async (side) => {
      mockSetUp.mockResolvedValueOnce('remoteOff')
      const tree = shown()
      await act(async () => fireEvent.press(tree.getByTestId(DEMO[side])))
      expect(savedFour()).toEqual([undefined, undefined, undefined, undefined])
      expect(savedSide()).toBeUndefined()
    }
  )

  test('turning the side off saves all four off and no side (control: after the set-up, all four on)', async () => {
    const tree = shown()
    await act(async () => fireEvent.press(tree.getByTestId(DEMO.guardian)))
    expect(savedFour()).toEqual(SAVED.guardian)
    await act(async () => fireEvent.press(tree.getByTestId(DEMO.guardian)))
    expect(mockTurnOff).toHaveBeenCalledTimes(1)
    expect(savedFour()).toEqual([false, false, false, false])
    expect(savedSide()).toBe('')
  })
})
