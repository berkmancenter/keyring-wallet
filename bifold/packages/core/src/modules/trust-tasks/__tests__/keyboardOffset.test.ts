/**
 * The keyboard offset is where the view's parent starts on screen, measured —
 * not the header height a screen is told (225 gate: 62 reported for a header
 * ending at 106, and Claim's "Continue" stayed 25 pt under the keyboard).
 */
import { act, renderHook } from '@testing-library/react-native'
import { type LayoutChangeEvent, Platform, type View } from 'react-native'

import { useMeasuredKeyboardOffset } from '../screens/keyboardOffset'

const laidOut = (y: number) => ({ nativeEvent: { layout: { x: 0, y, width: 402, height: 600 } } }) as LayoutChangeEvent
const onScreenAt = (y: number) =>
  ({ measureInWindow: (cb: (x: number, y: number) => void) => cb(0, y) }) as unknown as View

describe('useMeasuredKeyboardOffset', () => {
  test('until measured, the offset is the fallback', () => {
    const { result } = renderHook(() => useMeasuredKeyboardOffset(62))
    expect(result.current.offset).toBe(62)
  })

  test('once laid out, it is where the view sits on screen, not the fallback', () => {
    const { result } = renderHook(() => useMeasuredKeyboardOffset(62))
    ;(result.current.ref as { current: View | null }).current = onScreenAt(106)
    act(() => result.current.onLayout(laidOut(0)))
    expect(result.current.offset).toBe(106)
  })

  test("a view below the top of its parent counts from the parent's top", () => {
    const { result } = renderHook(() => useMeasuredKeyboardOffset(0))
    ;(result.current.ref as { current: View | null }).current = onScreenAt(130)
    act(() => result.current.onLayout(laidOut(24)))
    expect(result.current.offset).toBe(106)
  })

  test('a measurement that is not a number leaves the offset as it was', () => {
    const { result } = renderHook(() => useMeasuredKeyboardOffset(62))
    ;(result.current.ref as { current: View | null }).current = onScreenAt(Number.NaN)
    act(() => result.current.onLayout(laidOut(0)))
    expect(result.current.offset).toBe(62)
  })

  test('a view measured above its own place in its parent counts as at the top, never below it', () => {
    const { result } = renderHook(() => useMeasuredKeyboardOffset(62))
    ;(result.current.ref as { current: View | null }).current = onScreenAt(0)
    act(() => result.current.onLayout(laidOut(24)))
    expect(result.current.offset).toBe(0)
  })

  describe('where the app draws under the status bar', () => {
    const STATUS_BAR = 42
    // The two measures of one view, as they differ on an Android phone: the window's leaves the status bar out.
    const atPage = (y: number) =>
      ({
        measure: (cb: (x: number, y: number, w: number, h: number, pageX: number, pageY: number) => void) =>
          cb(0, 0, 402, 600, 0, y),
        measureInWindow: (cb: (x: number, y: number) => void) => cb(0, y - STATUS_BAR),
      }) as unknown as View
    const os = Platform.OS
    afterEach(() => {
      Platform.OS = os
    })

    test('on Android, the status bar counts: the offset is from the top of the screen', () => {
      Platform.OS = 'android'
      const { result } = renderHook(() => useMeasuredKeyboardOffset(0))
      ;(result.current.ref as { current: View | null }).current = atPage(130)
      act(() => result.current.onLayout(laidOut(24)))
      expect(result.current.offset).toBe(106)
    })

    test('on Android, a measurement that is not a number leaves the offset as it was', () => {
      Platform.OS = 'android'
      const { result } = renderHook(() => useMeasuredKeyboardOffset(62))
      ;(result.current.ref as { current: View | null }).current = atPage(Number.NaN)
      act(() => result.current.onLayout(laidOut(0)))
      expect(result.current.offset).toBe(62)
    })

    test('on iOS, the window is the screen: it is still what is measured (the control)', () => {
      Platform.OS = 'ios'
      const { result } = renderHook(() => useMeasuredKeyboardOffset(0))
      ;(result.current.ref as { current: View | null }).current = atPage(130)
      act(() => result.current.onLayout(laidOut(24)))
      expect(result.current.offset).toBe(106 - STATUS_BAR)
    })
  })
})
