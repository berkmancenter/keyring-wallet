/**
 * The "Confirm it's you" switch: a Developer setting turns it on, off by default; a toggle saves it under its own key;
 * on load the saved choice wins. Turning it off for everyone is bifold's CONFIRM_ITS_YOU_REMOTE_OFF (or the
 * SEDI_KERI_REMOTE_OFF umbrella), and either must beat a saved "on". So these rows use bifold's real switch, not a
 * mock, and read it the way every screen does, through isConfirmItsYouEnabled().
 */
import {
  CONFIRM_ITS_YOU_REMOTE_OFF,
  PersistentStorage,
  SEDI_KERI_REMOTE_OFF,
  TOKENS,
  isConfirmItsYouEnabled,
  setConfirmItsYouEnabled,
} from '@bifold/core'
import path from 'path'

import { composeContainers } from '../container-compose'
import { BCDispatchAction, BCLocalStorageKeys, initialState, reducer } from '../src/store'

jest.mock('@bifold/core', () => ({
  ...jest.requireActual('@bifold/core'),
  setSharedConnectEnabled: () => undefined,
  setSharedConnectInviteEnabled: () => undefined,
  // The loader also reads the login attempts from the keychain, whose native module isn't in jest.
  loadLoginAttempt: async () => undefined,
}))
// The same stubs stateVerifiedApproversSwitch.test.ts uses to build the app container under jest.
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

/** Run the app container's state loader once; what it stored, and what bifold's switch now reads. */
const load = async () => {
  const { app } = composeContainers(
    ((key: string) => key) as never,
    () => undefined,
    () => undefined
  )
  const dispatch = jest.fn()
  await app.resolve(TOKENS.LOAD_STATE)(dispatch)
  const state = dispatch.mock.calls[0][0].payload[0]
  return { stored: state.developer.enableConfirmItsYou, on: isConfirmItsYouEnabled() }
}

const kills = () => {
  CONFIRM_ITS_YOU_REMOTE_OFF.off = false
  SEDI_KERI_REMOTE_OFF.off = false
}

const DEFAULT = initialState.developer.enableConfirmItsYou

beforeEach(() => {
  saved.clear()
  kills()
  setConfirmItsYouEnabled(false)
  jest
    .spyOn(PersistentStorage.prototype, 'getValueForKey')
    .mockImplementation(async (key: string) => saved.get(key) as never)
})

afterEach(() => {
  jest.restoreAllMocks()
  initialState.developer.enableConfirmItsYou = DEFAULT
  kills()
  setConfirmItsYouEnabled(false)
})

describe('the "Confirm it\'s you" switch', () => {
  it('is off by default', () => {
    expect(initialState.developer.enableConfirmItsYou).toBe(false)
  })

  it('the Developer toggle sets it and saves it, under its own key (and nothing else)', () => {
    const save = jest.spyOn(PersistentStorage, 'storeValueForKey').mockImplementation(async () => undefined)
    const on = reducer(initialState, { type: BCDispatchAction.TOGGLE_CONFIRM_ITS_YOU, payload: [true] })
    expect(on.developer.enableConfirmItsYou).toBe(true)
    expect(on.developer.enableTrustedApprovers).toBe(initialState.developer.enableTrustedApprovers)
    expect(save).toHaveBeenCalledWith(BCLocalStorageKeys.EnableConfirmItsYou, true)
    expect(save).toHaveBeenCalledTimes(1)
    const off = reducer(on, { type: BCDispatchAction.TOGGLE_CONFIRM_ITS_YOU, payload: [false] })
    expect(off.developer.enableConfirmItsYou).toBe(false)
    expect(save).toHaveBeenLastCalledWith(BCLocalStorageKeys.EnableConfirmItsYou, false)
  })

  it('on load, with nothing saved, it is off (even if bifold was left on)', async () => {
    setConfirmItsYouEnabled(true)
    expect(await load()).toEqual({ stored: false, on: false })
  })

  it('on load, a saved "on" turns it on (control for the remote offs below)', async () => {
    saved.set(BCLocalStorageKeys.EnableConfirmItsYou, true)
    expect(await load()).toEqual({ stored: true, on: true })
  })

  it.each([
    ['its own remote off', () => (CONFIRM_ITS_YOU_REMOTE_OFF.off = true)],
    ['the SEDI/KERI umbrella', () => (SEDI_KERI_REMOTE_OFF.off = true)],
  ])('on load, %s beats a saved "on": the choice is kept, and it reads off', async (_, off) => {
    saved.set(BCLocalStorageKeys.EnableConfirmItsYou, true)
    off()
    expect(await load()).toEqual({ stored: true, on: false })
  })

  it('on load, a saved "off" wins over a default that is on', async () => {
    initialState.developer.enableConfirmItsYou = true
    saved.set(BCLocalStorageKeys.EnableConfirmItsYou, false)
    setConfirmItsYouEnabled(true)
    expect(await load()).toEqual({ stored: false, on: false })
  })
})
