/**
 * A link is handled once, not again after every unlock.
 *
 * `useDeepLinks` lives in the main stack, which unmounts when the wallet locks
 * and mounts again after the PIN. On each mount it asked for the link that
 * opened the app (`Linking.getInitialURL`), and that link stays the same for
 * the life of the process. On Android it is even the LATEST link the app was
 * opened with, since MainActivity.onNewIntent calls setIntent. So every unlock
 * handled that link again: an invitation already used failed with "Unable to
 * handle deeplink" (a6's #611 run, 10-26), and a link that acts (a join, an
 * enrolment, a reusable invitation) could act twice.
 */
import { Linking } from 'react-native'

import { DispatchAction } from '../../src/contexts/reducers/store'

type UrlListener = (event: { url: string }) => void

const mockDispatch = jest.fn()

jest.mock('../../src/contexts/store', () => ({
  useStore: () => [{ authentication: { didAuthenticate: true } }, mockDispatch],
}))
jest.mock('../../src/contexts/activity', () => ({
  useActivity: () => ({ appStateStatus: 'active' }),
}))

const INVITE = 'https://example.org/invite?oob=eyJAdHlwZSI6Im91dC1vZi1iYW5kIn0'
const OTHER = 'keyring://vta/enrol?offer=abc'

let hookListener: UrlListener | undefined
let initialUrl: string | null = null

const activated = () =>
  mockDispatch.mock.calls
    .map(([action]) => action)
    .filter((action) => action.type === DispatchAction.ACTIVE_DEEP_LINK)
    .map((action) => action.payload[0])

type Loaded = { useDeepLinks: () => void; rtl: typeof import('@testing-library/react-native/pure') }

// A fresh module per test, since what the hook remembers lives for the process, as the app's does. The testing
// library comes from the same registry, so the hook and the renderer share one React.
function loadHook(): Loaded {
  let loaded: Loaded | undefined
  jest.isolateModules(() => {
    loaded = {
      // eslint-disable-next-line @typescript-eslint/no-var-requires -- a fresh copy per test
      useDeepLinks: require('../../src/hooks/deep-links').useDeepLinks,
      // eslint-disable-next-line @typescript-eslint/no-var-requires -- the same registry's React
      rtl: require('@testing-library/react-native/pure'),
    }
  })
  return loaded as Loaded
}

// One unlock: the main stack mounts the hook; the lock unmounts it.
async function unlockedSession({ useDeepLinks, rtl }: Loaded, during?: () => void) {
  const hook = rtl.renderHook(() => useDeepLinks())
  await rtl.act(async () => {})
  during?.()
  await rtl.act(async () => {})
  hook.unmount()
}

beforeEach(() => {
  mockDispatch.mockReset()
  hookListener = undefined
  initialUrl = null
  ;(Linking as unknown as { getInitialURL: () => Promise<string | null> }).getInitialURL = jest.fn(
    async () => initialUrl
  )
  ;(Linking as unknown as { addListener: unknown }).addListener = jest.fn((_: string, listener: UrlListener) => {
    hookListener = listener
    return { remove: jest.fn() }
  })
})

describe('a link is handled once', () => {
  it('the link that opened the app is handled at the first unlock, and not again at the next ones', async () => {
    initialUrl = INVITE
    const app = loadHook()

    await unlockedSession(app)
    await unlockedSession(app)
    await unlockedSession(app)

    expect(activated()).toEqual([INVITE])
  }, 30_000)

  it('a link that reached the running app is not replayed at the next unlock (Android keeps it as the initial URL)', async () => {
    const app = loadHook()

    await unlockedSession(app, () => {
      hookListener?.({ url: INVITE })
      // MainActivity.onNewIntent → setIntent: from now on getInitialURL answers with it.
      initialUrl = INVITE
    })
    await unlockedSession(app)

    expect(activated()).toEqual([INVITE])
  }, 30_000)

  it('a new link after an unlock is still handled', async () => {
    initialUrl = INVITE
    const app = loadHook()

    await unlockedSession(app)
    await unlockedSession(app, () => hookListener?.({ url: OTHER }))

    expect(activated()).toEqual([INVITE, OTHER])
  }, 30_000)
})
