/**
 * The Developer rows for state-verified approvers (trusted-approver plan, stage 2, S1): each shows only while the
 * switches above it hold, remote offs included, read live from bifold. "State-verified approvers" needs trusted
 * approvers; "Trust the test state (K0)" needs both; the three K0 actions need the test-state setting too.
 */
import {
  AuthProvider,
  SEDI_KERI_REMOTE_OFF,
  STATE_VERIFIED_APPROVERS_REMOTE_OFF,
  TRUSTED_APPROVERS_REMOTE_OFF,
  setStateVerifiedApproversEnabled,
  setTrustTestStateEnabled,
  setTrustedApproversEnabled,
  testIdWithKey,
} from '@bifold/core'
import { act, fireEvent, render, within } from '@testing-library/react-native'
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
const mockHold = jest.fn<Promise<string>, [unknown, string]>(async () => 'done')
const mockWard = jest.fn<Promise<string>, [unknown, string]>(async () => 'done')
const mockRevoked = jest.fn<Promise<string>, [unknown, string]>(async () => 'done')
const mockOmitted = jest.fn<Promise<string>, [unknown, string]>(async () => 'done')
const mockSetUp = jest.fn<Promise<string>, [unknown, string]>(async () => 'done')
const mockTurnOff = jest.fn<void, []>()
jest.mock('@bifold/core', () => ({
  ...jest.requireActual('@bifold/core'),
  holdK0TestGuardianCard: (agent: unknown) => mockHold(agent),
  becomeK0TestWard: (agent: unknown) => mockWard(agent),
  holdK0RevokedTestCard: (agent: unknown) => mockRevoked(agent),
  holdK0RevokedOmittedCard: (agent: unknown) => mockOmitted(agent),
  setUpSediDemoAsGuardian: (agent: unknown) => mockSetUp(agent, 'guardian'),
  setUpSediDemoAsPerson: (agent: unknown) => mockSetUp(agent, 'person'),
  turnOffSediDemo: () => mockTurnOff(),
}))

const ROWS = {
  stateVerified: testIdWithKey('ToggleEnableStateVerifiedApprovers'),
  testState: testIdWithKey('ToggleEnableTrustTestState'),
  hold: testIdWithKey('HoldK0TestGuardianCard'),
  revoked: testIdWithKey('HoldK0RevokedTestCard'),
  omitted: testIdWithKey('HoldK0RevokedOmittedCard'),
  ward: testIdWithKey('BecomeK0TestWard'),
}

const shown = () => {
  const tree = render(
    <BasicAppContext>
      <AuthProvider>
        <Developer />
      </AuthProvider>
    </BasicAppContext>
  )
  return {
    tree,
    rows: Object.fromEntries(Object.entries(ROWS).map(([k, id]) => [k, tree.queryByTestId(id) !== null])),
  }
}
const none = { stateVerified: false, testState: false, hold: false, revoked: false, omitted: false, ward: false }
const all = { stateVerified: true, testState: true, hold: true, revoked: true, omitted: true, ward: true }

const set = (ta: boolean, sv: boolean, ts: boolean) => {
  setTrustedApproversEnabled(ta)
  setStateVerifiedApproversEnabled(sv)
  setTrustTestStateEnabled(ts)
}

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => null)
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined)
  TRUSTED_APPROVERS_REMOTE_OFF.off = false
  STATE_VERIFIED_APPROVERS_REMOTE_OFF.off = false
  SEDI_KERI_REMOTE_OFF.off = false
})
afterEach(() => {
  jest.restoreAllMocks()
  mockHold.mockClear()
  mockWard.mockClear()
  mockRevoked.mockClear()
  mockOmitted.mockClear()
  mockSetUp.mockClear()
  mockTurnOff.mockClear()
  set(false, false, false)
  TRUSTED_APPROVERS_REMOTE_OFF.off = false
  STATE_VERIFIED_APPROVERS_REMOTE_OFF.off = false
  SEDI_KERI_REMOTE_OFF.off = false
})

