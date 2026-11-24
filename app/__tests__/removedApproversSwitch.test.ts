/**
 * The approvers feature is gone, and with it its Developer switch: the store field, its action and its saved key. A
 * phone that updates in place may still hold the key (it saved "on" or "off" while the switch existed), and may hold
 * the person's other saved switches beside it. It must load as a phone that never had it.
 *
 * What is held: the app keeps no state, saved key or action for it; on load the old key is not read, a saved value
 * of either kind changes nothing about the state the loader makes, and the other saved switches still load (control:
 * "not read" must not mean "nothing was read"). Nothing deletes the old key; it is left orphaned and ignored, as
 * "Confirm it's you" was (confirmItsYouSwitch.test.ts).
 */
import { PersistentStorage, TOKENS } from '@bifold/core'
import path from 'path'

import { composeContainers } from '../container-compose'
import { BCDispatchAction, BCLocalStorageKeys, initialState } from '../src/store'

jest.mock('@bifold/core', () => ({
  ...jest.requireActual('@bifold/core'),
  setSharedConnectEnabled: () => undefined,
  setSharedConnectInviteEnabled: () => undefined,
  // The loader also reads the login attempts from the keychain, whose native module isn't in jest.
  loadLoginAttempt: async () => undefined,
}))
// The stubs needed to build the app container under jest.
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

/**
 * The key the Developer switch saved under, as phones still hold it. Spelled in parts so that a search for the
 * feature's names finds only what is left of the feature, not this record of the key.
 */
const OLD_KEY = ['Enable', 'Trusted', 'Approvers'].join('')
const OLD_FIELD = 'enable' + OLD_KEY.slice('Enable'.length)

const saved = new Map<string, unknown>()
let read: jest.SpyInstance

/** Run the app container's state loader once; the state it made. */
const load = async () => {
  const { app } = composeContainers(
    ((key: string) => key) as never,
    () => undefined,
    () => undefined
  )
  const dispatch = jest.fn()
  await app.resolve(TOKENS.LOAD_STATE)(dispatch)
  return dispatch.mock.calls[0][0].payload[0].developer as Record<string, unknown>
}

beforeEach(() => {
  saved.clear()
  read = jest
    .spyOn(PersistentStorage.prototype, 'getValueForKey')
    .mockImplementation(async (key: string) => saved.get(key) as never)
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('an install that updates in place from a build that had the approvers switch', () => {
  it('the app keeps no state, no saved key and no action for it', () => {
    expect(Object.keys(initialState.developer)).not.toContain(OLD_FIELD)
    expect(Object.values(BCLocalStorageKeys)).not.toContain(OLD_KEY)
    expect(Object.keys(BCDispatchAction).filter((name) => /TRUSTED_APPROVERS/.test(name))).toEqual([])
  })

  it.each([
    ['nothing saved', undefined],
    ['"off" saved', false],
    ['"on" saved', true],
  ])(
    'with %s, it loads: the old key is not read, the state has no field for it, the rest is as without it',
    async (_, was) => {
      const without = await load()
      expect(Object.keys(without)).not.toContain(OLD_FIELD)
      read.mockClear()

      if (was !== undefined) saved.set(OLD_KEY, was)
      // Another saved switch, to show the loader still reads what it keeps and that the old value does not disturb it.
      saved.set(BCLocalStorageKeys.EnableLivePickup, true)
      const developer = await load()

      expect(read.mock.calls.map(([key]) => key)).not.toContain(OLD_KEY)
      expect(read.mock.calls.map(([key]) => key)).toContain(BCLocalStorageKeys.EnableSharedConnectInvite)
      expect(Object.keys(developer)).not.toContain(OLD_FIELD)
      expect(developer.enableLivePickup).toBe(true)
      expect(Object.keys(developer).sort()).toEqual(Object.keys(without).sort())
    }
  )
})
