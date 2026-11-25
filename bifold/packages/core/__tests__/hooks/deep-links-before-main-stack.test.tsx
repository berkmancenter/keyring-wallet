/**
 * A link that arrives before the main stack has ever rendered: during
 * onboarding, or on the PIN screen after a cold start. `useDeepLinks` lives in
 * the main stack; the module keeps such a link for it. A release build inlines
 * requires, so the keeper must be registered by a call as the app starts
 * (RootStack), not only when the module is first evaluated. Jest does not
 * inline requires, so the call itself is held by a source check.
 */
import { act, renderHook } from '@testing-library/react-native'
import { readFileSync } from 'fs'
import path from 'path'
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
import { keepLinksUntilMainStack, useDeepLinks } from '../../src/hooks/deep-links'

// A community's DID, as the VTC landing page's "Open in Keyring" links to it.
const COMMUNITY = 'did:webvh:QmCommunity:vtc.example:first-vtc'

const urlRegistrations = () =>
  (Linking.addEventListener as unknown as jest.Mock).mock.calls.filter((call) => call[0] === 'url')
const keeper: UrlListener | undefined = urlRegistrations()[0]?.[1]

beforeEach(() => {
  mockDispatch.mockReset()
  mockDidAuthenticate = false
  ;(Linking as unknown as { getInitialURL: () => Promise<string | null> }).getInitialURL = jest.fn(async () => null)
  ;(Linking as unknown as { addListener: unknown }).addListener = jest.fn(() => ({ remove: jest.fn() }))
})

describe('a link that arrives before the main stack has rendered', () => {
  it('is kept by one listener, however often the keeper is asked for', () => {
    const before = urlRegistrations().length
    expect(before).toBe(1)
    keepLinksUntilMainStack()
    keepLinksUntilMainStack()
    expect(urlRegistrations()).toHaveLength(before)
  })

  it("a community's DID tapped during onboarding becomes the active deep link once the main stack mounts", async () => {
    expect(keeper).toBeDefined()
    keeper?.({ url: COMMUNITY })
    expect(mockDispatch).not.toHaveBeenCalled()

    mockDidAuthenticate = true
    const hook = renderHook(() => useDeepLinks())
    await act(async () => {})
    expect(mockDispatch).toHaveBeenCalledWith({ type: DispatchAction.ACTIVE_DEEP_LINK, payload: [COMMUNITY] })
    hook.unmount()
  })

  it('RootStack asks for the keeper as it mounts, before any onboarding screen', () => {
    const source = readFileSync(path.join(__dirname, '../../src/navigators/RootStack.tsx'), 'utf8')
    expect(source).toMatch(/import \{ keepLinksUntilMainStack \} from '\.\.\/hooks\/deep-links'/)
    expect(source).toMatch(/useEffect\(\(\) => \{\s*keepLinksUntilMainStack\(\)\s*\}, \[\]\)/)
  })
})
