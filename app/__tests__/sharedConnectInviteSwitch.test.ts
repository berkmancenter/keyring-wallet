/**
 * The "Show a code" switch (shared-connect as the inviter, plan WP9):
 * Developer settings turns on showing a shared-connect code for someone else
 * to scan. It is off by default until the live run passes, a toggle saves it,
 * and on load the saved choice wins — "off" included, so that turning the
 * default on later cannot override someone who switched it off.
 */
import { PersistentStorage, TOKENS } from '@bifold/core'
import path from 'path'

import { composeContainers } from '../container-compose'
import { BCDispatchAction, BCLocalStorageKeys, initialState, reducer } from '../src/store'

const mockSetSharedConnectInviteEnabled = jest.fn()
jest.mock('@bifold/core', () => ({
  ...jest.requireActual('@bifold/core'),
  setSharedConnectEnabled: () => undefined,
  setSharedConnectInviteEnabled: (enabled: boolean) => mockSetSharedConnectInviteEnabled(enabled),
  // The loader also reads the login attempts from the keychain, whose native module isn't in jest; not what this
  // test is about.
  loadLoginAttempt: async () => undefined,
}))
// The same stubs sharedConnectSwitch.test.ts uses to build the app container under jest.
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
  return {
    stored: state.developer.enableSharedConnectInvite,
    told: mockSetSharedConnectInviteEnabled.mock.calls.at(-1)?.[0],
  }
}

beforeEach(() => {
  saved.clear()
  mockSetSharedConnectInviteEnabled.mockClear()
  jest
    .spyOn(PersistentStorage.prototype, 'getValueForKey')
    .mockImplementation(async (key: string) => saved.get(key) as never)
})

const DEFAULT = initialState.developer.enableSharedConnectInvite

afterEach(() => {
  jest.restoreAllMocks()
  initialState.developer.enableSharedConnectInvite = DEFAULT
})

describe('the Show a code switch', () => {
  it('is off by default', () => {
    expect(initialState.developer.enableSharedConnectInvite).toBe(false)
  })

  it('the Developer toggle sets it and saves it, under its own key', () => {
    const save = jest.spyOn(PersistentStorage, 'storeValueForKey').mockImplementation(async () => undefined)

    const on = reducer(initialState, { type: BCDispatchAction.TOGGLE_SHARED_CONNECT_INVITE, payload: [true] })
    expect(on.developer.enableSharedConnectInvite).toBe(true)
    expect(on.developer.enableSharedConnect).toBe(initialState.developer.enableSharedConnect)
    expect(save).toHaveBeenCalledWith(BCLocalStorageKeys.EnableSharedConnectInvite, true)

    const off = reducer(on, { type: BCDispatchAction.TOGGLE_SHARED_CONNECT_INVITE, payload: [false] })
    expect(off.developer.enableSharedConnectInvite).toBe(false)
    expect(save).toHaveBeenLastCalledWith(BCLocalStorageKeys.EnableSharedConnectInvite, false)
  })

  it('on load, with nothing saved, bifold is told the default (off)', async () => {
    expect(await load()).toEqual({ stored: false, told: false })
  })

  it('on load, a saved "on" turns it on', async () => {
    saved.set(BCLocalStorageKeys.EnableSharedConnectInvite, true)
    expect(await load()).toEqual({ stored: true, told: true })
  })

  it('on load, a saved "off" wins over a default that is on', async () => {
    // Turning it on after the live run flips this one default; someone who switched it off keeps it off.
    initialState.developer.enableSharedConnectInvite = true
    saved.set(BCLocalStorageKeys.EnableSharedConnectInvite, false)
    expect(await load()).toEqual({ stored: false, told: false })
  })

  it('on load, with nothing saved, a default that is on reaches bifold', async () => {
    initialState.developer.enableSharedConnectInvite = true
    expect(await load()).toEqual({ stored: true, told: true })
  })
})
