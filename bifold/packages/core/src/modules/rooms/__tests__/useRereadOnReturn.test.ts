/**
 * A screen listing rooms reads them again when it comes back into view, and, after a read that failed, when the
 * app comes back to the foreground while it is in view. Never on its first focus (the mount reads), never on a
 * return to the foreground after a read that answered, and never while another screen is in view.
 */
import { act, renderHook } from '@testing-library/react-native'
import { AppState } from 'react-native'

import { useRereadOnReturn } from '../useRereadOnReturn'

let mockFocused = true
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('../../../../__mocks__/@react-navigation/native'),
  useIsFocused: () => mockFocused,
}))

let onAppState: ((state: string) => void) | undefined
beforeEach(() => {
  mockFocused = true
  onAppState = undefined
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_type: string, listener: (s: string) => void) => {
    onAppState = listener
    return { remove: jest.fn() }
  }) as never)
})
afterEach(() => jest.restoreAllMocks())

const mount = (failed: boolean) => {
  const reload = jest.fn()
  const hook = renderHook((props: { failed: boolean }) => useRereadOnReturn({ reload, failed: props.failed }), {
    initialProps: { failed },
  })
  return { reload, hook }
}

const backAndForth = () =>
  act(() => {
    onAppState?.('background')
    onAppState?.('active')
  })

describe('reading rooms again on return', () => {
  it('on coming back into view, not on the first focus', () => {
    const { reload, hook } = mount(false)
    expect(reload).not.toHaveBeenCalled()
    mockFocused = false
    hook.rerender({ failed: false })
    mockFocused = true
    hook.rerender({ failed: false })
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('on returning to the app after a read that failed', () => {
    const { reload } = mount(true)
    backAndForth()
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('not on returning to the app after a read that answered (control for the one above)', () => {
    const { reload } = mount(false)
    backAndForth()
    expect(reload).not.toHaveBeenCalled()
  })

  it('reads the latest outcome: a read that fails after mount is read again on return', () => {
    const { reload, hook } = mount(false)
    hook.rerender({ failed: true })
    backAndForth()
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('not while another screen is in view; coming back reads instead', () => {
    const { reload, hook } = mount(true)
    mockFocused = false
    hook.rerender({ failed: true })
    backAndForth()
    expect(reload).not.toHaveBeenCalled()
    mockFocused = true
    hook.rerender({ failed: true })
    expect(reload).toHaveBeenCalledTimes(1)
  })
})
