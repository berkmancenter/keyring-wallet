/**
 * A link that reaches a running app while the wallet is locked. `useDeepLinks`
 * lives in the main stack, which renders only when unlocked, so the system's
 * `url` event used to be dropped: a tapped notification opened the app on the
 * tab it was on. The module keeps such a link for the hook's next mount.
 */
import { act, renderHook } from '@testing-library/react-native'
import { Linking } from 'react-native'

import { DispatchAction } from '../../src/contexts/reducers/store'

type UrlListener = (event: { url: string }) => void

const mockDispatch = jest.fn()
let mockDidAuthenticate = false

jest.mock('../../src/contexts/store', () => ({
  useStore: () => [{ authentication: { didAuthenticate: mockDidAuthenticate } }, mockDispatch],
}))
jest.mock('../../src/contexts/activity', () => ({
  useActivity: () => ({ appStateStatus: 'active' }),
}))

// eslint-disable-next-line import/first
import { useDeepLinks } from '../../src/hooks/deep-links'

const LINK = 'keyring://vta/approvals'

// The `url` listener the module registered when it was imported, for the life
// of the app. Read now, before any mock is reset.
const appListener: UrlListener | undefined = (Linking.addEventListener as unknown as jest.Mock).mock.calls.find(
  (call) => call[0] === 'url'
)?.[1]
// The `url` listener the mounted hook registers.
let hookListener: UrlListener | undefined

beforeEach(() => {
  mockDispatch.mockReset()
  mockDidAuthenticate = false
  hookListener = undefined
  ;(Linking as unknown as { getInitialURL: () => Promise<string | null> }).getInitialURL = jest.fn(async () => null)
  ;(Linking as unknown as { addListener: unknown }).addListener = jest.fn((_: string, listener: UrlListener) => {
    hookListener = listener
    return { remove: jest.fn() }
  })
})

describe('a link that arrives while the wallet is locked', () => {
  // Not only the approvals link: any link the system hands a locked wallet.
  it.each([
    ['the approvals link a tapped notification opens', LINK],
    ['an ordinary keyring:// link', 'keyring://vta/enrol?offer=abc'],
    ['an invitation link', 'https://example.org/invite?oob=eyJAdHlwZSI6Im91dC1vZi1iYW5kIn0'],
    ['a didcomm:// invitation', 'didcomm://invite?oob=eyJAdHlwZSI6Im91dC1vZi1iYW5kIn0'],
  ])('%s is kept, and becomes the active deep link once the wallet is unlocked', async (_name, link) => {
    // Locked: no hook is mounted. The system delivers the link.
    expect(appListener).toBeDefined()
    appListener?.({ url: link })
    expect(mockDispatch).not.toHaveBeenCalled()

    // Unlocked: the main stack mounts the hook.
    mockDidAuthenticate = true
    const hook = renderHook(() => useDeepLinks())
    await act(async () => {})
    expect(mockDispatch).toHaveBeenCalledTimes(1)
    expect(mockDispatch).toHaveBeenCalledWith({ type: DispatchAction.ACTIVE_DEEP_LINK, payload: [link] })
    hook.unmount()
  })

  it('delivers only the latest of two links that arrive while locked', async () => {
    appListener?.({ url: 'keyring://vta/enrol?offer=first' })
    appListener?.({ url: LINK })
    mockDidAuthenticate = true
    const hook = renderHook(() => useDeepLinks())
    await act(async () => {})
    expect(mockDispatch).toHaveBeenCalledTimes(1)
    expect(mockDispatch).toHaveBeenCalledWith({ type: DispatchAction.ACTIVE_DEEP_LINK, payload: [LINK] })
    hook.unmount()
  })

  it('is not taken twice when the hook is mounted and has its own listener', async () => {
    mockDidAuthenticate = true
    const hook = renderHook(() => useDeepLinks())
    await act(async () => {})

    // Mounted: the app-lifetime listener leaves the link to the hook's listener.
    appListener?.({ url: LINK })
    hook.unmount()

    mockDispatch.mockReset()
    const again = renderHook(() => useDeepLinks())
    await act(async () => {})
    expect(mockDispatch).not.toHaveBeenCalled()
    again.unmount()
  })

  it('keeps a link that was still waiting when the wallet locked', async () => {
    // Mounted, but this render cannot activate a link yet.
    const hook = renderHook(() => useDeepLinks())
    await act(async () => {})
    await act(async () => hookListener?.({ url: LINK }))
    expect(mockDispatch).not.toHaveBeenCalled()

    // The wallet locks: the main stack, and the hook with it, unmounts.
    hook.unmount()

    // Unlocked again: the link is still there.
    mockDidAuthenticate = true
    const again = renderHook(() => useDeepLinks())
    await act(async () => {})
    expect(mockDispatch).toHaveBeenCalledWith({ type: DispatchAction.ACTIVE_DEEP_LINK, payload: [LINK] })
    again.unmount()
  })
})
