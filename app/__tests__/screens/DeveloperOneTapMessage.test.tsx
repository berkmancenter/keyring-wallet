/**
 * What the alert after "Set up the SEDI demo" says, beyond the result's own line: on a done set-up it names the Demo
 * state host in effect (or warns that none is set), and on 'doneSomeHidden' it names each feature a release has
 * turned off. Alert only: the screen keeps no persistent line about what is hidden, so there is nothing that could go
 * stale; which features are hidden is read live from bifold at the tap.
 */
import { AuthProvider, testIdWithKey } from '@bifold/core'
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
jest.mock('@bifold/react-hooks', () => ({
  ...jest.requireActual('@bifold/react-hooks'),
  useAgent: () => ({ agent: { genericRecords: {} } }),
}))
const mockSetUp = jest.fn<Promise<string>, [unknown]>(async () => 'done')
const mockHost = jest.fn<string | null, []>(() => null)
const mockHidden = jest.fn<string[], []>(() => [])
jest.mock('@bifold/core', () => ({
  ...jest.requireActual('@bifold/core'),
  setUpSediDemo: (agent: unknown) => mockSetUp(agent),
  turnOffSediDemo: () => undefined,
  demoStateHost: () => mockHost(),
  sediDemoHiddenByKill: () => mockHidden(),
}))

const tap = async () => {
  const tree = render(
    <BasicAppContext>
      <AuthProvider>
        <Developer />
      </AuthProvider>
    </BasicAppContext>
  )
  await act(async () => fireEvent.press(tree.getByTestId(testIdWithKey('SetUpSediDemo'))))
  const calls = (Alert.alert as jest.Mock).mock.calls
  return String(calls[calls.length - 1][1]).split('\n\n')
}

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => null)
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined)
})
afterEach(() => {
  jest.restoreAllMocks()
  mockSetUp.mockReset().mockImplementation(async () => 'done')
  mockHost.mockReset().mockImplementation(() => null)
  mockHidden.mockReset().mockImplementation(() => [])
})

describe('Developer: the one-tap SEDI demo says where the state is checked from, and what is hidden', () => {
  test('done with a Demo state host in effect: it names that the state is fetched live (control: no host, the warning)', async () => {
    mockHost.mockReturnValue('abc-def.trycloudflare.com')
    expect(await tap()).toEqual(['Developer.SediDemoDone', 'Developer.SediDemoHost'])
    expect(mockHost).toHaveBeenCalled()
  })

  test('done with no Demo state host: it warns, and says the copy on this phone is used meanwhile', async () => {
    expect(await tap()).toEqual(['Developer.SediDemoDone', 'Developer.SediDemoNoHost'])
  })

  test.each([
    [['stateCard'], ['Developer.SediDemoHiddenStateCard']],
    [['confirmItsYou'], ['Developer.SediDemoHiddenConfirmItsYou']],
    [
      ['stateCard', 'confirmItsYou'],
      ['Developer.SediDemoHiddenStateCard', 'Developer.SediDemoHiddenConfirmItsYou'],
    ],
  ])('doneSomeHidden with %j turned off: each is named (control: done names none)', async (hidden, named) => {
    mockSetUp.mockResolvedValue('doneSomeHidden')
    mockHidden.mockReturnValue(hidden)
    expect(await tap()).toEqual(['Developer.SediDemoDone', 'Developer.SediDemoNoHost', ...named])
  })

  test('a done set-up names no hidden feature even if bifold would list one (the result decides)', async () => {
    mockHidden.mockReturnValue(['stateCard'])
    expect(await tap()).toEqual(['Developer.SediDemoDone', 'Developer.SediDemoNoHost'])
  })

  test.each([['remoteOff'], ['cardNotHeld'], ['wardNotSet']])(
    'a set-up that returns %s says only its own line, no host line',
    async (result) => {
      mockSetUp.mockResolvedValue(result)
      mockHost.mockReturnValue('abc-def.trycloudflare.com')
      expect(await tap()).toHaveLength(1)
    }
  )
})
