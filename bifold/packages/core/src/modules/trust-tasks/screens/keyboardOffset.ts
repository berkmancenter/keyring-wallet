/**
 * Where a KeyboardAvoidingView sits on screen, measured, for its
 * `keyboardVerticalOffset`.
 *
 * keyboard-controller lifts a view by (offset + the view's own y + height) −
 * (screen height − keyboard height): the offset has to be where the view's
 * parent starts on screen. The screens passed the navigation header's height,
 * and on an iOS 26 iPhone 17 Pro that came back as the status bar alone (about
 * 62 of the 106 points above the page). So the view was lifted 45 points too
 * little, and the step's filled button stayed under the keyboard (225 gate:
 * Claim's "Continue", 25 pt under it). Measured, the offset holds whatever the
 * header, the tab bar, the phone or the iOS version.
 *
 * @module trust-tasks/screens/keyboardOffset
 */
import { useCallback, useRef, useState } from 'react'
import type { LayoutChangeEvent, View } from 'react-native'

export interface MeasuredKeyboardOffset {
  /** For the KeyboardAvoidingView. */
  ref: React.RefObject<View>
  /** For the KeyboardAvoidingView: re-measures whenever it is laid out. */
  onLayout: (e: LayoutChangeEvent) => void
  /** Where the view's parent starts on screen; `fallback` until measured. */
  offset: number
}

export function useMeasuredKeyboardOffset(fallback: number): MeasuredKeyboardOffset {
  const ref = useRef<View>(null)
  const [offset, setOffset] = useState(fallback)
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    // The view's y within its parent, from the layout; its y on screen, measured.
    const withinParent = e.nativeEvent.layout.y
    ref.current?.measureInWindow((_x, onScreen) => {
      if (Number.isFinite(onScreen)) setOffset(Math.max(0, onScreen - withinParent))
    })
  }, [])
  return { ref, onLayout, offset }
}
