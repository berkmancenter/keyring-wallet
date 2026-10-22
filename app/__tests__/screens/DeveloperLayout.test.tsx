/**
 * Developer options, regrouped: the mediator lives here now (the Menu no longer shows it), on one line with a Copy for
 * the whole value; the rows nothing reads are gone; every row the gate drives keeps its testID, and no gate row sits
 * further down the screen than before (e2e finds them by scrolling).
 */
import { AuthProvider, MainContainer, ContainerProvider, Screens, StoreProvider, ThemeProvider } from '@bifold/core'
import Clipboard from '@react-native-clipboard/clipboard'
import { fireEvent, render } from '@testing-library/react-native'
import React from 'react'
import { container } from 'tsyringe'

import { KeyRingThemeNames } from '@/constants'
import { initialState, reducer } from '@/store'
import { themes } from '@/theme'
import Developer from '../../src/screens/Developer'

const mockNavigate = jest.fn()
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: mockNavigate }),
}))

const MEDIATOR =
  'https://mediator.example.org/invite?oob=eyJAdHlwZSI6Imh0dHBzOi8vZGlkY29tbS5vcmcvb3V0LW9mLWJhbmQvMS4xL2ludml0YXRpb24ifQ'
const id = (key: string) => `com.ariesbifold:id/${key}`

const show = () => {
  const context = new MainContainer(container.createChildContainer()).init()
  const state = { ...initialState, preferences: { ...initialState.preferences, selectedMediator: MEDIATOR } }
  return render(
    <ContainerProvider value={context}>
      <StoreProvider initialState={state} reducer={reducer}>
        <ThemeProvider themes={themes} defaultThemeName={KeyRingThemeNames.KeyRing}>
          <AuthProvider>
            <Developer />
          </AuthProvider>
        </ThemeProvider>
      </StoreProvider>
    </ContainerProvider>
  )
}

/** Every testID on the screen, in render (top-to-bottom) order. */
const testIdsInOrder = (tree: ReturnType<typeof show>): string[] =>
  tree.UNSAFE_root.findAll((node) => typeof node.type === 'string' && typeof node.props.testID === 'string').map(
    (node) => String(node.props.testID).replace('com.ariesbifold:id/', '')
  )

// The rows the e2e harness drives or reads on this screen.
const GATE_IDS = [
  'ToggleDeveloper',
  'ToggleEnableTspCarriage',
  'ToggleEnableDidCommV2',
  'ProbeVtaMediatorButton',
  'ShowManagerIdentityButton',
  'ProbeVtaManagerButton',
  'OtaBundleId',
  'OtaRing',
]

describe('Developer options layout', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => null)
  })
  afterEach(() => {
    jest.restoreAllMocks()
    mockNavigate.mockClear()
  })

  test('the mediator shows on one line, shortened in the middle, and the row opens Configure Mediator', () => {
    const tree = show()
    const value = tree.getByTestId(id('DeveloperMediatorValue'))
    expect(value.props.children).toBe(MEDIATOR)
    expect(value.props.numberOfLines).toBe(1)
    expect(value.props.ellipsizeMode).toBe('middle')

    fireEvent.press(tree.getByTestId(id('DeveloperMediator')))
    expect(mockNavigate).toHaveBeenCalledWith(Screens.ConfigureMediator)
  })

  test('Copy puts the whole mediator value on the clipboard, not the shortened line', () => {
    const tree = show()
    fireEvent.press(tree.getByTestId(id('DeveloperMediatorCopy')))
    expect(Clipboard.setString).toHaveBeenCalledWith(MEDIATOR)
  })

  test('the rows nothing reads are gone, and every gate row is still there', () => {
    const ids = testIdsInOrder(show())
    // Positive control: the walk does see the screen's rows, gate rows included.
    for (const key of GATE_IDS) expect(ids).toContain(key)
    expect(ids).toContain('ToggleUseShareableLink')
    expect(ids).toContain('environment')
    expect(ids).toContain('ToggleEnableAppToAppPersonFlow')
    expect(ids).not.toContain('TogglePreventAutoLockSwitch')
    expect(ids).not.toContain('ToggleEnableProxy')
  })

  test('the probe says it sends a join request', () => {
    const tree = show()
    expect(tree.getByText('Probe VTA mediator (sends a join request)')).toBeTruthy()
    expect(tree.queryByText('Probe VTA mediator')).toBeNull()
  })

  test('the groups run Connection, Diagnostics, Agent tools, Test data, OTA, Credentials, with the clock rows last', () => {
    const ids = testIdsInOrder(show())
    const order = [
      'ToggleDeveloper',
      'DeveloperMediator',
      'ToggleEnableDidCommV2',
      'ToggleEnableTspCarriage',
      'ToggleRemoteLoggingSwitch',
      'ProbeVtaMediatorButton',
      'ProbeVtaManagerButton',
      'SeedTestContactsButton',
      'ClearTestContactsButton',
      'OtaBundleId',
      'ToggleVerifierCapability',
      'environment',
    ]
    const positions = order.map((key) => ids.indexOf(key))
    for (const position of positions) expect(position).toBeGreaterThanOrEqual(0)
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
  })
})
