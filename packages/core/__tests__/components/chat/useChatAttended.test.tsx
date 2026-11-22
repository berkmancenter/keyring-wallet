import { act, renderHook } from '@testing-library/react-native'
import { AppState, AppStateStatus } from 'react-native'

import { useChatAttended } from '../../../src/components/chat/useChatAttended'

let mockFocused = true
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('../../../__mocks__/@react-navigation/native'),
  useIsFocused: () => mockFocused,
}))

// jestSetup.js maps 'react-native' to the actual module, so the app's state is set on the real AppState.
let mockAppState: unknown = 'active'
let listeners: ((next: AppStateStatus) => void)[] = []
Object.defineProperty(AppState, 'currentState', { configurable: true, get: () => mockAppState })
AppState.addEventListener = ((_type: string, listener: (next: AppStateStatus) => void) => {
  listeners.push(listener)
  return { remove: () => (listeners = listeners.filter((l) => l !== listener)) }
}) as unknown as typeof AppState.addEventListener
const appGoes = (next: AppStateStatus) =>
  act(() => {
    mockAppState = next
    listeners.forEach((listener) => listener(next))
  })

beforeEach(() => {
  mockFocused = true
  mockAppState = 'active'
  listeners = []
})

test('attended while focused and active; not in the background or inactive; again on return', () => {
  const { result } = renderHook(() => useChatAttended())
  expect(result.current).toBe(true)
  appGoes('inactive')
  expect(result.current).toBe(false)
  appGoes('background')
  expect(result.current).toBe(false)
  appGoes('active')
  expect(result.current).toBe(true)
})

test('not attended while another screen is in front, however active the app', () => {
  mockFocused = false
  const { result, rerender } = renderHook(() => useChatAttended())
  expect(result.current).toBe(false)
  mockFocused = true
  rerender({})
  expect(result.current).toBe(true)
})

test('an app state not yet reported is taken as in use: an app starts in the foreground', () => {
  mockAppState = null
  expect(renderHook(() => useChatAttended()).result.current).toBe(true)
  mockAppState = 'unknown'
  expect(renderHook(() => useChatAttended()).result.current).toBe(true)
})

test('opened in the background, it is not attended', () => {
  mockAppState = 'background'
  expect(renderHook(() => useChatAttended()).result.current).toBe(false)
})

test('stops listening when it unmounts', () => {
  const { unmount } = renderHook(() => useChatAttended())
  expect(listeners).toHaveLength(1)
  unmount()
  expect(listeners).toHaveLength(0)
})
