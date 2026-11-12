/**
 * The Developer "Demo state host" field (Demos): shown only while trusted approvers and state-verified approvers hold
 * (read live from bifold, remote offs included); a value bifold refuses changes nothing and is not saved; one it takes
 * is saved so a restart applies the same value.
 */
import {
  AuthProvider,
  PersistentStorage,
  SEDI_KERI_REMOTE_OFF,
  STATE_VERIFIED_APPROVERS_REMOTE_OFF,
  TRUSTED_APPROVERS_REMOTE_OFF,
  setStateVerifiedApproversEnabled,
  setTrustedApproversEnabled,
  testIdWithKey,
} from '@bifold/core'
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
jest.mock('@bifold/react-hooks', () => ({
  ...jest.requireActual('@bifold/react-hooks'),
  useAgent: () => ({ agent: { genericRecords: {} } }),
}))
const mockSetHost = jest.fn<string, [string | null]>()
jest.mock('@bifold/core', () => {
  const actual = jest.requireActual('@bifold/core')
  return {
    ...actual,
    setDemoStateHost: (h: string | null) => {
      const r = actual.setDemoStateHost(h)
      mockSetHost(h)
      return r
    },
  }
})

const FIELD = testIdWithKey('DemoStateHost')
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
  TRUSTED_APPROVERS_REMOTE_OFF.off = false
  STATE_VERIFIED_APPROVERS_REMOTE_OFF.off = false
  SEDI_KERI_REMOTE_OFF.off = false
  setTrustedApproversEnabled(true)
  setStateVerifiedApproversEnabled(true)
  mockSetHost.mockClear()
})
afterEach(() => {
  setTrustedApproversEnabled(false)
  setStateVerifiedApproversEnabled(false)
  jest.restoreAllMocks()
})

test.each([
  ['trusted approvers off', () => setTrustedApproversEnabled(false)],
  ['state-verified approvers off', () => setStateVerifiedApproversEnabled(false)],
  ['trusted approvers turned off remotely', () => (TRUSTED_APPROVERS_REMOTE_OFF.off = true)],
  ['state-verified approvers turned off remotely', () => (STATE_VERIFIED_APPROVERS_REMOTE_OFF.off = true)],
  ['the SEDI/KERI umbrella off', () => (SEDI_KERI_REMOTE_OFF.off = true)],
])('%s: no Demo state host field (control: both on, it shows)', (_, off) => {
  expect(shown().queryByTestId(FIELD)).not.toBeNull()
  off()
  expect(shown().queryByTestId(FIELD)).toBeNull()
})

test('a public hostname is handed to bifold and saved (control: a refused one is not)', async () => {
  const store = jest.spyOn(PersistentStorage, 'storeValueForKey').mockResolvedValue(undefined as never)
  const tree = shown()
  const field = tree.getByTestId(FIELD)
  await act(async () => {
    fireEvent.changeText(field, 'https://abc.trycloudflare.com/x')
    fireEvent(field, 'endEditing', { nativeEvent: { text: 'https://abc.trycloudflare.com/x' } })
  })
  expect(mockSetHost).toHaveBeenLastCalledWith('https://abc.trycloudflare.com/x')
  expect(Alert.alert).toHaveBeenCalledWith('Developer.DemoStateHost', 'Developer.DemoStateHostInvalid')
  expect(store.mock.calls.filter(([key]) => key === BCLocalStorageKeys.DemoStateHost)).toHaveLength(0)
  await act(async () => {
    fireEvent.changeText(field, 'Abc-Def.TryCloudflare.com')
    fireEvent(field, 'endEditing', { nativeEvent: { text: 'Abc-Def.TryCloudflare.com' } })
  })
  expect(mockSetHost).toHaveBeenLastCalledWith('Abc-Def.TryCloudflare.com')
  expect(store).toHaveBeenCalledWith(BCLocalStorageKeys.DemoStateHost, 'abc-def.trycloudflare.com')
})
