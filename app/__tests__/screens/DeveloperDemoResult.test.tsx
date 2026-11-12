/**
 * Developer › Demos (C1, 11-12): what the result of "Set up as the guardian" / "Set up as the person" says, kept ON
 * the screen instead of an alert that goes away. Its own line names the side on a done set-up; on a done set-up it
 * then says where the state is checked from (read live, so pasting a host after the set-up updates it); on
 * 'doneSomeHidden' it names each feature a release has turned off, read from bifold for THAT side at the tap.
 * Also: the Paste button for Demo state host, and the remote off hides every new entry point.
 */
import { AuthProvider, SEDI_KERI_REMOTE_OFF, testIdWithKey } from '@bifold/core'
import Clipboard from '@react-native-clipboard/clipboard'
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
jest.mock('@bifold/react-hooks', () => ({
  ...jest.requireActual('@bifold/react-hooks'),
  useAgent: () => ({ agent: { genericRecords: {} } }),
}))
const mockSetUp = jest.fn<Promise<string>, [unknown, string]>(async () => 'done')
const mockHost = jest.fn<string | null, []>(() => null)
const mockHidden = jest.fn<string[], [string | undefined]>(() => [])
const mockSetHost = jest.fn<string, [string | null]>(() => 'set')
jest.mock('@bifold/core', () => ({
  ...jest.requireActual('@bifold/core'),
  setUpSediDemoAsGuardian: (agent: unknown) => mockSetUp(agent, 'guardian'),
  setUpSediDemoAsPerson: (agent: unknown) => mockSetUp(agent, 'person'),
  turnOffSediDemo: () => undefined,
  demoStateHost: () => mockHost(),
  sediDemoHiddenByKill: (side?: string) => mockHidden(side),
  setDemoStateHost: (host: string | null) => mockSetHost(host),
  // The Demo state host field shows only while both approver switches hold.
  isTrustedApproversEnabled: () => true,
  isStateVerifiedApproversEnabled: () => true,
}))

/** The clipboard mock (app/__mocks__), typed for its jest methods. */
const clip = () => Clipboard.getString as jest.Mock

const ID = {
  guardian: testIdWithKey('SetUpSediDemoGuardian'),
  person: testIdWithKey('SetUpSediDemoPerson'),
  result: testIdWithKey('SediDemoResult'),
  paste: testIdWithKey('PasteDemoStateHost'),
  host: testIdWithKey('DemoStateHost'),
}

const shown = () =>
  render(
    <BasicAppContext>
      <AuthProvider>
        <Developer />
      </AuthProvider>
    </BasicAppContext>
  )
type Tree = ReturnType<typeof shown>
const lines = (tree: Tree) =>
  within(tree.getByTestId(ID.result))
    .getAllByText(/./)
    .map((n) => String(n.props.children))
const tap = async (side: 'guardian' | 'person', tree: Tree = shown()) => {
  await act(async () => fireEvent.press(tree.getByTestId(ID[side])))
  return tree
}

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => null)
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined)
  SEDI_KERI_REMOTE_OFF.off = false
})
afterEach(() => {
  jest.restoreAllMocks()
  mockSetUp.mockReset().mockImplementation(async () => 'done')
  mockHost.mockReset().mockImplementation(() => null)
  mockHidden.mockReset().mockImplementation(() => [])
  mockSetHost.mockReset().mockImplementation(() => 'set')
  clip()
    .mockReset()
    .mockImplementation(() => Promise.resolve('mocked clipboard content'))
  SEDI_KERI_REMOTE_OFF.off = false
})

