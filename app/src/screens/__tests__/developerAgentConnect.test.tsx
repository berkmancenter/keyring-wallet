/**
 * The agent-connect developer switches (backlog 2, R4): Developer settings turns on the AI agent screens and, only
 * while that is on, their HCP lane. Both are off by default; a row saves its choice in the store and tells bifold at
 * once, and the app's start-up apply hands the saved choice to bifold before the first stack mounts.
 */
import { AuthProvider, PersistentStorage, TOKENS, testIdWithKey, useStore } from '@bifold/core'
import { act, fireEvent, render } from '@testing-library/react-native'
import path from 'path'
import React from 'react'
import { Switch } from 'react-native'

import { composeContainers } from '../../../container-compose'
import { BasicAppContext } from '../../../__mocks__/helpers/app'
import { BCDispatchAction, BCLocalStorageKeys, BCState, initialState, reducer } from '../../store'
import Developer from '../Developer'

const mockSetAgentConnectEnabled = jest.fn()
const mockSetHcpEnabled = jest.fn()
jest.mock('@bifold/core', () => ({
  ...jest.requireActual('@bifold/core'),
  setAgentConnectEnabled: (enabled: boolean) => mockSetAgentConnectEnabled(enabled),
  setHcpEnabled: (enabled: boolean) => mockSetHcpEnabled(enabled),
  // The loader also reads the login attempts from the keychain, whose native module isn't in jest.
  loadLoginAttempt: async () => undefined,
}))
const mockNavigation = jest.fn()
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => mockNavigation,
}))
// The same stubs sharedConnectSwitch.test.ts uses to build the app container under jest: a registered screen imports
// react-native-webview, and AppContainer.init() starts the app logger's event listeners.
jest.mock('react-native-webview', () => ({ WebView: () => null }))
jest.mock('../../utils/logger', () => {
  const log = jest.fn()
  return {
    __esModule: true,
    default: { startEventListeners: jest.fn(), info: log, warn: log, error: log, debug: log, trace: log },
  }
})
const bifoldCoreDir = path.resolve(__dirname, '../../../../packages/core')
for (const from of [__dirname, bifoldCoreDir]) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires -- the copy that directory resolves
  const i18nModule = require(require.resolve('i18next', { paths: [from] }))
  const i18n = i18nModule.default ?? i18nModule
  i18n.addResourceBundle ??= jest.fn()
}

const AGENT_ROW = testIdWithKey('ToggleEnableAgentConnect')
const HCP_ROW = testIdWithKey('ToggleEnableHcp')

/** The developer state the screen's store holds, read after each press. */
let seen: BCState['developer'] | undefined
const Probe = () => {
  const [store] = useStore<BCState>()
  seen = store.developer
  return null
}

const developer = () =>
  render(
    <BasicAppContext>
      <AuthProvider>
        <Developer />
        <Probe />
      </AuthProvider>
    </BasicAppContext>
  )

/** The Switch inside a row. */
const switchIn = (tree: ReturnType<typeof developer>, testID: string) =>
  tree.getByTestId(testID).findByType(Switch as unknown as React.ComponentType)

const saved = new Map<string, unknown>()

beforeEach(() => {
  // Silence the Switch's "dispatchCommand was called with a ref" warning, as Developer.test.tsx does.
  jest.spyOn(console, 'error').mockImplementation(() => null)
  jest.spyOn(PersistentStorage, 'storeValueForKey').mockImplementation(async () => undefined)
  saved.clear()
  jest
    .spyOn(PersistentStorage.prototype, 'getValueForKey')
    .mockImplementation(async (key: string) => saved.get(key) as never)
  mockSetAgentConnectEnabled.mockClear()
  mockSetHcpEnabled.mockClear()
  seen = undefined
})
afterEach(() => jest.restoreAllMocks())