describe('Developer: the state-verified approvers rows', () => {
  test('all off: none of the six rows (control: all on, all six)', () => {
    set(false, false, false)
    expect(shown().rows).toEqual(none)
    set(true, true, true)
    expect(shown().rows).toEqual(all)
  })

  test('trusted approvers on: only "State-verified approvers" shows', () => {
    set(true, false, false)
    expect(shown().rows).toEqual({ ...none, stateVerified: true })
  })

  test('both switches on: "Trust the test state (K0)" shows, the K0 actions do not', () => {
    set(true, true, false)
    expect(shown().rows).toEqual({ ...none, stateVerified: true, testState: true })
  })

  test('a saved test-state "on" without state-verified approvers shows no test-state row and no actions', () => {
    set(true, false, true)
    expect(shown().rows).toEqual({ ...none, stateVerified: true })
  })

  test.each([
    ['trusted approvers', () => (TRUSTED_APPROVERS_REMOTE_OFF.off = true), none],
    [
      'state-verified approvers',
      () => (STATE_VERIFIED_APPROVERS_REMOTE_OFF.off = true),
      { ...none, stateVerified: true },
    ],
    ['SEDI/KERI', () => (SEDI_KERI_REMOTE_OFF.off = true), none],
  ])('the %s remote off hides what it kills, even with all switched on (control: all on, all six)', (_, off, rows) => {
    set(true, true, true)
    off()
    expect(shown().rows).toEqual(rows)
  })

  test('the K0 actions call bifold with this agent and say what happened (control: off, they are not there)', async () => {
    set(true, true, true)
    const { tree } = shown()
    await act(async () => fireEvent.press(tree.getByTestId(ROWS.hold)))
    await act(async () => fireEvent.press(tree.getByTestId(ROWS.ward)))
    expect(mockHold).toHaveBeenCalledWith(mockAgent)
    expect(mockWard).toHaveBeenCalledWith(mockAgent)
    expect((Alert.alert as jest.Mock).mock.calls.map((c) => c[1])).toEqual(['Done.', 'Done.'])
  })

  test('"Hold the revoked test card (K0)" calls bifold with this agent and says done (control: refused, it says not done)', async () => {
    set(true, true, true)
    const { tree } = shown()
    await act(async () => fireEvent.press(tree.getByTestId(ROWS.revoked)))
    expect(mockRevoked).toHaveBeenCalledWith(mockAgent)
    expect(mockHold).not.toHaveBeenCalled()
    mockRevoked.mockResolvedValueOnce('off')
    await act(async () => fireEvent.press(tree.getByTestId(ROWS.revoked)))
    expect((Alert.alert as jest.Mock).mock.calls.map((c) => c[1])).toEqual([
      'Done.',
      'Not done: turn on Trust the test state (K0) first.',
    ])
  })

  test('"Hold the revoked card without its revocation (K0)" calls bifold with this agent and says done (control: refused, it says not done)', async () => {
    set(true, true, true)
    const { tree } = shown()
    await act(async () => fireEvent.press(tree.getByTestId(ROWS.omitted)))
    expect(mockOmitted).toHaveBeenCalledWith(mockAgent)
    expect(mockRevoked).not.toHaveBeenCalled()
    expect(mockHold).not.toHaveBeenCalled()
    mockOmitted.mockResolvedValueOnce('off')
    await act(async () => fireEvent.press(tree.getByTestId(ROWS.omitted)))
    mockOmitted.mockResolvedValueOnce('tooLarge')
    await act(async () => fireEvent.press(tree.getByTestId(ROWS.omitted)))
    expect((Alert.alert as jest.Mock).mock.calls.map((c) => c[1])).toEqual([
      'Done.',
      'Not done: turn on Trust the test state (K0) first.',
      'Not done: the card is too large to keep on this phone.',
    ])
  })

  test('an action that bifold refuses says so, not "Done."', async () => {
    set(true, true, true)
    mockHold.mockResolvedValueOnce('off')
    const { tree } = shown()
    await act(async () => fireEvent.press(tree.getByTestId(ROWS.hold)))
    expect((Alert.alert as jest.Mock).mock.calls[0][1]).toMatch(/^Not done/)
  })
})

