/**
 * The trusted-approvers switch (docs/plans/trusted-approver-plan.md): Developer settings turns on naming someone to
 * approve for this person, and approving for someone else. Off by default; a toggle saves it; on load the saved choice
 * wins. Turning it off for everyone is bifold's TRUSTED_APPROVERS_REMOTE_OFF, and it must beat a saved "on": a phone
 * that saved "on" would otherwise keep it on whatever a release does. So these rows use bifold's real switch, not a
 * mock, and read it the way every screen does, through isTrustedApproversEnabled().
 */
import {
  PersistentStorage,
  TOKENS,
  TRUSTED_APPROVERS_REMOTE_OFF,
  isTrustedApproversEnabled,
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
// The same stubs sharedConnectInviteSwitch.test.ts uses to build the app container under jest.
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
  return { stored: state.developer.enableTrustedApprovers, on: isTrustedApproversEnabled() }
}

beforeEach(() => {
  saved.clear()
  TRUSTED_APPROVERS_REMOTE_OFF.off = false
  // Each row starts from the opposite of what it expects, so a loader that never tells bifold fails it.
  setTrustedApproversEnabled(false)
  jest
    .spyOn(PersistentStorage.prototype, 'getValueForKey')
    .mockImplementation(async (key: string) => saved.get(key) as never)
})

const DEFAULT = initialState.developer.enableTrustedApprovers

afterEach(() => {
  jest.restoreAllMocks()
  initialState.developer.enableTrustedApprovers = DEFAULT
  TRUSTED_APPROVERS_REMOTE_OFF.off = false
  setTrustedApproversEnabled(false)
})

describe('the trusted-approvers switch', () => {
  it('is off by default', () => {
    expect(initialState.developer.enableTrustedApprovers).toBe(false)
  })

  it('the Developer toggle sets it and saves it, under its own key', () => {
    const save = jest.spyOn(PersistentStorage, 'storeValueForKey').mockImplementation(async () => undefined)

    const on = reducer(initialState, { type: BCDispatchAction.TOGGLE_TRUSTED_APPROVERS, payload: [true] })
    expect(on.developer.enableTrustedApprovers).toBe(true)
    expect(on.developer.enableSharedConnectInvite).toBe(initialState.developer.enableSharedConnectInvite)
    expect(save).toHaveBeenCalledWith(BCLocalStorageKeys.EnableTrustedApprovers, true)

    const off = reducer(on, { type: BCDispatchAction.TOGGLE_TRUSTED_APPROVERS, payload: [false] })
    expect(off.developer.enableTrustedApprovers).toBe(false)
    expect(save).toHaveBeenLastCalledWith(BCLocalStorageKeys.EnableTrustedApprovers, false)
  })

  it('on load, with nothing saved, it is off', async () => {
    setTrustedApproversEnabled(true)
    expect(await load()).toEqual({ stored: false, on: false })
  })

  it('on load, a saved "on" turns it on (control for the remote off below)', async () => {
    saved.set(BCLocalStorageKeys.EnableTrustedApprovers, true)
    expect(await load()).toEqual({ stored: true, on: true })
  })

  it('on load, the remote off beats a saved "on": the choice is kept, and the switch reads off', async () => {
    saved.set(BCLocalStorageKeys.EnableTrustedApprovers, true)
    TRUSTED_APPROVERS_REMOTE_OFF.off = true
    expect(await load()).toEqual({ stored: true, on: false })
  })

  it('on load, a saved "off" wins over a default that is on', async () => {
    initialState.developer.enableTrustedApprovers = true
    saved.set(BCLocalStorageKeys.EnableTrustedApprovers, false)
    setTrustedApproversEnabled(true)
    expect(await load()).toEqual({ stored: false, on: false })
  })
})
