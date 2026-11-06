/**
 * The shared-connect switch (keyring-wallet #853): Developer settings turns on
 * connecting from a code someone shared. It is off by default, a toggle saves
 * it, and on load the saved choice wins — "off" included, so that turning the
 * default on later cannot override someone who switched it off.
 */
import { PersistentStorage, TOKENS } from '@bifold/core'
import path from 'path'

import { composeContainers } from '../container-compose'
import { BCDispatchAction, BCLocalStorageKeys, initialState, reducer } from '../src/store'

const mockSetSharedConnectEnabled = jest.fn()
jest.mock('@bifold/core', () => ({
  ...jest.requireActual('@bifold/core'),
  setSharedConnectEnabled: (enabled: boolean) => mockSetSharedConnectEnabled(enabled),
}))
// The same stubs containerComposition.test.ts uses to build the app container under jest:
// - react-native-webview: a registered screen imports it, and its native module isn't in jest;
// - the app logger: AppContainer.init() starts its event listeners, which jest's logger mock lacks;
// - i18next's addResourceBundle (below): the VRC module registers its translations into a bare mock.
jest.mock('react-native-webview', () => ({ WebView: () => null }))
jest.mock('../src/utils/logger', () => {
  const log = jest.fn()
  return {
    __esModule: true,
    default: { startEventListeners: jest.fn(), info: log, warn: log, error: log, debug: log, trace: log },
  }
})
const bifoldCoreDir = path.resolve(__dirname, '../../bifold/packages/core')
for (const from of [__dirname, bifoldCoreDir]) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires -- the copy that directory resolves
  const i18nModule = require(require.resolve('i18next', { paths: [from] }))
  const i18n = i18nModule.default ?? i18nModule
  i18n.addResourceBundle ??= jest.fn()
}

const saved = new Map<string, unknown>()

/** Run the app container's state loader once; what it dispatched, and what it told bifold. */
const load = async () => {
  const { app } = composeContainers(
    ((key: string) => key) as never,
    () => undefined,
    () => undefined
  )
  const dispatch = jest.fn()
  await app.resolve(TOKENS.LOAD_STATE)(dispatch)
  const state = dispatch.mock.calls[0][0].payload[0]
  return { stored: state.developer.enableSharedConnect, told: mockSetSharedConnectEnabled.mock.calls.at(-1)?.[0] }
}

beforeEach(() => {
  saved.clear()
  mockSetSharedConnectEnabled.mockClear()
  jest
    .spyOn(PersistentStorage.prototype, 'getValueForKey')
    .mockImplementation(async (key: string) => saved.get(key) as never)
})

const DEFAULT = initialState.developer.enableSharedConnect

afterEach(() => {
  jest.restoreAllMocks()
  initialState.developer.enableSharedConnect = DEFAULT
})

describe('shared-connect switch', () => {
  it('is on by default', () => {
    expect(initialState.developer.enableSharedConnect).toBe(true)
  })

  it('the Developer toggle sets it and saves it', () => {
    const save = jest.spyOn(PersistentStorage, 'storeValueForKey').mockImplementation(async () => undefined)

    const on = reducer(initialState, { type: BCDispatchAction.TOGGLE_SHARED_CONNECT, payload: [true] })
    expect(on.developer.enableSharedConnect).toBe(true)
    expect(save).toHaveBeenCalledWith(BCLocalStorageKeys.EnableSharedConnect, true)

    const off = reducer(on, { type: BCDispatchAction.TOGGLE_SHARED_CONNECT, payload: [false] })
    expect(off.developer.enableSharedConnect).toBe(false)
    expect(save).toHaveBeenLastCalledWith(BCLocalStorageKeys.EnableSharedConnect, false)
  })

  it('on load, with nothing saved, bifold is told the default', async () => {
    expect(await load()).toEqual({ stored: true, told: true })
  })

  it('on load, a saved "on" turns it on', async () => {
    saved.set(BCLocalStorageKeys.EnableSharedConnect, true)
    expect(await load()).toEqual({ stored: true, told: true })
  })

  it('on load, a saved "off" wins over a default that is on', async () => {
    // The default-on change flips this one value; someone who switched it off keeps it off.
    initialState.developer.enableSharedConnect = true
    saved.set(BCLocalStorageKeys.EnableSharedConnect, false)
    expect(await load()).toEqual({ stored: false, told: false })
  })

  it('on load, with nothing saved, a default that is on reaches bifold', async () => {
    initialState.developer.enableSharedConnect = true
    expect(await load()).toEqual({ stored: true, told: true })
  })
})
