/**
 * Developer › Demos: the "Guardian demo" / "Ward demo" switches (Alberto, 278.19: switches, not arrow rows; "ward",
 * not "person"), one side per phone, and what turning one on says, kept ON the screen instead of an alert that goes
 * away: ONE line saying what this phone now does (278.19: the box said too much). On 'doneSomeHidden' a line names the
 * state card when a release has turned it off, read from bifold for THAT side at the tap. Where the state is checked
 * from is said under Demo state host, not here. Also: the Paste button for Demo state host, and the remote off hides
 * every new entry point.
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
const mockTurnOff = jest.fn()
jest.mock('@bifold/core', () => ({
  ...jest.requireActual('@bifold/core'),
  setUpSediDemoAsGuardian: (agent: unknown) => mockSetUp(agent, 'guardian'),
  setUpSediDemoAsWard: (agent: unknown) => mockSetUp(agent, 'ward'),
  turnOffSediDemo: () => mockTurnOff(),
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
  guardian: testIdWithKey('SediDemoGuardian'),
  ward: testIdWithKey('SediDemoWard'),
  guardianSwitch: testIdWithKey('SediDemoGuardianSwitch'),
  wardSwitch: testIdWithKey('SediDemoWardSwitch'),
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
const tap = async (side: 'guardian' | 'ward', tree: Tree = shown()) => {
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
  mockTurnOff.mockReset()
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
    ['ward', 'Developer.SediDemoWardDone'],
  ] as const)('a done %s set-up is ONE line saying what this phone now does', async (side, done) => {
    expect(lines(await tap(side))).toEqual([done])
  })

  test('still one line with a Demo state host in effect: where the state comes from is not in the result', async () => {
    mockHost.mockReturnValue('abc-def.trycloudflare.com')
    expect(lines(await tap('guardian'))).toEqual(['Developer.SediDemoGuardianDone'])
  })

  test.each(['guardian', 'ward'] as const)(
    'doneSomeHidden on the %s side adds the state card line, asked of bifold for that side',
    async (side) => {
      mockSetUp.mockResolvedValue('doneSomeHidden')
      mockHidden.mockReturnValue(['stateCard'])
      const done = side === 'guardian' ? 'Developer.SediDemoGuardianDone' : 'Developer.SediDemoWardDone'
      expect(lines(await tap(side))).toEqual([done, 'Developer.SediDemoHiddenStateCard'])
      expect(mockHidden).toHaveBeenCalledWith(side)
    }
  )

  test('a done set-up names no hidden feature even if bifold would list one (the result decides)', async () => {
    mockHidden.mockReturnValue(['stateCard'])
    expect(lines(await tap('guardian'))).toEqual(['Developer.SediDemoGuardianDone'])
  })

  test.each([
    ['guardian', 'remoteOff', 'Developer.SediDemoOff'],
    ['guardian', 'cardNotHeld', 'Developer.SediDemoCardNotHeld'],
    ['guardian', 'wardNotCleared', 'Developer.SediDemoWardNotCleared'],
    ['ward', 'remoteOff', 'Developer.SediDemoOff'],
    ['ward', 'wardNotSet', 'Developer.SediDemoWardNotSet'],
    ['ward', 'cardNotRemoved', 'Developer.SediDemoCardNotRemoved'],
  ] as const)('the %s set-up returning %s says only its own line', async (side, result, line) => {
    mockSetUp.mockResolvedValue(result)
    mockHost.mockReturnValue('abc-def.trycloudflare.com')
    expect(lines(await tap(side))).toEqual([line])
  })

  test('a set-up that throws says "Not done" on the screen', async () => {
    mockSetUp.mockRejectedValue(new Error('boom'))
    expect(lines(await tap('ward'))).toEqual(['Developer.SediDemoFailed'])
  })

  test('the next set-up replaces the result (control: the first one showed)', async () => {
    const tree = await tap('guardian')
    expect(lines(tree)[0]).toBe('Developer.SediDemoGuardianDone')
    mockSetUp.mockResolvedValue('wardNotSet')
    await tap('ward', tree)
    expect(lines(tree)).toEqual(['Developer.SediDemoWardNotSet'])
  })
})

describe('Developer › Demos: two switches, one side per phone', () => {
  const on = (tree: Tree) => ({
    guardian: tree.getByTestId(ID.guardianSwitch).props.value,
    ward: tree.getByTestId(ID.wardSwitch).props.value,
  })

  test('both off at first; turning one on sets this phone up as that side and shows it on', async () => {
    const tree = shown()
    expect(on(tree)).toEqual({ guardian: false, ward: false })
    await tap('ward', tree)
    expect(mockSetUp).toHaveBeenCalledWith(expect.anything(), 'ward')
    expect(on(tree)).toEqual({ guardian: false, ward: true })
  })

  test('turning the other side on moves this phone to it: never both (control: the first side was on)', async () => {
    const tree = await tap('guardian')
    expect(on(tree)).toEqual({ guardian: true, ward: false })
    await tap('ward', tree)
    expect(on(tree)).toEqual({ guardian: false, ward: true })
    expect(mockTurnOff).not.toHaveBeenCalled()
  })

  test('turning the side that is on off turns the demo off and clears the line (no set-up runs)', async () => {
    const tree = await tap('guardian')
    expect(tree.queryByTestId(ID.result)).not.toBeNull()
    await tap('guardian', tree)
    expect(mockTurnOff).toHaveBeenCalledTimes(1)
    expect(mockSetUp).toHaveBeenCalledTimes(1)
    expect(on(tree)).toEqual({ guardian: false, ward: false })
    expect(tree.queryByTestId(ID.result)).toBeNull()
  })

  test('the switch itself does what the row does (control: the row, above)', async () => {
    const tree = shown()
    await act(async () => fireEvent(tree.getByTestId(ID.wardSwitch), 'valueChange', true))
    expect(mockSetUp).toHaveBeenCalledWith(expect.anything(), 'ward')
    expect(on(tree)).toEqual({ guardian: false, ward: true })
  })

  test('a release with SEDI/KERI off: the set-up does nothing, so the switch stays off', async () => {
    mockSetUp.mockResolvedValue('remoteOff')
    const tree = await tap('guardian')
    expect(on(tree)).toEqual({ guardian: false, ward: false })
    expect(lines(tree)).toEqual(['Developer.SediDemoOff'])
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
  test('both demo switches, the intro, Paste and a kept result are gone while it holds (control: shown without it)', async () => {
    const on = await tap('guardian')
    for (const id of [ID.guardian, ID.ward, ID.paste, ID.result]) expect(on.queryByTestId(id)).not.toBeNull()
    expect(on.queryByText('Developer.SediDemoIntro')).not.toBeNull()
    on.unmount()
    SEDI_KERI_REMOTE_OFF.off = true
    const off = shown()
    for (const id of [ID.guardian, ID.ward, ID.paste, ID.result, ID.host]) expect(off.queryByTestId(id)).toBeNull()
    expect(off.queryByText('Developer.SediDemoIntro')).toBeNull()
  })
})
