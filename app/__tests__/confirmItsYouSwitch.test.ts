/**
 * "Confirm it's you" is part of the app, with no setting (Alberto, 2026-11-18: "not behind developer options anymore",
 * and it cannot be turned off). It was a Developer switch: off by default, saved under its own key, and applied to
 * bifold's switch at start-up.
 *
 * So the app no longer has a say: at start-up it neither reads the old key nor sets bifold's switch, whatever a phone
 * saved while it was a demo. A phone that saved "off" comes out as bifold ships it, like one that saved nothing.
 * Turning it off for everyone is bifold's CONFIRM_ITS_YOU_REMOTE_OFF, and that is
 * now the only way it goes off. So these rows use bifold's real switch, not a mock, and read it the way every
 * screen does, through isConfirmItsYouEnabled().
 *
 * Deliberately not asserted: that bifold's switch starts on. That is bifold's (its sediKeriSwitches.test.ts), and it
 * depends on the bifold this app is pinned to; what is held here is that the app leaves it alone.
 */
import {
  CONFIRM_ITS_YOU_REMOTE_OFF,
  PersistentStorage,
  TOKENS,
  isConfirmItsYouEnabled,
  setConfirmItsYouEnabled,
} from '@bifold/core'
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

/** The key the Developer switch saved under. No longer in BCLocalStorageKeys: named here as phones still hold it. */
const OLD_KEY = 'EnableConfirmItsYou'

const saved = new Map<string, unknown>()
let read: jest.SpyInstance

/** Run the app container's state loader once; the state it made, and what bifold's switch now reads. */
const load = async () => {
  const { app } = composeContainers(
    ((key: string) => key) as never,
    () => undefined,
    () => undefined
  )
  const dispatch = jest.fn()
  await app.resolve(TOKENS.LOAD_STATE)(dispatch)
  return { developer: dispatch.mock.calls[0][0].payload[0].developer, on: isConfirmItsYouEnabled() }
}

const kills = () => {
  CONFIRM_ITS_YOU_REMOTE_OFF.off = false
}

beforeEach(() => {
  saved.clear()
  kills()
  read = jest
    .spyOn(PersistentStorage.prototype, 'getValueForKey')
    .mockImplementation(async (key: string) => saved.get(key) as never)
})

afterEach(() => {
  jest.restoreAllMocks()
  kills()
  setConfirmItsYouEnabled(false)
})

describe('"Confirm it\'s you" has no setting in the app', () => {
  it('the app keeps no state, no saved key and no action for it', () => {
    expect(Object.keys(initialState.developer)).not.toContain('enableConfirmItsYou')
    expect(Object.values(BCLocalStorageKeys)).not.toContain(OLD_KEY)
    expect(Object.keys(BCDispatchAction).filter((name) => /CONFIRM_ITS_YOU/.test(name))).toEqual([])
  })

  it.each([
    ['nothing saved', undefined],
    ['"off" saved while it was a Developer switch', false],
    ['"on" saved while it was a Developer switch', true],
  ])('on load with %s, the old key is not read and the state carries nothing for it', async (_, was) => {
    if (was !== undefined) saved.set(OLD_KEY, was)
    const { developer } = await load()
    expect(read.mock.calls.map(([key]) => key)).not.toContain(OLD_KEY)
    expect(Object.keys(developer)).not.toContain('enableConfirmItsYou')
    // Control: the loader did read its other switches, so "not read" is not "nothing was read".
    expect(read.mock.calls.map(([key]) => key)).toContain(BCLocalStorageKeys.EnableTrustedApprovers)
  })

  it.each([
    ['nothing saved', undefined],
    ['"off" saved', false],
    ['"on" saved', true],
  ])("on load with %s, bifold's switch is left as it was: on stays on, off stays off", async (_, was) => {
    if (was !== undefined) saved.set(OLD_KEY, was)
    setConfirmItsYouEnabled(true)
    expect((await load()).on).toBe(true)
    setConfirmItsYouEnabled(false)
    expect((await load()).on).toBe(false)
  })

  it.each([['its own remote off', () => (CONFIRM_ITS_YOU_REMOTE_OFF.off = true)]])(
    '%s still turns it off after a load, whatever was saved (control: without it, on)',
    async (_, off) => {
      saved.set(OLD_KEY, true)
      setConfirmItsYouEnabled(true)
      expect((await load()).on).toBe(true)
      off()
      expect((await load()).on).toBe(false)
    }
  )
})
