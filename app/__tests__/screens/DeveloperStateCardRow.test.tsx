/**
 * The Developer row "State card (demo)" (SEDI/KERI holder card): there with every approver switch off (it needs
 * none), hidden by its own remote off and the SEDI/KERI one (the switch could do nothing), and a toggle reaches bifold
 * live, read through isStateCardEnabled().
 */
import {
  AuthProvider,
  SEDI_KERI_REMOTE_OFF,
  STATE_CARD_REMOTE_OFF,
  isStateCardEnabled,
  setStateCardEnabled,
  testIdWithKey,
} from '@bifold/core'
import { act, fireEvent, render } from '@testing-library/react-native'
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
const mockHold = jest.fn<Promise<string>, [unknown]>(async () => 'done')
const mockWard = jest.fn<Promise<string>, [unknown]>(async () => 'done')
jest.mock('@bifold/core', () => ({
  ...jest.requireActual('@bifold/core'),
  holdK0TestGuardianCard: (agent: unknown) => mockHold(agent),
  becomeK0TestWard: (agent: unknown) => mockWard(agent),
}))

const ROW = testIdWithKey('ToggleEnableStateCard')

const developer = () =>
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
  STATE_CARD_REMOTE_OFF.off = false
  SEDI_KERI_REMOTE_OFF.off = false
})
afterEach(() => {
  jest.restoreAllMocks()
  setStateCardEnabled(false)
  STATE_CARD_REMOTE_OFF.off = false
  SEDI_KERI_REMOTE_OFF.off = false
})

describe('Developer: the "State card (demo)" row', () => {
  test('there with every approver switch off: it needs none of them', () => {
    expect(developer().queryByTestId(ROW)).not.toBeNull()
  })

  test.each([
    ['its own remote off', () => (STATE_CARD_REMOTE_OFF.off = true)],
    ['the SEDI/KERI remote off', () => (SEDI_KERI_REMOTE_OFF.off = true)],
  ])('%s hides it (control: lifted, it is there)', (_, off) => {
    off()
    expect(developer().queryByTestId(ROW)).toBeNull()
    STATE_CARD_REMOTE_OFF.off = false
    SEDI_KERI_REMOTE_OFF.off = false
    expect(developer().queryByTestId(ROW)).not.toBeNull()
  })

  test('a toggle reaches bifold at once, both ways', async () => {
    const tree = developer()
    expect(isStateCardEnabled()).toBe(false)
    await act(async () => fireEvent.press(tree.getByTestId(ROW)))
    expect(isStateCardEnabled()).toBe(true)
    await act(async () => fireEvent.press(tree.getByTestId(ROW)))
    expect(isStateCardEnabled()).toBe(false)
  })
})