describe('Developer › Demos: the set-up result stays on the screen', () => {
  test('no result before any set-up; after one it is on the screen, and no alert was shown', async () => {
    const tree = shown()
    expect(tree.queryByTestId(ID.result)).toBeNull()
    await tap('guardian', tree)
    expect(tree.getByTestId(ID.result)).toBeTruthy()
    expect(Alert.alert).not.toHaveBeenCalled()
  })

  test.each([
    ['guardian', 'Developer.SediDemoGuardianDone'],
    ['person', 'Developer.SediDemoPersonDone'],
  ] as const)('a done %s set-up names its side, then the host warning', async (side, done) => {
    expect(lines(await tap(side))).toEqual([done, 'Developer.SediDemoNoHost'])
  })

  test('with a Demo state host in effect it says the state is fetched live (control: no host, the warning above)', async () => {
    mockHost.mockReturnValue('abc-def.trycloudflare.com')
    expect(lines(await tap('guardian'))).toEqual(['Developer.SediDemoGuardianDone', 'Developer.SediDemoHost'])
  })

  test('the host line is read live: a host set after the set-up shows without tapping again', async () => {
    const tree = await tap('guardian')
    expect(lines(tree)[1]).toBe('Developer.SediDemoNoHost')
    mockHost.mockReturnValue('abc-def.trycloudflare.com')
    clip().mockResolvedValueOnce('abc-def.trycloudflare.com')
    await act(async () => fireEvent.press(tree.getByTestId(ID.paste)))
    expect(lines(tree)[1]).toBe('Developer.SediDemoHost')
    expect(mockSetUp).toHaveBeenCalledTimes(1)
  })

  test.each([
    ['guardian', ['stateCard'], ['Developer.SediDemoHiddenStateCard']],
    ['guardian', ['confirmItsYou'], ['Developer.SediDemoHiddenConfirmItsYou']],
    ['person', ['confirmItsYou'], ['Developer.SediDemoHiddenConfirmItsYou']],
  ] as const)('doneSomeHidden on the %s side names %j, asked of bifold for that side', async (side, hidden, named) => {
    mockSetUp.mockResolvedValue('doneSomeHidden')
    mockHidden.mockReturnValue([...hidden])
    const done = side === 'guardian' ? 'Developer.SediDemoGuardianDone' : 'Developer.SediDemoPersonDone'
    expect(lines(await tap(side))).toEqual([done, 'Developer.SediDemoNoHost', ...named])
    expect(mockHidden).toHaveBeenCalledWith(side)
  })

  test('a done set-up names no hidden feature even if bifold would list one (the result decides)', async () => {
    mockHidden.mockReturnValue(['stateCard'])
    expect(lines(await tap('guardian'))).toEqual(['Developer.SediDemoGuardianDone', 'Developer.SediDemoNoHost'])
  })

  test.each([
    ['guardian', 'remoteOff', 'Developer.SediDemoOff'],
    ['guardian', 'cardNotHeld', 'Developer.SediDemoCardNotHeld'],
    ['guardian', 'wardNotCleared', 'Developer.SediDemoWardNotCleared'],
    ['person', 'remoteOff', 'Developer.SediDemoOff'],
    ['person', 'wardNotSet', 'Developer.SediDemoWardNotSet'],
    ['person', 'cardNotRemoved', 'Developer.SediDemoCardNotRemoved'],
  ] as const)('the %s set-up returning %s says only its own line, no host line', async (side, result, line) => {
    mockSetUp.mockResolvedValue(result)
    mockHost.mockReturnValue('abc-def.trycloudflare.com')
    expect(lines(await tap(side))).toEqual([line])
  })

  test('a set-up that throws says "Not done" on the screen', async () => {
    mockSetUp.mockRejectedValue(new Error('boom'))
    expect(lines(await tap('person'))).toEqual(['Developer.SediDemoFailed'])
  })

  test('the next set-up replaces the result (control: the first one showed)', async () => {
    const tree = await tap('guardian')
    expect(lines(tree)[0]).toBe('Developer.SediDemoGuardianDone')
    mockSetUp.mockResolvedValue('wardNotSet')
    await tap('person', tree)
    expect(lines(tree)).toEqual(['Developer.SediDemoWardNotSet'])
  })
})

describe('Developer › Demos: Paste into Demo state host', () => {
  test("Paste puts the clipboard's text, trimmed, in the field and saves it", async () => {
    clip().mockResolvedValueOnce('  abc-def.trycloudflare.com \n')
    const tree = shown()
    await act(async () => fireEvent.press(tree.getByTestId(ID.paste)))
    expect(mockSetHost).toHaveBeenCalledWith('abc-def.trycloudflare.com')
    expect(tree.getByTestId(ID.host).props.value).toBe('abc-def.trycloudflare.com')
  })

  test('an empty clipboard changes nothing: a host already set is never cleared (control: the row above saves)', async () => {
    clip().mockResolvedValueOnce('   ')
    const tree = shown()
    await act(async () => fireEvent.press(tree.getByTestId(ID.paste)))
    expect(mockSetHost).not.toHaveBeenCalled()
  })

  test('a paste bifold refuses says so and saves nothing (bifold decides what a host is)', async () => {
    clip().mockResolvedValueOnce('https://example.com/path')
    mockSetHost.mockReturnValueOnce('invalid')
    const tree = shown()
    await act(async () => fireEvent.press(tree.getByTestId(ID.paste)))
    expect(Alert.alert).toHaveBeenCalledWith('Developer.DemoStateHost', 'Developer.DemoStateHostInvalid')
  })
})

describe('Developer › Demos: the SEDI/KERI remote off hides every new entry point', () => {
  test('both set-up rows, the intro, Paste and a kept result are gone while it holds (control: shown without it)', async () => {
    const on = await tap('guardian')
    for (const id of [ID.guardian, ID.person, ID.paste, ID.result]) expect(on.queryByTestId(id)).not.toBeNull()
    expect(on.queryByText('Developer.SediDemoIntro')).not.toBeNull()
    on.unmount()
    SEDI_KERI_REMOTE_OFF.off = true
    const off = shown()
    for (const id of [ID.guardian, ID.person, ID.paste, ID.result, ID.host]) expect(off.queryByTestId(id)).toBeNull()
    expect(off.queryByText('Developer.SediDemoIntro')).toBeNull()
  })
})
