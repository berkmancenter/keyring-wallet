/**
 * The keyboard offset is where the view's parent starts on screen, measured —
 * not the header height a screen is told (225 gate: 62 reported for a header
 * ending at 106, and Claim's "Continue" stayed 25 pt under the keyboard).
 */
import { act, renderHook } from '@testing-library/react-native'
import type { LayoutChangeEvent, View } from 'react-native'

import { useMeasuredKeyboardOffset } from '../screens/keyboardOffset'

const laidOut = (y: number) => ({ nativeEvent: { layout: { x: 0, y, width: 402, height: 600 } } }) as LayoutChangeEvent
const onScreenAt = (y: number) => ({ measureInWindow: (cb: (x: number, y: number) => void) => cb(0, y) }) as unknown as View

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
})