describe('Developer: "Set up the SEDI demo" in one tap', () => {
  const DEMO = {
    setUp: testIdWithKey('SetUpSediDemoGuardian'),
    person: testIdWithKey('SetUpSediDemoPerson'),
    turnOff: testIdWithKey('TurnOffSediDemo'),
  }
  const has = (tree: ReturnType<typeof shown>['tree'], id: string) => tree.queryByTestId(id) !== null
  /** The result kept on the screen, line by line (C1: no alert). */
  const resultLines = (tree: ReturnType<typeof shown>['tree']) =>
    within(tree.getByTestId(testIdWithKey('SediDemoResult')))
      .getAllByText(/./)
      .map((n) => n.props.children)
      .join('\n\n')

  test('the row shows with everything off, and no undo yet (control: the SEDI/KERI remote off hides both)', () => {
    set(false, false, false)
    const { tree } = shown()
    expect(has(tree, DEMO.setUp)).toBe(true)
    expect(has(tree, DEMO.person)).toBe(true)
    expect(has(tree, DEMO.turnOff)).toBe(false)
    tree.unmount()
    SEDI_KERI_REMOTE_OFF.off = true
    const off = shown().tree
    expect(has(off, DEMO.setUp)).toBe(false)
    expect(has(off, DEMO.person)).toBe(false)
    expect(has(off, DEMO.turnOff)).toBe(false)
  })

  test('a done set-up calls bifold with this agent, says so, and keeps the switches on: the undo appears', async () => {
    set(false, false, false)
    const { tree } = shown()
    await act(async () => fireEvent.press(tree.getByTestId(DEMO.setUp)))
    expect(mockSetUp).toHaveBeenCalledWith(mockAgent, 'guardian')
    // The done line, then where the state is checked from (no Demo state host here; see DeveloperOneTapMessage).
    expect(resultLines(tree)).toBe('Developer.SediDemoGuardianDone\n\nDeveloper.SediDemoNoHost')
    expect(Alert.alert).not.toHaveBeenCalled()
    expect(has(tree, DEMO.turnOff)).toBe(true)
  })

  test('a set-up bifold refuses (remote off) saves nothing and says so (control: the row above)', async () => {
    set(false, false, false)
    mockSetUp.mockResolvedValueOnce('remoteOff')
    const { tree } = shown()
    await act(async () => fireEvent.press(tree.getByTestId(DEMO.setUp)))
    expect(resultLines(tree)).toBe('Developer.SediDemoOff')
    expect(has(tree, DEMO.turnOff)).toBe(false)
  })

  // bifold says which step stopped the set-up (#1033); each has its own message, and since bifold has already turned
  // the switches on, they are saved, so a restart matches this screen (control: the remote-off row above saves nothing).
  test.each([
    ['cardNotHeld', 'Developer.SediDemoCardNotHeld'],
    ['wardNotSet', 'Developer.SediDemoWardNotSet'],
  ])(
    'a set-up that stopped at a step (%s) says which, and keeps the switches on: the undo appears',
    async (result, message) => {
      set(false, false, false)
      mockSetUp.mockResolvedValueOnce(result)
      const { tree } = shown()
      await act(async () => fireEvent.press(tree.getByTestId(DEMO.setUp)))
      expect(resultLines(tree)).toBe(message)
      expect(has(tree, DEMO.turnOff)).toBe(true)
    }
  )

  test('the undo calls bifold and turns the saved switches off: the undo goes (control: set up, it shows)', async () => {
    set(false, false, false)
    const { tree } = shown()
    await act(async () => fireEvent.press(tree.getByTestId(DEMO.setUp)))
    expect(has(tree, DEMO.turnOff)).toBe(true)
    expect(has(tree, testIdWithKey('SediDemoResult'))).toBe(true)
    await act(async () => fireEvent.press(tree.getByTestId(DEMO.turnOff)))
    expect(mockTurnOff).toHaveBeenCalledTimes(1)
    expect(has(tree, DEMO.turnOff)).toBe(false)
    // The kept result goes with it (control: it showed after the set-up).
    expect(has(tree, testIdWithKey('SediDemoResult'))).toBe(false)
  })
})
