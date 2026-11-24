/**
 * DIDComm v2, wallet-to-wallet TSP carriage and, from 281.2, the v2 mailbox (needed to mint v2 invitations) are on for
 * everyone. The saved opt-outs live under new keys, read with loadSwitch so a saved false counts, and the values a
 * phone saved under the old keys while these were opt-in are ignored.
 */
import { PersistentStorage, TOKENS } from '@bifold/core'
import path from 'path'

import { composeContainers } from '../container-compose'
import { BCDispatchAction, BCLocalStorageKeys, initialState, reducer } from '../src/store'

jest.mock('@bifold/core', () => ({
  ...jest.requireActual('@bifold/core'),
  // The loader also reads the login attempts from the keychain, whose native module isn't in jest; not what this
  // test is about.
  loadLoginAttempt: async () => undefined,
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

/** Run the app container's state loader once; the three DIDComm switches it loaded. */
const load = async () => {
  const { app } = composeContainers(
    ((key: string) => key) as never,
    () => undefined,
    () => undefined
  )
  const dispatch = jest.fn()
  await app.resolve(TOKENS.LOAD_STATE)(dispatch)
  const { enableTspCarriage, enableDidCommV2, enableV2Mailbox } = dispatch.mock.calls[0][0].payload[0].developer
  return { enableTspCarriage, enableDidCommV2, enableV2Mailbox }
}

beforeEach(() => {
  saved.clear()
  jest
    .spyOn(PersistentStorage.prototype, 'getValueForKey')
    .mockImplementation(async (key: string) => saved.get(key) as never)
})

afterEach(() => jest.restoreAllMocks())

const AS_SHIPPED = { enableTspCarriage: true, enableDidCommV2: true, enableV2Mailbox: true }

describe('DIDComm v2, TSP carriage and the v2 mailbox on by default', () => {
  it('the shipped defaults', () => {
    const { enableTspCarriage, enableDidCommV2, enableV2Mailbox } = initialState.developer
    expect({ enableTspCarriage, enableDidCommV2, enableV2Mailbox }).toEqual(AS_SHIPPED)
  })

  it('on load, with nothing saved: the defaults', async () => {
    expect(await load()).toEqual(AS_SHIPPED)
  })

  it('on load, a "false" saved while these were opt-in switches (the old keys) does not beat the new default', async () => {
    // The trap Confirm it's you hit on 11-18: a false saved against the opt-in experiment is not an opt-out of the
    // default that now ships.
    saved.set('EnableTspCarriage', false)
    saved.set('EnableDidCommV2', false)
    // The mailbox's testers-only key (281.1 and before): a tester who turned it off then is on, like everyone.
    saved.set('EnableV2Mailbox', false)
    expect(await load()).toEqual(AS_SHIPPED)
  })

  it('the old keys are not the new ones', () => {
    expect(BCLocalStorageKeys.EnableTspCarriage).not.toBe('EnableTspCarriage')
    expect(BCLocalStorageKeys.EnableDidCommV2).not.toBe('EnableDidCommV2')
    expect(BCLocalStorageKeys.EnableV2Mailbox).not.toBe('EnableV2Mailbox')
  })

  it('CONTROL: an opt-out saved under the new keys wins on load (a saved false is read, not skipped)', async () => {
    saved.set(BCLocalStorageKeys.EnableTspCarriage, false)
    saved.set(BCLocalStorageKeys.EnableDidCommV2, false)
    saved.set(BCLocalStorageKeys.EnableV2Mailbox, false)
    expect(await load()).toEqual({ enableTspCarriage: false, enableDidCommV2: false, enableV2Mailbox: false })
  })

  it('a v2 mailbox "off" saved under its new key is an opt-out and is loaded', async () => {
    saved.set(BCLocalStorageKeys.EnableV2Mailbox, false)
    expect(await load()).toEqual({ ...AS_SHIPPED, enableV2Mailbox: false })
  })

  it.each([
    [BCDispatchAction.TOGGLE_TSP_CARRIAGE, 'enableTspCarriage', BCLocalStorageKeys.EnableTspCarriage],
    [BCDispatchAction.TOGGLE_DIDCOMM_V2, 'enableDidCommV2', BCLocalStorageKeys.EnableDidCommV2],
    [BCDispatchAction.TOGGLE_V2_MAILBOX, 'enableV2Mailbox', BCLocalStorageKeys.EnableV2Mailbox],
  ])('the Developer toggle %s sets %s and saves it under its new key', (type, field, key) => {
    const save = jest.spyOn(PersistentStorage, 'storeValueForKey').mockImplementation(async () => undefined)
    const off = reducer(initialState, { type, payload: [false] })
    expect((off.developer as unknown as Record<string, boolean>)[field]).toBe(false)
    expect(save).toHaveBeenLastCalledWith(key, false)
    const on = reducer(off, { type, payload: [true] })
    expect((on.developer as unknown as Record<string, boolean>)[field]).toBe(true)
    expect(save).toHaveBeenLastCalledWith(key, true)
  })
})
