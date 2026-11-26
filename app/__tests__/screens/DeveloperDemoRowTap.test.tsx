/**
 * Developer › Demos: an action row takes the tap on its words, not only on its arrow. On 278.16 Alberto needed two taps
 * on "Set up the SEDI demo": the title sat outside the row's Pressable. A switch row keeps its old shape (its words take
 * no tap), so a Switch inside a pressable row can never toggle twice. The demo's two sides are switch rows since 278.19
 * ("Guardian demo" / "Ward demo"): each takes its tap on the switch, once, and shows its plain line beside it.
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
const mockSetUp = jest.fn<Promise<string>, [unknown, string]>(async () => 'done')
const mockTurnOff = jest.fn<void, []>()
const mockSetTrusted = jest.fn<void, [boolean]>()
/** The four K0 test-state actions, each its own mock, so a row reaching the wrong one fails. */
const mockK0 = {
  holdK0TestGuardianCard: jest.fn<Promise<string>, [unknown]>(async () => 'done'),
  holdK0RevokedTestCard: jest.fn<Promise<string>, [unknown]>(async () => 'done'),
  holdK0RevokedOmittedCard: jest.fn<Promise<string>, [unknown]>(async () => 'done'),
  becomeK0TestWard: jest.fn<Promise<string>, [unknown]>(async () => 'done'),
}
// The K0 rows show only while "Trust the test state (K0)" holds: on here, so the rows are on screen to tap.
let mockTrustTestState = true
jest.mock('@bifold/core', () => ({
  ...jest.requireActual('@bifold/core'),
  isTrustTestStateEnabled: () => mockTrustTestState,
  holdK0TestGuardianCard: (agent: unknown) => mockK0.holdK0TestGuardianCard(agent),
  holdK0RevokedTestCard: (agent: unknown) => mockK0.holdK0RevokedTestCard(agent),
  holdK0RevokedOmittedCard: (agent: unknown) => mockK0.holdK0RevokedOmittedCard(agent),
  becomeK0TestWard: (agent: unknown) => mockK0.becomeK0TestWard(agent),
  setUpSediDemoAsGuardian: (agent: unknown) => mockSetUp(agent, 'guardian'),
  setUpSediDemoAsWard: (agent: unknown) => mockSetUp(agent, 'ward'),
  turnOffSediDemo: () => mockTurnOff(),
  setTrustedApproversEnabled: (on: boolean) => mockSetTrusted(on),
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
  mockSetTrusted.mockClear()
  for (const action of Object.values(mockK0)) action.mockClear()
  mockTrustTestState = true
  SEDI_KERI_REMOTE_OFF.off = false
})

describe('Developer › Demos: the whole action row takes the tap', () => {
  // The two demo sides are switch rows (278.19): the switch takes the tap and runs that side once, never the other.
  test.each([
    ['guardian', 'SediDemoGuardian'],
    ['ward', 'SediDemoWard'],
  ])('one tap on the %s switch runs that side once, and not the other', async (side, id) => {
    const tree = shown()
    await act(async () => fireEvent.press(tree.getByTestId(testIdWithKey(id))))
    expect(mockSetUp).toHaveBeenCalledTimes(1)
    expect(mockSetUp.mock.calls[0][1]).toBe(side)
  })

  test.each([
    ['SediDemoGuardian', 'Developer.SediDemoGuardian', 'Developer.SediDemoGuardianHint'],
    ['SediDemoWard', 'Developer.SediDemoWard', 'Developer.SediDemoWardHint'],
  ])('the %s switch is labelled with its title, its plain line on screen and as the hint', (id, title, hint) => {
    const tree = shown()
    const row = tree.getByTestId(testIdWithKey(id))
    expect(row.props.accessibilityLabel).toBe(title)
    expect(row.props.accessibilityHint).toBe(hint)
    expect(tree.getByText(title)).toBeTruthy()
    expect(tree.getByText(hint)).toBeTruthy()
  })

  test("a demo switch's words take no tap, so it can never run twice (control: its switch, above)", async () => {
    const tree = shown()
    await userEvent.setup().press(tree.getByText('Developer.SediDemoGuardian'))
    await userEvent.setup().press(tree.getByText('Developer.SediDemoWardHint'))
    expect(mockSetUp).not.toHaveBeenCalled()
  })

  test('no "Turn off the SEDI demo" row any more: the switch that is on turns it off', async () => {
    const tree = shown()
    await act(async () => fireEvent.press(tree.getByTestId(testIdWithKey('SediDemoGuardian'))))
    expect(tree.queryByTestId(testIdWithKey('TurnOffSediDemo'))).toBeNull()
    await act(async () => fireEvent.press(tree.getByTestId(testIdWithKey('SediDemoGuardian'))))
    expect(mockTurnOff).toHaveBeenCalledTimes(1)
  })

  // Every K0 test-state row Alberto taps while setting up the demo, not only the one-tap: dropping wholeRow from any
  // of them must turn this red (a mutant that removed it from one row survived the rows above).
  test.each([
    ['HoldK0TestGuardianCard', 'holdK0TestGuardianCard'],
    ['HoldK0RevokedTestCard', 'holdK0RevokedTestCard'],
    ['HoldK0RevokedOmittedCard', 'holdK0RevokedOmittedCard'],
    ['BecomeK0TestWard', 'becomeK0TestWard'],
  ] as const)('one tap on the words of %s runs its own action once, and no other', async (key, action) => {
    const tree = shown()
    await userEvent.setup().press(tree.getByText(`Developer.${key}`))
    expect(mockK0[action]).toHaveBeenCalledTimes(1)
    for (const [other, fn] of Object.entries(mockK0)) if (other !== action) expect(fn).not.toHaveBeenCalled()
    const row = tree.getByTestId(testIdWithKey(key))
    expect(row.props.accessibilityRole).toBe('button')
    expect(within(row).getByText(`Developer.${key}`)).toBeTruthy()
  })

  // The control was the "Confirm it's you" row until that row went (the feature has no setting now); any switch row
  // serves, and trusted approvers' is shown whatever else is on.
  test("control: a switch row's words still take no tap (trusted approvers stays as it was)", async () => {
    const tree = shown()
    await userEvent.setup().press(tree.getByText('Developer.EnableTrustedApprovers'))
    expect(mockSetTrusted).not.toHaveBeenCalled()
    // ...while its own pressable still toggles it, so the control can fail.
    await act(async () => fireEvent.press(tree.getByTestId(testIdWithKey('ToggleEnableTrustedApprovers'))))
    expect(mockSetTrusted).toHaveBeenCalledTimes(1)
  })
})
