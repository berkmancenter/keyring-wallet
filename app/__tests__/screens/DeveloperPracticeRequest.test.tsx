/**
 * Developer › Demos shows the practice request (B7, Alberto 11-12: "move the practice request to Developer"): bifold's
 * EnforcementCheckCard, the same card Who approves showed. Hidden with the trusted-approvers switch off and under the
 * SEDI/KERI remote off (the whole Demos section goes), each with on as the control. The probe itself is bifold's, tested
 * there (enforcementCheckCard.test.tsx); here only that it is placed, and gated.
 */
import {
  AuthProvider,
  EnforcementCheckIds,
  SEDI_KERI_REMOTE_OFF,
  setTrustedApproversEnabled,
  testIdWithKey,
} from '@bifold/core'
import { act, render } from '@testing-library/react-native'
import React from 'react'
import { Alert } from 'react-native'

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

const shown = async () => {
  const tree = render(
    <BasicAppContext>
      <AuthProvider>
        <Developer />
      </AuthProvider>
    </BasicAppContext>
  )
  await act(async () => undefined)
  return tree
}
const ID = { place: testIdWithKey('DevPracticeRequest'), card: testIdWithKey(EnforcementCheckIds.check) }

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => null)
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined)
  SEDI_KERI_REMOTE_OFF.off = false
  setTrustedApproversEnabled(true)
})
afterEach(() => {
  jest.restoreAllMocks()
  SEDI_KERI_REMOTE_OFF.off = false
  setTrustedApproversEnabled(false)
})

describe('Developer › Demos: the practice request', () => {
  test('with trusted approvers on, the card is in Demos, with its button', async () => {
    const tree = await shown()
    expect(tree.getByTestId(ID.place)).toBeTruthy()
    expect(tree.getByTestId(ID.card)).toBeTruthy()
    expect(tree.getByTestId(testIdWithKey(`${EnforcementCheckIds.check}Button`))).toBeTruthy()
  })

  test('trusted approvers off: neither the place nor the card (control: on, both)', async () => {
    const on = await shown()
    expect(on.queryByTestId(ID.card)).not.toBeNull()
    on.unmount()
    setTrustedApproversEnabled(false)
    const off = await shown()
    expect(off.queryByTestId(ID.place)).toBeNull()
    expect(off.queryByTestId(ID.card)).toBeNull()
  })

  test('the SEDI/KERI remote off: neither (control: on, both)', async () => {
    const on = await shown()
    expect(on.queryByTestId(ID.place)).not.toBeNull()
    on.unmount()
    SEDI_KERI_REMOTE_OFF.off = true
    const off = await shown()
    expect(off.queryByTestId(ID.place)).toBeNull()
    expect(off.queryByTestId(ID.card)).toBeNull()
  })
})