describe('the agent-connect developer switches', () => {
  it("the store's defaults are false, both", () => {
    expect(initialState.developer.enableAgentConnect).toBe(false)
    expect(initialState.developer.enableHcp).toBe(false)
  })

  it('the actions set each one and save it, both ways', () => {
    const save = PersistentStorage.storeValueForKey as jest.Mock
    const on = reducer(initialState, { type: BCDispatchAction.TOGGLE_AGENT_CONNECT, payload: [true] })
    expect(on.developer.enableAgentConnect).toBe(true)
    expect(save).toHaveBeenLastCalledWith(BCLocalStorageKeys.EnableAgentConnect, true)
    const hcp = reducer(on, { type: BCDispatchAction.TOGGLE_HCP, payload: [true] })
    expect(hcp.developer.enableHcp).toBe(true)
    expect(save).toHaveBeenLastCalledWith(BCLocalStorageKeys.EnableHcp, true)
    const off = reducer(hcp, { type: BCDispatchAction.TOGGLE_AGENT_CONNECT, payload: [false] })
    expect(off.developer.enableAgentConnect).toBe(false)
    expect(save).toHaveBeenLastCalledWith(BCLocalStorageKeys.EnableAgentConnect, false)
  })

  it('the agent-connect row toggles the store and calls the setter, both ways', async () => {
    const tree = developer()
    await act(async () => fireEvent.press(tree.getByTestId(AGENT_ROW)))
    expect(seen?.enableAgentConnect).toBe(true)
    expect(mockSetAgentConnectEnabled).toHaveBeenLastCalledWith(true)
    expect(switchIn(tree, AGENT_ROW).props.value).toBe(true)
    await act(async () => fireEvent.press(tree.getByTestId(AGENT_ROW)))
    expect(seen?.enableAgentConnect).toBe(false)
    expect(mockSetAgentConnectEnabled).toHaveBeenLastCalledWith(false)
  })

  it('with agent connect on, the HCP row toggles the store and calls its setter', async () => {
    const tree = developer()
    await act(async () => fireEvent.press(tree.getByTestId(AGENT_ROW)))
    expect(switchIn(tree, HCP_ROW).props.disabled).toBe(false)
    await act(async () => fireEvent.press(tree.getByTestId(HCP_ROW)))
    expect(seen?.enableHcp).toBe(true)
    expect(mockSetHcpEnabled).toHaveBeenLastCalledWith(true)
    expect(switchIn(tree, HCP_ROW).props.value).toBe(true)
    await act(async () => fireEvent.press(tree.getByTestId(HCP_ROW)))
    expect(seen?.enableHcp).toBe(false)
    expect(mockSetHcpEnabled).toHaveBeenLastCalledWith(false)
  })

  // control: the HCP row is off and disabled while agent connect is off, and a press there changes nothing.
  it('control: the HCP row is off and disabled while agent connect is off', async () => {
    const tree = developer()
    expect(switchIn(tree, HCP_ROW).props.value).toBe(false)
    expect(switchIn(tree, HCP_ROW).props.disabled).toBe(true)
    expect(tree.getByTestId(HCP_ROW).props.accessibilityState).toEqual({ disabled: true })
    await act(async () => fireEvent.press(tree.getByTestId(HCP_ROW)))
    expect(seen?.enableHcp).toBe(false)
    expect(mockSetHcpEnabled).not.toHaveBeenCalled()
    // A saved HCP "on" still shows off once agent connect is switched off again.
    await act(async () => fireEvent.press(tree.getByTestId(AGENT_ROW)))
    await act(async () => fireEvent.press(tree.getByTestId(HCP_ROW)))
    await act(async () => fireEvent.press(tree.getByTestId(AGENT_ROW)))
    expect(seen).toMatchObject({ enableAgentConnect: false, enableHcp: true })
    expect(switchIn(tree, HCP_ROW).props.value).toBe(false)
    expect(switchIn(tree, HCP_ROW).props.disabled).toBe(true)
  })
})

describe('the start-up apply (container-imp.ts)', () => {
  /** Run the app container's state loader once; what it stored, and what it told bifold. */
  const load = async () => {
    const { app } = composeContainers(
      ((key: string) => key) as never,
      () => undefined,
      () => undefined
    )
    const dispatch = jest.fn()
    await app.resolve(TOKENS.LOAD_STATE)(dispatch)
    const state = dispatch.mock.calls[0][0].payload[0]
    return {
      stored: [state.developer.enableAgentConnect, state.developer.enableHcp],
      told: [mockSetAgentConnectEnabled.mock.calls.at(-1)?.[0], mockSetHcpEnabled.mock.calls.at(-1)?.[0]],
    }
  }

  it('with nothing saved, bifold is told both are off', async () => {
    expect(await load()).toEqual({ stored: [false, false], told: [false, false] })
  })

  it('a saved "on" reaches bifold for each', async () => {
    saved.set(BCLocalStorageKeys.EnableAgentConnect, true)
    saved.set(BCLocalStorageKeys.EnableHcp, true)
    expect(await load()).toEqual({ stored: [true, true], told: [true, true] })
  })
})
