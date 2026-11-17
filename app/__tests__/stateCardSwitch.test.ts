/**
 * The "State card (demo)" switch (SEDI/KERI holder card): Developer settings turn it on, off by default; a toggle
 * saves it under its own key; on load the saved choice wins and reaches bifold. Turning it off for everyone is
 * bifold's STATE_CARD_REMOTE_OFF or SEDI_KERI_REMOTE_OFF, and either must beat a saved "on". So these rows use
 * bifold's real switch, not a mock, and read it the way the card does, through isStateCardEnabled().
 */
import {
  PersistentStorage,
  SEDI_KERI_REMOTE_OFF,
  STATE_CARD_REMOTE_OFF,
  TOKENS,
  isStateCardEnabled,
  setStateCardEnabled,
} from '@bifold/core'
import path from 'path'

import { composeContainers } from '../container-compose'
import { BCDispatchAction, BCLocalStorageKeys, initialState, reducer } from '../src/store'

jest.mock('@bifold/core', () => ({
  ...jest.requireActual('@bifold/core'),
  setSharedConnectEnabled: () => undefined,
  setSharedConnectInviteEnabled: () => undefined,
  // The loader also reads the login attempts from the keychain, whose native module isn't in jest; not what this
  // test is about.
  loadLoginAttempt: async () => undefined,
}))
// The same stubs trustedApproversSwitch.test.ts uses to build the app container under jest.
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
  return { stored: state.developer.enableStateCard, on: isStateCardEnabled() }
}

const DEFAULT = initialState.developer.enableStateCard

beforeEach(() => {
  saved.clear()
  STATE_CARD_REMOTE_OFF.off = false
  SEDI_KERI_REMOTE_OFF.off = false
  jest
    .spyOn(PersistentStorage.prototype, 'getValueForKey')
    .mockImplementation(async (key: string) => saved.get(key) as never)
})

afterEach(() => {
  jest.restoreAllMocks()
  initialState.developer.enableStateCard = DEFAULT
  STATE_CARD_REMOTE_OFF.off = false
  SEDI_KERI_REMOTE_OFF.off = false
  setStateCardEnabled(false)
})

describe('the "State card (demo)" switch', () => {
  it('is off by default', () => {
    expect(initialState.developer.enableStateCard).toBe(false)
  })

  it('the Developer toggle sets it and saves it, under its own key', () => {
    const save = jest.spyOn(PersistentStorage, 'storeValueForKey').mockImplementation(async () => undefined)
    const on = reducer(initialState, { type: BCDispatchAction.TOGGLE_STATE_CARD, payload: [true] })
    expect(on.developer.enableStateCard).toBe(true)
    expect(on.developer.enableTrustTestState).toBe(initialState.developer.enableTrustTestState)
    expect(save).toHaveBeenCalledWith(BCLocalStorageKeys.EnableStateCard, true)
    expect(save).toHaveBeenCalledTimes(1)
    const off = reducer(on, { type: BCDispatchAction.TOGGLE_STATE_CARD, payload: [false] })
    expect(off.developer.enableStateCard).toBe(false)
    expect(save).toHaveBeenLastCalledWith(BCLocalStorageKeys.EnableStateCard, false)
  })

  it('on load, with nothing saved, it is off (starting from on, so a loader that never tells bifold fails)', async () => {
    setStateCardEnabled(true)
    expect(await load()).toEqual({ stored: false, on: false })
  })

  it('on load, a saved "on" turns it on, with no approver switch saved (control for the remote offs below)', async () => {
    saved.set(BCLocalStorageKeys.EnableStateCard, true)
    expect(await load()).toEqual({ stored: true, on: true })
  })

  it.each([
    ['its own', () => (STATE_CARD_REMOTE_OFF.off = true)],
    ['the SEDI/KERI', () => (SEDI_KERI_REMOTE_OFF.off = true)],
  ])('on load, %s remote off beats a saved "on": the choice is kept, and the card reads off', async (_, off) => {
    saved.set(BCLocalStorageKeys.EnableStateCard, true)
    off()
    expect(await load()).toEqual({ stored: true, on: false })
  })

  it('on load, a saved "off" wins over a default that is on', async () => {
    initialState.developer.enableStateCard = true
    saved.set(BCLocalStorageKeys.EnableStateCard, false)
    setStateCardEnabled(true)
    expect(await load()).toEqual({ stored: false, on: false })
  })
})
