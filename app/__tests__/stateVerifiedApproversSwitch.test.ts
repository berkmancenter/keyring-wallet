/**
 * The state-verified approvers switch and the "Trust the test state (K0)" setting (trusted-approver plan, stage 2,
 * S1): Developer settings turn each on, off by default; a toggle saves it under its own key; on load the saved choice
 * wins. Turning either off for everyone is bifold's remote offs (STATE_VERIFIED_APPROVERS_REMOTE_OFF,
 * TRUSTED_APPROVERS_REMOTE_OFF, SEDI_KERI_REMOTE_OFF), and they must beat a saved "on". So these rows use bifold's
 * real switches, not mocks, and read them the way every screen does, through is…Enabled().
 */
import {
  PersistentStorage,
  SEDI_KERI_REMOTE_OFF,
  STATE_VERIFIED_APPROVERS_REMOTE_OFF,
  TOKENS,
  TRUSTED_APPROVERS_REMOTE_OFF,
  isStateVerifiedApproversEnabled,
  isTrustTestStateEnabled,
  setStateVerifiedApproversEnabled,
  setTrustTestStateEnabled,
  setTrustedApproversEnabled,
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

/** Run the app container's state loader once; what it stored, and what bifold's switches now read. */
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
    stored: [state.developer.enableStateVerifiedApprovers, state.developer.enableTrustTestState],
    on: [isStateVerifiedApproversEnabled(), isTrustTestStateEnabled()],
  }
}

const allSaved = () => {
  saved.set(BCLocalStorageKeys.EnableTrustedApprovers, true)
  saved.set(BCLocalStorageKeys.EnableStateVerifiedApprovers, true)
  saved.set(BCLocalStorageKeys.EnableTrustTestState, true)
}

const kills = () => {
  TRUSTED_APPROVERS_REMOTE_OFF.off = false
  STATE_VERIFIED_APPROVERS_REMOTE_OFF.off = false
  SEDI_KERI_REMOTE_OFF.off = false
}
const allOff = () => {
  setTrustedApproversEnabled(false)
  setStateVerifiedApproversEnabled(false)
  setTrustTestStateEnabled(false)
}

const DEFAULTS = { ...initialState.developer }

beforeEach(() => {
  saved.clear()
  kills()
  // Each row starts from the opposite of what it expects, so a loader that never tells bifold fails it.
  allOff()
  jest
    .spyOn(PersistentStorage.prototype, 'getValueForKey')
    .mockImplementation(async (key: string) => saved.get(key) as never)
})

afterEach(() => {
  jest.restoreAllMocks()
  initialState.developer.enableStateVerifiedApprovers = DEFAULTS.enableStateVerifiedApprovers
  initialState.developer.enableTrustTestState = DEFAULTS.enableTrustTestState
  kills()
  allOff()
})

describe('the state-verified approvers switch and the test-state setting', () => {
  it('are off by default', () => {
    expect(initialState.developer.enableStateVerifiedApprovers).toBe(false)
    expect(initialState.developer.enableTrustTestState).toBe(false)
  })

  it.each([
    [
      BCDispatchAction.TOGGLE_STATE_VERIFIED_APPROVERS,
      'enableStateVerifiedApprovers',
      BCLocalStorageKeys.EnableStateVerifiedApprovers,
    ],
    [BCDispatchAction.TOGGLE_TRUST_TEST_STATE, 'enableTrustTestState', BCLocalStorageKeys.EnableTrustTestState],
  ] as const)('the Developer toggle %s sets it and saves it, under its own key', (type, field, key) => {
    const save = jest.spyOn(PersistentStorage, 'storeValueForKey').mockImplementation(async () => undefined)

    const on = reducer(initialState, { type, payload: [true] })
    expect(on.developer[field]).toBe(true)
    expect(on.developer.enableTrustedApprovers).toBe(initialState.developer.enableTrustedApprovers)
    expect(save).toHaveBeenCalledWith(key, true)
    expect(save).toHaveBeenCalledTimes(1)

    const off = reducer(on, { type, payload: [false] })
    expect(off.developer[field]).toBe(false)
    expect(save).toHaveBeenLastCalledWith(key, false)
  })

  it('on load, with nothing saved, both are off', async () => {
    setStateVerifiedApproversEnabled(true)
    setTrustTestStateEnabled(true)
    expect(await load()).toEqual({ stored: [false, false], on: [false, false] })
  })

  it('on load, saved "on"s turn both on (control for the remote offs below)', async () => {
    allSaved()
    expect(await load()).toEqual({ stored: [true, true], on: [true, true] })
  })

  it('on load, the test-state setting holds only with state-verified approvers saved on too', async () => {
    saved.set(BCLocalStorageKeys.EnableTrustedApprovers, true)
    saved.set(BCLocalStorageKeys.EnableTrustTestState, true)
    expect(await load()).toEqual({ stored: [false, true], on: [false, false] })
  })

  it.each([
    // The state-verified switch answers for itself; the test-state setting needs trusted approvers too.
    ['trusted approvers', () => (TRUSTED_APPROVERS_REMOTE_OFF.off = true), [true, false]],
    ['state-verified approvers', () => (STATE_VERIFIED_APPROVERS_REMOTE_OFF.off = true), [false, false]],
    ['SEDI/KERI', () => (SEDI_KERI_REMOTE_OFF.off = true), [false, false]],
  ])(
    'on load, the %s remote off beats saved "on"s: the choices are kept, and what it kills reads off',
    async (_, off, on) => {
      allSaved()
      off()
      expect(await load()).toEqual({ stored: [true, true], on })
    }
  )

  it('on load, saved "off"s win over defaults that are on', async () => {
    initialState.developer.enableStateVerifiedApprovers = true
    initialState.developer.enableTrustTestState = true
    saved.set(BCLocalStorageKeys.EnableTrustedApprovers, true)
    saved.set(BCLocalStorageKeys.EnableStateVerifiedApprovers, false)
    saved.set(BCLocalStorageKeys.EnableTrustTestState, false)
    setStateVerifiedApproversEnabled(true)
    setTrustTestStateEnabled(true)
    expect(await load()).toEqual({ stored: [false, false], on: [false, false] })
  })
})
