/**
 * A link the app opens itself (`openAppLink`, e.g. from a tapped push
 * notification) is handled like any deep link: it waits until the wallet is
 * unlocked, and one opened before the hook mounts (a cold start) is kept for it.
 */
import { act, renderHook } from '@testing-library/react-native'
import { Linking } from 'react-native'

import { DispatchAction } from '../../src/contexts/reducers/store'

const mockDispatch = jest.fn()
let mockDidAuthenticate = false

jest.mock('../../src/contexts/store', () => ({
  useStore: () => [{ authentication: { didAuthenticate: mockDidAuthenticate } }, mockDispatch],
}))
jest.mock('../../src/contexts/activity', () => ({
  useActivity: () => ({ appStateStatus: 'active' }),
}))

// eslint-disable-next-line import/first
import { openAppLink, useDeepLinks } from '../../src/hooks/deep-links'

const LINK = 'keyring://vta/approvals'

beforeEach(() => {
  mockDispatch.mockReset()
  mockDidAuthenticate = false
  ;(Linking as unknown as { getInitialURL: () => Promise<string | null> }).getInitialURL = jest.fn(async () => null)
  ;(Linking as unknown as { addListener: () => { remove: () => void } }).addListener = jest.fn(() => ({
    remove: jest.fn(),
  }))
})

describe('a link the app opens itself', () => {
  it('waits for the wallet to be unlocked, then becomes the active deep link', async () => {
    const hook = renderHook(() => useDeepLinks())
    await act(async () => openAppLink(LINK))
    expect(mockDispatch).not.toHaveBeenCalled()

    mockDidAuthenticate = true
    await act(async () => hook.rerender({}))
    expect(mockDispatch).toHaveBeenCalledWith({ type: DispatchAction.ACTIVE_DEEP_LINK, payload: [LINK] })
    hook.unmount()
  })

  it('opened before the hook mounts (a cold start), is kept for it', async () => {
    openAppLink(LINK)
    mockDidAuthenticate = true
    const hook = renderHook(() => useDeepLinks())
    await act(async () => {})
    expect(mockDispatch).toHaveBeenCalledWith({ type: DispatchAction.ACTIVE_DEEP_LINK, payload: [LINK] })
    hook.unmount()
  })
})
